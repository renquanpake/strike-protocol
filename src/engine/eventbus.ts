/** 最小类型化事件总线：系统产出事件，UI/音频/Bot 消费 */
export type GameEvent =
  | { type: 'shot'; shooterId: number; weaponId: string }
  | { type: 'hit'; victimId: number; part: string; damage: number }
  | { type: 'targetKilled'; victimId: number; weaponId: string }
  | { type: 'reloadStarted'; weaponId: string }
  | { type: 'reloadFinished'; weaponId: string }

export class EventBus {
  private handlers: Record<string, Array<(e: GameEvent) => void>> = {}

  on<T extends GameEvent['type']>(
    type: T,
    fn: (e: Extract<GameEvent, { type: T }>) => void,
  ): void {
    const list = (this.handlers[type] ??= [])
    list.push(fn as (e: GameEvent) => void)
  }

  off(type: string, fn: (e: GameEvent) => void): void {
    const list = this.handlers[type]
    if (!list) return
    const i = list.indexOf(fn)
    if (i >= 0) list.splice(i, 1)
  }

  emit(e: GameEvent): void {
    const list = this.handlers[e.type]
    if (!list) return
    for (const fn of [...list]) fn(e)
  }

  clear(): void {
    this.handlers = {}
  }
}
