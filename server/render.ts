// The renderer: the same page the preview uses is stepped frame by frame in headless Chrome,
// screenshotted, and encoded with the mastered audio. QC runs before and after.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { newId } from '../shared/starter.ts'
import { compileTimeline, toSrt } from '../shared/timeline.ts'
import { FPS, H, W, type QcIssue, type QcReport, type Reel, type Render, type SceneSpec } from '../shared/types.ts'
import { mixIsCurrent, mixLoudness, mixReel } from './audio/mix.ts'
import { runFfmpeg } from './audio/wav.ts'
import { internalCookie } from './auth.ts'
import { launchBrowser, NAME_SHIM } from './browser.ts'
import { ensureDir, env, ffmpegPath, filePath, fileUrl } from './env.ts'
import type { JobHandle } from './jobs.ts'
import { audioQc, geometryQc, syncQc, visionQc } from './qc.ts'
import { db, getSettings, saveReel } from './store.ts'
import { generateVoice } from './voice.ts'

export type Preset = Render['preset']
export const PRESETS: Record<Preset, { width: number; height: number; label: string }> = {
  reel: { width: 1080, height: 1920, label: '9:16 Reels, TikTok, Shorts' },
  feed: { width: 1080, height: 1350, label: '4:5 feed post' },
  square: { width: 1080, height: 1080, label: '1:1 square' },
}

const base = () => `http://127.0.0.1:${env.port}`

async function openReelPage(browser: Browser, reelId: string, scale = 1): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: Math.round(W * scale), height: Math.round(H * scale) }, deviceScaleFactor: 1 })
  await ctx.addInitScript(NAME_SHIM)
  // The render page reads the reel from this server's own gated API.
  await ctx.addCookies([{ ...internalCookie(), url: base() }])
  const page = await ctx.newPage()
  await page.goto(`${base()}/render?reel=${encodeURIComponent(reelId)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__reel?.ready || window.__reel?.error, undefined, { timeout: 90_000 })
  const error = await page.evaluate(() => window.__reel?.error)
  if (error) throw new Error(`The render page could not load the reel: ${error}`)
  return page
}

function requireReel(id: string): Reel {
  const reel = db.reels.get(id)
  if (!reel) throw new Error('Reel not found')
  return reel
}

/** Makes sure the reel has a current voice recording and a current mix. Saves both on the reel. */
export async function ensureAudio(reelId: string, h?: JobHandle): Promise<Reel> {
  let reel = requireReel(reelId)
  if (!reel.scenes.length) throw new Error('This reel has no script yet.')
  const voice = await generateVoice(reel, h)
  reel = requireReel(reelId)
  if (reel.voice !== voice) reel = saveReel({ ...reel, voice: { ...voice, mixUrl: reel.voice?.voiceUrl === voice.voiceUrl ? reel.voice?.mixUrl : undefined } })
  if (!mixIsCurrent(reel)) {
    h?.step(0.95, 'Mixing voice, music and sound')
    const mix = await mixReel(reel)
    reel = requireReel(reelId)
    reel = saveReel({ ...reel, voice: { ...reel.voice!, mixUrl: mix.mixUrl } })
  }
  return reel
}

const sub = (h: JobHandle, from: number, to: number): JobHandle => ({ step: (p, m) => h.step(from + (to - from) * p, m), log: (m) => h.log(m) })

async function contactSheet(browser: Browser, frames: { path: string; label: string }[], out: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 })
  try {
    const page = await ctx.newPage()
    const cells = frames
      .map((f, i) => `<figure><img src="data:image/jpeg;base64,${readFileSync(f.path).toString('base64')}"><b>${i + 1}</b><figcaption>${f.label}</figcaption></figure>`)
      .join('')
    await page.setContent(
      `<style>body{margin:0;padding:14px;background:#fff;font:600 15px system-ui,sans-serif;display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
      figure{margin:0;position:relative}img{width:100%;display:block;border:1px solid #bbb}
      b{position:absolute;left:6px;top:6px;background:#111;color:#fff;border-radius:6px;padding:2px 8px;font-size:17px}
      figcaption{color:#333;padding:3px 0 0;font-weight:500;font-size:13px}</style>${cells}`,
      { waitUntil: 'load' },
    )
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined))))
    await page.screenshot({ path: out, type: 'jpeg', quality: 82, fullPage: true })
  } finally {
    await ctx.close()
  }
}

