// Character Studio's "describe it" path: a sentence becomes a full character record.
import { HAIR_COLORS, CLOTH_COLORS, newId, randomCharacter, SKIN_TONES } from '../shared/starter.ts'
import {
  ACCESSORIES, BROWS, BUILDS, ENERGIES, EYE_SHAPES, FACIAL_HAIR, GLASSES, HAIR_STYLES, MOUTHS, NOSES, ROLES, TOPS, WALKS,
  type CharacterRecord,
} from '../shared/types.ts'
import { llmReady, structured } from './llm.ts'

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : fallback)
const text = (v: unknown, max: number, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback)

/** Coerces any object into a valid CharacterRecord. Used for model output and for API input. */
export function sanitizeCharacter(input: unknown, base?: CharacterRecord): CharacterRecord {
  const b = base ?? randomCharacter(newId('seed'))
  const r = (input ?? {}) as Record<string, Record<string, unknown> | undefined> & Record<string, unknown>
  const id = text(r.id, 60) || base?.id || newId('char')
  const g = (group: string, key: string) => r[group]?.[key]
  return {
    id,
    version: b.version, createdAt: b.createdAt, updatedAt: b.updatedAt, starter: base?.starter,
    identity: {
      name: text(g('identity', 'name'), 30, b.identity.name), role: oneOf(ROLES, g('identity', 'role'), b.identity.role),
      personality: text(g('identity', 'personality'), 140, b.identity.personality), catchphrase: text(g('identity', 'catchphrase'), 60, b.identity.catchphrase),
    },
    body: {
      height: Math.min(1.15, Math.max(0.75, Number(g('body', 'height')) || b.body.height)),
      build: oneOf(BUILDS, g('body', 'build'), b.body.build), skin: hex(g('body', 'skin'), b.body.skin),
    },
    face: {
      eyes: oneOf(EYE_SHAPES, g('face', 'eyes'), b.face.eyes), brows: oneOf(BROWS, g('face', 'brows'), b.face.brows),
      nose: oneOf(NOSES, g('face', 'nose'), b.face.nose), mouth: oneOf(MOUTHS, g('face', 'mouth'), b.face.mouth),
      freckles: typeof g('face', 'freckles') === 'boolean' ? (g('face', 'freckles') as boolean) : b.face.freckles,
      acne: typeof g('face', 'acne') === 'boolean' ? (g('face', 'acne') as boolean) : b.face.acne,
      blush: typeof g('face', 'blush') === 'boolean' ? (g('face', 'blush') as boolean) : b.face.blush,
      glasses: oneOf(GLASSES, g('face', 'glasses'), b.face.glasses), facialHair: oneOf(FACIAL_HAIR, g('face', 'facialHair'), b.face.facialHair),
    },
    hair: { style: oneOf(HAIR_STYLES, g('hair', 'style'), b.hair.style), color: hex(g('hair', 'color'), b.hair.color) },
    wardrobe: {
      top: oneOf(TOPS, g('wardrobe', 'top'), b.wardrobe.top), topColor: hex(g('wardrobe', 'topColor'), b.wardrobe.topColor),
      bottomColor: hex(g('wardrobe', 'bottomColor'), b.wardrobe.bottomColor), shoeColor: hex(g('wardrobe', 'shoeColor'), b.wardrobe.shoeColor),
      accessory: oneOf(ACCESSORIES, g('wardrobe', 'accessory'), b.wardrobe.accessory), accessoryColor: hex(g('wardrobe', 'accessoryColor'), b.wardrobe.accessoryColor),
    },
    performance: {
      walk: oneOf(WALKS, g('performance', 'walk'), b.performance.walk), energy: oneOf(ENERGIES, g('performance', 'energy'), b.performance.energy),
      voice: text(g('performance', 'voice'), 80) || b.performance.voice,
    },
    styleOverrides: (r.styleOverrides as CharacterRecord['styleOverrides']) ?? base?.styleOverrides,
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    identity: {
      type: 'object',
      properties: { name: { type: 'string', description: 'A first name' }, role: { type: 'string', enum: [...ROLES] }, personality: { type: 'string', description: 'One line' }, catchphrase: { type: 'string', description: 'A few words they would say' } },
      required: ['name', 'role', 'personality', 'catchphrase'],
    },
    body: {
      type: 'object',
      properties: { height: { type: 'number', description: '0.8 (child or short) to 1.12 (tall); 1 is average' }, build: { type: 'string', enum: [...BUILDS] }, skin: { type: 'string', description: `Hex colour, one of ${SKIN_TONES.join(', ')}` } },
      required: ['height', 'build', 'skin'],
    },
    face: {
      type: 'object',
      properties: {
        eyes: { type: 'string', enum: [...EYE_SHAPES] }, brows: { type: 'string', enum: [...BROWS] }, nose: { type: 'string', enum: [...NOSES] }, mouth: { type: 'string', enum: [...MOUTHS] },
        freckles: { type: 'boolean' }, acne: { type: 'boolean', description: 'Visible pimples' }, blush: { type: 'boolean' }, glasses: { type: 'string', enum: [...GLASSES] }, facialHair: { type: 'string', enum: [...FACIAL_HAIR] },
      },
      required: ['eyes', 'brows', 'nose', 'mouth', 'freckles', 'blush', 'glasses', 'facialHair'],
    },
    hair: { type: 'object', properties: { style: { type: 'string', enum: [...HAIR_STYLES] }, color: { type: 'string', description: 'Hex colour' } }, required: ['style', 'color'] },
    wardrobe: {
      type: 'object',
      properties: {
        top: { type: 'string', enum: [...TOPS] }, topColor: { type: 'string', description: 'Hex colour. Saturated colours read best.' }, bottomColor: { type: 'string', description: 'Hex colour' },
        shoeColor: { type: 'string', description: 'Hex colour' }, accessory: { type: 'string', enum: [...ACCESSORIES] }, accessoryColor: { type: 'string', description: 'Hex colour' },
      },
      required: ['top', 'topColor', 'bottomColor', 'shoeColor', 'accessory', 'accessoryColor'],
    },
    performance: { type: 'object', properties: { walk: { type: 'string', enum: [...WALKS] }, energy: { type: 'string', enum: [...ENERGIES] } }, required: ['walk', 'energy'] },
  },
  required: ['identity', 'body', 'face', 'hair', 'wardrobe', 'performance'],
}

