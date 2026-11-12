// The script stage and scene compiler's writing half. A story becomes a beat sheet, a 100-130
// word voiceover and one style-neutral SceneSpec per beat. The model writes compact specs, never
// animation code; sanitizeScenes then enforces every layout rule, so a bad spec cannot reach a frame.
import { formatById } from '../shared/formats.ts'
import { tokenize, WORD_TARGET } from '../shared/timeline.ts'
import {
  BEATS, CAMERAS, ENTERS, EXPRESSIONS, HELD, OUTFITS, POSES, PROP_KINDS, PROP_SLOTS, SETS, SHOTS, SLOTS, TRANSITIONS,
  type ActorSpec, type CharacterRecord, type Expression, type FootagePage, type Pose, type Product, type PropSpec, type Region,
  type SceneSpec, type Slot, type Story, type StyleId,
} from '../shared/types.ts'
import { llmReady, structured, WRITER_RULES } from './llm.ts'
import { templateFor, type TemplateHint } from './stories.ts'

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
const num = (v: unknown, fallback: number, lo = 0, hi = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
/** Shortens on-screen text at a word boundary. */
function short(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const i = cut.lastIndexOf(' ')
  return (i > max * 0.5 ? cut.slice(0, i) : text.slice(0, max)).replace(/[,;:.\s]+$/, '')
}

export const wordCount = (scenes: SceneSpec[]) => scenes.reduce((n, s) => n + tokenize(s.line).length, 0)

const TOP_BAND: PropSpec['kind'][] = ['title', 'sign', 'screen', 'card']
const CENTER_ONLY: PropSpec['kind'][] = ['stamp', 'phone', 'laptop']

const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
const wordSet = (s: string) => new Set(bare(s).split(/\s+/).filter((w) => w.length > 3))

/** Regions good enough to zoom into, best first: feature-linked cards, then other cards and sections. */
export function zoomRegions(product: Product): { page: FootagePage; region: Region }[] {
  const out: { page: FootagePage; region: Region; rank: number }[] = []
  for (const page of product.footage) {
    for (const region of page.regions) {
      if (region.kind === 'cta' || region.rect.h > 720 || region.rect.h < 70) continue
      const rank = (region.feature ? 0 : 4) + (region.kind === 'card' ? 0 : region.kind === 'heading' ? 1 : region.kind === 'media' ? 2 : 3) + (page.device === 'desktop' ? 0 : 0.5)
      out.push({ page, region, rank })
    }
  }
  return out.sort((a, b) => a.rank - b.rank)
}

function matchRegion(product: Product, text: string, used: Set<string>): { page: FootagePage; region: Region } | undefined {
  const want = wordSet(text)
  const options = zoomRegions(product).filter((o) => !used.has(o.region.id))
  let best: { page: FootagePage; region: Region } | undefined
  let bestScore = 0
  for (const o of options) {
    const have = wordSet(`${o.region.label} ${o.region.feature ?? ''}`)
    let s = 0
    for (const w of want) if (have.has(w)) s++
    if (s > bestScore) { bestScore = s; best = o }
  }
  return best ?? options[0]
}

interface RawScene { [key: string]: unknown }

/** Enforces the scene contract. Everything the engine draws has passed through here. */
export function sanitizeScenes(raw: RawScene[], product: Product, cast: CharacterRecord[], structure = true): SceneSpec[] {
  const ids = cast.map((c) => c.id)
  const usedRegions = new Set<string>()
  const hasDevice = (d: string) => product.footage.some((p) => p.device === d)
  const scenes: SceneSpec[] = []

  for (const r of raw) {
    const line = str(r.line)
    if (!line) continue
    let kind = oneOf(['story', 'product', 'cta'] as const, r.kind, 'story')
    let beat = oneOf(BEATS, r.beat, kind === 'product' ? 'product' : kind === 'cta' ? 'cta' : 'setup')
    if (beat === 'product') kind = 'product'
    if (beat === 'cta') kind = 'cta'
    if (kind === 'product') beat = 'product'
    if (kind === 'cta') beat = 'cta'
    if (kind === 'story' && (beat === 'product' || beat === 'cta')) beat = 'setup'

    // Actors: known characters only, one slot each.
    const actors: ActorSpec[] = []
    const takenSlots = new Set<Slot>()
    const seenChars = new Set<string>()
    for (const a of (Array.isArray(r.actors) ? r.actors : []) as RawScene[]) {
      if (actors.length >= 3) break
      let characterId = str(a.character ?? a.characterId)
      if (!ids.includes(characterId)) characterId = ids.find((id) => !seenChars.has(id)) ?? ''
      if (!characterId || seenChars.has(characterId)) continue
      seenChars.add(characterId)
      let slot = oneOf(SLOTS, a.slot, 'center')
      if (takenSlots.has(slot)) slot = SLOTS.find((s) => !takenSlots.has(s)) ?? slot
      takenSlots.add(slot)
      const reactExpr = oneOf([...EXPRESSIONS, 'none'] as const, a.reactExpression, 'none')
      const reactPose = oneOf([...POSES, 'none'] as const, a.reactPose, 'none')
      const bubble = short(str(a.bubble), 30)
      const holding = oneOf(HELD, a.holding, 'none')
      // Whoever holds something keeps holding it: other arm poses would swing the item over a face.
      const busy = holding !== 'none'
      actors.push({
        characterId, slot,
        pose: busy ? 'hold' : oneOf(POSES, a.pose, 'stand'), expression: oneOf(EXPRESSIONS, a.expression, 'neutral'),
        enter: oneOf(ENTERS, a.enter, 'none'), outfit: oneOf(OUTFITS, a.outfit, 'default'), holding,
        speaks: a.speaks === true,
        bubble: bubble || undefined, bubbleAt: bubble ? num(a.bubbleAt, 0.2, 0, 0.8) : undefined,
        react: reactExpr !== 'none' ? { at: num(a.reactAt, 0.5, 0.1, 0.85), expression: reactExpr as Expression, pose: reactPose !== 'none' && !busy ? (reactPose as Pose) : undefined } : undefined,
      })
    }
    // Only one mouth follows the narration.
    let speaker = false
    for (const a of actors) {
      if (a.speaks && speaker) a.speaks = false
      if (a.speaks) speaker = true
    }
    if (kind === 'story' && actors.length && !speaker) actors[0].speaks = true
    // A lone actor stands in the middle; a pair stands left and right.
    if (actors.length === 1) actors[0].slot = 'center'
    if (actors.length === 2 && actors.some((a) => a.slot === 'center')) {
      actors[0].slot = 'left'
      actors[1].slot = 'right'
    }

    // Props: text limits, slot rules, one per band.
    let props: PropSpec[] = []
    for (const p of (Array.isArray(r.props) ? r.props : []) as RawScene[]) {
      const k = oneOf(PROP_KINDS, p.kind, 'sparkle')
      const text = short(str(p.text), k === 'title' ? 34 : k === 'stamp' ? 18 : 30)
      if (['stamp', 'sign', 'screen', 'card', 'title', 'phone', 'laptop'].includes(k) && !text) continue
      let slot = oneOf(PROP_SLOTS, p.slot, 'top')
      if (CENTER_ONLY.includes(k)) slot = 'center'
      if (k === 'title') slot = 'top'
      props.push({ kind: k, text: text || undefined, slot, at: num(p.at, 0.25, 0, 0.85), tone: oneOf(['accent', 'bad', 'good', 'plain'] as const, p.tone, 'plain') })
    }
    const bandOf = (p: PropSpec) => (p.kind === 'confetti' || p.kind === 'burst' || p.kind === 'sparkle' ? 'fx' : p.slot === 'center' ? 'center' : 'top')
    const seenBand = new Set<string>()
    props = props.filter((p) => {
      const b = bandOf(p)
      if (b === 'fx') {
        if (seenBand.has(p.kind)) return false
        seenBand.add(p.kind)
        return true
      }
      if (seenBand.has(b)) return false
      seenBand.add(b)
      return true
    })
    // Bubbles and top-band props share the same strip of sky. The hook keeps its title; elsewhere dialogue wins.
    const topProp = props.find((p) => bandOf(p) === 'top' && TOP_BAND.includes(p.kind))
    if (topProp && actors.some((a) => a.bubble)) {
      if (beat === 'hook' && topProp.kind === 'title') for (const a of actors) { a.bubble = undefined; a.bubbleAt = undefined }
      else props = props.filter((p) => p !== topProp)
    }

    let shot = oneOf(SHOTS, r.shot, 'wide')
    if (shot === 'close' && actors.length > 1) shot = 'medium'
    if (shot === 'medium' && actors.length > 2) shot = 'wide'
    // Centre-band props sit over the bodies, which only works when the whole body is in frame.
    if (shot !== 'wide' && props.some((p) => bandOf(p) === 'center')) shot = 'wide'
    let camera = oneOf(CAMERAS, r.camera, 'static')
    if (camera === 'rack' && actors.length < 2) camera = 'push'

    const scene: SceneSpec = {
      id: `s${scenes.length + 1}`, beat, kind, line,
      emphasis: (Array.isArray(r.emphasis) ? r.emphasis : []).map(str).filter((w) => w && bare(line).includes(bare(w).trim())).slice(0, 3),
      set: oneOf(SETS, r.set, 'neutral'), shot, camera, transition: oneOf(TRANSITIONS, r.transition, 'cut'),
      actors, props, crowd: shot === 'close' ? 0 : Math.round(num(r.crowd, 0, 0, 6)),
    }
    if (!scene.emphasis.length) {
      const name = product.brief.name
      const longest = tokenize(line).map((w) => w.replace(/[^\w'$%]/g, '')).sort((a, b) => b.length - a.length)[0]
      scene.emphasis = bare(line).includes(bare(name)) && !name.includes(' ') ? [name] : longest ? [longest] : []
    }

    if (kind === 'product') {
      let move = oneOf(['hero', 'scroll', 'zoom'] as const, r.productMove ?? (r.product as RawScene | undefined)?.move, 'hero')
      let device = oneOf(['desktop', 'mobile'] as const, r.productDevice ?? (r.product as RawScene | undefined)?.device, 'desktop')
      const callout = short(str(r.productCallout ?? (r.product as RawScene | undefined)?.callout), 34)
      let regionId = str(r.productRegion ?? (r.product as RawScene | undefined)?.regionId)
      let pageId: string | undefined
      if (move === 'zoom') {
        let hit = product.footage.flatMap((p) => p.regions.map((region) => ({ page: p, region }))).find((x) => x.region.id === regionId && !usedRegions.has(regionId))
        if (!hit || hit.region.rect.h > 720) hit = matchRegion(product, `${callout} ${line}`, usedRegions)
        if (hit) {
          regionId = hit.region.id
          pageId = hit.page.id
          device = hit.page.device
          usedRegions.add(regionId)
        } else {
          move = 'scroll'
          regionId = ''
        }
      } else regionId = ''
      if (!hasDevice(device)) device = device === 'desktop' ? 'mobile' : 'desktop'
      // A page that fits on one screen has nothing to scroll through.
      if (move === 'scroll' && !product.footage.some((p) => p.device === device && p.pageHeight > p.viewport.h * 1.35)) {
        const other = device === 'desktop' ? 'mobile' : 'desktop'
        if (product.footage.some((p) => p.device === other && p.pageHeight > p.viewport.h * 1.35)) device = other
        else {
          const hit = matchRegion(product, `${callout} ${line}`, usedRegions)
          if (hit) {
            move = 'zoom'
            regionId = hit.region.id
            pageId = hit.page.id
            device = hit.page.device
            usedRegions.add(regionId)
          } else move = 'hero'
        }
      }
      scene.product = { device, move, pageId, regionId: regionId || undefined, callout: callout || undefined }
      scene.set = 'neutral'
      scene.shot = 'wide'
      scene.crowd = 0
      scene.props = scene.props.filter((p) => p.kind === 'confetti' || p.kind === 'sparkle')
      for (const a of scene.actors) { a.bubble = undefined; a.bubbleAt = undefined }
    }
    if (kind === 'cta') {
      scene.set = 'neutral'
      scene.shot = 'wide'
      scene.crowd = 0
      scene.props = []
      for (const a of scene.actors) { a.bubble = undefined; a.bubbleAt = undefined }
    }
    scenes.push(scene)
  }

  // A single scene being revised is returned as is; a whole script gets the structure guarantees.
  if (!structure) return scenes
  // Structure guarantees: a hook first, at least one product shot, one CTA last.
  if (scenes.length && scenes[0].kind === 'story') scenes[0].beat = 'hook'
  const story = scenes.filter((s) => s.kind === 'story')
  let product_ = scenes.filter((s) => s.kind === 'product')
  let cta = scenes.filter((s) => s.kind === 'cta').slice(-1)
  if (!product_.length) product_ = productScenes(product, cast, false)
  if (!cta.length) cta = [ctaScene(product, cast)]
  if (product_.length && product_[0].product) product_[0].product.move = product_[0].product.move === 'zoom' ? 'zoom' : 'hero'
  const ordered = [...story, ...product_, ...cta]
  ordered.forEach((s, i) => { s.id = `s${i + 1}` })
  if (ordered[0]) ordered[0].transition = 'cut'
  return ordered
}

// ---------- Template scene builder (keyless fallback, and repair when the model's script is unusable) ----------
const feature = (p: Product, i: number) => p.brief.features[i] ?? p.brief.features[0]
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ')
  return /[.!?]$/.test(t) ? t : t + '.'
}
const capWords = (s: string, n: number) => {
  const w = s.trim().split(/\s+/)
  return w.length <= n ? s.trim() : w.slice(0, n).join(' ').replace(/[,;:]+$/, '')
}

function ctaScene(product: Product, cast: CharacterRecord[]): SceneSpec {
  const host = (() => { try { return new URL(product.url).hostname.replace(/^www\./, '') } catch { return '' } })()
  return {
    id: 'cta', beat: 'cta', kind: 'cta', line: `Try ${product.brief.name}. ${host ? `It is at ${host}.` : 'Link in bio.'}`, emphasis: [product.brief.name.split(' ')[0]],
    set: 'neutral', shot: 'wide', camera: 'static', transition: 'flash', crowd: 0, props: [],
    actors: cast.slice(0, 3).map((c, i) => ({ characterId: c.id, slot: SLOTS[i], pose: 'cheer' as const, expression: 'grin' as const, enter: 'pop' as const, outfit: 'default' as const, holding: 'none' as const, speaks: i === 0 })),
  }
}

/** The product section: hero shot, a scroll through the real site, then a zoom on a feature. */
export function productScenes(product: Product, cast: CharacterRecord[], long: boolean): SceneSpec[] {
  const lead = cast[0]
  const second = cast[1]
  const actor = (pose: Pose, expression: Expression): ActorSpec[] => [
    ...(lead ? [{ characterId: lead.id, slot: 'left' as const, pose, expression, enter: 'none' as const, outfit: 'default' as const, holding: 'none' as const, speaks: true }] : []),
    ...(second ? [{ characterId: second.id, slot: 'right' as const, pose: 'stand' as const, expression: 'happy' as const, enter: 'none' as const, outfit: 'default' as const, holding: 'none' as const, speaks: false, react: { at: 0.4, expression: 'shock' as const, pose: 'raise' as const } }] : []),
  ]
  const used = new Set<string>()
  const f0 = feature(product, 0)
  const f1 = feature(product, 1)
  const hasMobile = product.footage.some((p) => p.device === 'mobile')
  const hasDesktop = product.footage.some((p) => p.device === 'desktop')
  const out: SceneSpec[] = []
  const base = { set: 'neutral' as const, shot: 'wide' as const, crowd: 0, props: [] as PropSpec[], beat: 'product' as const, kind: 'product' as const }
  out.push({
    ...base, id: 'p1', line: sentence(`This is ${product.brief.name}`), emphasis: [product.brief.name.split(' ')[0]], camera: 'push', transition: 'whip',
    actors: actor('point', 'grin'), product: { device: hasDesktop ? 'desktop' : 'mobile', move: 'hero', callout: capWords(product.brief.pitch, 6) },
  })
  if (f0) {
    out.push({
      ...base, id: 'p2', line: sentence(capWords(f0.benefit || f0.name, 16)), emphasis: [], camera: 'static', transition: 'cut',
      actors: actor('think', 'happy'), product: { device: hasMobile ? 'mobile' : 'desktop', move: 'scroll', callout: capWords(f0.name, 5) },
    })
  }
  const targets = long ? [f1, feature(product, 2)] : [f1]
  for (const f of targets) {
    if (!f) continue
    const hit = matchRegion(product, `${f.name} ${f.where ?? ''}`, used)
    if (hit) used.add(hit.region.id)
    out.push({
      ...base, id: `p${out.length + 1}`, line: sentence(capWords(f.benefit || f.name, 16)), emphasis: [], camera: 'static', transition: 'cut',
      actors: actor('raise', 'grin'),
      product: hit ? { device: hit.page.device, move: 'zoom', pageId: hit.page.id, regionId: hit.region.id, callout: capWords(f.name, 5) } : { device: hasDesktop ? 'desktop' : 'mobile', move: 'scroll', callout: capWords(f.name, 5) },
    })
  }
  return out
}

const MOODS: Record<NonNullable<TemplateHint['mood']>, { expression: Expression; pose: Pose; react: Expression }> = {
  tense: { expression: 'worried', pose: 'stand', react: 'shock' },
  funny: { expression: 'grin', pose: 'shrug', react: 'smug' },
  calm: { expression: 'neutral', pose: 'think', react: 'happy' },
  win: { expression: 'happy', pose: 'point', react: 'proud' },
}

/** Builds scene specs from a story's beats by rule: staging varies by beat so adjacent shots differ. */
export function scenesFromStory(story: Story, product: Product, cast: CharacterRecord[], seconds: number): SceneSpec[] {
  const tpl = templateFor(story)
  const format = formatById(story.formatId)
  const hero = cast.find((c) => c.identity.role === 'hero') ?? cast[0]
  const foil = cast.find((c) => c !== hero && c.identity.role === 'foil') ?? cast.find((c) => c !== hero)
  const mentor = cast.find((c) => c !== hero && c !== foil)
  const lines = [story.hook, ...story.beats, story.bridge].map(sentence)
  const beats = ['hook', 'setup', 'escalation', 'escalation', 'turn', 'bridge'] as const
  const shots = ['medium', 'wide', 'medium', 'wide', 'close', 'medium'] as const
  const cameras = ['push', 'pan-right', 'static', 'shake', 'push', 'pull'] as const
  const transitions = ['cut', 'cut', 'whip', 'cut', 'flash', 'iris'] as const
  const sets = [format.bestSet, format.bestSet, format.bestSet === 'neutral' ? 'office' : format.bestSet, format.bestSet, format.bestSet, 'neutral'] as const

  const raw: RawScene[] = lines.map((line, i) => {
    const hint = tpl?.hints[i] ?? {}
    const mood = MOODS[hint.mood ?? (i === 0 ? 'tense' : i === 4 ? 'win' : i % 2 ? 'calm' : 'tense')]
    const withFoil = foil && (i === 2 || i === 3 || i === 5)
    const actors: RawScene[] = []
    if (hero) {
      actors.push({
        character: hero.id, slot: withFoil ? 'left' : 'center', pose: i === 0 ? 'raise' : mood.pose, expression: mood.expression,
        enter: i === 0 ? 'pop' : i === 1 ? 'walk' : 'none', speaks: !withFoil || i !== 2,
        bubble: hint.bubble && !(withFoil && i === 2) ? hint.bubble : '', bubbleAt: 0.3,
        reactExpression: i === 3 || i === 0 ? mood.react : 'none', reactPose: i === 3 ? 'raise' : 'none', reactAt: 0.5,
        holding: i === 1 && format.bestSet !== 'neutral' ? 'laptop' : 'none',
      })
    }
    if (withFoil && foil) {
      actors.push({
        character: foil.id, slot: 'right', pose: i === 5 ? 'point' : i === 2 ? 'hips' : 'stand', expression: i === 2 ? 'smug' : i === 5 ? 'happy' : 'neutral',
        enter: i === 2 ? 'walk' : 'none', speaks: i === 2, bubble: i === 2 && hint.bubble ? hint.bubble : '', bubbleAt: 0.35,
        reactExpression: i === 3 ? 'shock' : 'none', reactPose: 'none', reactAt: 0.55,
      })
    }
    if (mentor && i === 4 && shots[i] !== 'close') actors.push({ character: mentor.id, slot: 'right', pose: 'think', expression: 'proud' })
    const props: RawScene[] = []
    if (hint.prop) props.push({ kind: hint.prop.kind, text: hint.prop.text, slot: hint.prop.kind === 'stamp' || hint.prop.kind === 'phone' ? 'center' : 'top', at: hint.prop.kind === 'stamp' ? 0.45 : 0.08, tone: hint.prop.tone ?? 'accent' })
    else if (i === 0) props.push({ kind: 'title', text: capWords(story.hook, 5), slot: 'top', at: 0.05, tone: 'accent' })
    if (i === 0) props.push({ kind: 'burst', at: 0, tone: 'accent', slot: 'center' })
    if (i === 4) props.push({ kind: 'sparkle', at: 0.5, tone: 'accent', slot: 'top' })
    return {
      beat: beats[i], kind: 'story', line, emphasis: [], set: sets[i], shot: props.some((p) => p.kind === 'stamp') ? 'wide' : shots[i],
      camera: cameras[i], transition: transitions[i], crowd: i === 3 ? 3 : 0, actors, props,
    }
  })
  const story_ = sanitizeScenes(raw, product, cast, false)
  if (story_[0]) story_[0].beat = 'hook'
  const all = [...story_, ...productScenes(product, cast, seconds >= 38), ctaScene(product, cast)]
  all.forEach((s, i) => { s.id = `s${i + 1}` })
  return all
}

// ---------- Model-written script ----------
const ACTOR_SCHEMA = (ids: string[]) => ({
  type: 'object',
  properties: {
    character: { type: 'string', enum: ids },
    slot: { type: 'string', enum: [...SLOTS] },
    pose: { type: 'string', enum: [...POSES] },
    expression: { type: 'string', enum: [...EXPRESSIONS] },
    enter: { type: 'string', enum: [...ENTERS], description: 'How they arrive. Use "none" if they were already on screen in the previous scene.' },
    outfit: { type: 'string', enum: [...OUTFITS] },
    holding: { type: 'string', enum: [...HELD] },
    speaks: { type: 'boolean', description: 'True for the one character whose mouth follows the narration in this scene' },
    bubble: { type: 'string', description: 'Speech bubble, at most 4 words, or empty string for none' },
    bubbleAt: { type: 'number', description: 'When the bubble pops, 0 to 0.8 through the scene' },
    reactExpression: { type: 'string', enum: [...EXPRESSIONS, 'none'], description: 'Expression they switch to mid-scene, or "none"' },
    reactPose: { type: 'string', enum: [...POSES, 'none'] },
    reactAt: { type: 'number', description: 'When the reaction lands, 0.1 to 0.85' },
  },
  required: ['character', 'slot', 'pose', 'expression', 'enter', 'outfit', 'holding', 'speaks', 'bubble', 'bubbleAt', 'reactExpression', 'reactPose', 'reactAt'],
})

const SCENE_SCHEMA = (ids: string[]) => ({
  type: 'object',
  properties: {
    beat: { type: 'string', enum: [...BEATS] },
    kind: { type: 'string', enum: ['story', 'product', 'cta'] },
    line: { type: 'string', description: 'Narration spoken over this scene. At most 18 words.' },
    emphasis: { type: 'array', items: { type: 'string' }, description: '1 or 2 words from the line to colour in the captions' },
    set: { type: 'string', enum: [...SETS] },
    shot: { type: 'string', enum: [...SHOTS], description: 'wide fits 3 actors, medium 2, close 1' },
    camera: { type: 'string', enum: [...CAMERAS] },
    transition: { type: 'string', enum: [...TRANSITIONS], description: 'How this scene arrives. Mostly "cut".' },
    crowd: { type: 'number', description: 'Background extras, 0 to 6' },
    actors: { type: 'array', items: ACTOR_SCHEMA(ids), description: 'At most 3' },
    props: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...PROP_KINDS] },
          text: { type: 'string', description: 'On-screen text, at most 4 words; empty for confetti, burst, sparkle' },
          slot: { type: 'string', enum: [...PROP_SLOTS] },
          at: { type: 'number', description: 'When it appears, 0 to 0.85 through the scene' },
          tone: { type: 'string', enum: ['accent', 'bad', 'good', 'plain'] },
        },
        required: ['kind', 'text', 'slot', 'at', 'tone'],
      },
    },
    productMove: { type: 'string', enum: ['none', 'hero', 'scroll', 'zoom'], description: '"none" for story and cta scenes' },
    productDevice: { type: 'string', enum: ['desktop', 'mobile'] },
    productRegion: { type: 'string', description: 'Region id from the footage inventory for a zoom, else empty string' },
    productCallout: { type: 'string', description: 'Label shown over the footage, at most 5 words, else empty string' },
  },
  required: ['beat', 'kind', 'line', 'emphasis', 'set', 'shot', 'camera', 'transition', 'crowd', 'actors', 'props', 'productMove', 'productDevice', 'productRegion', 'productCallout'],
})

