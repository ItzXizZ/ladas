// Downloads a static ffmpeg build into tools/ffmpeg so renders work without a system install.
// Skipped when ffmpeg is already on PATH or FFMPEG_PATH is set.
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'tools', 'ffmpeg')
const exe = process.platform === 'win32' ? '.exe' : ''
const target = join(dir, `ffmpeg${exe}`)

if (existsSync(target)) {
  console.log(`ffmpeg already present at ${target}`)
  process.exit(0)
}
if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
  console.log(`Using FFMPEG_PATH=${process.env.FFMPEG_PATH}`)
  process.exit(0)
}
const onPath = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
if (onPath.status === 0) {
  console.log('ffmpeg found on PATH, nothing to download')
  process.exit(0)
}

const base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/'
const builds = {
  'win32-arm64': 'ffmpeg-master-latest-winarm64-gpl.zip',
  'win32-x64': 'ffmpeg-master-latest-win64-gpl.zip',
  'linux-x64': 'ffmpeg-master-latest-linux64-gpl.tar.xz',
  'linux-arm64': 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
}
const key = `${process.platform}-${process.arch}`
const file = builds[key]
if (!file) {
  console.error(`No prebuilt ffmpeg for ${key}. Install ffmpeg yourself and set FFMPEG_PATH in .env.`)
  process.exit(1)
}

mkdirSync(dir, { recursive: true })
const archive = join(dir, file)
console.log(`Downloading ${base + file} ...`)
const res = await fetch(base + file)
if (!res.ok || !res.body) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))
console.log(`Downloaded ${(statSync(archive).size / 1e6).toFixed(0)} MB, extracting ...`)

// bsdtar ships with Windows 10+ and handles zip; GNU tar handles .tar.xz on Linux.
const untar = spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
if (untar.status !== 0) {
  console.error('Extraction failed')
  process.exit(1)
}
const extracted = readdirSync(dir).find((n) => n.startsWith('ffmpeg-master') && statSync(join(dir, n)).isDirectory())
if (!extracted) {
  console.error('Could not find the extracted ffmpeg folder')
  process.exit(1)
}
for (const name of [`ffmpeg${exe}`, `ffprobe${exe}`]) {
  renameSync(join(dir, extracted, 'bin', name), join(dir, name))
}
rmSync(join(dir, extracted), { recursive: true, force: true })
rmSync(archive, { force: true })
console.log(`ffmpeg ready at ${target}`)
