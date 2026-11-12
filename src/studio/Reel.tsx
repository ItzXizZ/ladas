// One reel: loads it, shows the six steps and hands each step the same save helpers.
import { useCallback, useEffect, useState } from 'react'
import type { Product, Reel, ReelBundle } from '../../shared/types.ts'
import { errorText, get, patch } from '../api.ts'
import { CastStep } from './CastStep.tsx'
import { ExportStep } from './ExportStep.tsx'
import { ProductPanel } from './ProductStep.tsx'
import { ScriptStep } from './ScriptStep.tsx'
import { StoryStep } from './StoryStep.tsx'
import { StyleStep } from './StyleStep.tsx'
import { Button, go, Notice, useStudio } from './ui.tsx'

export interface StepProps {
  bundle: ReelBundle
  /** Use a reel the server just returned (cast unchanged). */
  setReel: (reel: Reel) => void
  /** Save changes to the reel. Returns false when the save failed. */
  save: (changes: Record<string, unknown>) => Promise<boolean>
  reload: () => Promise<void>
  next: () => void
}

const STEPS = [
  { id: 'product', label: 'Product' },
  { id: 'cast', label: 'Cast' },
  { id: 'style', label: 'Style' },
  { id: 'story', label: 'Story' },
  { id: 'script', label: 'Script & voice' },
  { id: 'export', label: 'Export' },
] as const
type StepId = (typeof STEPS)[number]['id']

export function ReelWorkspace({ reelId, step }: { reelId: string; step: string }) {
  const { toast } = useStudio()
  const [bundle, setBundle] = useState<ReelBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')

  const reload = useCallback(async () => {
    try {
      const b = await get<ReelBundle>(`/api/reels/${reelId}/bundle`)
      setBundle(b)
      setName(b.reel.name)
    } catch (e) { setError(errorText(e)) }
  }, [reelId])
  useEffect(() => { void reload() }, [reload])

  const setReel = useCallback((reel: Reel) => setBundle((b) => (b ? { ...b, reel } : b)), [])
  const save = useCallback(async (changes: Record<string, unknown>) => {
    try {
      const reel = await patch<Reel>(`/api/reels/${reelId}`, changes)
      // A new cast changes which character records the reel needs, so fetch the whole bundle again.
      if ('characterIds' in changes) await reload()
      else setReel(reel)
      return true
    } catch (e) {
      toast(errorText(e), 'error')
      return false
    }
  }, [reelId, reload, setReel, toast])

  if (error) return <div className="page"><Notice kind="error">{error}</Notice><Button onClick={() => go('/')}>Back to reels</Button></div>
  if (!bundle) return <div className="page"><p className="muted">Loading</p></div>

  const { reel } = bundle
  const current: StepId = STEPS.some((s) => s.id === step) ? (step as StepId) : 'cast'
  const index = STEPS.findIndex((s) => s.id === current)
  // Script and export need earlier work; the rest can be visited in any order.
  const locked = (id: StepId) => (id === 'script' || id === 'export') && reel.scenes.length === 0
  const goStep = (id: StepId) => go(`/reel/${reel.id}/${id}`)
  const next = () => { const n = STEPS[index + 1]; if (n) goStep(locked(n.id) ? 'story' : n.id) }
  const props: StepProps = { bundle, setReel, save, reload, next }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div className="grow">
          <p className="eyebrow">{bundle.product.brief.name} · Step {index + 1} of {STEPS.length}</p>
          <input
            className="title-input" value={name} aria-label="Reel name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name !== reel.name) void save({ name }); else setName(reel.name) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        </div>
      </div>
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button className={`step${s.id === current ? ' on' : ''}${i < index ? ' done' : ''}`} disabled={locked(s.id)} onClick={() => goStep(s.id)} title={locked(s.id) ? 'Pick a story and write the script first' : undefined}>
              <span className="step-n">{i + 1}</span>{s.label}
            </button>
          </li>
        ))}
      </ol>

      {current === 'product' && (
        <>
          <ProductPanel product={bundle.product} onChange={(product: Product) => setBundle((b) => (b ? { ...b, product } : b))} />
          <div className="step-foot"><Button kind="primary" onClick={next}>Continue to cast</Button></div>
        </>
      )}
      {current === 'cast' && <CastStep {...props} />}
      {current === 'style' && <StyleStep {...props} />}
      {current === 'story' && <StoryStep {...props} />}
      {current === 'script' && <ScriptStep {...props} />}
      {current === 'export' && <ExportStep {...props} />}
    </div>
  )
}
