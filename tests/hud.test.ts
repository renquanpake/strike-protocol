import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { createGameState } from '../src/game/state'
import { matchLevel } from '../src/game/map/match'
import { roundLine } from '../src/ui/hud'

function makeState() {
  const level = matchLevel()
  return createGameState(level.spawns.T, level.spawns.CT, CONFIG.healthMax, CONFIG.startMoney, 0x99)
}

describe('HUD 回合栏（M9 复刻检查回归）', () => {
  it('live 相位剩余时间按 tick/64 换算（115s）', () => {
    const state = makeState()
    state.round.phase = 'live'
    state.round.roundNumber = 1
    state.round.phaseEndTick = state.tick + Math.round(115 * CONFIG.tickRate)
    const line = roundLine(state)
    expect(line).toContain('115s')
    expect(line).toContain('LIVE')
  })

  it('freeze 相位显示购买倒计时（5s）', () => {
    const state = makeState()
    state.round.phase = 'freeze'
    state.round.phaseEndTick = state.tick + Math.round(5 * CONFIG.tickRate)
    const line = roundLine(state)
    expect(line).toContain('BUY 5.0s')
  })

  it('bombPlanted 显示 C4 爆炸倒计时与站点', () => {
    const state = makeState()
    state.round.phase = 'bombPlanted'
    state.round.c4.state = 'planted'
    state.round.c4.site = 'A'
    state.round.c4.explodeAtTick = state.tick + Math.round(40 * CONFIG.tickRate)
    const line = roundLine(state)
    expect(line).toContain('C4 A 40s')
  })

  it('本地玩家携带 C4 时显示 C4:携带', () => {
    const state = makeState()
    state.round.phase = 'live'
    state.round.c4.state = 'carried'
    state.round.c4.carrierId = 0
    expect(roundLine(state)).toContain('C4:携带')
  })
})
