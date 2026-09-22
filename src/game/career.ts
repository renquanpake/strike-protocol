/**
 * #40 生涯战绩持久化（localStorage `sp_career_v1`）。
 * 仅记录本地玩家视角的每局结果，FIFO 保留最近 100 局 + 累计统计。
 */
export interface MatchRecord {
  date: number
  mapId: string
  mode: string
  result: 'win' | 'loss' | 'draw'
  score: [number, number]
  k: number
  d: number
  hs: number
}

export interface CareerTotals {
  games: number
  wins: number
  kills: number
  deaths: number
  hs: number
}

export interface Career {
  matches: MatchRecord[]
  totals: CareerTotals
}

const KEY = 'sp_career_v1'
const CAP = 100

function blank(): Career {
  return {
    matches: [],
    totals: { games: 0, wins: 0, kills: 0, deaths: 0, hs: 0 },
  }
}

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return blank()
    const c = JSON.parse(raw) as Career
    if (!c.matches || !c.totals) return blank()
    return c
  } catch {
    return blank()
  }
}

/** 一局结束写入（matchEnd 时调用一次） */
export function recordMatch(rec: Omit<MatchRecord, 'date'>): void {
  const c = loadCareer()
  c.matches.push({ ...rec, date: Date.now() })
  c.totals.games += 1
  if (rec.result === 'win') c.totals.wins += 1
  c.totals.kills += rec.k
  c.totals.deaths += rec.d
  c.totals.hs += rec.hs
  // FIFO
  while (c.matches.length > CAP) c.matches.shift()
  saveCareer(c)
}

export function saveCareer(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // 静默
  }
}
