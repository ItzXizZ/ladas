// The story engine's first half: candidate stories and the Hook Score. Stories follow a fixed
// shape (visual hook, withheld payoff, one-line bridge, then the product). With an API key Claude
// writes them for the product; without one, a small library of pre-written stories is used.
import { FORMATS, formatById, HOOK_RUBRIC } from '../shared/formats.ts'
import { newId } from '../shared/starter.ts'
import type { CharacterRecord, HookScore, Product, Story, StyleId } from '../shared/types.ts'
import { llmReady, structured, WRITER_RULES } from './llm.ts'

const STOP = new Set('the a an and or but of to in on for with at by from is are was were be been it its this that these those you your they them their we our i my me not no yes do does did have has had will would can could should just than then so if as about into over out up down what when where who why how all any every one two'.split(' '))
const content = (s: string) => s.toLowerCase().replace(/[^a-z0-9$% ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w))
const clampScore = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)))

/** The rubric as code: cheap checks that back up (or stand in for) the model's judgement. */
export function heuristicScore(story: Pick<Story, 'hook' | 'beats' | 'bridge'>, product: Product): HookScore {
  const { hook, beats, bridge } = story
  const hookWords = hook.split(/\s+/).length
  const reasons: Record<string, string[]> = { visual: [], curiosity: [], specificity: [], relevance: [], bridge: [] }

  let visual = 11
  if (hookWords <= 12) { visual += 6; reasons.visual.push('short enough to read in one glance') } else reasons.visual.push('long for a first frame')
  if (/\d|"|“/.test(hook)) { visual += 3; reasons.visual.push('has a number or quote to put on screen') }
  if (/\b(screen|door|phone|stage|trial|letter|street|room|fire|money|box|key|clock|midnight|night|morning|day|city|door)\b/i.test(hook)) { visual += 4; reasons.visual.push('names something you can picture') }

  let curiosity = 10
  if (/^(what if|pov|day \d+|this |everyone |nobody |exhibit|why |how |in \d{4})/i.test(hook.trim())) { curiosity += 8; reasons.curiosity.push('opens on a proven hook pattern') }
  if (/\?$|\.\.\.$/.test(hook.trim())) { curiosity += 4; reasons.curiosity.push('ends on an open question') }
  if (beats.length >= 4 && !content(beats[0]).some((w) => content(bridge).includes(w))) { curiosity += 3; reasons.curiosity.push('payoff is held back to the end') }
  if (!reasons.curiosity.length) reasons.curiosity.push('no clear open question')

  const all = [hook, ...beats].join(' ')
  const numbers = (all.match(/\d[\d,.]*/g) ?? []).length
  const proper = (all.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}/g) ?? []).length
  const specificity = 4 + Math.min(6, numbers * 3) + Math.min(5, proper * 1.5)
  reasons.specificity.push(numbers + proper > 0 ? `${numbers} numbers, ${proper} names or places` : 'generic, no names or numbers')

  const audience = new Set(content(`${product.brief.audience} ${product.brief.category} ${product.brief.pitch}`))
  const overlap = content(all).filter((w) => audience.has(w)).length
  const relevance = 7 + Math.min(8, overlap * 2.5)
  reasons.relevance.push(overlap > 0 ? `shares ${overlap} words with the audience and pitch` : "story world is not tied to the buyer's world")

  let bridgeScore = 4
  const storyWords = new Set(content(all))
  const reused = content(bridge).filter((w) => storyWords.has(w))
  if (reused.length) { bridgeScore += 8; reasons.bridge.push(`reuses "${reused[0]}" from the story`) } else reasons.bridge.push('does not reuse a story word')
  if (bridge.toLowerCase().includes(product.brief.name.toLowerCase())) { bridgeScore += 4; reasons.bridge.push('names the product') }
  if (bridge.split(/\s+/).length <= 24) bridgeScore += 4
  else reasons.bridge.push('long for a one-line pivot')

  const raw = { visual, curiosity, specificity, relevance, bridge: bridgeScore }
  const factors = HOOK_RUBRIC.map((r) => ({ key: r.key, label: r.label, max: r.max, score: clampScore(raw[r.key], r.max), reason: reasons[r.key].join('; ') }))
  return { total: factors.reduce((n, f) => n + f.score, 0), factors }
}

