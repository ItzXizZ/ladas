import 'dotenv/config'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA = join(ROOT, 'data')
/** Everything under here is served at /files. */
export const FILES = join(DATA, 'files')
export const DB = join(DATA, 'db')
for (const d of [DATA, FILES, DB]) mkdirSync(d, { recursive: true })

const clean = (v: string | undefined) => (v ?? '').trim()

export const env = {
  anthropicKey: clean(process.env.ANTHROPIC_API_KEY),
  anthropicModel: clean(process.env.ANTHROPIC_MODEL),
  elevenKey: clean(process.env.ELEVENLABS_API_KEY),
  port: Number(clean(process.env.PORT)) || 5173,
  browserChannel: clean(process.env.BROWSER_CHANNEL),
  prod: process.argv.includes('--prod'),
}

let ffmpegCache: string | null | undefined
/** Resolved ffmpeg binary: FFMPEG_PATH, then tools/ffmpeg, then PATH. null when none works. */
export function ffmpegPath(): string | null {
  if (ffmpegCache !== undefined) return ffmpegCache
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = [clean(process.env.FFMPEG_PATH), join(ROOT, 'tools', 'ffmpeg', exe), 'ffmpeg'].filter(Boolean)
  for (const c of candidates) {
    if (c !== 'ffmpeg' && !existsSync(c)) continue
    if (spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0) return (ffmpegCache = c)
  }
  return (ffmpegCache = null)
}

/** Maps a path under data/files to its public URL. */
export const fileUrl = (...parts: string[]) => '/files/' + parts.join('/').replace(/\\/g, '/')
export const filePath = (...parts: string[]) => join(FILES, ...parts)
export function ensureDir(...parts: string[]): string {
  const d = filePath(...parts)
  mkdirSync(d, { recursive: true })
  return d
}
