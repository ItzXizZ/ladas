// Step 2: pick up to three characters. The stage on the right shows them acting together.
import { useMemo, useState } from 'react'
import type { Cast, CharacterRecord } from '../../shared/types.ts'
import { errorText, post } from '../api.ts'
import { Player } from '../engine/Player.tsx'
import { CharacterEditor } from './CharacterEditor.tsx'
import { CharacterCard } from './Characters.tsx'
import type { StepProps } from './Reel.tsx'
import { Button, Notice, Portrait, previewBundle, stageScenes, useStudio } from './ui.tsx'

const MAX = 3

export function CastStep({ bundle, save, next }: StepProps) {
  const { characters, casts, reloadCharacters, toast } = useStudio()
  const { reel } = bundle
  const [editing, setEditing] = useState<CharacterRecord | null | 'new'>(null)
  const [busy, setBusy] = useState(false)
  const ids = reel.characterIds
  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])
  // The reel pins the version it was cast with; the library may hold a newer one.
  const cast = bundle.characters
  const outdated = cast.filter((c) => (byId.get(c.id)?.version ?? c.version) > c.version)

  const setCast = async (next: string[]) => {
    if (!next.length) { toast('A reel needs at least one character', 'error'); return }
    setBusy(true)
    await save({ characterIds: next.slice(0, MAX) })
    setBusy(false)
  }
  const toggle = (id: string) => {
    if (ids.includes(id)) void setCast(ids.filter((x) => x !== id))
    else if (ids.length >= MAX) toast(`A cast holds up to ${MAX} characters. Remove one first.`, 'error')
    else void setCast([...ids, id])
  }
  const saveCast = async () => {
    const name = window.prompt('Name this cast', cast.map((c) => c.identity.name).join(', '))
    if (!name) return
    try {
      await post<Cast>('/api/casts', { name, description: 'Saved from a reel', characterIds: ids })
      await reloadCharacters()
      toast('Cast saved')
    } catch (e) { toast(errorText(e), 'error') }
  }

  const stage = useMemo(() => previewBundle(cast, reel.style, stageScenes(cast.map((c) => c.id)), bundle.product.brand), [cast, reel.style, bundle.product.brand])
  const mine = characters.filter((c) => !c.starter)
  const starters = characters.filter((c) => c.starter)

  return (
    <div className="split">
      <div className="stack">
        <div className="card card-pad">
          <div className="section-head">
            <div><h2>Your cast</h2><p className="muted">Up to {MAX} characters. The first one leads the story.</p></div>
            <Button small onClick={saveCast} disabled={!ids.length}>Save as a cast</Button>
          </div>
          <div className="cast-slots">
            {Array.from({ length: MAX }, (_, i) => {
              const c = cast[i]
              return c ? (
                <div key={c.id} className="slot">
                  <Portrait character={c} style={reel.style} size={108} />
                  <strong>{c.identity.name}</strong>
                  <span className="muted small">{i === 0 ? 'Lead' : c.identity.role}</span>
                  <div className="row">
                    {i > 0 && <button className="icon-btn" title="Make lead" onClick={() => setCast([c.id, ...ids.filter((x) => x !== c.id)])}>↑</button>}
                    <button className="icon-btn" title="Remove from cast" onClick={() => toggle(c.id)} disabled={busy || ids.length === 1}>✕</button>
                  </div>
                </div>
              ) : (
                <div key={i} className="slot slot-empty"><span>Empty seat</span><span className="muted small">Pick a character below</span></div>
              )
            })}
          </div>
          {outdated.length > 0 && (
            <Notice kind="info">
              {outdated.map((c) => c.identity.name).join(' and ')} {outdated.length === 1 ? 'has' : 'have'} a newer version in your library.{' '}
              <button className="link" onClick={() => setCast(ids)}>Use the latest</button>
            </Notice>
          )}
          {reel.scenes.length > 0 && <p className="muted small">This reel already has a script. Swapping a character hands their part to the replacement; the lines stay the same.</p>}
        </div>

        <div className="card card-pad">
          <div className="section-head"><h2>Ready-made casts</h2></div>
          <div className="cast-list">
            {casts.map((k) => {
              const members = k.characterIds.map((id) => byId.get(id)).filter((c): c is CharacterRecord => !!c)
              const on = k.characterIds.length === ids.length && k.characterIds.every((id, i) => ids[i] === id)
              return (
                <button key={k.id} className={`cast-card${on ? ' on' : ''}`} onClick={() => setCast(k.characterIds)} disabled={busy || !members.length}>
                  <span className="cast-faces">{members.map((c) => <Portrait key={c.id} character={c} size={56} />)}</span>
                  <strong>{k.name}</strong>
                  <span className="muted small">{k.description}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="card card-pad">
          <div className="section-head">
            <div><h2>All characters</h2><p className="muted">Click to add or remove.</p></div>
            <Button kind="primary" small onClick={() => setEditing('new')}>New character</Button>
          </div>
          <div className="char-grid">
            {[...mine, ...starters].map((c) => (
              <CharacterCard key={c.id} character={c} selected={ids.includes(c.id)} onClick={() => toggle(c.id)} badge={c.starter ? undefined : 'Yours'}>
                <Button small kind="ghost" onClick={() => setEditing(c)}>{c.starter ? 'Remix' : 'Edit'}</Button>
              </CharacterCard>
            ))}
          </div>
        </div>
      </div>

      <aside className="sticky">
        <Player bundle={stage} autoPlay loop controls={false} muted fps={20} />
        <Button kind="primary" onClick={next} disabled={!ids.length}>Continue to style</Button>
      </aside>

      {editing && (
        <CharacterEditor
          initial={editing === 'new' ? null : editing} style={reel.style}
          onClose={(saved) => {
            setEditing(null)
            if (!saved) return
            // A new character joins the cast if there is a free seat; an edited member is re-pinned to its new version.
            if (ids.includes(saved.id)) void setCast(ids)
            else if (ids.length < MAX) void setCast([...ids, saved.id])
          }}
        />
      )}
    </div>
  )
}
