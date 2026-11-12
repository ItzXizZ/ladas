// The page the renderer and QC drive: /render?reel=ID. It draws exactly one frame at a time
// with the same component the preview uses and reports where tagged elements landed.
// /render?demo=poses|faces|props|cast&style=cartoon&char=jake draws test sheets for the engine.
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  EXPRESSIONS, POSES, PROP_KINDS, STYLE_IDS, W,
  type ActorSpec, type CharacterRecord, type Product, type QcBox, type ReelBundle, type RenderApi, type SceneSpec, type StyleId,
} from '../shared/types.ts'
import { loadFonts } from './engine/fonts.ts'
import { prepare, ReelFrame, type Prepared } from './engine/ReelFrame.tsx'

let setFrameState: ((n: number) => void) | null = null

function Stage({ bundle, prepared }: { bundle: ReelBundle; prepared: Prepared }) {
  const [frame, setFrame] = useState(0)
  setFrameState = setFrame
  return <ReelFrame bundle={bundle} prepared={prepared} frame={frame} />
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`)
  return (await res.json()) as T
}

const actor = (id: string, over: Partial<ActorSpec> = {}): ActorSpec => ({ characterId: id, slot: 'center', pose: 'stand', expression: 'happy', enter: 'none', outfit: 'default', holding: 'none', speaks: true, ...over })
const scene = (id: string, line: string, over: Partial<SceneSpec>): SceneSpec => ({ id, beat: 'setup', kind: 'story', line, emphasis: [], set: 'neutral', shot: 'wide', camera: 'static', transition: 'cut', actors: [], props: [], crowd: 0, ...over })

/** Engine test sheets: every pose, face, prop or starter character, one per scene. */
async function demoBundle(q: URLSearchParams): Promise<ReelBundle> {
  const all = await getJson<CharacterRecord[]>('/api/characters')
  const pick = (id: string | null, fallback: number) => all.find((c) => c.id === id) ?? all[fallback % all.length]
  const a = pick(q.get('char'), 0)
  const b = pick(q.get('char2'), 1)
  const style = (STYLE_IDS as readonly string[]).includes(q.get('style') ?? '') ? (q.get('style') as StyleId) : 'cartoon'
  const set = (q.get('set') ?? 'neutral') as SceneSpec['set']
  let scenes: SceneSpec[]
  let characters = [a, b]
  switch (q.get('demo')) {
    case 'faces':
      scenes = EXPRESSIONS.map((e) => scene(e, `${e} face.`, { set, shot: 'close', actors: [actor(a.id, { expression: e })] }))
      break
    case 'props':
      scenes = PROP_KINDS.map((k) => scene(k, `${k} prop.`, {
        set, actors: [actor(a.id, { slot: 'left', bubble: 'Wait, what?' }), actor(b.id, { slot: 'right', speaks: false, expression: 'shock' })],
        props: [{ kind: k, text: k === 'stamp' ? 'REJECTED' : k === 'title' ? 'The big idea' : 'Due at 9am', slot: k === 'stamp' || k === 'phone' || k === 'laptop' ? 'center' : 'top', at: 0.05, tone: k === 'stamp' ? 'bad' : 'accent' }],
      }))
      break
    case 'cast':
      characters = all
      scenes = []
      for (let i = 0; i < all.length; i += 3) {
        const trio = all.slice(i, i + 3)
        scenes.push(scene(`cast${i}`, trio.map((c) => c.identity.name).join(', ') + '.', {
          set: (['campus', 'office', 'home', 'street'] as const)[(i / 3) % 4], crowd: i === 0 ? 4 : 0,
          actors: trio.map((c, k) => actor(c.id, { slot: trio.length === 1 ? 'center' : (['left', 'center', 'right'] as const)[k], speaks: k === 0, pose: (['wave', 'stand', 'hips'] as const)[k] })),
        }))
      }
      break
    case 'held':
      scenes = (['phone', 'laptop', 'sign', 'paper', 'coffee'] as const).map((h) => scene(h, `holding ${h}.`, { set, actors: [actor(a.id, { pose: 'hold', holding: h, slot: 'left' }), actor(b.id, { slot: 'right', pose: 'point', speaks: false, outfit: h === 'paper' ? 'gown' : h === 'coffee' ? 'suit' : h === 'sign' ? 'labcoat' : 'default' })] }))
      break
    default:
      scenes = POSES.map((p) => scene(p, `${p} pose.`, { set, actors: [actor(a.id, { pose: p, slot: 'left' }), actor(b.id, { pose: p, slot: 'right', speaks: false, expression: 'neutral' })] }))
  }
  const product: Product = {
    id: 'demo', url: 'https://example.com/', createdAt: '', status: 'ready', briefSource: 'heuristic', footage: [],
    brief: { name: 'Example', pitch: 'A test product.', category: '', audience: '', features: [], tone: [], claims: [], notes: '' },
    brand: { primary: q.get('primary') ?? '#4F46E5', accent: q.get('accent') ?? '#F59E0B', ink: '#111827', fonts: [] },
  }
  return {
    product, characters,
    reel: {
      id: 'demo', name: 'Demo', createdAt: '', updatedAt: '', productId: 'demo', characterIds: characters.map((c) => c.id), characterVersions: {}, style, scenes, renders: [],
      settings: { voiceId: '', music: 'none', musicLevel: 0, sfxLevel: 0, captions: true },
    },
  }
}

export async function mountRender(el: HTMLElement): Promise<void> {
  const api: RenderApi = { ready: false, total: 0, scenes: [], setFrame: async () => undefined, qc: () => [] }
  window.__reel = api
  document.documentElement.style.cssText = 'margin:0;height:100%;background:#000'
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000'
  el.style.cssText = 'width:100vw;height:100vh'
  const css = document.createElement('style')
  css.textContent = '#app > svg { width: 100vw; height: 100vh; }'
  document.head.appendChild(css)
  try {
    const q = new URLSearchParams(location.search)
    const bundle = q.get('demo') ? await demoBundle(q) : await getJson<ReelBundle>(`/api/reels/${encodeURIComponent(q.get('reel') ?? '')}/bundle`)
    if (q.get('style') && (STYLE_IDS as readonly string[]).includes(q.get('style')!)) bundle.reel.style = q.get('style') as StyleId
    await loadFonts()
    const prepared = prepare(bundle)
    const root = createRoot(el)
    flushSync(() => root.render(<Stage bundle={bundle} prepared={prepared} />))

    const settle = async () => {
      // Footage tiles must be decoded before the screenshot, or a frame could show a blank device.
      const images = Array.from(el.querySelectorAll('image')) as (SVGImageElement & { decode?: () => Promise<void> })[]
      if (images.length) await Promise.all(images.map((i) => i.decode?.().catch(() => undefined)))
    }
    api.total = prepared.timeline.totalFrames
    api.scenes = prepared.timeline.scenes.map((s) => ({ start: s.start, end: s.end }))
    api.setFrame = async (n: number) => {
      flushSync(() => setFrameState?.(n))
      await settle()
    }
    api.qc = (): QcBox[] => {
      const svg = el.querySelector('svg')
      if (!svg) return []
      const r = svg.getBoundingClientRect()
      const k = W / r.width
      return Array.from(svg.querySelectorAll('[data-qc]')).map((n) => {
        const b = n.getBoundingClientRect()
        return { kind: n.getAttribute('data-qc') ?? '', scene: n.getAttribute('data-scene'), x: (b.left - r.left) * k, y: (b.top - r.top) * k, w: b.width * k, h: b.height * k }
      })
    }
    await settle()
    api.ready = true
  } catch (e) {
    api.error = e instanceof Error ? e.message : String(e)
  }
}
