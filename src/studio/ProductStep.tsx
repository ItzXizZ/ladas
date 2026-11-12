// Step 1: the Product Brief and the captured footage. Everything the agent read or filmed is
// shown here and can be corrected before any story is written.
import { useCallback, useEffect, useState } from 'react'
import type { Feature, Job, Product, Reel } from '../../shared/types.ts'
import { errorText, get, patch, post, trackJob, useJob } from '../api.ts'
import { Button, Field, go, Notice, Progress, useStudio } from './ui.tsx'

export function ProductPanel({ product, onChange }: { product: Product; onChange: (p: Product) => void }) {
  const { toast, status } = useStudio()
  const [draft, setDraft] = useState(product)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(product) }, [product])

  const reload = useCallback(async () => {
    try { onChange(await get<Product>(`/api/products/${product.id}`)) } catch (e) { toast(errorText(e), 'error') }
  }, [product.id, onChange, toast])
  const ingest = useJob<Product>(`ingest:${product.id}`, () => { void reload() })

  // After a page reload the job id is gone; keep checking until the capture finishes.
  useEffect(() => {
    if (product.status !== 'ingesting' || ingest.running) return
    const t = window.setInterval(() => { void reload() }, 2500)
    return () => window.clearInterval(t)
  }, [product.status, ingest.running, reload])

  const recapture = () => ingest.start(async () => {
    const r = await post<{ product: Product; job: Job }>(`/api/products/${product.id}/recapture`)
    onChange(r.product)
    return r
  })

  if (product.status === 'ingesting') {
    return (
      <div className="card card-pad">
        <h2>Reading {hostOf(product.url)}</h2>
        <p className="muted">The footage agent opens the site in a real browser, hides cookie banners and chat bubbles, and films each page at double resolution. It only looks: it never types, clicks buy buttons or signs up.</p>
        <Progress job={ingest.job} label="Capturing the site" />
        {!ingest.job && <p className="muted">Still working</p>}
      </div>
    )
  }
  if (product.status === 'failed') {
    return (
      <div className="card card-pad">
        <h2>That site could not be captured</h2>
        <Notice kind="error">{product.error ?? 'Unknown error'}</Notice>
        <div className="row"><Button kind="primary" onClick={recapture}>Try again</Button><Button onClick={() => go('/')}>Use a different site</Button></div>
      </div>
    )
  }

  const b = draft.brief
  const setBrief = (p: Partial<Product['brief']>) => setDraft({ ...draft, brief: { ...b, ...p } })
  const setFeature = (i: number, p: Partial<Feature>) => setBrief({ features: b.features.map((f, k) => (k === i ? { ...f, ...p } : f)) })
  const dirty = JSON.stringify(draft.brief) !== JSON.stringify(product.brief) || JSON.stringify(draft.brand) !== JSON.stringify(product.brand)
  const save = async () => {
    setSaving(true)
    try {
      onChange(await patch<Product>(`/api/products/${product.id}`, { brief: draft.brief, brand: draft.brand }))
      toast('Brief saved')
    } catch (e) { toast(errorText(e), 'error') } finally { setSaving(false) }
  }

  return (
    <div className="stack">
      {product.briefSource === 'heuristic' && (
        <Notice kind="warn">{status?.anthropic.configured ? 'The writer could not be reached, so this brief is a basic draft from the page headings.' : 'No Anthropic key is set, so this brief is a basic draft from the page headings.'} Check it before continuing.</Notice>
      )}
      <div className="card card-pad">
        <div className="section-head">
          <div><h2>Product Brief</h2><p className="muted">Stories and scripts are written from this card, and may only repeat the claims listed here. Fix anything that is wrong.</p></div>
          <Button kind="primary" onClick={save} busy={saving} disabled={!dirty}>Save changes</Button>
        </div>
        <div className="form-grid">
          <Field label="Name"><input value={b.name} onChange={(e) => setBrief({ name: e.target.value })} /></Field>
          <Field label="Who it is for"><input value={b.audience} onChange={(e) => setBrief({ audience: e.target.value })} /></Field>
          <Field label="One-line pitch" hint="Shown on the closing card of the reel." wide><input value={b.pitch} onChange={(e) => setBrief({ pitch: e.target.value })} /></Field>
        </div>
        <h3>Features</h3>
        <div className="feature-list">
          {b.features.map((f, i) => (
            <div key={i} className="feature-row">
              <input value={f.name} placeholder="Feature" onChange={(e) => setFeature(i, { name: e.target.value })} aria-label="Feature name" />
              <input value={f.benefit} placeholder="What the user gets" onChange={(e) => setFeature(i, { benefit: e.target.value })} aria-label="Benefit" />
              <button className="icon-btn" onClick={() => setBrief({ features: b.features.filter((_, k) => k !== i) })} aria-label="Remove feature">✕</button>
            </div>
          ))}
          {b.features.length < 8 && <Button small onClick={() => setBrief({ features: [...b.features, { name: '', benefit: '' }] })}>Add a feature</Button>}
        </div>
        <div className="form-grid">
          <Field label="Claims the reel may make" hint="One per line. Taken from the site's own words." wide>
            <textarea rows={Math.max(2, b.claims.length)} value={b.claims.join('\n')} onChange={(e) => setBrief({ claims: e.target.value.split('\n') })} />
          </Field>
          <Field label="Notes for the writer" hint="Anything to stress or avoid." wide>
            <textarea rows={2} value={b.notes} onChange={(e) => setBrief({ notes: e.target.value })} placeholder="For example: aim it at first-year students. Do not mention pricing." />
          </Field>
          <Field label="Brand colour"><input type="color" value={draft.brand.primary} onChange={(e) => setDraft({ ...draft, brand: { ...draft.brand, primary: e.target.value } })} /></Field>
          <Field label="Accent colour"><input type="color" value={draft.brand.accent} onChange={(e) => setDraft({ ...draft, brand: { ...draft.brand, accent: e.target.value } })} /></Field>
        </div>
      </div>

      <div className="card card-pad">
        <div className="section-head">
          <div><h2>Captured footage</h2><p className="muted">These are the shots the reel can use. Nothing else from the site appears in your video.</p></div>
          <Button onClick={recapture}>Capture again</Button>
        </div>
        {ingest.error && <Notice kind="error">{ingest.error}</Notice>}
        {product.footage.length === 0 && <Notice kind="warn">No footage was captured. The product section will show a title card instead of your site.</Notice>}
        {product.footage.map((page) => (
          <div key={page.id} className="capture">
            <div className="capture-head">
              <strong>{page.device === 'mobile' ? 'Phone' : 'Desktop'}</strong>
              <span className="muted">{page.url.replace(/^https?:\/\//, '')}</span>
              <span className="chip">{page.tiles.length} screen{page.tiles.length === 1 ? '' : 's'}</span>
              {page.hiddenOverlays > 0 && <span className="chip">{page.hiddenOverlays} pop-up{page.hiddenOverlays === 1 ? '' : 's'} hidden</span>}
            </div>
            <div className={`tiles tiles-${page.device}`}>
              {page.tiles.map((t) => <a key={t.url} href={t.url} target="_blank" rel="noreferrer"><img src={t.url} alt={`${page.title} capture`} loading="lazy" /></a>)}
            </div>
            {page.regions.filter((r) => r.kind !== 'cta').length > 0 && (
              <div className="regions">
                <span className="muted">Close-ups available:</span>
                {page.regions.filter((r) => r.kind !== 'cta').slice(0, 10).map((r) => <span key={r.id} className="chip" title={r.feature ? `Shows: ${r.feature}` : undefined}>{r.label.slice(0, 44)}{r.feature ? ' ★' : ''}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** The product step before a reel exists: capture the site, check the brief, then create the reel. */
export function NewProduct({ productId }: { productId: string }) {
  const { toast } = useStudio()
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    get<Product>(`/api/products/${productId}`).then(setProduct).catch((e) => setError(errorText(e)))
  }, [productId])

  const create = async () => {
    if (!product) return
    setBusy(true)
    try {
      const reel = await post<Reel>('/api/reels', { productId: product.id })
      go(`/reel/${reel.id}/cast`)
    } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
  }

  if (error) return <div className="page"><Notice kind="error">{error}</Notice><Button onClick={() => go('/')}>Back to reels</Button></div>
  if (!product) return <div className="page"><p className="muted">Loading</p></div>
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Step 1 of 6 · Product</p>
          <h1>{product.status === 'ready' ? product.brief.name : hostOf(product.url)}</h1>
        </div>
        {product.status === 'ready' && <Button kind="primary" onClick={create} busy={busy}>Looks right, pick the cast</Button>}
      </div>
      <ProductPanel product={product} onChange={setProduct} />
    </div>
  )
}

export { trackJob }