function videoFilter(preset: Preset): string {
  // Screenshots are full-range JPEG (BT.601); the MP4 is tagged BT.709 limited range like phone video.
  const color = 'scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv:flags=bicubic'
  if (preset === 'feed') return `[0:v]crop=1080:1350:0:230,${color},format=yuv420p,setsar=1[v]`
  if (preset === 'square') return `[0:v]crop=1080:1350:0:230,split[a][b];[a]scale=1080:1080,setsar=1,boxblur=26:3,eq=brightness=-0.06[bg];[b]scale=864:1080:flags=lanczos,setsar=1[fg];[bg][fg]overlay=108:0,${color},format=yuv420p,setsar=1[v]`
  return `[0:v]${color},format=yuv420p,setsar=1[v]`
}

export async function renderReel(reelId: string, presets: Preset[], h: JobHandle): Promise<Render[]> {
  if (!ffmpegPath()) throw new Error('ffmpeg was not found. Run `npm run setup` once, then render again.')
  const started = Date.now()
  const settings = getSettings()
  const wanted: Preset[] = presets.length ? presets : ['reel']

  h.step(0.01, 'Preparing the voice')
  await ensureAudio(reelId, sub(h, 0.01, 0.16))

  const browser = await launchBrowser()
  const tmp = mkdtempSync(join(tmpdir(), 'reel-studio-'))
  try {
    // 1. Geometry QC with automatic fixes, on a half-size page (layout is identical at any size).
    h.step(0.17, 'Checking the layout')
    let page = await openReelPage(browser, reelId, 0.5)
    const geometry = await geometryQc(page, () => requireReel(reelId), async (fixes) => {
      const reel = requireReel(reelId)
      const scenes: SceneSpec[] = reel.scenes.map((s) => (fixes.has(s.id) ? { ...s, fix: { ...s.fix, ...fixes.get(s.id) } } : s))
      saveReel({ ...reel, scenes })
      h.log(`Adjusted the layout in ${fixes.size} scene${fixes.size === 1 ? '' : 's'}`)
      await page.context().close()
      page = await openReelPage(browser, reelId, 0.5)
    })
    await page.context().close()

    // Layout fixes do not move any sound cue, but make sure the mix still matches before encoding.
    let reel = await ensureAudio(reelId)
    const tl = compileTimeline(reel)
    const total = tl.totalFrames

    // 2. Frames.
    const workers = Math.max(1, Math.min(8, Math.round(settings.renderWorkers) || 4, total))
    h.step(0.24, `Drawing ${total} frames`)
    const pages = await Promise.all(Array.from({ length: workers }, () => openReelPage(browser, reelId)))
    const framePath = (n: number) => join(tmp, `f${String(n).padStart(6, '0')}.jpg`)
    let next = 0
    let done = 0
    let lastReport = 0
    await Promise.all(pages.map(async (p) => {
      for (;;) {
        const n = next++
        if (n >= total) return
        await p.evaluate((f) => window.__reel!.setFrame(f), n)
        await p.screenshot({ path: framePath(n), type: 'jpeg', quality: 94 })
        done++
        if (Date.now() - lastReport > 700) {
          lastReport = Date.now()
          h.step(0.24 + 0.56 * (done / total), `Drawing frame ${done} of ${total}`)
        }
      }
    }))
    await Promise.all(pages.map((p) => p.context().close()))

    // 3. Encode each preset.
    const renderId = newId('render')
    const dir = `reels/${reelId}/renders/${renderId}`
    ensureDir(dir)
    const audio = reel.voice?.mixUrl ? filePath(reel.voice.mixUrl.replace(/^\/files\//, '')) : null
    for (let i = 0; i < wanted.length; i++) {
      const preset = wanted[i]
      h.step(0.81 + 0.1 * (i / wanted.length), `Encoding ${PRESETS[preset].label}`)
      const args = ['-framerate', String(FPS), '-i', join(tmp, 'f%06d.jpg')]
      if (audio) args.push('-i', audio)
      args.push('-filter_complex', videoFilter(preset), '-map', '[v]')
      if (audio) args.push('-map', '1:a', '-c:a', 'copy')
      args.push(
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-profile:v', 'high', '-r', String(FPS), '-g', String(FPS * 2),
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
        '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
        '-movflags', '+faststart', '-t', (total / FPS).toFixed(3), filePath(dir, `${preset}.mp4`),
      )
      await runFfmpeg(args)
    }
    writeFileSync(filePath(dir, 'captions.srt'), toSrt(tl))
    const coverFrame = Math.min(total - 1, tl.scenes[0].start + Math.round(tl.scenes[0].duration * 0.7))
    copyFileSync(framePath(coverFrame), filePath(dir, 'cover.jpg'))

    // 4. Review: contact sheet, vision pass, sync and audio checks.
    h.step(0.92, 'Reviewing the result')
    const perScene = tl.scenes.length > 12 ? [0.7] : [0.4, 0.92]
    const thumbs = tl.scenes.flatMap((s) => perScene.map((p) => ({ scene: s.index, frame: Math.min(s.end - 1, s.start + Math.round(s.duration * p)) }))).slice(0, 30)
    const issues: QcIssue[] = [...geometry.issues]
    let contactSheetUrl: string | undefined
    let visionReviewed = false
    try {
      await contactSheet(browser, thumbs.map((t) => ({ path: framePath(t.frame), label: `Scene ${t.scene + 1} · ${reel.scenes[t.scene].beat}` })), filePath(dir, 'contact-sheet.jpg'))
      contactSheetUrl = fileUrl(dir, 'contact-sheet.jpg')
      if (settings.qcVision) {
        const vision = await visionQc(filePath(dir, 'contact-sheet.jpg'), thumbs, reel)
        visionReviewed = vision.reviewed
        issues.push(...vision.issues)
        if (vision.error) h.log(`Vision review skipped: ${vision.error}`)
      }
    } catch (e) {
      h.log(`Contact sheet failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    issues.push(...syncQc(reel, tl))
    const loudness = mixLoudness(reel)
    issues.push(...audioQc(loudness))

    const qc: QcReport = {
      ranAt: new Date().toISOString(),
      passed: !issues.some((i) => i.severity === 'error' && !i.fixed),
      rounds: geometry.rounds, issues, contactSheetUrl, loudness: loudness ?? undefined, visionReviewed,
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    const renders: Render[] = wanted.map((preset) => ({
      id: `${renderId}-${preset}`, reelId, createdAt: qc.ranAt, preset, width: PRESETS[preset].width, height: PRESETS[preset].height,
      duration: total / FPS, seconds, mp4Url: fileUrl(dir, `${preset}.mp4`), srtUrl: fileUrl(dir, 'captions.srt'), coverUrl: fileUrl(dir, 'cover.jpg'), qc,
    }))
    reel = requireReel(reelId)
    saveReel({ ...reel, renders: [...renders, ...reel.renders].slice(0, 24) })
    h.step(1, qc.passed ? 'Finished' : 'Finished with issues to review')
    return renders
  } finally {
    await browser.close().catch(() => undefined)
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** A single frame as JPEG, used for project thumbnails. */
export async function renderStill(reelId: string, frame: number, out: string, scale = 0.5): Promise<void> {
  const browser = await launchBrowser()
  try {
    const page = await openReelPage(browser, reelId, scale)
    await page.evaluate((f) => window.__reel!.setFrame(f), frame)
    await page.screenshot({ path: out, type: 'jpeg', quality: 90 })
  } finally {
    await browser.close().catch(() => undefined)
  }
}
