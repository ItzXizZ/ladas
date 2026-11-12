// The character library: starter characters plus everything the user has made.
import { useState, type ReactNode } from 'react'
import type { CharacterRecord } from '../../shared/types.ts'
import { del, errorText } from '../api.ts'
import { CharacterEditor } from './CharacterEditor.tsx'
import { Button, Empty, Portrait, useStudio } from './ui.tsx'

export function CharacterCard({ character, onClick, selected, badge, children }: { character: CharacterRecord; onClick?: () => void; selected?: boolean; badge?: string; children?: ReactNode }) {
  return (
    <div className={`char-card${selected ? ' on' : ''}`}>
      <button className="char-main" onClick={onClick} disabled={!onClick} aria-pressed={selected}>
        <Portrait character={character} size={84} />
        <span className="char-text">
          <strong>{character.identity.name}</strong>
          <span className="muted small">{character.identity.personality || character.identity.role}</span>
        </span>
        {badge && <span className="chip">{badge}</span>}
      </button>
      {children && <div className="char-actions">{children}</div>}
    </div>
  )
}

export function CharactersPage({ selected }: { selected?: string }) {
  const { characters, reloadCharacters, toast } = useStudio()
  const [editing, setEditing] = useState<CharacterRecord | null | 'new'>(selected === 'new' ? 'new' : null)
  const mine = characters.filter((c) => !c.starter)
  const starters = characters.filter((c) => c.starter)

  const remove = async (c: CharacterRecord) => {
    if (!window.confirm(`Delete ${c.identity.name}? This cannot be undone.`)) return
    try {
      await del(`/api/characters/${c.id}`)
      await reloadCharacters()
    } catch (e) { toast(errorText(e), 'error') }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Characters</h1>
          <p className="muted">Saved characters can star in any reel, in any style. Editing one saves a new version, so reels you already made keep their look.</p>
        </div>
        <Button kind="primary" onClick={() => setEditing('new')}>New character</Button>
      </div>

      <section>
        <div className="section-head"><h2>Yours</h2></div>
        {mine.length === 0 ? (
          <Empty title="You have not made a character yet"><p>Describe one in a sentence, or remix a starter below.</p></Empty>
        ) : (
          <div className="char-grid">
            {mine.map((c) => (
              <CharacterCard key={c.id} character={c} onClick={() => setEditing(c)} badge={c.version > 1 ? `v${c.version}` : undefined}>
                <Button small onClick={() => setEditing(c)}>Edit</Button>
                <Button small kind="ghost" onClick={() => remove(c)}>Delete</Button>
              </CharacterCard>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-head"><h2>Starter characters</h2></div>
        <div className="char-grid">
          {starters.map((c) => (
            <CharacterCard key={c.id} character={c} onClick={() => setEditing(c)} badge={c.identity.role}>
              <Button small onClick={() => setEditing(c)}>Remix</Button>
            </CharacterCard>
          ))}
        </div>
      </section>

      {editing && <CharacterEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
