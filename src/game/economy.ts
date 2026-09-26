import { CONFIG } from './config'
import { WEAPONS, newWeaponInstance, type WeaponDef } from './weapons'
import type { GameState, PlayerEntity } from './state'
import { inBuyZone, type PreppedLevel } from './physics/collision'
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

/** 购买窗口：freeze 全程 + live 前 buyTimeMs（CS：5s 冻结 + 5s = 10s） */
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

/** 阵营限购（CS）：CT 不卖燃烧瓶；T 不卖拆弹钳。手枪轮（首回合）只允许刀/手枪/装备。 */
function buyAllowed(p: PlayerEntity, state: GameState, def: WeaponDef | null, itemId: string): boolean {
  if (itemId === 'kit' && p.team !== 'CT') return false
  if (itemId === 'molotov' && p.team !== 'T') return false
  if (state.mode !== 'de' || !CONFIG.pistolRound || state.round.roundNumber !== 1) return true
  const isGear = itemId === 'kit' || itemId === 'kevlar' || itemId === 'kevlarHelmet'
  if (isGear || def?.category === 'knife' || def?.category === 'pistol') return true
  return false
}

/** 购买（时间窗口 + 出生区买区 + 阵营限购 + 手枪轮限制） */
export function buyItem(state: GameState, p: PlayerEntity, itemId: string, events: EventBus, level?: PreppedLevel): boolean {
  if (!canBuyNow(state)) return false
  // CS：只能在本方出生区（买区）内购买
  if (state.mode === 'de' && level && !inBuyZone(level, p.team, p.position.x, p.position.z)) return false
  const def = WEAPONS[itemId] ?? null
  if (!buyAllowed(p, state, def, itemId)) return false
  if (itemId === 'kit') {
    const cost = GEAR_PRICES.kit
    if (p.money < cost || p.hasKit) return false
    p.money -= cost
    p.hasKit = true
    events.emit({ type: 'shot', shooterId: p.id, weaponId: 'kit' })
    return true
  }
  // #18 护甲：kevlar=100 甲；kevlarHelmet=100 甲+头盔（爆头减伤）。已穿可补满。
  if (itemId === 'kevlar' || itemId === 'kevlarHelmet') {
    const cost = GEAR_PRICES[itemId]
    if (p.money < cost) return false
    p.money -= cost
    p.armor = 100
    if (itemId === 'kevlarHelmet') p.helmet = true
    events.emit({ type: 'shot', shooterId: p.id, weaponId: itemId })
    return true
  }
  if (!def || def.price <= 0) return false
  if (p.money < def.price) return false
  p.money -= def.price
  if (def.category === 'grenade') {
    const idx = GRENADE_ORDER.indexOf(def.id as (typeof GRENADE_ORDER)[number])
    if (idx < 0) return false
    if (!p.weapons.grenades[idx]) {
      p.weapons.grenades[idx] = newWeaponInstance(def.id)
      p.activeSlot = idx + 3
    }
    return true
  }
  const slot = slotFor(def.id)
  if (slot === 'primary') p.weapons.primary = newWeaponInstance(def.id)
  else p.weapons.secondary = newWeaponInstance(def.id)
  p.activeSlot = slot === 'primary' ? 0 : 1
  return true
}

const GRENADE_ORDER = ['he', 'flash', 'smoke', 'molotov']

function slotFor(defId: string): 'primary' | 'secondary' {
  const cat = WEAPONS[defId].category
  if (cat === 'pistol' || cat === 'smg') return 'secondary'
  return 'primary'
}

/** 回合开始重置装备：败方保留阵营默认手枪+刀（T=Glock / CT=USP-S），胜方保留装备（弹药回满） */
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
      p.weapons.secondary = newWeaponInstance(p.team === 'CT' ? 'usp' : 'glock')
      p.weapons.knife = newWeaponInstance('knife')
      p.weapons.grenades = [null, null, null, null]
      p.activeSlot = 1
    }
  }
}

export const GEAR_PRICES: Record<string, number> = {
  kit: 500,
  kevlar: 650,
  kevlarHelmet: 1000,
}
