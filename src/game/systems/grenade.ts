import { CONFIG } from '../config'
import { WEAPONS } from '../weapons'
import type { GameState } from '../state'
import type { PreppedLevel } from '../physics/collision'
import { raycastBoxes } from '../physics/raycast'
import { grantKillReward } from '../economy'
import { v3, type Vec3 } from '../../engine/math'
import type { EventBus } from '../../engine/eventbus'

const GRENADE_RADIUS = 8
const BOUNCE = CONFIG.grenadeBounceFriction

function fuseMs(kind: string): number {
  switch (kind) {
    case 'he':
      return CONFIG.heFuseMs
    case 'flash':
      return CONFIG.flashFuseMs
    case 'smoke':
      return CONFIG.smokeFuseMs
    case 'molotov':
      return CONFIG.molotovFuseMs
    default:
      return 1000
  }
}

/** 抛出（weapon 系统与 bot 共用） */
export function throwGrenade(state: GameState, shooter: { id: number }, kind: string, origin: Vec3, dir: Vec3, events: EventBus): void {
  const g = {
    id: state.nextGrenadeId++,
    kind: kind as 'he' | 'flash' | 'smoke' | 'molotov',
    owner: shooter.id,
    position: v3(origin.x, origin.y, origin.z),
    velocity: v3(dir.x * CONFIG.grenadeThrowSpeed, dir.y * CONFIG.grenadeThrowSpeed, dir.z * CONFIG.grenadeThrowSpeed),
    fuseUntilTick: state.tick + Math.round((fuseMs(kind) / 1000) * CONFIG.tickRate),
    exploded: false,
  }
  state.grenades.push(g)
  events.emit({ type: 'shot', shooterId: shooter.id, weaponId: kind })
}

/** 每 tick：投掷物物理 + 引爆 + 区域效果 */
export function updateGrenades(state: GameState, level: PreppedLevel, events: EventBus, dt: number): void {
  const tick = state.tick

  // 弹道与反弹
  for (const g of state.grenades) {
    if (g.exploded) continue
    g.velocity.y -= CONFIG.gravity * dt
    g.position.x += g.velocity.x * dt
    g.position.y += g.velocity.y * dt
    g.position.z += g.velocity.z * dt
    // 简单球体-AABB 反弹
    for (const b of level.solids) {
      const R = GRENADE_RADIUS
      const ox = g.position.x
      const oy = g.position.y
      const oz = g.position.z
      if (
        ox + R > b.min.x &&
        ox - R < b.max.x &&
        oy + R > b.min.y &&
        oy - R < b.max.y &&
        oz + R > b.min.z &&
        oz - R < b.max.z
      ) {
        // 最小穿透轴反弹
        const penX = Math.min(ox + R - b.min.x, b.max.x - (ox - R))
        const penY = Math.min(oy + R - b.min.y, b.max.y - (oy - R))
        const penZ = Math.min(oz + R - b.min.z, b.max.z - (oz - R))
        if (penX <= penY && penX <= penZ) {
          g.position.x = g.velocity.x > 0 ? b.min.x - R : b.max.x + R
          g.velocity.x *= -BOUNCE
        } else if (penY <= penZ) {
          g.position.y = g.velocity.y > 0 ? b.min.y - R : b.max.y + R
          g.velocity.y *= -BOUNCE
        } else {
          g.position.z = g.velocity.z > 0 ? b.min.z - R : b.max.z + R
          g.velocity.z *= -BOUNCE
        }
      }
    }
    // 引爆
    if (tick >= g.fuseUntilTick) {
      g.exploded = true
      detonate(state, g, level, events)
    }
  }
  state.grenades = state.grenades.filter((g) => !g.exploded)

  // 区域清理
  state.smokes = state.smokes.filter((z) => tick < z.untilTick)
  state.burns = state.burns.filter((z) => tick < z.untilTick)

  // 燃烧区持续伤害
  if (state.burns.length > 0) {
    const dps = CONFIG.molotovDps
    for (const z of state.burns) {
      for (const p of state.players) {
        if (!p.alive) continue
        if (dist2D(z.center, p.position) <= z.radius) {
          p.health -= dps * dt
          if (p.health <= 0) killPlayer(state, p, 0, 'molotov', events)
        }
      }
      for (const t of state.targets) {
        if (!t.alive) continue
        if (dist2D(z.center, t.position) <= z.radius) {
          t.health -= dps * dt
          if (t.health <= 0) {
            t.alive = false
            t.respawnAtTick = tick + Math.round((2000 / 1000) * CONFIG.tickRate)
          }
        }
      }
    }
  }
}

