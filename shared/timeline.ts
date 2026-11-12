// Turns scene specs + word timings into frame-accurate timing: scene cuts, caption chunks and
// the sound cue sheet. Shared by the browser engine (drawing) and the server (audio mix, SRT, QC),
// so sound lands on the same frame the picture does.
import { FPS, type PropSpec, type Reel, type SceneSpec, type WordTiming } from './types.ts'

export type SoundId =
  | 'whoosh' | 'flash' | 'pop' | 'stamp' | 'steps' | 'thud' | 'boing' | 'blip' | 'success'
  | 'hit' | 'sparkle' | 'click' | 'scroll' | 'tick'

export interface SceneTime {
  index: number
  id: string
  start: number
  end: number
  duration: number
}

export interface CaptionChunk {
  scene: number
  start: number
  end: number
  words: { text: string; accent: boolean; start: number }[]
}

export interface SfxEvent {
  frame: number
  sound: SoundId
  gain: number
}

export interface Timeline {
  totalFrames: number
  duration: number
  scenes: SceneTime[]
  captions: CaptionChunk[]
  sfx: SfxEvent[]
  words: WordTiming[]
}

export const tokenize = (line: string): string[] => line.trim().split(/\s+/).filter(Boolean)
/** Narration length for each reel length. The voices speak about 2.8 words a second, pauses included. */
export const WORD_TARGET: Record<number, [number, number]> = { 20: [46, 58], 30: [74, 88], 38: [96, 110] }
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9$%']/g, '')

/** Stable hash of the narration, used to tell when audio is stale. */
export function scriptHash(scenes: SceneSpec[]): string {
  const text = scenes.map((s) => tokenize(s.line).join(' ')).join('|')
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + ':' + text.length
}

