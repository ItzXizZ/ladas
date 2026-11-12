// Dev tool: one contact sheet of frames from the running server.
//   npx tsx scripts/still.ts "<query>" <out.jpg> [where] [cols] [scale]
// query: "reel=ID" or "demo=poses&style=stick". where: 0..1 through each scene (default 0.75),
// or "f:12,40,90" for exact frames.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { launchBrowser, NAME_SHIM } from '../server/browser.ts'
import { env } from '../server/env.ts'

const [query, out, where = '0.75', colsArg = '5', scaleArg = '0.3'] = process.argv.slice(2)
if (!query || !out) {
  console.error('usage: tsx scripts/still.ts "<query>" <out.jpg> [where] [cols] [scale]')
  process.exit(1)
}
const scale = Number(scaleArg)
const cols = Number(colsArg)
mkdirSync(dirname(out), { recursive: true })
const browser = await launchBrowser()
try {
  const w = Math.round(1080 * scale)
  const h = Math.round(1920 * scale)
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await ctx.addInitScript(NAME_SHIM)
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()) })
  page.on('pageerror', (e) => console.log('[page exception]', e.message))
  await page.goto(`http://127.0.0.1:${env.port}/render?${query}`)
  await page.waitForFunction(() => window.__reel?.ready || window.__reel?.error, undefined, { timeout: 60000 })
  const err = await page.evaluate(() => window.__reel?.error)
  if (err) throw new Error(err)
  const info = await page.evaluate(() => ({ total: window.__reel!.total, scenes: window.__reel!.scenes }))
  const frames = where.startsWith('f:')
    ? where.slice(2).split(',').map(Number)
    : info.scenes.map((s) => Math.min(s.end - 1, s.start + Math.round((s.end - s.start) * Number(where))))
  console.log(`total ${info.total} frames (${(info.total / 30).toFixed(1)}s), ${info.scenes.length} scenes; frames ${frames.join(', ')}`)
  const shots: string[] = []
  for (const f of frames) {
    await page.evaluate((n) => window.__reel!.setFrame(n), f)
    shots.push((await page.screenshot({ type: 'jpeg', quality: 86 })).toString('base64'))
  }
  if (shots.length === 1) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(out, Buffer.from(shots[0], 'base64'))
  } else {
    const sheet = await browser.newContext({ viewport: { width: cols * (w + 6) + 6, height: 600 }, deviceScaleFactor: 1 })
    const sp = await sheet.newPage()
    await sp.setContent(`<style>body{margin:0;padding:6px;background:#222;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:6px}img{width:${w}px;height:${h}px;display:block}</style>${shots.map((s) => `<img src="data:image/jpeg;base64,${s}">`).join('')}`)
    await sp.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())))
    await sp.screenshot({ path: out, type: 'jpeg', quality: 86, fullPage: true })
  }
} finally {
  await browser.close()
}
