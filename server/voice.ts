// Narration: free local Kokoro voices and premium ElevenLabs voices, both returning the same
// thing: one WAV, a timing for every word, and a loudness envelope for lip-sync.
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { KOKORO_VOICES } from '../shared/starter.ts'
import { pauseAfter, scriptHash, tokenize, wordWeight } from '../shared/timeline.ts'
import { FPS, type Reel, type SceneSpec, type VoiceOption, type VoiceTrack, type WordTiming } from '../shared/types.ts'
import { decodeAudio, resample, writeWav } from './audio/wav.ts'
import { ensureDir, env, filePath, fileUrl } from './env.ts'
import type { JobHandle } from './jobs.ts'

const VOICE_SR = 24000

// ---------- Kokoro (local, free) ----------
interface KokoroAudio { audio: Float32Array; sampling_rate: number }
interface Kokoro { generate(text: string, opts: { voice: string; speed?: number }): Promise<KokoroAudio> }
let kokoro: Promise<Kokoro> | null = null
const KOKORO_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
function loadKokoro(): Promise<Kokoro> {
  kokoro ??= (async () => {
    // On a shared host the model sees every core of the machine, not the few this service owns, and
    // starts a thread pool to match. Build it ourselves so the thread count can be capped (KOKORO_THREADS).
    const tf = (await import('@huggingface/transformers')) as unknown as {
      StyleTextToSpeech2Model: { from_pretrained(id: string, opts: Record<string, unknown>): Promise<unknown> }
      AutoTokenizer: { from_pretrained(id: string): Promise<unknown> }
    }
    const mod = (await import('kokoro-js')) as unknown as { KokoroTTS: new (model: unknown, tokenizer: unknown) => Kokoro }
    const threads = Math.max(1, Math.round(Number(process.env.KOKORO_THREADS)) || 2)
    const [model, tokenizer] = await Promise.all([
      tf.StyleTextToSpeech2Model.from_pretrained(KOKORO_ID, { dtype: 'q8', device: 'cpu', session_options: { intra_op_num_threads: threads, inter_op_num_threads: 1 } }),
      tf.AutoTokenizer.from_pretrained(KOKORO_ID),
    ])
    return new mod.KokoroTTS(model, tokenizer)
  })()
  kokoro.catch(() => { kokoro = null })
  return kokoro
}

/** Kokoro runs one sentence at a time; serialise calls so two jobs never share the session. */
let kokoroQueue: Promise<unknown> = Promise.resolve()
function kokoroSay(text: string, voice: string): Promise<Float32Array> {
  const run = kokoroQueue.then(async () => {
    const tts = await loadKokoro()
    const out = await tts.generate(text, { voice, speed: 1.06 })
    return out.sampling_rate === VOICE_SR ? out.audio : resample(out.audio, out.sampling_rate, VOICE_SR)
  })
  kokoroQueue = run.catch(() => undefined)
  return run
}

/** First and last sample above the noise floor. */
function voicedRange(x: Float32Array): [number, number] {
  const win = Math.floor(VOICE_SR * 0.01)
  let peak = 0
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]))
  const floor = Math.max(0.004, peak * 0.035)
  const loud = (i: number) => {
    let s = 0
    const end = Math.min(x.length, i + win)
    for (let k = i; k < end; k++) s += x[k] * x[k]
    return Math.sqrt(s / Math.max(1, end - i)) > floor
  }
  let a = 0
  while (a + win < x.length && !loud(a)) a += win
  let b = x.length - win
  while (b > a && !loud(b)) b -= win
  return [Math.max(0, a - win), Math.min(x.length, b + win * 3)]
}

