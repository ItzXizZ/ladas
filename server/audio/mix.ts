// The mix: narration + ducked music + sound cues placed on the same frames the picture uses,
// mastered to -14 LUFS with a -1.5 dB true-peak ceiling and saved as WAV and AAC.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { formatById } from '../../shared/formats.ts'
import { hashString } from '../../shared/starter.ts'
import { compileTimeline } from '../../shared/timeline.ts'
import { FPS, type Reel } from '../../shared/types.ts'
import { ensureDir, filePath, fileUrl } from '../env.ts'
import { music, sfx, SR } from './synth.ts'
import { readWav, resample, runFfmpeg, writeWav } from './wav.ts'

export const TARGET_LUFS = -14
export const TARGET_PEAK = -1.5

export interface MixResult { mixUrl: string; wavPath: string; m4aPath: string; lufs: number; truePeak: number }

interface Loudness { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string }
function parseLoudness(stderr: string): Loudness {
  const at = stderr.lastIndexOf('{')
  const end = stderr.indexOf('}', at)
  if (at < 0 || end < 0) throw new Error('Could not read the loudness measurement from ffmpeg')
  return JSON.parse(stderr.slice(at, end + 1)) as Loudness
}
async function measure(path: string): Promise<Loudness> {
  const { stderr } = await runFfmpeg(['-i', path, '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_PEAK}:LRA=11:print_format=json`, '-f', 'null', '-'])
  return parseLoudness(stderr)
}

export function musicMood(reel: Reel): 'upbeat' | 'curious' | 'chill' | 'none' {
  const m = reel.settings.music
  if (m !== 'auto') return m
  return reel.story ? formatById(reel.story.formatId).mood : 'upbeat'
}

/** Identifies a mix: changes whenever the voice, the cue sheet, the music or the levels change. */
export function mixKey(reel: Reel): string {
  const tl = compileTimeline(reel)
  const parts = [reel.voice?.voiceUrl ?? 'silent', reel.style, musicMood(reel), reel.settings.musicLevel, reel.settings.sfxLevel, tl.totalFrames, tl.sfx.map((e) => `${e.frame}${e.sound}${e.gain}`).join(','), tl.scenes.map((s) => s.start).join(','), reel.scenes.map((s) => s.beat).join(',')]
  return hashString(parts.join('|')).toString(36)
}

export const mixIsCurrent = (reel: Reel): boolean => !!reel.voice?.mixUrl && reel.voice.mixUrl.includes(`mix-${mixKey(reel)}.`) && existsSync(filePath(reel.voice.mixUrl.replace(/^\/files\//, '')))

export async function mixReel(reel: Reel): Promise<MixResult> {
  const tl = compileTimeline(reel)
  const total = Math.ceil((tl.totalFrames / FPS) * SR)
  const out = new Float32Array(total)
  const dir = `reels/${reel.id}`
  ensureDir(dir)

  // Narration.
  let voice: Float32Array | null = null
  if (reel.voice?.voiceUrl) {
    const path = filePath(reel.voice.voiceUrl.replace(/^\/files\//, ''))
    if (existsSync(path)) {
      const w = readWav(path)
      voice = resample(w.samples, w.sampleRate, SR)
      let peak = 0
      for (let i = 0; i < voice.length; i++) peak = Math.max(peak, Math.abs(voice[i]))
      const g = peak > 0 ? 0.8 / peak : 1
      for (let i = 0; i < voice.length && i < total; i++) out[i] += voice[i] * g
    }
  }

  // Music: ducked under speech, dropped at the bridge so the turn lands, lifted for the product.
  const mood = musicMood(reel)
  if (mood !== 'none' && reel.settings.musicLevel > 0) {
    const bed = music(mood, total / SR)
    const section = new Float32Array(total).fill(1)
    reel.scenes.forEach((s, i) => {
      const t = tl.scenes[i]
      const level = s.beat === 'bridge' ? 0.3 : s.kind === 'product' ? 1.15 : s.kind === 'cta' ? 1.25 : 1
      if (level === 1) return
      section.fill(level, Math.floor((t.start / FPS) * SR), Math.min(total, Math.floor((t.end / FPS) * SR)))
    })
    const base = 0.34 * reel.settings.musicLevel
    const fadeIn = 0.35 * SR
    const fadeOut = 0.9 * SR
    let env = 0
    let sec = 1
    const attack = 1 - Math.exp(-1 / (0.02 * SR))
    const release = 1 - Math.exp(-1 / (0.3 * SR))
    const glide = 1 - Math.exp(-1 / (0.12 * SR))
    for (let i = 0; i < total; i++) {
      const v = voice && i < voice.length ? Math.abs(voice[i]) : 0
      env += (v > env ? attack : release) * (v - env)
      sec += glide * (section[i] - sec)
      const duck = 1 - 0.62 * Math.min(1, env * 9)
      const fade = Math.min(1, i / fadeIn, (total - i) / fadeOut)
      out[i] += bed[i] * base * duck * sec * fade
    }
  }

  // Sound cues.
  if (reel.settings.sfxLevel > 0) {
    for (const e of tl.sfx) {
      const s = sfx(e.sound, reel.style)
      const at = Math.floor((e.frame / FPS) * SR)
      const g = 0.42 * e.gain * reel.settings.sfxLevel
      for (let i = 0; i < s.length && at + i < total; i++) out[at + i] += s[i] * g
    }
  }

  // Soft-clip any overs before mastering.
  for (let i = 0; i < total; i++) {
    const v = out[i]
    if (Math.abs(v) > 0.85) out[i] = Math.sign(v) * (0.85 + 0.15 * Math.tanh((Math.abs(v) - 0.85) / 0.15))
  }

  const key = mixKey(reel)
  const raw = filePath(dir, `mix-${key}.raw.wav`)
  const wavPath = filePath(dir, `mix-${key}.wav`)
  const m4aPath = filePath(dir, `mix-${key}.m4a`)
  writeWav(raw, out, SR)

  // Two-pass loudness: measure, then apply the measured values so the result lands on target.
  const m = await measure(raw)
  const silent = !isFinite(Number(m.input_i))
  const filter = silent
    ? 'anull'
    : `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_PEAK}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  await runFfmpeg(['-i', raw, '-af', filter, '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', wavPath])
  let final = silent ? m : await measure(wavPath)
  // Short mixes can land a little off target. Trim the difference with plain gain when the peak allows it.
  const off = TARGET_LUFS - Number(final.input_i)
  if (!silent && isFinite(off) && Math.abs(off) > 0.3 && Number(final.input_tp) + off <= TARGET_PEAK) {
    const trimmed = filePath(dir, `mix-${key}.trim.wav`)
    await runFfmpeg(['-i', wavPath, '-af', `volume=${off.toFixed(2)}dB`, '-c:a', 'pcm_s16le', trimmed])
    renameSync(trimmed, wavPath)
    final = await measure(wavPath)
  }
  await runFfmpeg(['-i', wavPath, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', m4aPath])
  // Keep only the current mix; older ones belong to scripts and settings that no longer exist.
  rmSync(raw, { force: true })
  for (const f of readdirSync(filePath(dir))) if (/^mix-/.test(f) && !f.startsWith(`mix-${key}.`)) rmSync(filePath(dir, f), { force: true })
  const result: MixResult = { mixUrl: fileUrl(dir, `mix-${key}.m4a`), wavPath, m4aPath, lufs: Number(final.input_i), truePeak: Number(final.input_tp) }
  writeFileSync(filePath(dir, `mix-${key}.json`), JSON.stringify({ lufs: result.lufs, truePeak: result.truePeak }))
  return result
}

/** Loudness measured when the current mix was made, if there is one. */
export function mixLoudness(reel: Reel): { lufs: number; truePeak: number } | null {
  const p = filePath(`reels/${reel.id}`, `mix-${mixKey(reel)}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as { lufs: number; truePeak: number }
  } catch {
    return null
  }
}
