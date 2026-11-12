// Quality control: nothing ships unchecked. Geometry is measured from the real layout, simple
// problems are fixed automatically (two rounds at most), and anything left is reported in plain words.
import { readFileSync } from 'node:fs'
import type { Page } from 'playwright-core'
import { compileTimeline, type Timeline } from '../shared/timeline.ts'
import { FPS, H, SAFE_BOTTOM, SAFE_TOP, W, type QcBox, type QcIssue, type Reel, type SceneSpec } from '../shared/types.ts'
import { TARGET_LUFS, TARGET_PEAK } from './audio/mix.ts'
import { llmReady, structured } from './llm.ts'

const area = (b: QcBox) => Math.max(0, b.w) * Math.max(0, b.h)
function overlap(a: QcBox, b: QcBox): { w: number; h: number; area: number } {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? { w, h, area: w * h } : { w: 0, h: 0, area: 0 }
}

/** Frames worth measuring in each scene: after things have appeared, and near the end. */
export function sampleFrames(tl: Timeline): { frame: number; scene: number }[] {
  const out: { frame: number; scene: number }[] = []
  for (const s of tl.scenes) for (const p of [0.45, 0.72, 0.95]) out.push({ frame: Math.min(s.end - 1, s.start + Math.round(s.duration * p)), scene: s.index })
  return out
}

type Fix = NonNullable<SceneSpec['fix']>
interface Finding extends QcIssue { fix?: Fix }

const TEXT_PROPS = new Set(['stamp', 'card', 'title', 'device'])
const NAME: Record<string, string> = { stamp: 'stamp', card: 'card', title: 'title', device: 'screen', bubble: 'speech bubble', callout: 'callout', caption: 'caption' }

/** Checks one measured frame against the layout rules. */
export function checkBoxes(boxes: QcBox[], scene: SceneSpec, frame: number): Finding[] {
  const out: Finding[] = []
  const cur = scene.fix ?? {}
  const add = (severity: QcIssue['severity'], message: string, fix?: Fix, suggestion?: string) => out.push({ check: 'geometry', severity, sceneId: scene.id, frame, message, fix, suggestion })
  const of = (kind: string) => boxes.filter((b) => b.kind === kind && area(b) > 4)
  const caption = of('caption')[0]
  const faces = of('face')

  if (caption) {
    if (caption.y < SAFE_TOP || caption.y + caption.h > SAFE_BOTTOM) add('error', 'A caption sits outside the safe area where app buttons cover the video.')
    if (caption.x < 24 || caption.x + caption.w > W - 24) add('error', 'A caption runs off the side of the frame.', undefined, 'Shorten the longest word in this line.')
  }
  for (const b of of('bubble')) {
    if (b.x < 8 || b.x + b.w > W - 8) add('error', 'A speech bubble is clipped by the edge of the frame.', { bubbleScale: Math.max(0.6, (cur.bubbleScale ?? 1) * 0.85) }, 'Use fewer words in the bubble.')
    if (b.y < SAFE_TOP - 12) add('warn', 'A speech bubble reaches into the top area that apps cover.', { bubbleScale: Math.max(0.6, (cur.bubbleScale ?? 1) * 0.85) })
    for (const f of faces) {
      const o = overlap(b, f)
      if (o.area > area(f) * 0.14) {
        const room = b.y - (SAFE_TOP + 8)
        const need = o.h + 24
        add('error', 'A speech bubble covers a face.', room >= need ? { bubbleDy: (cur.bubbleDy ?? 0) - need } : { bubbleDy: (cur.bubbleDy ?? 0) - Math.max(0, room), bubbleScale: Math.max(0.6, (cur.bubbleScale ?? 1) * 0.82) }, 'Use fewer words in the bubble or move the character.')
        break
      }
    }
    if (caption && overlap(b, caption).area > area(caption) * 0.05) add('error', 'A speech bubble overlaps the captions.', { bubbleDy: (cur.bubbleDy ?? 0) - overlap(b, caption).h - 24 })
  }
  for (const b of boxes.filter((x) => TEXT_PROPS.has(x.kind) && area(x) > 4)) {
    const label = NAME[b.kind] ?? b.kind
    if (b.x < -4 || b.x + b.w > W + 4) add('warn', `A ${label} is wider than the frame.`, undefined, 'Shorten its text.')
    if (caption) {
      const o = overlap(b, caption)
      if (o.area > area(caption) * 0.05) add('error', `A ${label} overlaps the captions.`, { propDy: (cur.propDy ?? 0) - o.h - 28 })
    }
    if (b.kind !== 'device') {
      for (const f of faces) {
        if (overlap(b, f).area > area(f) * 0.4) {
          add('warn', `A ${label} covers a face.`, { propDy: (cur.propDy ?? 0) - 70 }, 'Move it to the top of the frame.')
          break
        }
      }
    }
    if (b.y + b.h > SAFE_BOTTOM + 4 || b.y < SAFE_TOP - 60) add('warn', `A ${label} sits partly outside the safe area.`)
  }
  for (const b of of('callout')) {
    if (b.x < 8 || b.x + b.w > W - 8) add('warn', 'A product callout is clipped by the edge of the frame.', undefined, 'Shorten the callout text.')
    if (caption && overlap(b, caption).area > area(caption) * 0.05) add('error', 'A product callout overlaps the captions.')
  }
  for (const f of faces) {
    if (f.x < -f.w * 0.35 || f.x + f.w > W + f.w * 0.35 || f.y < -10 || f.y + f.h > H) add('warn', 'A character\'s face is cut off by the edge of the frame.')
  }
  return out
}

