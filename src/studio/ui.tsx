// Small building blocks shared by every Studio screen.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { W, type Cast, type CharacterRecord, type Job, type ReelBundle, type SceneSpec, type ServerStatus, type StyleId } from '../../shared/types.ts'
import { ReelFrame, usePrepared } from '../engine/ReelFrame.tsx'

export interface Studio {
  status: ServerStatus | null
  characters: CharacterRecord[]
  casts: Cast[]
  reloadStatus: () => Promise<void>
  reloadCharacters: () => Promise<void>
  toast: (message: string, kind?: 'ok' | 'error') => void
}
export const StudioCtx = createContext<Studio | null>(null)
export function useStudio(): Studio {
  const s = useContext(StudioCtx)
  if (!s) throw new Error('Studio context is missing')
  return s
}

// ---------- Routing (hash based, so the server needs no page routes) ----------
export const go = (path: string) => { location.hash = path }
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  const [parts, setParts] = useState(read)
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return parts
}

// ---------- Controls ----------
export function Button({ children, onClick, kind = 'default', disabled, busy, small, title, type }: {
  children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean; title?: string; type?: 'button' | 'submit'
}) {
  return (
    <button type={type ?? 'button'} className={`btn btn-${kind}${small ? ' btn-small' : ''}`} onClick={onClick} disabled={disabled || busy} title={title}>
      {busy && <span className="spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Seg<T extends string | number>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<string, string>> }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  )
}

export function Swatches({ value, colors, onChange, custom }: { value: string; colors: readonly string[]; onChange: (c: string) => void; custom?: boolean }) {
  const known = colors.some((c) => c.toLowerCase() === value.toLowerCase())
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} type="button" className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} title={c} />
      ))}
      {custom && (
        <label className={`swatch swatch-custom${known ? '' : ' on'}`} style={{ background: known ? undefined : value }} title="Custom colour">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
          {known && '+'}
        </label>
      )}
    </div>
  )
}

export function Progress({ job, label }: { job: Job | null; label?: string }) {
  if (!job) return null
  return (
    <div className="progress" role="status">
      <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(3, Math.round(job.progress * 100))}%` }} /></div>
      <div className="progress-text">{job.status === 'running' ? job.message || label : job.status === 'failed' ? job.error : 'Done'}</div>
    </div>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

// ---------- Preview helpers ----------
/** A bundle for drawing characters outside a real reel: style cards, the cast stage, Character Studio. */
export function previewBundle(characters: CharacterRecord[], style: StyleId, scenes: SceneSpec[], brand?: { primary: string; accent: string }): ReelBundle {
  return {
    characters,
    product: {
      id: 'preview', url: 'https://example.com/', createdAt: '', status: 'ready', briefSource: 'heuristic', footage: [],
      brief: { name: '', pitch: '', category: '', audience: '', features: [], tone: [], claims: [], notes: '' },
      brand: { primary: brand?.primary ?? '#6D5EF5', accent: brand?.accent ?? '#FFB020', ink: '#17140F', fonts: [] },
    },
    reel: {
      id: 'preview', name: '', createdAt: '', updatedAt: '', productId: 'preview', characterIds: characters.map((c) => c.id), characterVersions: {},
      style, scenes, renders: [], settings: { voiceId: '', music: 'none', musicLevel: 0, sfxLevel: 0, captions: false },
    },
  }
}

/** One still frame of a reel, e.g. a scene thumbnail. `at` is 0..1 through the scene. */
export function SceneThumb({ bundle, scene, at = 0.8 }: { bundle: ReelBundle; scene: number; at?: number }) {
  const prepared = usePrepared(bundle)
  const t = prepared.timeline.scenes[scene]
  if (!t) return null
  return <ReelFrame bundle={bundle} prepared={prepared} frame={Math.min(t.end - 1, t.start + Math.round(t.duration * at))} captions={false} />
}

/** A short looping scene that shows 1 to 3 characters acting together. */
export function stageScenes(ids: string[], set: SceneSpec['set'] = 'campus'): SceneSpec[] {
  const slots = ids.length === 1 ? (['center'] as const) : ids.length === 2 ? (['left', 'right'] as const) : (['left', 'center', 'right'] as const)
  const base = { enter: 'none', outfit: 'default', holding: 'none' } as const
  const scene = (id: string, line: string, lead: number): SceneSpec => ({
    id, beat: 'hook', kind: 'story', line, emphasis: [], set, shot: 'medium', camera: 'static', transition: lead === 0 ? 'cut' : 'whip', crowd: 0, props: [],
    actors: ids.slice(0, 3).map((characterId, i) => i === lead % ids.length
      ? { ...base, characterId, slot: slots[i], pose: lead === 0 ? 'wave' : 'point', expression: 'grin', speaks: true, bubble: lead === 0 ? 'Hey!' : 'No way!', bubbleAt: 0.2 }
      : { ...base, characterId, slot: slots[i], pose: i === 2 ? 'hips' : 'stand', expression: 'happy', speaks: false, react: { at: 0.5, expression: lead === 0 ? 'proud' : 'shock', pose: lead === 0 ? undefined : 'raise' } }),
  })
  return [scene('stage-a', 'Meet the cast of your next reel.', 0), scene('stage-b', 'Wait. What did you just say?', 1)]
}

/** A character's face, cropped from a close shot drawn by the real engine. */
export function Portrait({ character, style = 'cartoon', size = 72 }: { character: CharacterRecord; style?: StyleId; size?: number }) {
  const bundle = useMemo(() => previewBundle([character], style, [{
    id: 'portrait', beat: 'hook', kind: 'story', line: 'Hello there, nice to meet you.', emphasis: [], set: 'neutral', shot: 'close', camera: 'static', transition: 'cut', crowd: 0, props: [],
    actors: [{ characterId: character.id, slot: 'center', pose: 'stand', expression: 'happy', enter: 'none', outfit: 'default', holding: 'none', speaks: false }],
  }]), [character, style])
  const prepared = usePrepared(bundle)
  const ref = useRef<HTMLDivElement>(null)
  // Head size and position differ per style and per character, so the crop is measured from the drawing.
  const [crop, setCrop] = useState<{ x: number; y: number; side: number } | null>(null)
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    const face = svg?.querySelector('[data-qc="face"]')
    if (!svg || !face) return
    const r = svg.getBoundingClientRect()
    const b = face.getBoundingClientRect()
    if (!r.width || !b.width) return
    const k = W / r.width
    const side = b.width * k * 1.5
    setCrop({ x: (b.left + b.width / 2 - r.left) * k - side / 2, y: (b.top + b.height / 2 - r.top) * k - side * 0.56, side })
  }, [bundle])
  const k = crop ? size / crop.side : 0
  return (
    <div ref={ref} className="portrait" style={{ width: size, height: size }}>
      <div style={crop ? { position: 'absolute', width: W * k, left: -crop.x * k, top: -crop.y * k } : { position: 'absolute', width: size, opacity: 0 }}>
        <ReelFrame bundle={bundle} prepared={prepared} frame={Math.round(prepared.timeline.totalFrames * 0.6)} captions={false} />
      </div>
    </div>
  )
}

export const STYLE_LABEL: Record<StyleId, string> = { cartoon: 'Bold Cartoon', stick: 'Stick Figure', paper: 'Paper Cut-out', line: 'Kinetic Line Art' }

export const timeAgo = (iso: string): string => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!isFinite(s)) return ''
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