const STAGING_RULES = `Staging rules (the layout engine enforces these, so follow them or content gets dropped):
- A scene shows 1 to 3 cast members. "wide" fits 3, "medium" 2, "close" 1.
- A scene has EITHER speech bubbles OR one top-band prop (title, sign, screen, card). Never both. The hook scene may use a title.
- stamp, phone and laptop props always use slot "center" and need a "wide" shot.
- Bubble and prop text: 4 words at most. Captions already show the narration, so on-screen text adds a joke or a label, it never repeats the line.
- Vary shot and camera between neighbouring scenes. Transitions are mostly "cut"; use "whip" or "flash" on an escalation and "iris" or "match" into the bridge.
- Use "enter" only when a character first appears. Use reactExpression for the moment something lands.
- Sets: campus, office, home, street, or neutral (a plain branded backdrop).
- Exactly one actor per scene has speaks true.`

function inventory(product: Product): string {
  const lines: string[] = []
  for (const page of product.footage) {
    lines.push(`Page ${page.id} (${page.device}, "${page.title.slice(0, 60)}"):`)
    for (const r of page.regions.filter((x) => x.kind !== 'cta' && x.rect.h <= 720).slice(0, 14)) lines.push(`  - ${r.id} [${r.kind}] "${r.label.slice(0, 70)}"${r.feature ? ` (shows feature: ${r.feature})` : ''}`)
  }
  return lines.join('\n') || 'No footage was captured. Use productMove "hero" only.'
}

