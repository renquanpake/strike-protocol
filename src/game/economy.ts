import { CONFIG } from './config'
import { WEAPONS, newWeaponInstance } from './weapons'
import type { GameState, PlayerEntity } from './state'
import type { EventBus } from '../engine/eventbus'
import type { Team } from './types'

function clampMoney(v: number): number {
  return Math.max(0, Math.min(CONFIG.moneyCap, Math.round(v)))
}

/** 击杀奖励入账（击杀者） */
export function grantKillReward(killer: PlayerEntity, amount: number): void {
  killer.money = clampMoney(killer.money + amount)
}

/** 回合结束结算：胜方奖金 + 败方连败补偿 */
export function settleRoundEconomy(state: GameState): void {
  const r = state.round
  const winner = r.lastWinner
  if (!winner) return
  const loser: Team = winner === 'T' ? 'CT' : 'T'
  r.lossStreak[winner] = 0
  r.lossStreak[loser] += 1

  for (const p of state.players) {
    if (p.team === winner) {
      p.money = clampMoney(p.money + CONFIG.roundWinBonus)
    } else {
      const streak = r.lossStreak[loser]
      // 首败 $0，第 2 次连败起按阶梯 [1400,1900,2400,2900,3400]
      const bonus = streak < 2 ? 0 : CONFIG.lossBonus[Math.min(streak - 2, CONFIG.lossBonus.length - 1)]
      p.money = clampMoney(p.money + bonus)
    }
  }
}

/** 购买窗口：freeze 全程 + live 前 buyTimeMs */
export function canBuyNow(state: GameState): boolean {
  const r = state.round
  if (r.phase === 'freeze') return true
  if (r.phase === 'live') {
    const liveStartTick = r.phaseEndTick - Math.round((CONFIG.roundTimeMs / 1000) * CONFIG.tickRate)
    const buyEndTick = liveStartTick + Math.round((CONFIG.buyTimeMs / 1000) * CONFIG.tickRate)
    return state.tick <= buyEndTick
  }
  return false
}

/** 购买（仅时间窗口内，M4 加出生区限制） */
export function buyItem(state: GameState, p: PlayerEntity, itemId: string, events: EventBus): boolean {
  if (!canBuyNow(state)) return false
  if (itemId === 'kit') {
    const cost = 500
    if (p.money < cost || p.hasKit) return false
    p.money -= cost
    p.hasKit = true
    events.emit({ type: 'shot', shooterId: p.id, weaponId: 'kit' })
    return true
  }
  const def = WEAPONS[itemId]
  if (!def || def.price <= 0) return false
  if (p.money < def.price) return false
  p.money -= def.price
  const slot = slotFor(def.id)
  if (slot === 'primary') p.weapons.primary = newWeaponInstance(def.id)
  else p.weapons.secondary = newWeaponInstance(def.id)
  p.activeSlot = slot === 'primary' ? 0 : 1
  return true
}

function slotFor(defId: string): 'primary' | 'secondary' {
  const cat = WEAPONS[defId].category
  if (cat === 'pistol' || cat === 'smg') return 'secondary'
  return 'primary'
}

/** 回合开始重置装备：败方保留手枪+刀，胜方保留装备（弹药回满） */
export function resetEquipment(state: GameState): void {
  const winner = state.round.lastWinner
  for (const p of state.players) {
    const keepFull = p.team === winner
    if (keepFull) {
      for (const inst of [p.weapons.primary, p.weapons.secondary, p.weapons.knife]) {
        if (!inst) continue
        const def = WEAPONS[inst.defId]
        inst.ammoMag = def.magazine
        inst.ammoReserve = def.reserve
        inst.reloadUntilTick = 0
      }
    } else {
      p.weapons.primary = null
      p.weapons.secondary = newWeaponInstance('glock')
      p.weapons.knife = newWeaponInstance('knife')
      p.activeSlot = 1
    }
  }
}

export const GEAR_PRICES: Record<string, number> = {
  kit: 500,
}
