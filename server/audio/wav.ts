// PCM helpers: WAV in and out, resampling, and an ffmpeg runner.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { ffmpegPath } from '../env.ts'

export function writeWav(path: string, samples: Float32Array, sampleRate: number, channels = 1): void {
  const frames = samples.length
  const data = Buffer.alloc(frames * channels * 2)
  for (let i = 0; i < frames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    const s = Math.round(v * 32767)
    for (let c = 0; c < channels; c++) data.writeInt16LE(s, (i * channels + c) * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

/** Reads a 16-bit PCM WAV written by writeWav, mixing down to mono. */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`)
  let off = 12
  let channels = 1
  let sampleRate = 24000
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10)
      sampleRate = buf.readUInt32LE(off + 12)
    } else if (id === 'data') {
      const frames = Math.floor(Math.min(size, buf.length - off - 8) / (2 * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let sum = 0
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(off + 8 + (i * channels + c) * 2)
        samples[i] = sum / channels / 32768
      }
      return { samples, sampleRate }
    }
    off += 8 + size + (size % 2)
  }
  throw new Error(`${path} has no audio data`)
}

/** Linear-interpolation resample. Good enough for speech going 24 kHz to 48 kHz. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const n = Math.floor((input.length * to) / from)
  const out = new Float32Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const p = i * step
    const a = Math.floor(p)
    const b = Math.min(input.length - 1, a + 1)
    out[i] = input[a] + (input[b] - input[a]) * (p - a)
  }
  return out
}

export function runFfmpeg(args: string[], input?: Buffer): Promise<{ stdout: Buffer; stderr: string }> {
  const bin = ffmpegPath()
  if (!bin) return Promise.reject(new Error('ffmpeg was not found. Run `npm run setup` or set FFMPEG_PATH in .env.'))
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-y', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => out.push(d))
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-20000) })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`ffmpeg exited with code ${code}: ${err.split('\n').slice(-6).join(' | ')}`))))
    if (input) p.stdin.end(input)
    else p.stdin.end()
  })
}

/** Decodes any audio file ffmpeg understands to mono float samples. */
export async function decodeAudio(path: string, sampleRate: number): Promise<Float32Array> {
  const { stdout } = await runFfmpeg(['-i', path, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', '-'])
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4)).slice()
}
