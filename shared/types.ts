// The data model shared by the server pipeline and the browser engine.
// Everything a user makes is a versioned record; a reel is pointers to records plus scene specs.

export const FPS = 30
export const W = 1080
export const H = 1920
/** Captions and bubbles must stay inside this band to clear the Reels/TikTok interface. */
export const SAFE_TOP = Math.round(H * 0.14)
export const SAFE_BOTTOM = Math.round(H * 0.8)

// ---------- Styles ----------
export const STYLE_IDS = ['cartoon', 'stick', 'paper', 'line'] as const
export type StyleId = (typeof STYLE_IDS)[number]

// ---------- Characters ----------
export const EXPRESSIONS = ['neutral', 'happy', 'grin', 'shock', 'worried', 'sad', 'smug', 'proud'] as const
export type Expression = (typeof EXPRESSIONS)[number]

export const POSES = ['stand', 'point', 'raise', 'hold', 'behind', 'cheer', 'hips', 'think', 'shrug', 'wave'] as const
export type Pose = (typeof POSES)[number]

export const HAIR_STYLES = ['short', 'messy', 'sidepart', 'spiky', 'buzz', 'bald', 'bob', 'long', 'ponytail', 'bun', 'curly', 'afro'] as const
export type HairStyle = (typeof HAIR_STYLES)[number]

export const TOPS = ['tee', 'hoodie', 'shirt', 'blazer', 'sweater', 'dress', 'labcoat', 'gown'] as const
export type Top = (typeof TOPS)[number]

export const ACCESSORIES = ['none', 'cap', 'beanie', 'headphones', 'scarf', 'backpack', 'gradcap', 'tie'] as const
export type Accessory = (typeof ACCESSORIES)[number]

export const EYE_SHAPES = ['round', 'oval', 'narrow', 'sleepy'] as const
export const BROWS = ['thin', 'medium', 'thick'] as const
export const NOSES = ['button', 'pointed', 'round', 'none'] as const
export const MOUTHS = ['small', 'medium', 'wide'] as const
export const GLASSES = ['none', 'round', 'square'] as const
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'mustache'] as const
export const BUILDS = ['slim', 'average', 'broad'] as const
export const WALKS = ['normal', 'bouncy', 'slouch'] as const
export const ENERGIES = ['calm', 'nervous', 'hype'] as const
export const ROLES = ['hero', 'foil', 'mentor', 'crowd'] as const
export type Role = (typeof ROLES)[number]

/** A character is style-independent data. Every style plug-in draws it from this record. */
export interface CharacterRecord {
  id: string
  version: number
  starter?: boolean
  createdAt: string
  updatedAt: string
  identity: { name: string; role: Role; personality: string; catchphrase: string }
  body: { height: number; build: (typeof BUILDS)[number]; skin: string }
  face: {
    eyes: (typeof EYE_SHAPES)[number]
    brows: (typeof BROWS)[number]
    nose: (typeof NOSES)[number]
    mouth: (typeof MOUTHS)[number]
    freckles: boolean
    acne?: boolean
    blush: boolean
    glasses: (typeof GLASSES)[number]
    facialHair: (typeof FACIAL_HAIR)[number]
  }
  hair: { style: HairStyle; color: string }
  wardrobe: { top: Top; topColor: string; bottomColor: string; shoeColor: string; accessory: Accessory; accessoryColor: string }
  performance: { walk: (typeof WALKS)[number]; energy: (typeof ENERGIES)[number]; voice?: string }
  /** Per-style tweaks, e.g. bigger eyes in one style. */
  styleOverrides?: Partial<Record<StyleId, { eyeScale?: number; headScale?: number }>>
}

export interface Cast {
  id: string
  name: string
  description: string
  characterIds: string[]
  starter?: boolean
}

// ---------- Product ----------
export interface Feature {
  name: string
  benefit: string
  /** Page url or screen where the feature lives. */
  where?: string
}

export interface BrandKit {
  logoUrl?: string
  primary: string
  accent: string
  ink: string
  fonts: string[]
}

export interface ProductBrief {
  name: string
  pitch: string
  category: string
  audience: string
  pricePoint?: string
  features: Feature[]
  tone: string[]
  /** Claims the site itself makes. Scripts may only repeat these. */
  claims: string[]
  notes: string
}

export interface Region {
  id: string
  kind: 'hero' | 'heading' | 'card' | 'cta' | 'media'
  label: string
  /** CSS pixels in page coordinates. */
  rect: { x: number; y: number; w: number; h: number }
  feature?: string
}