const COLOR_WORDS: [RegExp, string][] = [[/\bred\b/, '#EF4444'], [/\bblue\b/, '#3B82F6'], [/\bgreen\b/, '#10B981'], [/\byellow\b/, '#F59E0B'], [/\bpurple\b/, '#8B5CF6'], [/\bpink\b/, '#EC4899'], [/\borange\b/, '#F97316'], [/\bblack\b/, '#111827'], [/\bwhite\b/, '#F8FAFC'], [/\bgr[ae]y\b/, '#64748B'], [/\bteal\b/, '#14B8A6']]

/** Keyless fallback: reads the obvious words and randomises the rest from the description. */
function keywordCharacter(description: string): CharacterRecord {
  const d = description.toLowerCase()
  const c = randomCharacter(description)
  const has = (re: RegExp) => re.test(d)
  if (has(/glasses|spectacles/)) c.face.glasses = has(/square|rectang/) ? 'square' : 'round'
  if (has(/beard/)) c.face.facialHair = 'beard'
  else if (has(/mustache|moustache/)) c.face.facialHair = 'mustache'
  else if (has(/stubble|unshaven/)) c.face.facialHair = 'stubble'
  else c.face.facialHair = 'none'
  if (has(/freckle/)) c.face.freckles = true
  if (has(/acne|pimpl|zits?\b/)) c.face.acne = true
  if (has(/tired|sleep|exhaust/)) c.face.eyes = 'sleepy'
  for (const s of HAIR_STYLES) if (has(new RegExp(`\\b${s}\\b`))) c.hair.style = s
  if (has(/curl/)) c.hair.style = 'curly'
  if (has(/pony ?tail/)) c.hair.style = 'ponytail'
  if (has(/blond/)) c.hair.color = HAIR_COLORS[4]
  else if (has(/red ?head|ginger|red hair/)) c.hair.color = HAIR_COLORS[5]
  else if (has(/grey hair|gray hair|silver|old|elder|grand/)) c.hair.color = HAIR_COLORS[6]
  else if (has(/black hair|dark hair/)) c.hair.color = HAIR_COLORS[0]
  else if (has(/brown hair|brunette/)) c.hair.color = HAIR_COLORS[1]
  for (const t of TOPS) if (has(new RegExp(`\\b${t === 'labcoat' ? 'lab ?coat' : t}\\b`))) c.wardrobe.top = t
  if (has(/suit|business|executive|lawyer/)) c.wardrobe.top = 'blazer'
  if (has(/scientist|doctor|chemist/)) c.wardrobe.top = 'labcoat'
  if (has(/student|teen|gamer|developer|programmer/)) c.wardrobe.top = 'hoodie'
  for (const a of ACCESSORIES) if (a !== 'none' && has(new RegExp(`\\b${a}\\b`))) c.wardrobe.accessory = a
  const clothing = /(\w+)\s+(hoodie|shirt|tee|t-shirt|sweater|blazer|dress|jacket|top)/.exec(d)
  if (clothing) for (const [re, colour] of COLOR_WORDS) if (re.test(clothing[1])) c.wardrobe.topColor = colour
  if (has(/kid|child|boy\b|girl\b|ten.year|young/)) c.body.height = 0.82
  if (has(/tall/)) c.body.height = 1.1
  if (has(/nervous|anxious|stressed|worried/)) c.performance.energy = 'nervous'
  if (has(/hype|excited|energetic|loud|cheerful/)) c.performance.energy = 'hype'
  if (has(/mentor|professor|teacher|boss|coach|grand/)) c.identity.role = 'mentor'
  else if (has(/rival|skeptic|sarcastic|smug/)) c.identity.role = 'foil'
  else c.identity.role = 'hero'
  c.identity.personality = description.trim().slice(0, 140)
  if (!CLOTH_COLORS.includes(c.wardrobe.topColor)) c.wardrobe.topColor = c.wardrobe.topColor.toUpperCase()
  return { ...c, id: newId('char') }
}

export async function describeCharacter(description: string): Promise<{ character: CharacterRecord; writtenBy: 'llm' | 'keywords'; error?: string }> {
  const d = description.trim().slice(0, 600)
  if (!d) throw new Error('Describe the character first')
  if (llmReady()) {
    try {
      const res = await structured<unknown>({
        system: 'You are a character designer for a 2D animated cast. You turn a short description into a character record by choosing from the listed options. The same record is drawn in several art styles, so pick a strong silhouette: distinctive hair, one saturated clothing colour, at most one accessory. Characters are original cartoon people, never likenesses of real individuals.',
        prompt: `Description: "${d}"\n\nDesign the character. Skin tones to choose from: ${SKIN_TONES.join(', ')}. Natural hair colours: ${HAIR_COLORS.slice(0, 8).join(', ')} (dyed colours are allowed when the description calls for it).`,
        tool: { name: 'save_character', description: 'Save the character record.', schema: SCHEMA },
        maxTokens: 1200,
      })
      return { character: { ...sanitizeCharacter(res), id: newId('char') }, writtenBy: 'llm' }
    } catch (e) {
      return { character: keywordCharacter(d), writtenBy: 'keywords', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { character: keywordCharacter(d), writtenBy: 'keywords' }
}
