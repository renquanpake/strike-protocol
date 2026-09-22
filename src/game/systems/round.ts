import { CONFIG } from '../config'
import type { GameState, PlayerEntity } from '../state'
import { teamPlayers } from '../state'
import type { PreppedLevel } from '../physics/collision'
import type { EventBus } from '../../engine/eventbus'
import { settleRoundEconomy, resetEquipment } from '../economy'
import type { Team } from '../types'

function msToTicks(ms: number): number {
  return Math.round((ms / 1000) * CONFIG.tickRate)
}

function teamIndexOf(state: GameState, p: PlayerEntity): number {
  const mates = teamPlayers(state, p.team)
  const i = mates.findIndex((m) => m.id === p.id)
  return i < 0 ? 0 : i
}

/** 出生点（半场换边后互换） */
export function teamSpawn(state: GameState, level: PreppedLevel, team: Team, idx: number): { x: number; y: number; z: number } {
  const swapped = state.round.sidesSwapped
  const tSpawns = swapped ? level.spawns.CT : level.spawns.T
  const cSpawns = swapped ? level.spawns.T : level.spawns.CT
  const list = team === 'T' ? tSpawns : cSpawns
  return list[idx % list.length]
}

/** 进入冻结时间：结算上回合、重置位置与装备 */
function enterFreeze(state: GameState, level: PreppedLevel): void {
  const r = state.round
  r.roundNumber += 1
  r.c4 = {
    state: 'carried',
    carrierId: 0,
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    explodeAtTick: 0,
    position: { x: 0, y: 0, z: 0 },
  }
  for (const p of state.players) {
    const sp = teamSpawn(state, level, p.team, teamIndexOf(state, p))
    p.position = { x: sp.x, y: sp.y + 40, z: sp.z }
    p.velocity = { x: 0, y: 0, z: 0 }
    p.yaw = sp.z > 0 ? 0 : Math.PI
    p.pitch = 0
    p.alive = true
    p.health = CONFIG.healthMax
    p.armor = 0
    p.helmet = false
    p.onGround = false
    p.onLadder = false
    p.crouching = false
    p.blindUntil = 0
    p.hasKit = p.team === 'CT' ? p.hasKit : false
  }
  // 清场：投掷物与区域效果
  state.grenades = []
  state.smokes = []
  state.burns = []
  state.droppedWeapons = []
  resetEquipment(state)
  // C4 交给 T 侧存活随机一人（M3：本地玩家）
  r.c4.carrierId = 0
  r.phase = 'freeze'
  r.phaseEndTick = state.tick + msToTicks(CONFIG.freezeMs)
}

function endRound(state: GameState, winner: Team, result: 'elimination' | 'timeout' | 'bomb' | 'defuse'): void {
  const r = state.round
  r.lastWinner = winner
  r.lastResult = result
  r.score[winner] += 1
  if (winner === 'T' && r.c4.state === 'planted' && result === 'defuse') r.c4.state = 'defused'
  if (result === 'bomb') r.c4.state = 'exploded'
  settleRoundEconomy(state)

  // #26 加时 MR3：常规 30 回合（15+15）无人到 16 → 进入加时（overtime=1）。
  const otRounds = r.roundNumber - 30
  if (r.overtime === 0 && r.roundNumber >= 30 && r.score.T < CONFIG.winRounds && r.score.CT < CONFIG.winRounds) {
    r.overtime = 1
  }
  const winThreshold = CONFIG.winRounds + r.overtime * 3

  // 常规胜：分数到阈值（常规 16；加时节 19/22/...）
  if (r.score[winner] >= winThreshold) {
    r.phase = 'matchEnd'
    r.phaseEndTick = Infinity
    return
  }
  // 半场（仅常规时间）
  if (r.overtime === 0 && r.roundNumber >= 15 && r.roundNumber % 15 === 0) {
    r.phase = 'halftime'
    r.phaseEndTick = state.tick + msToTicks(CONFIG.halftimeMs)
    r.sidesSwapped = !r.sidesSwapped
    return
  }
  // 加时节内：每 3 回合换边；节末 3:3（同分）→ 进入下一节（阈值 +3）
  if (r.overtime > 0 && otRounds > 0 && otRounds % 3 === 0) {
    r.sidesSwapped = !r.sidesSwapped
    if (r.score.T === r.score.CT) r.overtime += 1
  }
  r.phase = 'roundEnd'
  r.phaseEndTick = state.tick + msToTicks(CONFIG.roundEndMs)
}

