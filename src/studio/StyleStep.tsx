// Step 3: pick the look. Each card plays the user's own cast in that style.
import { useMemo, useState } from 'react'
import type { StyleId } from '../../shared/types.ts'
import { Player } from '../engine/Player.tsx'
import { STYLE_LIST } from '../engine/style.tsx'
import type { StepProps } from './Reel.tsx'
import { Button, previewBundle, SceneThumb, stageScenes } from './ui.tsx'

export function StyleStep({ bundle, save, next }: StepProps) {
  const { reel, characters, product } = bundle
  const [hover, setHover] = useState<StyleId | null>(null)
  const scenes = useMemo(() => stageScenes(characters.map((c) => c.id)), [characters])
  const previews = useMemo(
    () => Object.fromEntries(STYLE_LIST.map((s) => [s.id, previewBundle(characters, s.id, scenes, product.brand)])),
    [characters, scenes, product.brand],
  )

  return (
    <div className="stack">
      <div className="style-grid">
        {STYLE_LIST.map((s) => {
          const on = reel.style === s.id
          // Only the chosen and the hovered card animate, so four reels are not drawn at once.
          const live = on || hover === s.id
          return (
            <button key={s.id} className={`style-card${on ? ' on' : ''}`} onClick={() => { if (!on) void save({ style: s.id }) }} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} aria-pressed={on}>
              <div className="style-preview">
                {live ? <Player bundle={previews[s.id]} autoPlay loop controls={false} muted fps={20} /> : <SceneThumb bundle={previews[s.id]} scene={0} />}
              </div>
              <div className="style-text">
                <strong>{s.name}</strong>
                <span>{s.tagline}</span>
                <span className="muted small">Best for: {s.bestFor}</span>
              </div>
              {on && <span className="chip chip-on">Selected</span>}
            </button>
          )
        })}
      </div>
      <p className="muted">The same script works in every style, so you can change this later without rewriting anything. 3D Toon is not available yet.</p>
      <div className="step-foot"><Button kind="primary" onClick={next}>Continue to story</Button></div>
    </div>
  )
}