/** One captured page: a column of sharp tiles the engine pans and zooms over. */
export interface FootagePage {
  id: string
  url: string
  title: string
  device: 'desktop' | 'mobile'
  viewport: { w: number; h: number }
  /** Device scale the tiles were captured at. */
  scale: number
  pageHeight: number
  tiles: { y: number; h: number; url: string }[]
  regions: Region[]
  hiddenOverlays: number
  /** A photo the user uploaded rather than a captured page. Survives a re-capture. */
  uploaded?: boolean
}

export interface Product {
  id: string
  url: string
  createdAt: string
  status: 'ingesting' | 'ready' | 'failed'
  error?: string
  brief: ProductBrief
  brand: BrandKit
  footage: FootagePage[]
  /** How the brief was written: by the model, or by the keyless fallback. */
  briefSource: 'llm' | 'heuristic'
}

// ---------- Story ----------
export const BEATS = ['hook', 'setup', 'escalation', 'turn', 'bridge', 'product', 'cta'] as const
export type Beat = (typeof BEATS)[number]

export interface HookScore {
  total: number
  factors: { key: 'visual' | 'curiosity' | 'specificity' | 'relevance' | 'bridge'; label: string; score: number; max: number; reason: string }[]
}

export interface Story {
  id: string
  productId: string
  formatId: string
  hook: string
  /** The 4-beat outline shown on the card. */
  beats: string[]
  bridge: string
  score: HookScore
  source: 'recommended' | 'custom'
  writtenBy: 'llm' | 'template'
  /** Suggested stronger first line, only for custom stories with weak hooks. */
  hookSuggestion?: string
}

// ---------- Scene spec: the style-neutral interface every style compiles ----------
export const SETS = ['campus', 'office', 'home', 'street', 'neutral'] as const
export type SetId = (typeof SETS)[number]
export const SHOTS = ['wide', 'medium', 'close'] as const
export type Shot = (typeof SHOTS)[number]
export const CAMERAS = ['static', 'push', 'pull', 'pan-left', 'pan-right', 'shake', 'rack'] as const
export type Camera = (typeof CAMERAS)[number]
export const TRANSITIONS = ['cut', 'whip', 'flash', 'iris', 'match'] as const
export type Transition = (typeof TRANSITIONS)[number]
export const SLOTS = ['left', 'center', 'right'] as const
export type Slot = (typeof SLOTS)[number]
export const ENTERS = ['none', 'walk', 'pop', 'drop'] as const
export type Enter = (typeof ENTERS)[number]
export const OUTFITS = ['default', 'gown', 'labcoat', 'suit'] as const
export type Outfit = (typeof OUTFITS)[number]
export const PROP_KINDS = ['stamp', 'sign', 'screen', 'phone', 'laptop', 'card', 'confetti', 'burst', 'sparkle', 'title'] as const
export type PropKind = (typeof PROP_KINDS)[number]
export const PROP_SLOTS = ['top', 'center', 'left', 'right'] as const
export const HELD = ['none', 'phone', 'laptop', 'sign', 'paper', 'coffee'] as const
export type Held = (typeof HELD)[number]

export interface ActorSpec {
  characterId: string
  slot: Slot
  pose: Pose
  expression: Expression
  enter: Enter
  outfit: Outfit
  holding: Held
  /** Lip-syncs to the narration during this scene. */
  speaks: boolean
  /** Speech bubble text, a few words. */
  bubble?: string
  /** When the bubble pops, 0..1 through the scene. */
  bubbleAt?: number
  /** Mid-scene change of expression or pose. */
  react?: { at: number; expression: Expression; pose?: Pose }
}

export interface PropSpec {
  kind: PropKind
  text?: string
  slot: (typeof PROP_SLOTS)[number]
  /** When it appears, 0..1 through the scene. */
  at: number
  tone: 'accent' | 'bad' | 'good' | 'plain'
}

export interface ProductShot {
  device: 'desktop' | 'mobile'
  move: 'hero' | 'scroll' | 'zoom'
  pageId?: string
  regionId?: string
  callout?: string
}

