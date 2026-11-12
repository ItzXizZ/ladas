// Starter content: the pre-made cast, the curated voice shortlist and default settings.
import {
  ACCESSORIES, BROWS, BUILDS, EYE_SHAPES, HAIR_STYLES, MOUTHS, NOSES, TOPS,
  type AppSettings, type Cast, type CharacterRecord, type ReelSettings, type SceneSpec, type VoiceOption,
} from './types.ts'

export const SKIN_TONES = ['#FFE0C4', '#F7CFA8', '#EDB98A', '#D99C6C', '#B97A50', '#8D5A3A', '#63402B']
export const HAIR_COLORS = ['#2B2118', '#4A3222', '#7A4B2A', '#B8763A', '#E0B75E', '#C2452D', '#9AA0A8', '#F2F2F2', '#3B5BD9', '#D6479B']
export const CLOTH_COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#111827', '#F8FAFC', '#64748B', '#7C2D12']
export const BOTTOM_COLORS = ['#1F2937', '#334155', '#1E3A8A', '#57534E', '#7C6F57', '#111827']

type Seed = Omit<CharacterRecord, 'version' | 'createdAt' | 'updatedAt' | 'starter'>

const c = (
  id: string, name: string, role: CharacterRecord['identity']['role'], personality: string, catchphrase: string,
  body: CharacterRecord['body'], face: Partial<CharacterRecord['face']>, hair: CharacterRecord['hair'],
  wardrobe: Partial<CharacterRecord['wardrobe']> & Pick<CharacterRecord['wardrobe'], 'top' | 'topColor'>,
  performance: CharacterRecord['performance'],
): Seed => ({
  id,
  identity: { name, role, personality, catchphrase },
  body,
  face: { eyes: 'round', brows: 'medium', nose: 'button', mouth: 'medium', freckles: false, blush: false, glasses: 'none', facialHair: 'none', ...face },
  hair,
  wardrobe: { bottomColor: '#1F2937', shoeColor: '#F8FAFC', accessory: 'none', accessoryColor: '#EF4444', ...wardrobe },
  performance,
})

