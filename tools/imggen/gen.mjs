#!/usr/bin/env node
// 生图批处理：读取 .env + queue.json，调用 agnes 生图 API，下载 PNG 到 public/textures/
// 用法：node tools/imggen/gen.mjs [--force] [file ...]（不带 file 则跑整个队列）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const force = process.argv.includes('--force')
// 仅把 argv[2..] 里非 --force 的作为目标文件名
const only = process.argv.slice(2).filter((a) => a !== '--force' && !a.startsWith('-'))

function loadEnv() {
  const p = join(__dirname, '.env')
  const lines = readFileSync(p, 'utf8').split('\n')
  const env = {}
  for (const l of lines) {
    const m = l.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = loadEnv()
const BASE = env.AGNES_API_BASE.replace(/\/$/, '')
const KEY = env.AGNES_API_KEY
const MODEL = env.AGNES_IMAGE_MODEL || 'agnes-image-2.5-flash'
if (!KEY) throw new Error('AGNES_API_KEY missing in .env')

const queue = JSON.parse(readFileSync(join(__dirname, 'queue.json'), 'utf8'))
const outDir = join(__dirname, '..', '..', 'public', 'textures')
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function generate(item) {
  const out = join(outDir, item.file + '.png')
  if (existsSync(out) && !force) {
    console.log(`SKIP  ${item.file}.png (exists, use --force to regenerate)`)
    return
  }
  const body = { model: MODEL, prompt: item.prompt, n: 1 }
  if (item.size) body.size = item.size
  let url
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + '/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const j = await res.json()
      url = j?.data?.[0]?.url
      if (!url) throw new Error('no url in response: ' + JSON.stringify(j).slice(0, 200))
      break
    } catch (e) {
      console.error(`  retry ${attempt + 1} for ${item.file}: ${e.message}`)
      await sleep(3000 * (attempt + 1))
      if (attempt === 2) throw e
    }
  }
  const img = await fetch(url)
  if (!img.ok) throw new Error(`download failed ${img.status}`)
  const buf = Buffer.from(await img.arrayBuffer())
  writeFileSync(out, buf)
  console.log(`OK    ${item.file}.png (${(buf.length / 1024).toFixed(0)} KB)`)
}

const items = only.length ? queue.filter((q) => only.includes(q.file)) : queue
if (items.length === 0) {
  console.log('nothing to do')
  process.exit(0)
}

for (const item of items) {
  console.log(`\n=== ${item.file} ===\n${item.prompt.slice(0, 120)}...`)
  try {
    await generate(item)
  } catch (e) {
    console.error(`FAIL  ${item.file}: ${e.message}`)
  }
  await sleep(1500)
}
console.log('\nbatch done')