/** Rough speaking-time weight of a word: syllables plus a pause for punctuation. */
export function wordWeight(word: string): number {
  const core = bare(word)
  const syl = Math.max(1, (core.match(/[aeiouy]+/g) ?? []).length)
  let w = 0.55 + syl * 0.5 + Math.min(core.length, 12) * 0.035
  if (/\d/.test(core)) w += 0.6
  return w
}
export function pauseAfter(word: string): number {
  if (/[.!?]["')]*$/.test(word)) return 0.26
  if (/[,;:]$/.test(word) || /[—–]$/.test(word)) return 0.12
  return 0
}

/**
 * Timings used before any voice exists, so the preview plays silently at a natural pace.
 * The pace is calibrated against the built-in voices: about 2.8 words a second, pauses included.
 */
export function estimateWords(scenes: SceneSpec[], wordsPerSecond = 4): WordTiming[] {
  const out: WordTiming[] = []
  let t = 0.15
  const unit = 1 / (wordsPerSecond * 1.32)
  scenes.forEach((scene, si) => {
    for (const text of tokenize(scene.line)) {
      const d = wordWeight(text) * unit
      out.push({ text, start: t, end: t + d, scene: si })
      t += d + pauseAfter(text)
    }
    t += 0.12
  })
  return out
}

/** Frame at which a prop or bubble appears inside its scene. */
export function eventFrame(time: SceneTime, at: number | undefined, fallback = 0.25): number {
  const a = Math.min(0.9, Math.max(0, at ?? fallback))
  return time.start + Math.min(Math.round(a * time.duration), Math.max(0, time.duration - 14))
}

const PROP_SOUND: Record<PropSpec['kind'], SoundId | null> = {
  stamp: 'stamp', sign: 'pop', screen: 'blip', phone: 'blip', laptop: 'blip', card: 'pop',
  confetti: 'success', burst: 'hit', sparkle: 'sparkle', title: 'whoosh',
}
/** Frames between a prop appearing and its impact (stamps slam down). */
export const STAMP_IMPACT = 5

export function compileTimeline(reel: Pick<Reel, 'scenes' | 'voice'>): Timeline {
  const { scenes } = reel
  const voiced = reel.voice && reel.voice.scriptHash === scriptHash(scenes) && reel.voice.words.length > 0
  const words = voiced ? reel.voice!.words : estimateWords(scenes)

  // Scene cuts sit just before the first word of each scene.
  const firstWord: (WordTiming | undefined)[] = scenes.map((_, i) => words.find((w) => w.scene === i))
  const lastWord: (WordTiming | undefined)[] = scenes.map((_, i) => {
    for (let k = words.length - 1; k >= 0; k--) if (words[k].scene === i) return words[k]
    return undefined
  })
  const cuts: number[] = []
  let prevEnd = 0
  scenes.forEach((_, i) => {
    const fw = firstWord[i]
    let t = i === 0 ? 0 : fw ? Math.max(prevEnd + 0.03, fw.start - 0.14) : prevEnd + 0.03
    if (i > 0 && t * FPS < cuts[i - 1] + 12) t = (cuts[i - 1] + 12) / FPS
    cuts.push(Math.round(t * FPS))
    prevEnd = lastWord[i]?.end ?? t + 1
  })
  const endTime = Math.max(prevEnd + 1.1, (cuts[cuts.length - 1] ?? 0) / FPS + 1.6)
  const totalFrames = Math.max(1, Math.round(endTime * FPS))

  const times: SceneTime[] = scenes.map((s, i) => {
    const start = cuts[i]
    const end = i + 1 < cuts.length ? cuts[i + 1] : totalFrames
    return { index: i, id: s.id, start, end, duration: Math.max(1, end - start) }
  })

  // Captions: 1-3 word chunks, cut at punctuation, never across scenes.
  const captions: CaptionChunk[] = []
  scenes.forEach((scene, si) => {
    const emph = new Set(scene.emphasis.map(bare).filter(Boolean))
    const sw = words.filter((w) => w.scene === si)
    let chunk: WordTiming[] = []
    const flush = () => {
      if (!chunk.length) return
      captions.push({
        scene: si,
        start: Math.max(times[si].start, Math.round(chunk[0].start * FPS)),
        end: 0,
        words: chunk.map((w) => ({ text: w.text, accent: emph.has(bare(w.text)) || /\d/.test(w.text), start: Math.round(w.start * FPS) })),
      })
      chunk = []
    }
    for (const w of sw) {
      const chars = chunk.reduce((n, c) => n + c.text.length + 1, 0)
      if (chunk.length >= 3 || (chunk.length > 0 && chars + w.text.length > 17)) flush()
      chunk.push(w)
      if (pauseAfter(w.text) > 0) flush()
    }
    flush()
  })
  captions.forEach((c, i) => {
    const next = captions[i + 1]
    const lastStart = c.words[c.words.length - 1].start
    const sceneEnd = times[c.scene].end
    c.end = next && next.scene === c.scene ? next.start : Math.min(sceneEnd, lastStart + Math.round(0.9 * FPS))
    if (c.end <= c.start) c.end = c.start + 1
  })

  // Sound cue sheet: every cue comes from an event the scene already knows about.
  const sfx: SfxEvent[] = []
  const add = (frame: number, sound: SoundId, gain = 1) => {
    if (frame >= 0 && frame < totalFrames) sfx.push({ frame, sound, gain })
  }
  scenes.forEach((scene, i) => {
    const t = times[i]
    if (i > 0) {
      if (scene.transition === 'whip' || scene.transition === 'iris' || scene.transition === 'match') add(t.start - 2, 'whoosh', 0.9)
      else if (scene.transition === 'flash') add(t.start, 'flash', 0.8)
      else add(t.start, 'tick', 0.35)
    }
    if (scene.kind === 'story') {
      let steps = false
      for (const a of scene.actors) {
        if (a.enter === 'walk' && !steps) { add(t.start + 2, 'steps', 0.7); steps = true }
        if (a.enter === 'pop') add(t.start + 3, 'pop', 0.7)
        if (a.enter === 'drop') add(t.start + 9, 'thud', 0.9)
        if (a.bubble) add(eventFrame(t, a.bubbleAt, 0.2), 'pop', 0.85)
        if (a.react) add(eventFrame(t, a.react.at, 0.5), a.react.expression === 'shock' || a.react.expression === 'worried' ? 'boing' : 'blip', 0.7)
      }
      if (scene.camera === 'shake' && !scene.props.some((p) => p.kind === 'stamp')) add(t.start + Math.round(t.duration * 0.3), 'hit', 0.8)
    }
    for (const p of scene.props) {
      const s = PROP_SOUND[p.kind]
      if (s) add(eventFrame(t, p.at) + (p.kind === 'stamp' ? STAMP_IMPACT : 0), s, p.kind === 'confetti' ? 0.8 : 1)
    }
    if (scene.kind === 'product' && scene.product) {
      if (scene.product.move === 'hero') add(t.start + 4, 'click', 0.9)
      if (scene.product.move === 'scroll') add(t.start + 6, 'scroll', 0.8)
      if (scene.product.move === 'zoom') { add(t.start + 8, 'click', 0.8); add(t.start + 16, 'pop', 0.7) }
    }
    if (scene.kind === 'cta') add(t.start + 6, 'success', 0.9)
  })
  sfx.sort((a, b) => a.frame - b.frame)

  return { totalFrames, duration: totalFrames / FPS, scenes: times, captions, sfx, words }
}

export function sceneAt(tl: Timeline, frame: number): SceneTime {
  for (let i = tl.scenes.length - 1; i >= 0; i--) if (frame >= tl.scenes[i].start) return tl.scenes[i]
  return tl.scenes[0]
}

const stamp = (sec: number) => {
  const ms = Math.round(sec * 1000)
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

/** Caption file exported next to the MP4. */
export function toSrt(tl: Timeline): string {
  return tl.captions
    .map((c, i) => `${i + 1}\n${stamp(c.start / FPS)} --> ${stamp(c.end / FPS)}\n${c.words.map((w) => w.text).join(' ')}\n`)
    .join('\n')
}