interface Candidate {
  format: string
  hook: string
  beats: string[]
  bridge: string
  scores?: { visual: number; curiosity: number; specificity: number; relevance: number; bridge: number }
  reasons?: { visual: string; curiosity: string; specificity: string; relevance: string; bridge: string }
}

/** Model scores are blended with the code checks so one generous grader cannot inflate a card. */
function finalScore(c: Candidate, product: Product): HookScore {
  const h = heuristicScore(c, product)
  if (!c.scores) return h
  const factors = h.factors.map((f) => {
    const model = Number(c.scores?.[f.key])
    const score = Number.isFinite(model) ? clampScore(0.7 * model + 0.3 * f.score, f.max) : f.score
    return { ...f, score, reason: c.reasons?.[f.key] ? String(c.reasons[f.key]) : f.reason }
  })
  return { total: factors.reduce((n, f) => n + f.score, 0), factors }
}

const STORY_TOOL = {
  name: 'save_story_candidates',
  description: 'Save the candidate stories with rubric scores.',
  schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array', minItems: 10, maxItems: 14,
        items: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: FORMATS.map((f) => f.id) },
            hook: { type: 'string', description: 'The first spoken line, at most 12 words. Must also work as on-screen text with no sound.' },
            beats: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' }, description: 'Four story beats, one sentence each. The payoff comes in beat 4.' },
            bridge: { type: 'string', description: 'One line that pivots into the product. Reuses a word or image from the story and states one concrete benefit.' },
            scores: {
              type: 'object',
              properties: { visual: { type: 'number', description: '0-25' }, curiosity: { type: 'number', description: '0-25' }, specificity: { type: 'number', description: '0-15' }, relevance: { type: 'number', description: '0-15' }, bridge: { type: 'number', description: '0-20' } },
              required: ['visual', 'curiosity', 'specificity', 'relevance', 'bridge'],
            },
            reasons: {
              type: 'object', description: 'One short reason per factor',
              properties: { visual: { type: 'string' }, curiosity: { type: 'string' }, specificity: { type: 'string' }, relevance: { type: 'string' }, bridge: { type: 'string' } },
              required: ['visual', 'curiosity', 'specificity', 'relevance', 'bridge'],
            },
          },
          required: ['format', 'hook', 'beats', 'bridge', 'scores', 'reasons'],
        },
      },
    },
    required: ['candidates'],
  },
}

const briefText = (p: Product) =>
  `Product Brief\nName: ${p.brief.name}\nPitch: ${p.brief.pitch}\nCategory: ${p.brief.category}\nAudience: ${p.brief.audience}\nFeatures:\n${p.brief.features.map((f) => `- ${f.name}: ${f.benefit}`).join('\n')}\nTone: ${p.brief.tone.join(', ')}\nClaims the brand makes: ${p.brief.claims.join(' | ') || 'none stored'}\nNotes from the user: ${p.brief.notes || 'none'}`

const castText = (cast: CharacterRecord[]) => cast.map((c) => `- ${c.identity.name} (${c.identity.role}): ${c.identity.personality}`).join('\n')

const RUBRIC_TEXT = HOOK_RUBRIC.map((r) => `- ${r.label} (0-${r.max}): ${r.checks}`).join('\n')

function toStory(c: Candidate, product: Product, source: Story['source'], writtenBy: Story['writtenBy']): Story {
  return {
    id: newId('story'), productId: product.id, formatId: formatById(c.format).id, hook: c.hook.trim(),
    beats: c.beats.map((b) => String(b).trim()).slice(0, 4), bridge: c.bridge.trim(),
    score: finalScore(c, product), source, writtenBy,
  }
}

