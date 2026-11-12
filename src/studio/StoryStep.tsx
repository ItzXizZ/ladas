// Step 4: pick the story. Six are recommended with a Hook Score; the user can also bring their own.
import { useEffect, useState } from 'react'
import { formatById } from '../../shared/formats.ts'
import type { Job, Reel, Story } from '../../shared/types.ts'
import { errorText, post, useJob } from '../api.ts'
import type { StepProps } from './Reel.tsx'
import { Button, Empty, go, Notice, Progress, Seg, useStudio } from './ui.tsx'

// Recommendations are requested once per reel on arrival, never in a loop if they fail.
const asked = new Set<string>()

function ScoreBars({ story }: { story: Story }) {
  return (
    <div className="score">
      {story.score.factors.map((f) => (
        <div key={f.key} className="score-row" title={f.reason}>
          <span>{f.label}</span>
          <div className="bar"><i style={{ width: `${(f.score / f.max) * 100}%` }} /></div>
          <span className="num">{f.score}/{f.max}</span>
        </div>
      ))}
    </div>
  )
}

function StoryCard({ story, selected, onPick, onUseSuggestion }: { story: Story; selected: boolean; onPick: () => void; onUseSuggestion?: () => void }) {
  const [open, setOpen] = useState(false)
  const format = formatById(story.formatId)
  return (
    <article className={`story-card${selected ? ' on' : ''}`}>
      <header>
        <span className="chip">{story.source === 'custom' ? 'Your idea' : format.name}</span>
        <span className="hook-score" title="Hook Score out of 100">{story.score.total}</span>
      </header>
      <h3>{story.hook}</h3>
      <ol className="beats">{story.beats.map((b, i) => <li key={i}>{b}</li>)}</ol>
      <p className="bridge"><strong>Into the product:</strong> {story.bridge}</p>
      {story.hookSuggestion && (
        <Notice kind="info">
          A stronger opening line: “{story.hookSuggestion}”{' '}
          {onUseSuggestion && <button className="link" onClick={onUseSuggestion}>Use it</button>}
        </Notice>
      )}
      <button className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Hide the score' : 'Why this score'}</button>
      {open && (
        <>
          <ScoreBars story={story} />
          <ul className="reasons">{story.score.factors.map((f) => <li key={f.key}><strong>{f.label}:</strong> {f.reason}</li>)}</ul>
        </>
      )}
      <footer>
        <Button kind={selected ? 'primary' : 'default'} onClick={onPick}>{selected ? 'Selected' : 'Pick this story'}</Button>
        {story.writtenBy === 'template' && <span className="muted small">From the story library</span>}
      </footer>
    </article>
  )
}

