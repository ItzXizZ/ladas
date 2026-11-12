// Sound effects and music beds synthesised in code: no samples, no licences to clear. Each style
// maps the same events to its own sounds (a cartoon boing where paper gets a rustle).
import type { SoundId } from '../../shared/timeline.ts'
import type { StyleId } from '../../shared/types.ts'

export const SR = 48000
const TAU = Math.PI * 2

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const buf = (seconds: number) => new Float32Array(Math.ceil(seconds * SR))

/** Adds a pitched tone. freq and amp are functions of time in seconds. */
function tone(out: Float32Array, start: number, dur: number, freq: (t: number) => number, amp: (t: number) => number, shape: 'sine' | 'tri' | 'square' = 'sine') {
  let phase = 0
  const s0 = Math.floor(start * SR)
  const n = Math.floor(dur * SR)
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SR
    phase += (TAU * freq(t)) / SR
    const v = shape === 'sine' ? Math.sin(phase) : shape === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sign(Math.sin(phase)) * 0.5
    out[s0 + i] += v * amp(t)
  }
}

/** Adds filtered noise. lp and hp are one-pole cutoffs in Hz as functions of time. */
function noise(out: Float32Array, start: number, dur: number, amp: (t: number) => number, lp: (t: number) => number, hp: (t: number) => number, seed = 1) {
  const r = rng(seed)
  let low = 0
  let hpState = 0
  const s0 = Math.floor(start * SR)
  const n = Math.floor(dur * SR)
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SR
    const white = r() * 2 - 1
    const a = 1 - Math.exp((-TAU * lp(t)) / SR)
    low += a * (white - low)
    const b = 1 - Math.exp((-TAU * hp(t)) / SR)
    hpState += b * (low - hpState)
    out[s0 + i] += (low - hpState) * amp(t)
  }
}

const decay = (rate: number) => (t: number) => Math.exp(-t * rate)
const ar = (attack: number, rate: number) => (t: number) => Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) * rate)
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / m) * peak
  return x
}

const cache = new Map<string, Float32Array>()

/** One sound effect, peak-normalised. The style picks the timbre. */
export function sfx(sound: SoundId, style: StyleId): Float32Array {
  const key = `${sound}:${style}`
  const hit = cache.get(key)
  if (hit) return hit
  const paper = style === 'paper'
  const soft = style === 'line'
  let x: Float32Array
  switch (sound) {
    case 'whoosh':
      x = buf(0.42)
      noise(x, 0, 0.42, (t) => Math.sin((Math.PI * t) / 0.42) ** 2, (t) => 500 + 5200 * (t / 0.42), (t) => 200 + 900 * (t / 0.42), 11)
      break
    case 'scroll':
      x = buf(0.7)
      noise(x, 0, 0.7, (t) => Math.sin((Math.PI * t) / 0.7) ** 1.5 * 0.7, (t) => 900 + 1400 * Math.sin((Math.PI * t) / 0.7), () => 300, 12)
      break
    case 'flash':
      x = buf(0.32)
      noise(x, 0, 0.32, decay(16), () => 9000, () => 2500, 13)
      tone(x, 0, 0.3, () => 2400, (t) => 0.4 * Math.exp(-t * 14))
      break
    case 'pop':
      x = buf(0.16)
      if (paper) noise(x, 0, 0.14, ar(0.004, 34), () => 5200, () => 900, 14)
      else if (soft) tone(x, 0, 0.09, (t) => 620 - 1800 * t, decay(46))
      else tone(x, 0, 0.14, (t) => 360 + 2600 * t * Math.exp(-t * 6), ar(0.003, 30))
      break
    case 'stamp':
      x = buf(0.4)
      tone(x, 0, 0.36, (t) => 130 * Math.exp(-t * 9) + 46, ar(0.002, 11))
      noise(x, 0, 0.09, decay(50), () => (paper ? 2500 : 4200), () => 300, 15)
      break
    case 'thud':
      x = buf(0.5)
      tone(x, 0, 0.46, (t) => 96 * Math.exp(-t * 7) + 38, ar(0.003, 8))
      noise(x, 0, 0.12, decay(34), () => 1200, () => 80, 16)
      break
    case 'hit':
      x = buf(0.34)
      tone(x, 0, 0.3, (t) => 180 * Math.exp(-t * 12) + 60, ar(0.002, 13))
      noise(x, 0, 0.2, decay(22), () => 6000, () => 500, 17)
      break
    case 'steps':
      x = buf(0.62)
      for (let i = 0; i < 3; i++) {
        tone(x, i * 0.19, 0.12, (t) => 150 * Math.exp(-t * 20) + 70, (t) => 0.9 * Math.exp(-t * 36))
        noise(x, i * 0.19, 0.06, decay(70), () => (paper ? 3500 : 1800), () => 200, 18 + i)
      }
      break
    case 'boing':
      x = buf(0.46)
      if (paper || soft) tone(x, 0, 0.2, (t) => 520 + 300 * Math.exp(-t * 14), ar(0.004, 14), 'tri')
      else tone(x, 0, 0.44, (t) => 230 + 190 * Math.exp(-t * 5) * Math.sin(TAU * 13 * t), ar(0.004, 6.5), 'tri')
      break
    case 'blip':
      x = buf(0.18)
      tone(x, 0, 0.07, () => 880, ar(0.003, 26), soft ? 'sine' : 'tri')
      tone(x, 0.07, 0.1, () => 1320, ar(0.003, 22), soft ? 'sine' : 'tri')
      break
    case 'success':
      x = buf(0.9)
      ;[72, 76, 79, 84].forEach((m, i) => {
        tone(x, i * 0.085, 0.6, () => hz(m), (t) => 0.5 * ar(0.004, 6.5)(t))
        tone(x, i * 0.085, 0.4, () => hz(m) * 2, (t) => 0.14 * ar(0.004, 10)(t))
      })
      break
    case 'sparkle': {
      x = buf(0.7)
      const r = rng(21)
      for (let i = 0; i < 9; i++) tone(x, i * 0.055 + r() * 0.02, 0.3, ((f) => () => f)(1800 + r() * 2600), (t) => 0.3 * ar(0.002, 16)(t))
      break
    }
    case 'click':
      x = buf(0.06)
      tone(x, 0, 0.03, () => 1900, decay(160))
      noise(x, 0, 0.02, decay(240), () => 8000, () => 1500, 22)
      break
    default:
      x = buf(0.05)
      noise(x, 0, 0.03, decay(200), () => 6000, () => 1800, 23)
  }
  const out = normalize(x)
  cache.set(key, out)
  return out
}

