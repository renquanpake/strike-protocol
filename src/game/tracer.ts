/**
 * #13 曳光数据池：环形槽位 + 出弹节流（与渲染层解耦，可单测）。
 * 狙击（有 zoom）每发一条；自动武器每 3 发一条；单发武器每发一条。
 */
export class TracerRing {
  private seq = 0

  constructor(private readonly size: number) {}

  /** 取下一槽位（环形复用最旧槽） */
  next(): number {
    const i = this.seq % this.size
    this.seq += 1
    return i
  }
}

/** 本发是否生成曳光：shotNo 为该武器第几发（从 1 起） */
export function tracerWanted(shotNo: number, def: { auto?: boolean; zoom?: unknown }): boolean {
  if (def.zoom) return true
  if (def.auto) return shotNo % 3 === 1
  return true
}