export function StoryStep({ bundle, setReel, save, reload }: StepProps) {
  const { status, toast } = useStudio()
  const { reel } = bundle
  const options = reel.storyOptions ?? []
  const [seconds, setSeconds] = useState<number>(reel.seconds ?? status?.settings.reelSeconds ?? 30)
  const [idea, setIdea] = useState('')
  const [scoring, setScoring] = useState(false)
  const [libraryNote, setLibraryNote] = useState<string | null>(null)

  const recommend = useJob<{ stories: Story[]; error?: string }>(`stories:${reel.id}`, (r) => {
    setLibraryNote(r.error ? `The writer could not be reached, so these come from the built-in story library. (${r.error})` : null)
    void reload()
  })
  const script = useJob<{ reel: Reel; writtenBy: 'llm' | 'template'; error?: string }>(`script:${reel.id}`, (r) => {
    setReel(r.reel)
    if (r.error) toast(`The writer could not be reached, so the script came from the story template. (${r.error})`, 'error')
    go(`/reel/${reel.id}/script`)
  })
  const startRecommend = () => recommend.start(() => post<{ job: Job }>('/api/stories/recommend', { reelId: reel.id }))

  useEffect(() => {
    if (options.length || reel.story || asked.has(reel.id) || recommend.running) return
    asked.add(reel.id)
    void startRecommend()
    // Runs once on arrival for a reel with no stories yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reel.id])

  const scoreIdea = async () => {
    setScoring(true)
    try {
      const r = await post<{ story: Story; error?: string }>('/api/stories/custom', { reelId: reel.id, idea })
      await save({ story: r.story })
      await reload()
      setIdea('')
      if (r.error) toast('The writer could not be reached, so your idea was scored with basic rules.', 'error')
    } catch (e) { toast(errorText(e), 'error') } finally { setScoring(false) }
  }

  const write = () => {
    if (!reel.story) return
    if (reel.scenes.length && !window.confirm('Write a new script? This replaces the current script and its voice recording.')) return
    void script.start(() => post<{ job: Job }>(`/api/reels/${reel.id}/script`, { story: reel.story, seconds }))
  }

  const custom = options.filter((s) => s.source === 'custom')
  const recommended = options.filter((s) => s.source !== 'custom')
  const picked = reel.story?.id

  return (
    <div className="stack">
      <div className="card card-pad write-bar">
        <div className="grow">
          <h2>{reel.story ? reel.story.hook : 'Pick a story below'}</h2>
          <p className="muted">{reel.story ? 'The script follows this story for a few beats, then turns into your product demo.' : 'Each one opens with a hook, builds for a few beats, then turns into your product demo.'}</p>
        </div>
        <div className="write-controls">
          <label className="field">
            <span className="field-label">Reel length</span>
            <Seg value={seconds} options={[20, 30, 38] as const} onChange={setSeconds} labels={{ 20: '20 s', 30: '30 s', 38: '38 s' }} />
          </label>
          <Button kind="primary" onClick={write} disabled={!reel.story} busy={script.running}>{reel.scenes.length ? 'Rewrite the script' : 'Write the script'}</Button>
        </div>
        {script.running && <Progress job={script.job} label="Writing the script" />}
        {script.error && <Notice kind="error">{script.error}</Notice>}
      </div>

      <div className="card card-pad">
        <h2>Have your own idea?</h2>
        <p className="muted">Describe it in a sentence or two. It gets the same Hook Score, and a stronger first line if the opening is weak.</p>
        <textarea rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A professor grades essays by smell and one student's essay smells suspiciously perfect" />
        <div className="row"><Button onClick={scoreIdea} busy={scoring} disabled={idea.trim().length < 8}>Score my idea</Button></div>
      </div>

      {custom.length > 0 && (
        <div className="story-grid">
          {custom.map((s) => (
            <StoryCard key={s.id} story={s} selected={picked === s.id} onPick={() => save({ story: s })}
              onUseSuggestion={() => save({ story: { ...s, hook: s.hookSuggestion, hookSuggestion: undefined } })} />
          ))}
        </div>
      )}

      <div className="section-head">
        <div><h2>Recommended for {bundle.product.brief.name}</h2><p className="muted">Written for your product and your cast. The score rates the first three seconds.</p></div>
        <Button onClick={startRecommend} busy={recommend.running}>{recommended.length ? 'Get six new ones' : 'Recommend stories'}</Button>
      </div>
      {recommend.running && <Progress job={recommend.job} label="Writing story ideas" />}
      {recommend.error && <Notice kind="error">{recommend.error}</Notice>}
      {libraryNote && <Notice kind="warn">{libraryNote}</Notice>}
      {!status?.anthropic.configured && <Notice kind="warn">No Anthropic key is set, so stories come from the built-in library instead of being written for your product.</Notice>}
      {recommended.length === 0 && !recommend.running ? (
        <Empty title="No stories yet"><p>Ask for recommendations, or write your own idea above.</p></Empty>
      ) : (
        <div className="story-grid">
          {[...recommended].sort((a, b) => b.score.total - a.score.total).map((s) => (
            <StoryCard key={s.id} story={s} selected={picked === s.id} onPick={() => save({ story: s })} />
          ))}
        </div>
      )}
    </div>
  )
}