type Mood = 'upbeat' | 'curious' | 'chill'
const SONGS: Record<Mood, { bpm: number; chords: number[][]; hats: boolean; claps: boolean; kick: number[] }> = {
  upbeat: { bpm: 116, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], hats: true, claps: true, kick: [0, 2] },
  curious: { bpm: 98, chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], hats: true, claps: false, kick: [0] },
  chill: { bpm: 86, chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], hats: false, claps: false, kick: [0] },
}

/** A looping music bed for the given mood, peak-normalised. Simple on purpose: it sits under a voice. */
export function music(mood: Mood, seconds: number): Float32Array {
  const song = SONGS[mood]
  const beat = 60 / song.bpm
  const x = buf(seconds + 1)
  const bars = Math.ceil(seconds / (beat * 4)) + 1
  for (let bar = 0; bar < bars; bar++) {
    const chord = song.chords[bar % song.chords.length]
    const t0 = bar * beat * 4
    // Pad: the chord held softly through the bar.
    for (const m of chord) tone(x, t0, beat * 4, () => hz(m), (t) => 0.035 * Math.min(1, t / 0.5) * Math.min(1, (beat * 4 - t) / 0.4))
    // Pluck arpeggio on eighth notes, an octave up.
    for (let e = 0; e < 8; e++) {
      const m = chord[[0, 1, 2, 1, 0, 2, 1, 2][e] % chord.length] + 12
      if (mood === 'chill' && e % 2 === 1) continue
      tone(x, t0 + e * beat * 0.5, 0.4, () => hz(m), (t) => 0.12 * ar(0.004, 9)(t), 'tri')
      tone(x, t0 + e * beat * 0.5, 0.3, () => hz(m) * 2, (t) => 0.03 * ar(0.004, 14)(t))
    }
    // Bass on the root.
    for (const b of mood === 'upbeat' ? [0, 1.5, 2, 3.5] : [0, 2.5]) tone(x, t0 + b * beat, 0.42, () => hz(chord[0] - 24), (t) => 0.26 * ar(0.006, 6)(t))
    for (const k of song.kick) tone(x, t0 + k * beat, 0.2, (t) => 118 * Math.exp(-t * 26) + 44, (t) => 0.4 * ar(0.002, 15)(t))
    if (song.claps) for (const c of [1, 3]) noise(x, t0 + c * beat, 0.09, (t) => 0.13 * Math.exp(-t * 38), () => 3800, () => 900, 31 + bar * 2 + c)
    if (song.hats) for (let e = 0; e < 8; e++) if (e % 2 === 1 || mood === 'upbeat') noise(x, t0 + e * beat * 0.5, 0.04, (t) => (e % 2 === 1 ? 0.06 : 0.03) * Math.exp(-t * 90), () => 12000, () => 6000, 41 + bar * 8 + e)
  }
  // Gentle low-pass so the bed stays out of the way of speech.
  let low = 0
  const a = 1 - Math.exp((-TAU * 5200) / SR)
  for (let i = 0; i < x.length; i++) {
    low += a * (x[i] - low)
    x[i] = low
  }
  return normalize(x.subarray(0, Math.ceil(seconds * SR)), 0.8)
}