function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function killPlayer(state: GameState, victim: (typeof state.players)[number], attackerId: number, weaponId: string, events: EventBus): void {
  if (!victim.alive) return
  victim.alive = false
  victim.health = 0
  victim.deaths += 1
  if (attackerId >= 0) {
    const killer = state.players[attackerId]
    if (killer) {
      killer.kills += 1
      grantKillReward(killer, WEAPONS[weaponId]?.killReward ?? 300)
    }
  }
  if (state.round.c4.state === 'carried' && state.round.c4.carrierId === victim.id) {
    state.round.c4.state = 'dropped'
    state.round.c4.carrierId = null
    state.round.c4.position = v3(victim.position.x, victim.position.y, victim.position.z)
  }
  events.emit({ type: 'playerKilled', victimId: victim.id, attackerId, weaponId })
}

function detonate(state: GameState, g: (typeof state.grenades)[number], level: PreppedLevel, events: EventBus): void {
  events.emit({
    type: 'grenadeExploded',
    kind: g.kind,
    x: g.position.x,
    y: g.position.y,
    z: g.position.z,
  })
  switch (g.kind) {
    case 'he': {
      const radius = CONFIG.heRadius
      const owner = state.players[g.owner]
      for (const p of state.players) {
        if (!p.alive) continue
        const d = Math.hypot(p.position.x - g.position.x, p.position.y + 40 - g.position.y, p.position.z - g.position.z)
        if (d <= radius) {
          const dmg = WEAPONS.he.damage * (1 - d / radius)
          p.health -= dmg
          if (p.health <= 0) killPlayer(state, p, g.owner, 'he', events)
        }
      }
      for (const t of state.targets) {
        if (!t.alive) continue
        const d = Math.hypot(t.position.x - g.position.x, t.position.y + 40 - g.position.y, t.position.z - g.position.z)
        if (d <= radius) {
          t.health -= WEAPONS.he.damage * (1 - d / radius)
          if (t.health <= 0) {
            t.alive = false
            t.respawnAtTick = state.tick + Math.round((2000 / 1000) * CONFIG.tickRate)
          }
        }
      }
      void owner
      break
    }
    case 'flash': {
      const radius = CONFIG.flashRadius
      const blindTicks = Math.round((CONFIG.flashBlindMs / 1000) * CONFIG.tickRate)
      const boxes = level.solids.map((b, i) => ({ id: `b${i}`, min: b.min, max: b.max }))
      for (const p of state.players) {
        if (!p.alive) continue
        const eye = { x: p.position.x, y: p.position.y + CONFIG.eyeHeight, z: p.position.z }
        const dx = g.position.x - eye.x
        const dy = g.position.y - eye.y
        const dz = g.position.z - eye.z
        const dist = Math.hypot(dx, dy, dz)
        if (dist > radius || dist < 1e-6) continue
        const hit = raycastBoxes(eye, v3(dx / dist, dy / dist, dz / dist), boxes)
        if (hit && hit.t < dist - 10) continue // 被墙挡住
        p.blindUntil = state.tick + blindTicks
      }
      break
    }
    case 'smoke': {
      state.smokes.push({
        id: state.nextZoneId++,
        center: { x: g.position.x, y: g.position.y, z: g.position.z },
        radius: CONFIG.smokeRadius,
        untilTick: state.tick + Math.round((CONFIG.smokeLifeMs / 1000) * CONFIG.tickRate),
      })
      break
    }
    case 'molotov': {
      state.burns.push({
        id: state.nextZoneId++,
        center: { x: g.position.x, y: g.position.y, z: g.position.z },
        radius: CONFIG.molotovRadius,
        untilTick: state.tick + Math.round((CONFIG.molotovLifeMs / 1000) * CONFIG.tickRate),
      })
      break
    }
  }
}

/** 烟雾遮蔽（Bot 感知 / 闪光判定用） */
export function inSmoke(state: GameState, x: number, y: number, z: number): boolean {
  for (const s of state.smokes) {
    const dx = x - s.center.x
    const dz = z - s.center.z
    if (dx * dx + dz * dz <= s.radius * s.radius && Math.abs(y - s.center.y) < 90) return true
  }
  return false
}