const SEEDS: Seed[] = [
  c('jake', 'Jake', 'hero', 'Nervous overthinker who leaves everything to the last night', 'It is fine. It is totally fine.',
    { height: 1, build: 'slim', skin: '#F7CFA8' }, { brows: 'thick', freckles: true },
    { style: 'messy', color: '#4A3222' }, { top: 'hoodie', topColor: '#3B82F6', bottomColor: '#334155', accessory: 'backpack', accessoryColor: '#F59E0B' },
    { walk: 'slouch', energy: 'nervous', voice: 'kokoro:am_puck' }),
  c('maya', 'Maya', 'foil', 'Sharp, organised, always three steps ahead and slightly smug about it', 'Told you.',
    { height: 0.97, build: 'average', skin: '#B97A50' }, { eyes: 'oval', mouth: 'wide', glasses: 'round', blush: true },
    { style: 'curly', color: '#2B2118' }, { top: 'sweater', topColor: '#F59E0B', bottomColor: '#1E3A8A' },
    { walk: 'bouncy', energy: 'hype', voice: 'kokoro:af_bella' }),
  c('hale', 'Professor Hale', 'mentor', 'Dry, unimpressed professor who has seen every excuse', 'See me after class.',
    { height: 1.06, build: 'average', skin: '#EDB98A' }, { eyes: 'narrow', brows: 'thick', nose: 'pointed', glasses: 'square', facialHair: 'beard' },
    { style: 'sidepart', color: '#9AA0A8' }, { top: 'blazer', topColor: '#57534E', bottomColor: '#1F2937', shoeColor: '#2B2118', accessory: 'tie', accessoryColor: '#7C2D12' },
    { walk: 'normal', energy: 'calm', voice: 'kokoro:bm_george' }),
  c('priya', 'Priya', 'hero', 'Overloaded team lead who answers Slack in her sleep', 'Circling back on that.',
    { height: 0.98, build: 'slim', skin: '#D99C6C' }, { eyes: 'oval', brows: 'medium', mouth: 'medium' },
    { style: 'bun', color: '#2B2118' }, { top: 'blazer', topColor: '#8B5CF6', bottomColor: '#111827', shoeColor: '#111827' },
    { walk: 'normal', energy: 'calm', voice: 'kokoro:af_heart' }),
  c('dev', 'Dev', 'foil', 'Relentlessly cheerful coworker with a spreadsheet for everything', 'Quick sync?',
    { height: 1.03, build: 'broad', skin: '#8D5A3A' }, { eyes: 'round', brows: 'thick', mouth: 'wide', facialHair: 'stubble' },
    { style: 'short', color: '#2B2118' }, { top: 'shirt', topColor: '#F8FAFC', bottomColor: '#334155', shoeColor: '#4A3222', accessory: 'tie', accessoryColor: '#EF4444' },
    { walk: 'bouncy', energy: 'hype', voice: 'kokoro:am_michael' }),
  c('sam', 'Sam', 'crowd', 'Quiet intern who notices what everyone else misses', 'Um, actually...',
    { height: 0.94, build: 'slim', skin: '#FFE0C4' }, { eyes: 'sleepy', brows: 'thin', mouth: 'small', freckles: true },
    { style: 'short', color: '#C2452D' }, { top: 'hoodie', topColor: '#10B981', bottomColor: '#57534E', accessory: 'beanie', accessoryColor: '#111827' },
    { walk: 'slouch', energy: 'calm', voice: 'kokoro:af_nicole' }),
  c('zoe', 'Zoe', 'hero', 'Scrappy founder shipping at 2am on cold brew and stubbornness', 'Ship it.',
    { height: 0.99, build: 'average', skin: '#F7CFA8' }, { eyes: 'round', brows: 'medium', mouth: 'wide', blush: true },
    { style: 'bob', color: '#D6479B' }, { top: 'tee', topColor: '#111827', bottomColor: '#334155', accessory: 'headphones', accessoryColor: '#F8FAFC' },
    { walk: 'bouncy', energy: 'hype', voice: 'kokoro:af_bella' }),
  c('marcus', 'Marcus', 'foil', 'Skeptical co-founder who asks what the numbers say', 'Show me the data.',
    { height: 1.07, build: 'broad', skin: '#63402B' }, { eyes: 'narrow', brows: 'thick', nose: 'round', mouth: 'medium', glasses: 'square' },
    { style: 'afro', color: '#2B2118' }, { top: 'sweater', topColor: '#14B8A6', bottomColor: '#1F2937' },
    { walk: 'normal', energy: 'calm', voice: 'kokoro:am_fenrir' }),
  c('june', 'Grandma June', 'mentor', 'Warm, blunt grandmother who is better with tech than you expect', 'In my day we just asked.',
    { height: 0.9, build: 'average', skin: '#FFE0C4' }, { eyes: 'sleepy', brows: 'thin', nose: 'round', mouth: 'small', glasses: 'round', blush: true },
    { style: 'bun', color: '#F2F2F2' }, { top: 'sweater', topColor: '#EC4899', bottomColor: '#7C6F57', shoeColor: '#7C2D12', accessory: 'scarf', accessoryColor: '#F8FAFC' },
    { walk: 'slouch', energy: 'calm', voice: 'kokoro:bf_emma' }),
  c('leo', 'Leo', 'hero', 'Ten-year-old chaos agent with too many questions', 'But why though?',
    { height: 0.8, build: 'slim', skin: '#EDB98A' }, { eyes: 'round', brows: 'thin', mouth: 'wide', freckles: true },
    { style: 'spiky', color: '#B8763A' }, { top: 'tee', topColor: '#EF4444', bottomColor: '#1E3A8A', accessory: 'cap', accessoryColor: '#3B82F6' },
    { walk: 'bouncy', energy: 'hype', voice: 'kokoro:am_puck' }),
]

const EPOCH = '2026-11-11T00:00:00.000Z'
export const STARTER_CHARACTERS: CharacterRecord[] = SEEDS.map((s) => ({ ...s, version: 1, starter: true, createdAt: EPOCH, updatedAt: EPOCH }))

export const STARTER_CASTS: Cast[] = [
  { id: 'cast-campus', name: 'Campus', description: 'Students and the professor who has heard it all', characterIds: ['jake', 'maya', 'hale'], starter: true },
  { id: 'cast-office', name: 'Office', description: 'A team lead, the keen coworker and the intern', characterIds: ['priya', 'dev', 'sam'], starter: true },
  { id: 'cast-founders', name: 'Startup founders', description: 'Two co-founders and their first hire', characterIds: ['zoe', 'marcus', 'sam'], starter: true },
  { id: 'cast-family', name: 'Family', description: 'Grandma, the kid and a tired parent', characterIds: ['june', 'leo', 'priya'], starter: true },
]

