/**
 * #27 丢弃/拾取装备：G 键丢当前武器（主/副）或 C4；走过 40u 内自动拾取空槽。
 * 每 tick 对所有玩家调用（bot 不产生 dropQueued，拾取对 bot 无效——仅本地玩家有意义，
 * 但逻辑统一处理；回合重置由 round.enterFreeze 清空 droppedWeapons）。
 */
import type { GameState, PlayerEntity } from '../state'
import type { EventBus } from '../../engine/eventbus'
import { v3 } from '../../engine/math'
import { WEAPONS, newWeaponInstance } from '../weapons'

/** 40u 拾取半径（与 C4 拾取/拆除一致） */
const PICKUP_RADIUS = 40

function slotForDef(defId: string): 'primary' | 'secondary' {
  const cat = WEAPONS[defId].category
  if (cat === 'pistol' || cat === 'smg') return 'secondary'
  return 'primary'
}

export function updateDrops(state: GameState, p: PlayerEntity, events: EventBus): void {
  if (!p.alive || state.round.phase !== 'live') return
  const inp = p.input

  if (inp.dropQueued) {
    const c4 = state.round.c4
    // 携包 T 按 G → C4 掉落（与 #17 拾取互通）
    if (c4.state === 'carried' && c4.carrierId === p.id && p.team === 'T') {
      c4.state = 'dropped'
      c4.carrierId = null
      c4.position = v3(p.position.x, p.position.y, p.position.z)
      return
    }
    // 丢弃当前主/副武器
    if (p.activeSlot === 0 && p.weapons.primary) {
      const inst = p.weapons.primary
      p.weapons.primary = null
      p.activeSlot = 1
      state.droppedWeapons.push({
        id: state.nextDropId++,
        defId: inst.defId,
        position: v3(p.position.x, p.position.y + 4, p.position.z),
        ammoMag: inst.ammoMag,
        ammoReserve: inst.ammoReserve,
      })
      events.emit({ type: 'shot', shooterId: p.id, weaponId: 'drop' })
    } else if (p.activeSlot === 1 && p.weapons.secondary) {
      const inst = p.weapons.secondary
      p.weapons.secondary = null
      state.droppedWeapons.push({
        id: state.nextDropId++,
        defId: inst.defId,
        position: v3(p.position.x, p.position.y + 4, p.position.z),
        ammoMag: inst.ammoMag,
        ammoReserve: inst.ammoReserve,
      })
      events.emit({ type: 'shot', shooterId: p.id, weaponId: 'drop' })
    }
  }

  // 拾取：脚下 40u 内、对应槽位为空的掉落物
  for (let i = state.droppedWeapons.length - 1; i >= 0; i--) {
    const drop = state.droppedWeapons[i]
    const dx = p.position.x - drop.position.x
    const dz = p.position.z - drop.position.z
    const dy = p.position.y - drop.position.y
    if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS || Math.abs(dy) > 60) continue
    const slot = slotForDef(drop.defId)
    if (slot === 'primary' && p.weapons.primary) continue
    if (slot === 'secondary' && p.weapons.secondary) continue
    const inst = newWeaponInstance(drop.defId)
    inst.ammoMag = drop.ammoMag
    inst.ammoReserve = drop.ammoReserve
    if (slot === 'primary') p.weapons.primary = inst
    else p.weapons.secondary = inst
    p.activeSlot = slot === 'primary' ? 0 : 1
    state.droppedWeapons.splice(i, 1)
  }
}