export interface SceneSpec {
  id: string
  beat: Beat
  kind: 'story' | 'product' | 'cta'
  /** The narration spoken over this scene. Scene length follows it. */
  line: string
  /** Words in the line to colour in captions. */
  emphasis: string[]
  set: SetId
  shot: Shot
  camera: Camera
  transition: Transition
  actors: ActorSpec[]
  props: PropSpec[]
  /** Background extras generated from the cast palette. */
  crowd: number
  product?: ProductShot
  /** What the scene was before a site photo was placed in it, restored when the photo is removed. */
  beforePhoto?: { kind: SceneSpec['kind']; product?: ProductShot }
  /** QC auto-fix overrides, applied by layout. */
  fix?: { bubbleDy?: number; bubbleScale?: number; propDy?: number }
}

// ---------- Voice ----------
export interface VoiceOption {
  id: string
  provider: 'kokoro' | 'elevenlabs'
  name: string
  blurb: string
  tags: string[]
  previewUrl?: string
}

export interface WordTiming {
  text: string
  start: number
  end: number
  scene: number
}

export interface VoiceTrack {
  voiceId: string
  provider: 'kokoro' | 'elevenlabs' | 'none'
  /** 'exact' from provider timestamps, 'estimated' from sentence lengths and silences. */
  alignment: 'exact' | 'estimated'
  duration: number
  words: WordTiming[]
  /** Voice loudness per frame, 0..1, drives lip-sync. */
  envelope: number[]
  voiceUrl?: string
  mixUrl?: string
  /** The script text this audio was generated from. */
  scriptHash: string
}

// ---------- Reel ----------
export interface ReelSettings {
  voiceId: string
  music: 'auto' | 'upbeat' | 'curious' | 'chill' | 'none'
  musicLevel: number
  sfxLevel: number
  captions: boolean
  captionAccent?: string
}

export interface QcIssue {
  check: 'geometry' | 'vision' | 'sync' | 'audio'
  severity: 'error' | 'warn'
  sceneId?: string
  frame?: number
  message: string
  fixed?: boolean
  suggestion?: string
}

export interface QcReport {
  ranAt: string
  passed: boolean
  rounds: number
  issues: QcIssue[]
  contactSheetUrl?: string
  loudness?: { lufs: number; truePeak: number }
  visionReviewed: boolean
}

export interface Render {
  id: string
  reelId: string
  createdAt: string
  preset: 'reel' | 'square' | 'feed'
  width: number
  height: number
  duration: number
  seconds: number
  mp4Url: string
  srtUrl: string
  coverUrl: string
  qc?: QcReport
}

export interface Reel {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  productId: string
  characterIds: string[]
  /** Character versions pinned when the script was written, so old reels keep their look. */
  characterVersions: Record<string, number>
  style: StyleId
  story?: Story
  /** Stories recommended or written for this reel, kept so the Story step survives a reload. */
  storyOptions?: Story[]
  /** Reel length the script was written for, in seconds. */
  seconds?: number
  scenes: SceneSpec[]
  scriptWrittenBy?: 'llm' | 'template'
  voice?: VoiceTrack
  settings: ReelSettings
  renders: Render[]
}

/** Everything the engine needs to draw a reel, resolved into one payload. */
export interface ReelBundle {
  reel: Reel
  product: Product
  characters: CharacterRecord[]
}

// ---------- Settings & jobs ----------
export interface AppSettings {
  model: string
  defaultVoiceId: string
  defaultStyle: StyleId
  reelSeconds: 20 | 30 | 38
  captions: boolean
  musicLevel: number
  sfxLevel: number
  renderWorkers: number
  capturePages: number
  qcVision: boolean
}

export interface Job {
  id: string
  kind: string
  status: 'running' | 'done' | 'failed'
  progress: number
  message: string
  log: string[]
  result?: unknown
  error?: string
}

export interface ServerStatus {
  anthropic: { configured: boolean; model?: string; models: string[]; error?: string }
  elevenlabs: { configured: boolean; error?: string }
  ffmpeg: boolean
  browser: string | null
  settings: AppSettings
  voices: VoiceOption[]
}

// ---------- Render page contract ----------
/** Where a tagged element landed, in frame units (1080x1920). */
export interface QcBox { kind: string; scene: string | null; x: number; y: number; w: number; h: number }

/** What the render page exposes to the renderer and the QC stage. */
export interface RenderApi {
  ready: boolean
  error?: string
  total: number
  /** First and last frame of every scene. */
  scenes: { start: number; end: number }[]
  setFrame(n: number): Promise<void>
  qc(): QcBox[]
}

declare global {
  interface Window {
    __reel?: RenderApi
  }
}
