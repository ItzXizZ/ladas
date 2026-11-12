// Home: paste a website to start a reel, or open one you already made.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Job, Product, StyleId } from '../../shared/types.ts'
import { del, errorText, get, post, trackJob } from '../api.ts'
import { Button, Empty, go, STYLE_LABEL, timeAgo, useStudio } from './ui.tsx'

interface ReelSummary {
  id: string; name: string; updatedAt: string; style: StyleId; productId: string; productName: string; hook: string; scenes: number; coverUrl?: string; mp4Url?: string
}

export function Home() {
  const { toast } = useStudio()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [reels, setReels] = useState<ReelSummary[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([get<ReelSummary[]>('/api/reels'), get<Product[]>('/api/products')])
      setReels(r)
      setProducts(p)
    } catch (e) { toast(errorText(e), 'error') }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    try {
      const r = await post<{ product: Product; job: Job }>('/api/products', { url })
      trackJob(`ingest:${r.product.id}`, r.job.id)
      go(`/new/${r.product.id}`)
    } catch (err) {
      toast(errorText(err), 'error')
    } finally { setBusy(false) }
  }

  const remove = async (r: ReelSummary) => {
    if (!window.confirm(`Delete "${r.name}"? Its renders are removed from the list too.`)) return
    try {
      await del(`/api/reels/${r.id}`)
      await load()
    } catch (e) { toast(errorText(e), 'error') }
  }

  const ready = products.filter((p) => p.status === 'ready')

  return (
    <div className="page">
      <section className="hero">
        <h1>Paste a website.<br />Get a story reel.</h1>
        <p>Reel Studio reads your site, films it, and wraps the product demo in a short animated story with your own cast of characters.</p>
        <form className="hero-form" onSubmit={submit}>
          <input type="text" inputMode="url" placeholder="yourproduct.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Website address" autoFocus />
          <Button kind="primary" type="submit" busy={busy} disabled={!url.trim()}>Start a reel</Button>
        </form>
        {ready.length > 0 && (
          <div className="hero-reuse">
            <span>Or reuse a site you already linked:</span>
            {ready.slice(0, 6).map((p) => (
              <button key={p.id} className="chip chip-btn" onClick={() => go(`/new/${p.id}`)}>{p.brief.name}</button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head"><h2>Your reels</h2></div>
        {reels === null ? <p className="muted">Loading</p> : reels.length === 0 ? (
          <Empty title="No reels yet"><p>Paste a website above and the Studio walks you through cast, style, story, voice and export.</p></Empty>
        ) : (
          <div className="reel-grid">
            {reels.map((r) => (
              <article key={r.id} className="reel-card">
                <button className="reel-cover" onClick={() => go(`/reel/${r.id}/${r.mp4Url ? 'export' : r.scenes ? 'script' : 'cast'}`)} aria-label={`Open ${r.name}`}>
                  {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" /> : (
                    <div className={`cover-blank cover-${r.style}`}><span>{r.hook || 'Not written yet'}</span></div>
                  )}
                </button>
                <div className="reel-meta">
                  <h3>{r.name}</h3>
                  <p>{STYLE_LABEL[r.style]} · {r.mp4Url ? 'Rendered' : r.scenes ? 'Draft script' : 'Setting up'} · {timeAgo(r.updatedAt)}</p>
                  <div className="row">
                    {r.mp4Url && <a className="btn btn-default btn-small" href={r.mp4Url} download>Download MP4</a>}
                    <Button small kind="ghost" onClick={() => remove(r)}>Delete</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