/** What the voice should say for a written word: web addresses are read as "name dot com". */
export function spoken(word: string): string {
  const m = /^((?:[a-z0-9-]+\.)+(?:com|io|co|ai|app|dev|org|net|me|so|xyz|uk|us|ca|de|fr|shop|store|tech|gg|tv|ly|to|fm)(?:\/[\w-]+)*)([.,!?;:]*)$/i.exec(word)
  if (!m) return word
  return m[1].replace(/^www\./i, '').replace(/\./g, ' dot ').replace(/\//g, ' slash ') + m[2]
}

/** Splits a line into sentences, keeping each word's index in the line. */
function sentences(words: string[]): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  for (const w of words) {
    cur.push(w)
    if (/[.!?…]["')]*$/.test(w) && cur.length >= 2) { out.push(cur); cur = [] }
  }
  if (cur.length) {
    if (out.length && cur.length < 2) out[out.length - 1].push(...cur)
    else out.push(cur)
  }
  return out
}

async function kokoroTrack(scenes: SceneSpec[], voice: string, h?: JobHandle): Promise<{ samples: Float32Array; words: WordTiming[] }> {
  const parts: { at: number; audio: Float32Array }[] = []
  const words: WordTiming[] = []
  let t = 0.18
  const total = scenes.reduce((n, s) => n + sentences(tokenize(s.line)).length, 0) || 1
  let done = 0
  for (let si = 0; si < scenes.length; si++) {
    for (const sentence of sentences(tokenize(scenes[si].line))) {
      h?.step(0.05 + 0.8 * (done / total), `Recording line ${done + 1} of ${total}`)
      const raw = await kokoroSay(sentence.map(spoken).join(' '), voice)
      const [a, b] = voicedRange(raw)
      const audio = raw.subarray(a, b)
      const dur = audio.length / VOICE_SR
      // Kokoro gives no word timestamps, so spread the words over the spoken span by their weight.
      const weights = sentence.map((w, i) => wordWeight(w) + (i < sentence.length - 1 ? pauseAfter(w) * 2.2 : 0))
      const sum = weights.reduce((x, y) => x + y, 0)
      let at = t
      sentence.forEach((text, i) => {
        const span = (weights[i] / sum) * dur
        const spoken = (wordWeight(text) / weights[i]) * span
        words.push({ text, start: at, end: at + spoken, scene: si })
        at += span
      })
      parts.push({ at: t, audio })
      t += dur + 0.2
      done++
    }
    t += 0.16
  }
  const samples = new Float32Array(Math.ceil((t + 0.3) * VOICE_SR))
  for (const p of parts) samples.set(p.audio, Math.floor(p.at * VOICE_SR))
  return { samples, words }
}

// ---------- ElevenLabs (premium) ----------
const ELEVEN = 'https://api.elevenlabs.io/v1'

interface ElevenAlignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }

async function elevenRequest(voice: string, text: string, format: string): Promise<{ audio: Buffer; alignment: ElevenAlignment | null }> {
  const res = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': env.elevenKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.42, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true } }),
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body.slice(0, 300)
    try {
      const j = JSON.parse(body) as { detail?: { message?: string } | string }
      detail = typeof j.detail === 'string' ? j.detail : j.detail?.message ?? detail
    } catch { /* keep raw text */ }
    throw new Error(`ElevenLabs ${res.status}: ${detail}`)
  }
  const json = (await res.json()) as { audio_base64: string; alignment: ElevenAlignment | null }
  return { audio: Buffer.from(json.audio_base64, 'base64'), alignment: json.alignment }
}

async function elevenTrack(scenes: SceneSpec[], voice: string, dir: string, h?: JobHandle): Promise<{ samples: Float32Array; words: WordTiming[]; exact: boolean }> {
  const list: { text: string; scene: number; from: number; to: number }[] = []
  let text = ''
  scenes.forEach((s, si) => {
    for (const w of tokenize(s.line)) {
      if (text) text += ' '
      const say = spoken(w)
      list.push({ text: w, scene: si, from: text.length, to: text.length + say.length - 1 })
      text += say
    }
  })
  h?.step(0.2, 'Recording with ElevenLabs')
  let samples: Float32Array
  let alignment: ElevenAlignment | null
  try {
    const r = await elevenRequest(voice, text, 'pcm_24000')
    alignment = r.alignment
    samples = new Float32Array(Math.floor(r.audio.length / 2))
    for (let i = 0; i < samples.length; i++) samples[i] = r.audio.readInt16LE(i * 2) / 32768
  } catch (e) {
    // Some plans cannot request raw PCM; MP3 works everywhere and ffmpeg decodes it.
    if (!/output_format|pcm|subscription|tier/i.test(String(e))) throw e
    h?.log('Raw audio is not available on this ElevenLabs plan, using MP3')
    const r = await elevenRequest(voice, text, 'mp3_44100_128')
    alignment = r.alignment
    const mp3 = filePath(dir, 'source.mp3')
    writeFileSync(mp3, r.audio)
    samples = await decodeAudio(mp3, VOICE_SR)
    rmSync(mp3, { force: true })
  }
  const duration = samples.length / VOICE_SR
  const a = alignment
  if (a && a.characters.length === text.length && a.character_start_times_seconds.length === text.length) {
    const words = list.map((w) => ({ text: w.text, start: a.character_start_times_seconds[w.from], end: a.character_end_times_seconds[w.to], scene: w.scene }))
    return { samples, words, exact: true }
  }
  // Timestamps did not line up with the text (rare): fall back to weights over the whole clip.
  h?.log('ElevenLabs timestamps did not match the script, estimating word timings')
  const weights = list.map((w) => wordWeight(w.text) + pauseAfter(w.text) * 2.2)
  const sum = weights.reduce((x, y) => x + y, 0)
  let at = 0.05
  const words = list.map((w, i) => {
    const span = (weights[i] / sum) * (duration - 0.1)
    const out = { text: w.text, start: at, end: at + span * (wordWeight(w.text) / weights[i]), scene: w.scene }
    at += span
    return out
  })
  return { samples, words, exact: false }
}