const castBrief = (cast: CharacterRecord[]) =>
  cast.map((c) => `- id "${c.id}": ${c.identity.name}, ${c.identity.role}. ${c.identity.personality}. Catchphrase: "${c.identity.catchphrase}"`).join('\n')

export async function writeScript(story: Story, product: Product, cast: CharacterRecord[], style: StyleId, seconds: number): Promise<{ scenes: SceneSpec[]; writtenBy: 'llm' | 'template'; error?: string }> {
  const [lo, hi] = WORD_TARGET[seconds] ?? WORD_TARGET[30]
  if (!llmReady()) return { scenes: scenesFromStory(story, product, cast, seconds), writtenBy: 'template' }
  try {
    const res = await structured<{ scenes: RawScene[] }>({
      system: `You are the script writer and storyboard artist for a ${seconds}-second animated story reel (9:16, burned-in captions). You write a voiceover and one scene spec per beat. The specs are compiled to animation by code, so you choose from the listed options and never describe pixels.\n${WRITER_RULES}\n\n${STAGING_RULES}`,
      prompt: `Product Brief\nName: ${product.brief.name}\nPitch: ${product.brief.pitch}\nAudience: ${product.brief.audience}\nFeatures:\n${product.brief.features.map((f) => `- ${f.name}: ${f.benefit}`).join('\n')}\nClaims allowed: ${product.brief.claims.join(' | ') || 'only the features above'}\nNotes from the user: ${product.brief.notes || 'none'}\nSite: ${product.url}\n\nStory to script (format: ${formatById(story.formatId).name})\nHook: ${story.hook}\nBeats:\n${story.beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}\nBridge: ${story.bridge}\n\nCast (use these ids):\n${castBrief(cast)}\n\nAnimation style: ${style}\n\nFootage inventory of the real site (for the product section):\n${inventory(product)}\n\nWrite the full reel:\n- Total narration ${lo} to ${hi} words. Count them.\n- Scene 1 is the hook (beat "hook"). It must work with the sound off: a striking pose or expression plus a title prop or a bubble. Its line is the hook, 12 words at most.\n- Then 4 to 6 story scenes (setup, escalation, turn) that withhold the payoff until the turn.\n- Then one bridge scene (beat "bridge") whose line pivots into the product by reusing a word or image from the story.\n- Then ${seconds >= 38 ? '3' : '2 or 3'} product scenes (kind "product", beat "product"): first productMove "hero"; one "scroll" (mobile device if available); at least one "zoom" with a productRegion id from the inventory that shows the feature the line talks about. Each has a productCallout. Put 1 or 2 cast members in each as presenters.\n- Last, one cta scene (kind "cta", beat "cta") that names the product and where to find it. Write the web address the way it is typed (for example "${(() => { try { return new URL(product.url).hostname.replace(/^www\./, '') } catch { return 'example.com' } })()}"); the voice reads it out correctly.\n- Write lines in the characters' world and voice. Keep the user's story; sharpen wording only.`,
      tool: { name: 'save_script', description: 'Save the reel as an ordered list of scene specs.', schema: { type: 'object', properties: { scenes: { type: 'array', items: SCENE_SCHEMA(cast.map((c) => c.id)) } }, required: ['scenes'] } },
      maxTokens: 9000,
    })
    const scenes = sanitizeScenes(Array.isArray(res.scenes) ? res.scenes : [], product, cast)
    if (scenes.filter((s) => s.kind === 'story').length < 3) throw new Error('The model returned too few story scenes')
    return { scenes, writtenBy: 'llm' }
  } catch (e) {
    return { scenes: scenesFromStory(story, product, cast, seconds), writtenBy: 'template', error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- Plain-English scene edits ----------
const EXPR_WORDS: [RegExp, Expression][] = [[/shock|surpris|stunned|gasp/i, 'shock'], [/worr|nervous|anxious|scared/i, 'worried'], [/sad|upset|cry/i, 'sad'], [/smug|cocky/i, 'smug'], [/proud/i, 'proud'], [/grin|laugh|excited/i, 'grin'], [/happy|smil/i, 'happy'], [/neutral|calm/i, 'neutral']]
const POSE_WORDS: [RegExp, Pose][] = [[/point/i, 'point'], [/cheer|celebrat/i, 'cheer'], [/wave/i, 'wave'], [/shrug/i, 'shrug'], [/think/i, 'think'], [/hands on hips|hips/i, 'hips'], [/raise/i, 'raise'], [/behind (his|her|their) back|hide/i, 'behind']]

/** Keyless edit: understands a handful of direct instructions. */
function ruleEdit(scene: SceneSpec, instruction: string, cast: CharacterRecord[]): { scene: SceneSpec; understood: boolean } {
  const next: SceneSpec = JSON.parse(JSON.stringify(scene))
  let understood = false
  const named = cast.find((c) => new RegExp(`\\b${c.identity.name.split(' ').pop()}\\b`, 'i').test(instruction))
  const target = next.actors.find((a) => a.characterId === named?.id) ?? next.actors[0]
  const quoted = /(?:to|say|says|text)\s+["“']?([^"”']{1,30})["”']?\s*$/i.exec(instruction)
  if (/bubble/i.test(instruction) && quoted && target) { target.bubble = short(quoted[1].trim(), 30); target.bubbleAt ??= 0.25; understood = true }
  else if (/(stamp|sign|title|screen|card)/i.test(instruction) && quoted) {
    const p = next.props.find((x) => new RegExp(x.kind, 'i').test(instruction))
    if (p) { p.text = short(quoted[1].trim(), 30); understood = true }
  }
  if (!understood && target) {
    for (const [re, e] of EXPR_WORDS) if (re.test(instruction)) { target.expression = e; if (target.react) target.react.expression = e; understood = true; break }
    for (const [re, p] of POSE_WORDS) if (re.test(instruction)) { target.pose = p; understood = true; break }
  }
  for (const c of CAMERAS) if (new RegExp(`\\b${c.replace('-', ' ')}\\b`, 'i').test(instruction.replace(/-/g, ' '))) { next.camera = c; understood = true }
  for (const s of SETS) if (new RegExp(`\\b${s}\\b`, 'i').test(instruction)) { next.set = s; understood = true }
  if (/close.?up|closer/i.test(instruction) && next.actors.length === 1) { next.shot = 'close'; understood = true }
  if (/wide|zoom out|pull back/i.test(instruction)) { next.shot = 'wide'; understood = true }
  if (/no bubble|remove (the )?bubble/i.test(instruction)) { for (const a of next.actors) a.bubble = undefined; understood = true }
  return { scene: next, understood }
}

export async function editScene(scene: SceneSpec, instruction: string, product: Product, cast: CharacterRecord[]): Promise<{ scene: SceneSpec; note?: string }> {
  const keep = (s: SceneSpec): SceneSpec => ({ ...s, id: scene.id, fix: undefined })
  if (!llmReady()) {
    const { scene: next, understood } = ruleEdit(scene, instruction, cast)
    return understood ? { scene: keep(next) } : { scene, note: 'Without an Anthropic key only simple edits work: expressions, poses, bubble or prop text, camera, set, close-up or wide.' }
  }
  const asRaw = {
    ...scene,
    actors: scene.actors.map((a) => ({ ...a, character: a.characterId, bubble: a.bubble ?? '', bubbleAt: a.bubbleAt ?? 0.2, reactExpression: a.react?.expression ?? 'none', reactPose: a.react?.pose ?? 'none', reactAt: a.react?.at ?? 0.5 })),
    props: scene.props.map((p) => ({ ...p, text: p.text ?? '' })),
    productMove: scene.product?.move ?? 'none', productDevice: scene.product?.device ?? 'desktop', productRegion: scene.product?.regionId ?? '', productCallout: scene.product?.callout ?? '',
  }
  const res = await structured<RawScene>({
    system: `You revise one scene spec of an animated reel according to the director's note. Change only what the note asks for and keep everything else exactly as it is. Keep "kind" and "beat" unchanged.\n${WRITER_RULES}\n\n${STAGING_RULES}`,
    prompt: `Cast (ids):\n${castBrief(cast)}\n\nFootage inventory:\n${inventory(product)}\n\nCurrent scene spec (JSON):\n${JSON.stringify(asRaw)}\n\nDirector's note: "${instruction.slice(0, 500)}"\n\nReturn the full revised scene.`,
    tool: { name: 'save_scene', description: 'Save the revised scene spec.', schema: SCENE_SCHEMA(cast.map((c) => c.id)) },
    maxTokens: 2000,
  })
  const [clean] = sanitizeScenes([{ ...res, kind: scene.kind, beat: scene.beat }], product, cast, false)
  if (!clean) return { scene, note: 'The revised scene came back empty, so nothing was changed.' }
  return { scene: keep(clean) }
}
