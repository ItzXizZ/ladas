// Step 6: render the MP4s, download them, and read the quality check.
import { useMemo, useState } from 'react'
import type { Job, QcReport, Reel, Render } from '../../shared/types.ts'
import { post, useJob } from '../api.ts'
import type { StepProps } from './Reel.tsx'
import { Button, Empty, Notice, Progress, timeAgo, useStudio } from './ui.tsx'

const PRESETS: { id: Render['preset']; label: string; size: string; use: string }[] = [
  { id: 'reel', label: 'Vertical 9:16', size: '1080 × 1920', use: 'Reels, TikTok, Shorts' },
  { id: 'feed', label: 'Portrait 4:5', size: '1080 × 1350', use: 'Instagram and Facebook feed' },
  { id: 'square', label: 'Square 1:1', size: '1080 × 1080', use: 'Feed posts and ads' },
]
const CHECK_LABEL: Record<string, string> = { geometry: 'Layout', vision: 'Visual review', sync: 'Caption sync', audio: 'Sound' }

function QcPanel({ qc, reel }: { qc: QcReport; reel: Reel }) {
  const open = qc.issues.filter((i) => !i.fixed)
  const fixed = qc.issues.filter((i) => i.fixed)
  const sceneNo = (id?: string) => { const i = reel.scenes.findIndex((s) => s.id === id); return i >= 0 ? `Scene ${i + 1}` : null }
  return (
    <div className="card card-pad">
      <div className="section-head">
        <div>
          <h2>Quality check</h2>
          <p className="muted">
            {qc.passed ? (open.length ? 'Passed, with notes worth a look.' : 'Passed. Nothing to fix.') : 'Found problems that should be fixed before posting.'}
            {qc.visionReviewed ? ' Frames were also reviewed by the vision model.' : ' The visual review did not run, so only measured checks are shown.'}
          </p>
        </div>
        <span className={`chip ${qc.passed ? 'chip-ok' : 'chip-bad'}`}>{qc.passed ? 'Passed' : 'Needs attention'}</span>
      </div>
      {qc.loudness && <p className="muted small">Loudness {qc.loudness.lufs.toFixed(1)} LUFS (target −14), peak {qc.loudness.truePeak.toFixed(1)} dB.</p>}
      {open.length > 0 && (
        <ul className="issues">
          {open.map((i, k) => (
            <li key={k} className={`issue issue-${i.severity}`}>
              <strong>{CHECK_LABEL[i.check] ?? i.check}{sceneNo(i.sceneId) ? ` · ${sceneNo(i.sceneId)}` : ''}</strong>
              <span>{i.message}</span>
              {i.suggestion && <span className="muted">Try: {i.suggestion}</span>}
            </li>
          ))}
        </ul>
      )}
      {fixed.length > 0 && <p className="muted small">{fixed.length} layout issue{fixed.length === 1 ? ' was' : 's were'} fixed automatically before rendering.</p>}
      {qc.contactSheetUrl && (
        <details>
          <summary>Contact sheet</summary>
          <a href={qc.contactSheetUrl} target="_blank" rel="noreferrer"><img className="sheet" src={qc.contactSheetUrl} alt="Frames from every scene" loading="lazy" /></a>
        </details>
      )}
    </div>
  )
}

export function ExportStep({ bundle, setReel }: StepProps) {
  const { status } = useStudio()
  const { reel } = bundle
  const [presets, setPresets] = useState<Render['preset'][]>(['reel'])
  const [showing, setShowing] = useState<string | null>(null)
  const job = useJob<{ renders: Render[]; reel: Reel }>(`render:${reel.id}`, (r) => { setReel(r.reel); setShowing(r.renders[0]?.id ?? null) })
  const start = () => job.start(() => post<{ job: Job }>(`/api/reels/${reel.id}/renders`, { presets }))

  // One render run produces a file per format; group them back together.
  const runs = useMemo(() => {
    const map = new Map<string, Render[]>()
    for (const r of reel.renders) map.set(r.createdAt, [...(map.get(r.createdAt) ?? []), r])
    return [...map.values()]
  }, [reel.renders])
  const current = reel.renders.find((r) => r.id === showing) ?? reel.renders[0]
  const voiceIsFree = reel.settings.voiceId.startsWith('kokoro:')
  const voiceReady = !!reel.voice?.mixUrl
  const canRender = !!status?.ffmpeg && !!status?.browser

  return (
    <div className="split split-export">
      <div className="stack">
        <div className="card card-pad">
          <h2>Render</h2>
          <div className="presets">
            {PRESETS.map((p) => {
              const on = presets.includes(p.id)
              return (
                <label key={p.id} className={`preset${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => setPresets(on ? presets.filter((x) => x !== p.id) : [...presets, p.id])} />
                  <span className={`preset-shape preset-${p.id}`} aria-hidden />
                  <strong>{p.label}</strong>
                  <span className="muted small">{p.size}</span>
                  <span className="muted small">{p.use}</span>
                </label>
              )
            })}
          </div>
          {status && !status.ffmpeg && <Notice kind="error">ffmpeg is missing. Run <code>npm run setup</code> in the project folder once, then reload.</Notice>}
          {status && !status.browser && <Notice kind="error">No Chrome or Edge browser was found. The renderer needs one installed.</Notice>}
          {!voiceReady && !job.running && (
            <Notice kind="info">The voice is recorded as part of this render.{voiceIsFree ? ' With a free voice that adds a few minutes.' : ''}</Notice>
          )}
          {job.running ? <Progress job={job.job} label="Rendering" /> : (
            <div className="row">
              <Button kind="primary" onClick={start} disabled={!presets.length || !canRender}>{reel.renders.length ? 'Render again' : 'Render the reel'}</Button>
              <span className="muted small">Every frame is drawn at full size, 30 per second. Expect 3 to 5 minutes.</span>
            </div>
          )}
          {job.error && <Notice kind="error">{job.error}</Notice>}
        </div>

        {current?.qc && <QcPanel qc={current.qc} reel={reel} />}

        {runs.length > 0 && (
          <div className="card card-pad">
            <h2>Renders</h2>
            <div className="runs">
              {runs.map((run) => (
                <div key={run[0].createdAt} className="run">
                  <img src={run[0].coverUrl} alt="" loading="lazy" />
                  <div className="grow">
                    <strong>{timeAgo(run[0].createdAt)}</strong>
                    <span className="muted small"> · {Math.round(run[0].duration)} s · took {Math.round(run[0].seconds / 60) || 1} min</span>
                    <div className="row">
                      {run.map((r) => (
                        <span key={r.id} className="dl">
                          <button className={`link${current?.id === r.id ? ' on' : ''}`} onClick={() => setShowing(r.id)}>{PRESETS.find((p) => p.id === r.preset)?.label ?? r.preset}</button>
                          <a href={r.mp4Url} download={`${slug(reel.name)}-${r.preset}.mp4`}>MP4</a>
                        </span>
                      ))}
                      <a href={run[0].srtUrl} download={`${slug(reel.name)}.srt`}>Captions (SRT)</a>
                      <a href={run[0].coverUrl} download={`${slug(reel.name)}-cover.jpg`}>Cover</a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <aside className="sticky">
        {current ? (
          <>
            <video key={current.mp4Url} className={`result result-${current.preset}`} src={current.mp4Url} poster={current.coverUrl} controls playsInline />
            <a className="btn btn-primary" href={current.mp4Url} download={`${slug(reel.name)}-${current.preset}.mp4`}>Download MP4</a>
          </>
        ) : (
          <Empty title="Nothing rendered yet"><p>Your finished video appears here.</p></Empty>
        )}
      </aside>
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reel'