/** 每 tick 回合状态机 */
export function updateRound(state: GameState, level: PreppedLevel, events: EventBus, dt: number): void {
  const r = state.round
  const tick = state.tick

  // 阶段推进
  if (r.phase === 'warmup' && tick >= r.phaseEndTick) {
    enterFreeze(state, level)
    return
  }
  if (r.phase === 'freeze' && tick >= r.phaseEndTick) {
    r.phase = 'live'
    r.phaseEndTick = tick + msToTicks(CONFIG.roundTimeMs)
  }
  if (r.phase === 'roundEnd' && tick >= r.phaseEndTick) {
    enterFreeze(state, level)
    return
  }
  if (r.phase === 'halftime' && tick >= r.phaseEndTick) {
    enterFreeze(state, level)
    return
  }
  if (r.phase === 'matchEnd') return

  // C4 位置同步（携带中）
  if (r.c4.state === 'carried' && r.c4.carrierId !== null) {
    const carrier = state.players[r.c4.carrierId]
    if (carrier && carrier.alive) {
      r.c4.position = { x: carrier.position.x, y: carrier.position.y, z: carrier.position.z }
    }
  }

  if (r.phase === 'live') {
    // 安放：T 侧在 bombsite 内按住 E
    const c4 = r.c4
    if (c4.state === 'carried' && c4.carrierId !== null) {
      const carrier = state.players[c4.carrierId]
      if (carrier?.alive && carrier.input.useHeld) {
        const site = siteAt(level, carrier.position.x, carrier.position.z, carrier.position.y)
        if (site) {
          c4.plantProgress += dt / (CONFIG.plantMs / 1000)
          if (c4.plantProgress >= 1) {
            c4.state = 'planted'
            c4.site = site.name
            c4.plantProgress = 0
            c4.explodeAtTick = tick + msToTicks(CONFIG.c4TimerMs)
            c4.position = { x: site.center.x, y: site.elevation, z: site.center.z }
            events.emit({ type: 'bombPlanted', site: site.name })
            r.phase = 'bombPlanted'
            r.phaseEndTick = c4.explodeAtTick
          }
        } else {
          c4.plantProgress = 0
        }
      }
    }
    // C4 掉落拾取（#17）：T 侧存活者走近掉落点即拾取
    if (c4.state === 'dropped') {
      for (const p of teamPlayers(state, 'T')) {
        if (!p.alive) continue
        const dx = p.position.x - c4.position.x
        const dz = p.position.z - c4.position.z
        const dy = p.position.y - c4.position.y
        if (dx * dx + dz * dz <= 40 * 40 && Math.abs(dy) < 60) {
          c4.state = 'carried'
          c4.carrierId = p.id
          events.emit({ type: 'c4PickedUp', playerId: p.id })
          break
        }
      }
    }
    // 超时 → CT 胜
    if (tick >= r.phaseEndTick) {
      endRound(state, 'CT', 'timeout')
      return
    }
    // 团灭判定
    const tAlive = teamPlayers(state, 'T').filter((p) => p.alive).length
    const ctAlive = teamPlayers(state, 'CT').filter((p) => p.alive).length
    if (ctAlive === 0) {
      endRound(state, 'T', 'elimination')
      return
    }
    if (tAlive === 0 && r.c4.state !== 'planted') {
      endRound(state, 'CT', 'elimination')
      return
    }
  }

  if (r.phase === 'bombPlanted') {
    const c4 = r.c4
    // 拆除：CT 侧持钳者靠近 C4 按住 E
    if (c4.state === 'planted') {
      for (const p of state.players) {
        if (p.team !== 'CT' || !p.alive || !p.hasKit || !p.input.useHeld) continue
        const dx = p.position.x - c4.position.x
        const dz = p.position.z - c4.position.z
        const dy = p.position.y - c4.position.y
        if (dx * dx + dz * dz + dy * dy <= 40 * 40) {
          const need = p.hasKit ? CONFIG.defuseWithKitMs : CONFIG.defuseMs
          c4.defuseProgress += dt / (need / 1000)
          if (c4.defuseProgress >= 1) {
            endRound(state, 'CT', 'defuse')
            return
          }
        }
      }
      if (c4.defuseProgress > 0 && !anyDefusing(state, c4)) c4.defuseProgress = Math.max(0, c4.defuseProgress - dt * 0.5)
      // C4 滴答（越临近爆炸越密）
      const remainTicks = c4.explodeAtTick - tick
      if (remainTicks > 0) {
        const interval = remainTicks > 640 ? 64 : remainTicks > 320 ? 32 : 16
        if ((c4.explodeAtTick - tick) % interval === 0) {
          events.emit({ type: 'c4Beep', remainingMs: (remainTicks / CONFIG.tickRate) * 1000 })
        }
      }
      // 爆炸
      if (tick >= c4.explodeAtTick) {
        for (const p of state.players) {
          p.alive = false
          p.health = 0
          p.deaths += 1
        }
        endRound(state, 'T', 'bomb')
        events.emit({ type: 'bombExploded' })
        return
      }
    }
  }
}

function anyDefusing(state: GameState, c4: { position: { x: number; y: number; z: number }; defuseProgress: number }): boolean {
  if (c4.defuseProgress <= 0) return false
  for (const p of state.players) {
    if (p.team !== 'CT' || !p.alive || !p.hasKit || !p.input.useHeld) continue
    const dx = p.position.x - c4.position.x
    const dz = p.position.z - c4.position.z
    if (dx * dx + dz * dz <= 40 * 40) return true
  }
  return false
}

function siteAt(
  level: PreppedLevel,
  x: number,
  z: number,
  y: number,
): { name: 'A' | 'B'; center: { x: number; y: number; z: number }; elevation: number } | null {
  for (const s of level.sites) {
    const dx = x - s.center.x
    const dz = z - s.center.z
    if (Math.abs(dx) <= s.half && Math.abs(dz) <= s.half && Math.abs(y - s.elevation) < 60) {
      return s
    }
  }
  return null
}

export function aliveCount(state: GameState, team: Team): number {
  return teamPlayers(state, team).filter((p) => p.alive).length
}