async function measureAll(page: Page, tl: Timeline, scenes: SceneSpec[]): Promise<Finding[]> {
  const findings: Finding[] = []
  for (const s of sampleFrames(tl)) {
    const boxes = await page.evaluate(async (n) => {
      await window.__reel!.setFrame(n)
      return window.__reel!.qc()
    }, s.frame)
    findings.push(...checkBoxes(boxes, scenes[s.scene], s.frame))
  }
  // One line per scene per problem, not one per sampled frame.
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.sceneId}|${f.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Measures the layout and repairs what it can. `apply` saves the fixes and reloads the page.
 * Returns the remaining issues plus the ones that were fixed.
 */
export async function geometryQc(
  page: Page,
  getReel: () => Reel,
  apply: (fixes: Map<string, Fix>) => Promise<void>,
): Promise<{ issues: QcIssue[]; rounds: number }> {
  const fixed: QcIssue[] = []
  let rounds = 0
  for (;;) {
    const reel = getReel()
    const findings = await measureAll(page, compileTimeline(reel), reel.scenes)
    const fixable = findings.filter((f) => f.fix)
    if (!fixable.length || rounds >= 2) {
      // Anything fixed earlier that no longer shows up really is fixed.
      const open = new Set(findings.map((f) => `${f.sceneId}|${f.message}`))
      const resolved = fixed.filter((f) => !open.has(`${f.sceneId}|${f.message}`)).map((f) => ({ ...f, fixed: true, severity: 'warn' as const }))
      return { issues: [...findings.map(({ fix: _fix, ...rest }) => rest), ...resolved], rounds }
    }
    const fixes = new Map<string, Fix>()
    for (const f of fixable) {
      const prev = fixes.get(f.sceneId!) ?? {}
      fixes.set(f.sceneId!, { ...prev, ...f.fix })
      if (!fixed.some((x) => x.sceneId === f.sceneId && x.message === f.message)) {
        const { fix: _fix, ...rest } = f
        fixed.push(rest)
      }
    }
    await apply(fixes)
    rounds++
  }
}

/** Sync: at the first word of each scene the voice should actually be making sound. */
export function syncQc(reel: Reel, tl: Timeline): QcIssue[] {
  const v = reel.voice
  if (!v || !v.envelope.length) return [{ check: 'sync', severity: 'warn', message: 'This reel has no voice, so lip-sync and caption timing could not be checked.' }]
  let checked = 0
  let off = 0
  let worst: { scene: number; frames: number } | null = null
  tl.scenes.forEach((s) => {
    const first = tl.words.find((w) => w.scene === s.index)
    if (!first) return
    checked++
    const f0 = Math.round(first.start * FPS)
    // Search a third of a second either side for the nearest frame with voice in it.
    let best = Infinity
    for (let d = -10; d <= 10; d++) if ((v.envelope[f0 + d] ?? 0) > 0.18 && Math.abs(d) < Math.abs(best)) best = d
    const late = [0, 1, 2, 3].every((d) => (v.envelope[f0 + d] ?? 0) <= 0.18)
    if (late) {
      off++
      const frames = isFinite(best) ? best : 10
      if (!worst || Math.abs(frames) > Math.abs(worst.frames)) worst = { scene: s.index, frames }
    }
  })
  const issues: QcIssue[] = []
  const w = worst as { scene: number; frames: number } | null
  if (checked && off / checked > 0.25 && w) {
    issues.push({
      check: 'sync', severity: 'warn', sceneId: reel.scenes[w.scene]?.id,
      message: `Captions may drift from the voice in ${off} of ${checked} scenes (up to about ${Math.abs(w.frames)} frames).`,
      suggestion: v.alignment === 'estimated' ? 'Free voices estimate word timings. A premium voice gives exact timings.' : undefined,
    })
  }
  return issues
}

export function audioQc(loudness: { lufs: number; truePeak: number } | null): QcIssue[] {
  if (!loudness || !isFinite(loudness.lufs)) return [{ check: 'audio', severity: 'warn', message: 'Loudness could not be measured.' }]
  const issues: QcIssue[] = []
  if (Math.abs(loudness.lufs - TARGET_LUFS) > 1) issues.push({ check: 'audio', severity: 'warn', message: `Loudness is ${loudness.lufs.toFixed(1)} LUFS; the target is ${TARGET_LUFS}.` })
  if (loudness.truePeak > TARGET_PEAK + 0.6) issues.push({ check: 'audio', severity: 'warn', message: `The loudest peak is ${loudness.truePeak.toFixed(1)} dB; the ceiling is ${TARGET_PEAK}.` })
  return issues
}

interface VisionResult { issues: { thumbnail: number; severity: 'error' | 'warn'; problem: string; suggestion: string }[] }

/** A second pair of eyes: the model looks at the contact sheet for problems geometry cannot see. */
export async function visionQc(sheetPath: string, thumbs: { scene: number; frame: number }[], reel: Reel): Promise<{ issues: QcIssue[]; reviewed: boolean; error?: string }> {
  if (!llmReady()) return { issues: [], reviewed: false }
  try {
    const res = await structured<VisionResult>({
      system: 'You are the quality reviewer for short vertical videos made of cartoon scenes and website screenshots. You look at a contact sheet of frames and report only real, visible defects. You are strict about text and faces, and you do not comment on taste.',
      prompt: `This contact sheet shows ${thumbs.length} frames from one ${reel.style}-style reel in reading order (left to right, top to bottom). Each thumbnail has its number in the corner.\n\nLook for:\n- text that is cut off, overlapping other text, or unreadable against its background\n- a speech bubble, stamp or sign covering a character's face\n- a character that is malformed, cut off, or floating\n- a website screenshot that is blank, mostly empty, or covered by a cookie banner or popup\n- a frame that is empty or looks broken\n\nThese are intended and must not be reported:\n- Captions of one to three words sit over the lower part of the picture, including over characters' bodies and the scenery. They have a thick outline. Only report a caption that is cut off by the frame edge or covers a face.\n- A small presenter character stands in front of the lower corner of the website window.\n- Website text is small at thumbnail size.\n- Confetti, the empty lower fifth of the frame, background extras drawn smaller and paler, and characters cropped at the waist in close-ups.\n\nReport each defect once. Report nothing if the frames look fine.`,
      tool: {
        name: 'report_review', description: 'Report the defects you can see, if any.',
        schema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  thumbnail: { type: 'integer', description: 'The number shown on the thumbnail' },
                  severity: { type: 'string', enum: ['error', 'warn'], description: 'error = a viewer would notice it as a mistake' },
                  problem: { type: 'string', description: 'One plain sentence' },
                  suggestion: { type: 'string', description: 'One plain sentence on how to fix it, or empty' },
                },
                required: ['thumbnail', 'severity', 'problem', 'suggestion'],
              },
            },
          },
          required: ['issues'],
        },
      },
      maxTokens: 1500,
      image: { mediaType: 'image/jpeg', base64: readFileSync(sheetPath).toString('base64') },
    })
    const issues = (res.issues ?? []).slice(0, 12).map((i): QcIssue => {
      const t = thumbs[Math.round(Number(i.thumbnail)) - 1]
      return {
        check: 'vision', severity: i.severity === 'error' ? 'error' : 'warn', sceneId: t ? reel.scenes[t.scene]?.id : undefined, frame: t?.frame,
        message: String(i.problem).slice(0, 240), suggestion: i.suggestion ? String(i.suggestion).slice(0, 240) : undefined,
      }
    })
    // Two thumbnails of one scene often show the same defect; keep one note per scene.
    const seen = new Set<string>()
    const unique = issues.filter((i) => {
      const key = `${i.sceneId}|${i.message.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 6).join(' ')}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { issues: unique, reviewed: true }
  } catch (e) {
    return { issues: [], reviewed: false, error: e instanceof Error ? e.message : String(e) }
  }
}