// ---------- Shared ----------
/** RMS loudness per video frame, scaled 0..1. Drives lip-sync and the QC sync check. */
export function envelopeOf(samples: Float32Array, sampleRate: number): number[] {
  const hop = sampleRate / FPS
  const n = Math.ceil(samples.length / hop)
  const env_: number[] = []
  for (let f = 0; f < n; f++) {
    const a = Math.floor(f * hop)
    const b = Math.min(samples.length, Math.floor((f + 1) * hop))
    let s = 0
    for (let i = a; i < b; i++) s += samples[i] * samples[i]
    env_.push(Math.sqrt(s / Math.max(1, b - a)))
  }
  const sorted = [...env_].sort((x, y) => x - y)
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1e-6
  return env_.map((v) => Math.round(Math.min(1, v / ref) * 100) / 100)
}

const safeName = (s: string) => s.replace(/[^a-z0-9_-]/gi, '_')

/** Records the narration for a reel. Reuses the existing recording when script and voice are unchanged. */
export async function generateVoice(reel: Reel, h?: JobHandle): Promise<VoiceTrack> {
  const scenes = reel.scenes
  if (!scenes.some((s) => tokenize(s.line).length)) throw new Error('The script is empty. Write the script before recording a voice.')
  const hash = scriptHash(scenes)
  const voiceId = reel.settings.voiceId || KOKORO_VOICES[0].id
  if (reel.voice && reel.voice.scriptHash === hash && reel.voice.voiceId === voiceId && reel.voice.voiceUrl && existsSync(filePath(reel.voice.voiceUrl.replace(/^\/files\//, '')))) return reel.voice

  const [provider, name] = voiceId.split(/:(.*)/s) as [string, string]
  const dir = `reels/${reel.id}`
  ensureDir(dir)
  let samples: Float32Array
  let words: WordTiming[]
  let exact = false
  if (provider === 'elevenlabs') {
    if (!env.elevenKey) throw new Error('This is an ElevenLabs voice but ELEVENLABS_API_KEY is not set in .env. Pick a free voice or add the key.')
    ;({ samples, words, exact } = await elevenTrack(scenes, name, dir, h))
  } else if (provider === 'kokoro') {
    h?.step(0.03, 'Loading the voice model (first run downloads about 90 MB)')
    ;({ samples, words } = await kokoroTrack(scenes, name, h))
  } else throw new Error(`Unknown voice "${voiceId}"`)

  // Words must never run backwards or overlap; the timeline relies on it.
  let prev = 0
  for (const w of words) {
    w.start = Math.max(prev, w.start)
    w.end = Math.max(w.start + 0.04, w.end)
    prev = w.start + 0.02
  }
  h?.step(0.9, 'Saving the recording')
  const file = `voice-${safeName(hash)}-${safeName(name).slice(0, 24)}.wav`
  writeWav(filePath(dir, file), samples, VOICE_SR)
  // Recordings of earlier drafts are no use once the script or the voice has changed.
  for (const f of readdirSync(filePath(dir))) if (/^voice-/.test(f) && f !== file) rmSync(filePath(dir, f), { force: true })
  return {
    voiceId, provider: provider as 'kokoro' | 'elevenlabs', alignment: exact ? 'exact' : 'estimated',
    duration: samples.length / VOICE_SR, words, envelope: envelopeOf(samples, VOICE_SR),
    voiceUrl: fileUrl(dir, file), scriptHash: hash,
  }
}

// ---------- Voice list and previews ----------
interface ElevenVoice { voice_id: string; name: string; category?: string; preview_url?: string; labels?: Record<string, string>; description?: string }
let elevenCache: { at: number; voices: VoiceOption[]; error?: string } | null = null
const PREFERRED = ['narrat', 'social', 'conversational', 'characters', 'entertainment', 'informative', 'news']

/** A short, varied list of premium voices: narrators and social-media voices first. */
export async function elevenVoices(): Promise<{ voices: VoiceOption[]; error?: string }> {
  if (!env.elevenKey) return { voices: [] }
  if (elevenCache && Date.now() - elevenCache.at < 10 * 60 * 1000) return elevenCache
  try {
    const res = await fetch(`${ELEVEN}/voices`, { headers: { 'xi-api-key': env.elevenKey } })
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const all = ((await res.json()) as { voices: ElevenVoice[] }).voices
    const rank = (v: ElevenVoice) => {
      const use = (v.labels?.use_case ?? '').toLowerCase().replace(/_/g, ' ')
      const i = PREFERRED.findIndex((p) => use.includes(p))
      return (i < 0 ? PREFERRED.length : i) + (v.category === 'premade' ? 0 : 0.5)
    }
    const sorted = [...all].sort((a, b) => rank(a) - rank(b))
    // Balance the shortlist so it is not eight voices of the same kind.
    const picked: ElevenVoice[] = []
    const seen = new Map<string, number>()
    for (const v of sorted) {
      const kind = `${v.labels?.gender ?? '?'}|${v.labels?.accent ?? '?'}`
      const n = seen.get(kind) ?? 0
      if (n >= 2) continue
      seen.set(kind, n + 1)
      picked.push(v)
      if (picked.length >= 8) break
    }
    const voices = picked.map((v): VoiceOption => {
      const l = v.labels ?? {}
      const nice = (s: string | undefined) => (s ?? '').replace(/[_-]/g, ' ').trim()
      const blurb = [nice(l.descriptive ?? l.description), nice(l.use_case)].filter(Boolean).join(', ')
      return {
        id: `elevenlabs:${v.voice_id}`, provider: 'elevenlabs', name: v.name.split(/\s+-\s+/)[0],
        blurb: blurb ? blurb[0].toUpperCase() + blurb.slice(1) + '.' : 'Premium voice.',
        tags: [nice(l.gender), nice(l.accent), nice(l.age)].filter(Boolean), previewUrl: v.preview_url,
      }
    })
    elevenCache = { at: Date.now(), voices }
  } catch (e) {
    elevenCache = { at: Date.now() - 9 * 60 * 1000, voices: [], error: e instanceof Error ? e.message : String(e) }
  }
  return elevenCache
}

export async function listVoices(): Promise<{ voices: VoiceOption[]; elevenError?: string }> {
  const eleven = await elevenVoices()
  const local = KOKORO_VOICES.map((v) => ({ ...v, previewUrl: `/api/voices/preview?id=${encodeURIComponent(v.id)}` }))
  return { voices: [...local, ...eleven.voices], elevenError: eleven.error }
}

const SAMPLE_LINE = 'What if your whole week changed, because of one small idea? Here is how it starts.'
const previews = new Map<string, Promise<string>>()
/** Path of a short sample for a local voice, synthesised once and kept. */
export function kokoroPreview(voiceId: string): Promise<string> {
  const v = KOKORO_VOICES.find((k) => k.id === voiceId)
  if (!v) return Promise.reject(new Error('Unknown voice'))
  const name = v.id.split(':')[1]
  ensureDir('voices')
  const path = filePath('voices', `${safeName(name)}.wav`)
  if (existsSync(path)) return Promise.resolve(path)
  let p = previews.get(v.id)
  if (!p) {
    p = kokoroSay(SAMPLE_LINE, name).then((audio) => {
      const [a, b] = voicedRange(audio)
      writeWav(path, audio.subarray(a, b), VOICE_SR)
      return path
    })
    p.catch(() => previews.delete(v.id))
    previews.set(v.id, p)
  }
  return p
}