/** Curated shortlist of the free local voices. Premium voices are added when a key is set. */
export const KOKORO_VOICES: VoiceOption[] = [
  { id: 'kokoro:af_heart', provider: 'kokoro', name: 'Heart', blurb: 'Warm, friendly narrator. The safe default.', tags: ['female', 'US', 'warm'] },
  { id: 'kokoro:af_bella', provider: 'kokoro', name: 'Bella', blurb: 'Bright and energetic, good for skits.', tags: ['female', 'US', 'upbeat'] },
  { id: 'kokoro:af_nicole', provider: 'kokoro', name: 'Nicole', blurb: 'Soft, close-mic storyteller.', tags: ['female', 'US', 'soft'] },
  { id: 'kokoro:am_michael', provider: 'kokoro', name: 'Michael', blurb: 'Calm, clear explainer.', tags: ['male', 'US', 'clear'] },
  { id: 'kokoro:am_fenrir', provider: 'kokoro', name: 'Fenrir', blurb: 'Deep and dramatic, good for "what if".', tags: ['male', 'US', 'dramatic'] },
  { id: 'kokoro:am_puck', provider: 'kokoro', name: 'Puck', blurb: 'Playful and quick.', tags: ['male', 'US', 'playful'] },
  { id: 'kokoro:bf_emma', provider: 'kokoro', name: 'Emma', blurb: 'Polished British narrator.', tags: ['female', 'UK', 'polished'] },
  { id: 'kokoro:bm_george', provider: 'kokoro', name: 'George', blurb: 'British documentary voice.', tags: ['male', 'UK', 'documentary'] },
]

export const DEFAULT_SETTINGS: AppSettings = {
  model: '',
  defaultVoiceId: 'kokoro:af_heart',
  defaultStyle: 'cartoon',
  reelSeconds: 30,
  captions: true,
  musicLevel: 0.5,
  sfxLevel: 0.7,
  renderWorkers: 4,
  capturePages: 3,
  qcVision: true,
}

export const defaultReelSettings = (app: AppSettings): ReelSettings => ({
  voiceId: app.defaultVoiceId,
  music: 'auto',
  musicLevel: app.musicLevel,
  sfxLevel: app.sfxLevel,
  captions: app.captions,
})

// ---------- Deterministic randomness ----------
export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const NAMES = ['Alex', 'Riley', 'Jordan', 'Casey', 'Morgan', 'Quinn', 'Avery', 'Rowan', 'Skye', 'Nico', 'Tess', 'Omar', 'Lena', 'Kai', 'Ivy', 'Theo']

/** A random but reproducible character. Used for crowds (varied, on-palette) and as a base for new ones. */
export function randomCharacter(seed: string, palette?: string[]): CharacterRecord {
  const r = mulberry(hashString(seed))
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]
  const tops = TOPS.filter((t) => t !== 'gown' && t !== 'labcoat')
  const cloth = palette && palette.length ? palette : CLOTH_COLORS
  return {
    id: `x-${hashString(seed).toString(36)}`,
    version: 1,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    identity: { name: pick(NAMES), role: 'crowd', personality: 'Background extra', catchphrase: '' },
    body: { height: 0.9 + r() * 0.2, build: pick(BUILDS), skin: pick(SKIN_TONES) },
    face: {
      eyes: pick(EYE_SHAPES), brows: pick(BROWS), nose: pick(NOSES), mouth: pick(MOUTHS),
      freckles: r() < 0.2, blush: r() < 0.3, glasses: r() < 0.25 ? pick(['round', 'square'] as const) : 'none',
      facialHair: r() < 0.15 ? pick(['stubble', 'beard', 'mustache'] as const) : 'none',
    },
    hair: { style: pick(HAIR_STYLES.filter((h) => h !== 'bald')), color: pick(HAIR_COLORS.slice(0, 7)) },
    wardrobe: {
      top: pick(tops), topColor: pick(cloth), bottomColor: pick(BOTTOM_COLORS), shoeColor: pick(['#F8FAFC', '#111827', '#4A3222']),
      accessory: r() < 0.3 ? pick(ACCESSORIES.filter((a) => a !== 'gradcap' && a !== 'none')) : 'none', accessoryColor: pick(cloth),
    },
    performance: { walk: 'normal', energy: 'calm' },
  }
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** A 3-second scene used for style previews and the Character Studio stage. */
export function demoScenes(ids: string[]): SceneSpec[] {
  const [a, b] = ids
  return [{
    id: 'demo', beat: 'hook', kind: 'story', line: 'Wait. What did you just say?', emphasis: ['what'],
    set: 'campus', shot: 'wide', camera: 'push', transition: 'cut', crowd: 0, props: [],
    actors: [
      { characterId: a, slot: b ? 'left' : 'center', pose: 'point', expression: 'grin', enter: 'pop', outfit: 'default', holding: 'none', speaks: true, bubble: 'No way!', bubbleAt: 0.25 },
      ...(b ? [{ characterId: b, slot: 'right' as const, pose: 'stand' as const, expression: 'neutral' as const, enter: 'none' as const, outfit: 'default' as const, holding: 'none' as const, speaks: false, react: { at: 0.45, expression: 'shock' as const, pose: 'raise' as const } }] : []),
    ],
  }]
}