/** Best six, with no format taking more than two cards. */
function topSix(stories: Story[]): Story[] {
  const sorted = [...stories].sort((a, b) => b.score.total - a.score.total)
  const out: Story[] = []
  const perFormat = new Map<string, number>()
  for (const s of sorted) {
    const n = perFormat.get(s.formatId) ?? 0
    if (n >= 2) continue
    perFormat.set(s.formatId, n + 1)
    out.push(s)
    if (out.length === 6) return out
  }
  for (const s of sorted) if (out.length < 6 && !out.includes(s)) out.push(s)
  return out
}

export async function recommendStories(product: Product, cast: CharacterRecord[], style: StyleId): Promise<{ stories: Story[]; error?: string }> {
  if (llmReady()) {
    try {
      const res = await structured<{ candidates: Candidate[] }>({
        system: `You write short-form story reels in the "story first, then pivot" format: an unrelated, gripping story that withholds its payoff, then one bridge line into the product.\n${WRITER_RULES}\n\nWhat the first seconds must do: viewers decide to stay in about 1.5 seconds and half watch muted, so the hook has to work as a picture with burned-in captions. Curiosity gaps hold best, more so paired with a visual surprise.\n\nFormats:\n${FORMATS.map((f) => `- ${f.id} (${f.name}): hook "${f.hookPattern}"; shape: ${f.shape}; bridge: ${f.bridgePattern}`).join('\n')}\n\nHook Score rubric. Score honestly; most drafts land between 55 and 85:\n${RUBRIC_TEXT}`,
        prompt: `${briefText(product)}\n\nCast available (the story engine maps roles onto them):\n${castText(cast)}\n\nAnimation style: ${style}\n\nDraft 12 candidate stories for this product across at least 5 different formats, then score each against the rubric. The story's world should feel native to the audience. The bridge must reuse a word or image from the story.`,
        tool: STORY_TOOL,
        maxTokens: 6000,
      })
      const stories = (res.candidates ?? []).filter((c) => c && c.hook && Array.isArray(c.beats) && c.beats.length >= 3 && c.bridge).map((c) => toStory(c, product, 'recommended', 'llm'))
      if (stories.length >= 3) return { stories: topSix(stories) }
      throw new Error('The model returned too few usable stories')
    } catch (e) {
      return { stories: topSix(templateStories(product)), error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { stories: topSix(templateStories(product)) }
}

/** Fits the user's own idea or script to the beat structure, keeping their words. */
export async function customStory(product: Product, idea: string, cast: CharacterRecord[]): Promise<{ story: Story; error?: string }> {
  const text = idea.trim()
  const fallback = (): Story => {
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
    const hook = sentences[0] ?? text
    const rest = sentences.slice(1)
    const beats = rest.length >= 4 ? [rest[0], rest[1], rest[2], rest.slice(3).join(' ')] : [...rest, ...Array(4).fill('')].slice(0, 4).map((b, i) => b || ['It starts small.', 'Then it gets worse.', 'Nobody sees a way out.', 'Until one thing changes.'][i])
    const c: Candidate = { format: 'what-if', hook, beats, bridge: `That one thing is ${product.brief.name}: ${product.brief.pitch}` }
    return toStory(c, product, 'custom', 'template')
  }
  if (!llmReady()) return { story: fallback() }
  try {
    const res = await structured<Candidate & { hookSuggestion?: string }>({
      system: `You fit a user's own story idea or script to a fixed reel structure: hook, four beats, one bridge line into the product. Keep the user's words wherever they work; only fill what is missing.\n${WRITER_RULES}\n\nFormats: ${FORMATS.map((f) => f.id).join(', ')}\n\nHook Score rubric:\n${RUBRIC_TEXT}`,
      prompt: `${briefText(product)}\n\nCast:\n${castText(cast)}\n\nThe user's idea or script:\n"""\n${text.slice(0, 4000)}\n"""\n\nFit it to the structure and score it honestly. If the hook scores under 15 on visual or curiosity, also give hookSuggestion: one stronger first line. Otherwise leave hookSuggestion empty.`,
      tool: {
        name: 'save_custom_story',
        description: 'Save the user story fitted to the beat structure.',
        schema: {
          type: 'object',
          properties: { ...(STORY_TOOL.schema.properties.candidates.items.properties), hookSuggestion: { type: 'string' } },
          required: ['format', 'hook', 'beats', 'bridge', 'scores', 'reasons', 'hookSuggestion'],
        },
      },
      maxTokens: 1500,
    })
    const story = toStory(res, product, 'custom', 'llm')
    if (res.hookSuggestion && res.hookSuggestion.trim() && res.hookSuggestion.trim() !== story.hook) story.hookSuggestion = res.hookSuggestion.trim()
    return { story }
  } catch (e) {
    return { story: fallback(), error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- Keyless fallback: pre-written stories, bridged to the product ----------
/** Per-beat staging hints the template scene builder understands. */
export interface TemplateHint { bubble?: string; prop?: { kind: 'stamp' | 'sign' | 'screen' | 'title' | 'card' | 'phone'; text: string; tone?: 'bad' | 'good' | 'accent' }; mood?: 'tense' | 'funny' | 'calm' | 'win' }
export interface Template { format: string; hook: string; beats: string[]; bridge: (name: string, pitch: string) => string; hints: TemplateHint[] }

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/[.!]+$/, '')

export const TEMPLATES: Template[] = [
  {
    format: 'what-if',
    hook: 'What if every shortcut you took got replayed on a giant screen?',
    beats: ['One morning, screens light up in every city.', 'Each one plays your laziest moment, on loop.', 'People sprint to cover them. It only gets louder.', 'One person just watches, calm. Nothing to hide.'],
    bridge: (n, p) => `They did it right the first time. That is what ${n} is for: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: 'What if?' }, mood: 'tense' }, { prop: { kind: 'screen', text: 'Now playing: you', tone: 'bad' }, mood: 'tense' }, { bubble: 'Not that one!', mood: 'funny' }, { prop: { kind: 'stamp', text: 'Exposed', tone: 'bad' }, mood: 'tense' }, { bubble: 'I am good.', mood: 'calm' }],
  },
  {
    format: 'true-story',
    hook: 'In 1928 a scientist came home to a ruined experiment.',
    beats: ['Alexander Fleming had left his lab dishes out over a holiday.', 'Mould had crept across one and killed the bacteria around it.', 'A spoiled dish like that normally goes straight in the bin.', 'He looked closer instead. That mould led to penicillin.'],
    bridge: (n, p) => `The answer was already in the room. Someone just had to look closer. Yours might be ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: '1928' }, mood: 'calm' }, { mood: 'calm' }, { bubble: 'Ruined...', mood: 'tense' }, { prop: { kind: 'sign', text: 'Bin it?', tone: 'bad' }, mood: 'tense' }, { prop: { kind: 'stamp', text: 'Penicillin', tone: 'good' }, mood: 'win' }],
  },
  {
    format: 'pov-skit',
    hook: 'POV: it is 11:58 and it is due at midnight.',
    beats: ['You open the laptop. Forty tabs stare back.', 'Your friend finished hours ago and will not stop smiling.', 'You type one sentence. You delete one sentence.', 'They slide their screen over. It took them ten minutes.'],
    bridge: (n, p) => `Those ten minutes were ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: '11:58 PM' }, mood: 'tense' }, { bubble: 'Forty tabs?!', mood: 'tense' }, { bubble: 'All done!', mood: 'funny' }, { prop: { kind: 'stamp', text: 'Deleted', tone: 'bad' }, mood: 'funny' }, { bubble: 'Ten minutes.', mood: 'win' }],
  },
  {
    format: 'countdown',
    hook: 'Day 12 of doing it the hard way.',
    beats: ['Day 1, you said it would only take a weekend.', 'Day 5, the weekend is a distant memory.', 'Day 9, you start talking to the spreadsheet.', 'Day 12, a friend asks one question: why not use the tool?'],
    bridge: (n, p) => `Day 13 looks different. The tool is ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: 'Day 12' }, mood: 'tense' }, { prop: { kind: 'sign', text: 'Day 1' }, mood: 'calm' }, { prop: { kind: 'sign', text: 'Day 5', tone: 'bad' }, mood: 'tense' }, { bubble: 'Talk to me...', mood: 'funny' }, { bubble: 'Why not this?', mood: 'win' }],
  },
  {
    format: 'expectation-reality',
    hook: 'What they think you do all day, versus what you really do.',
    beats: ['They picture big ideas and a clean desk.', 'Reality is copy, paste, fix, repeat.', 'By four o’clock the big idea is still a sticky note.', 'One change gives you the afternoon back.'],
    bridge: (n, p) => `That change is ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: 'Expectation vs reality' }, mood: 'funny' }, { prop: { kind: 'sign', text: 'Expectation', tone: 'good' }, mood: 'calm' }, { prop: { kind: 'stamp', text: 'Reality', tone: 'bad' }, mood: 'tense' }, { bubble: 'Still here...', mood: 'funny' }, { bubble: 'Wait, what?', mood: 'win' }],
  },
  {
    format: 'myth-busting',
    hook: 'Everyone believes working harder fixes it. It does not.',
    beats: ['The myth says more hours means better results.', 'But tired people make the same mistake twice.', 'The ones who win do less of the boring part.', 'They hand it to something that never gets tired.'],
    bridge: (n, p) => `Something that never gets tired: ${n}. ${p.replace(/[.!]+$/, '')}.`,
    hints: [{ prop: { kind: 'title', text: 'Myth' }, mood: 'calm' }, { prop: { kind: 'sign', text: 'More hours?', tone: 'bad' }, mood: 'tense' }, { bubble: 'Again?!', mood: 'funny' }, { prop: { kind: 'stamp', text: 'Busted', tone: 'good' }, mood: 'win' }, { bubble: 'Your turn.', mood: 'win' }],
  },
  {
    format: 'one-number',
    hook: 'One small mix-up cost NASA 125 million dollars.',
    beats: ['In 1999 the Mars Climate Orbiter reached Mars.', 'One team had worked in pounds. The other in metric.', 'Nobody caught it. The orbiter came in too low.', 'A 125 million dollar spacecraft, lost to a conversion nobody checked.'],
    bridge: (n, p) => `Something should have checked. For your work, that is ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'title', text: '$125,000,000' }, mood: 'tense' }, { prop: { kind: 'sign', text: 'Mars, 1999' }, mood: 'calm' }, { bubble: 'Pounds? Metric?', mood: 'funny' }, { prop: { kind: 'stamp', text: 'Too low', tone: 'bad' }, mood: 'tense' }, { prop: { kind: 'screen', text: 'Signal lost', tone: 'bad' }, mood: 'tense' }],
  },
  {
    format: 'courtroom',
    hook: 'Exhibit A: the thing you swore you would do later.',
    beats: ['The court calls its first witness: your to-do list.', 'It has been waiting since March.', 'The defence says there was never enough time.', 'The judge has heard that one before.'],
    bridge: (n, p) => `The verdict: stop doing it by hand. Sentenced to ${n}: ${lower(p)}.`,
    hints: [{ prop: { kind: 'card', text: 'Exhibit A' }, mood: 'calm' }, { bubble: 'Order!', mood: 'funny' }, { prop: { kind: 'sign', text: 'Since March', tone: 'bad' }, mood: 'tense' }, { bubble: 'No time!', mood: 'funny' }, { prop: { kind: 'stamp', text: 'Guilty', tone: 'bad' }, mood: 'tense' }],
  },
]

export function templateStories(product: Product): Story[] {
  return TEMPLATES.map((t) => toStory({ format: t.format, hook: t.hook, beats: t.beats, bridge: t.bridge(product.brief.name, product.brief.pitch) }, product, 'recommended', 'template'))
}

export const templateFor = (story: Story): Template | undefined => TEMPLATES.find((t) => t.hook === story.hook)
