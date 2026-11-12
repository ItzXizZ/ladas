// Character Studio: describe a character or build one by hand, watch it act in every style, save it.
import { useMemo, useState } from 'react'
import { BOTTOM_COLORS, CLOTH_COLORS, HAIR_COLORS, newId, randomCharacter, SKIN_TONES } from '../../shared/starter.ts'
import {
  ACCESSORIES, BROWS, BUILDS, ENERGIES, EYE_SHAPES, FACIAL_HAIR, GLASSES, HAIR_STYLES, MOUTHS, NOSES, ROLES, STYLE_IDS, TOPS, WALKS,
  type CharacterRecord, type StyleId,
} from '../../shared/types.ts'
import { errorText, post, put } from '../api.ts'
import { Player } from '../engine/Player.tsx'
import { Button, Field, Notice, Portrait, previewBundle, Seg, stageScenes, STYLE_LABEL, Swatches, useStudio } from './ui.tsx'

const SHOES = ['#F8FAFC', '#111827', '#4A3222', '#EF4444', '#3B82F6']
const ROLE_HINT: Record<string, string> = { hero: 'Leads the story', foil: 'Doubts or reacts', mentor: 'Knows the answer', crowd: 'Background' }

export function blankCharacter(): CharacterRecord {
  const c = randomCharacter(newId('seed'))
  return { ...c, id: newId('draft'), identity: { ...c.identity, role: 'hero', personality: '', catchphrase: '' } }
}

export function CharacterEditor({ initial, style = 'cartoon', onClose }: { initial: CharacterRecord | null; style?: StyleId; onClose: (saved?: CharacterRecord) => void }) {
  const { toast, status, reloadCharacters } = useStudio()
  const [c, setC] = useState<CharacterRecord>(() => initial ?? blankCharacter())
  const [look, setLook] = useState<StyleId>(style)
  const [description, setDescription] = useState('')
  const [describing, setDescribing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const existing = !!initial && !initial.starter
  const dirty = !initial || JSON.stringify(c) !== JSON.stringify(initial)

  const set = <K extends 'identity' | 'body' | 'face' | 'hair' | 'wardrobe' | 'performance'>(group: K, changes: Partial<CharacterRecord[K]>) =>
    setC((cur) => ({ ...cur, [group]: { ...cur[group], ...changes } }))

  const describe = async () => {
    if (!description.trim()) return
    setDescribing(true)
    setNote(null)
    try {
      const r = await post<{ character: CharacterRecord; writtenBy: 'llm' | 'keywords'; error?: string }>('/api/characters/describe', { description })
      setC((cur) => ({ ...r.character, id: cur.id, version: cur.version, starter: cur.starter, createdAt: cur.createdAt, updatedAt: cur.updatedAt }))
      setNote(r.writtenBy === 'llm' ? 'Built from your description. Adjust anything below.' : `Built from keywords in your description${r.error ? ' (the writer could not be reached)' : ' (no Anthropic key is set)'}. Adjust anything below.`)
    } catch (e) { toast(errorText(e), 'error') } finally { setDescribing(false) }
  }

  const randomize = () => {
    const r = randomCharacter(newId('seed'))
    setC((cur) => ({ ...cur, body: r.body, face: r.face, hair: r.hair, wardrobe: r.wardrobe }))
  }

  const saveAs = async (asNew: boolean) => {
    if (!c.identity.name.trim()) { toast('Give the character a name first', 'error'); return }
    setSaving(true)
    try {
      const saved = asNew ? await post<CharacterRecord>('/api/characters', c) : await put<CharacterRecord>(`/api/characters/${c.id}`, c)
      await reloadCharacters()
      toast(asNew ? `${saved.identity.name} saved to your characters` : `${saved.identity.name} updated (version ${saved.version})`)
      onClose(saved)
    } catch (e) { toast(errorText(e), 'error') } finally { setSaving(false) }
  }

  const bundle = useMemo(() => previewBundle([c], look, stageScenes([c.id], 'neutral')), [c, look])

  return (
    <div className="modal" role="dialog" aria-modal aria-label="Character Studio">
      <div className="modal-card editor">
        <header className="modal-head">
          <div>
            <p className="eyebrow">Character Studio</p>
            <h2>{initial ? (initial.starter ? `Remix ${initial.identity.name}` : `Edit ${initial.identity.name}`) : 'New character'}</h2>
          </div>
          <div className="row">
            <Button onClick={() => { if (!dirty || window.confirm('Close without saving this character?')) onClose() }}>Close</Button>
            {existing && <Button onClick={() => saveAs(true)} busy={saving}>Save as new</Button>}
            <Button kind="primary" onClick={() => saveAs(!existing)} busy={saving} disabled={existing && !dirty}>{existing ? 'Save changes' : 'Save character'}</Button>
          </div>
        </header>

        <div className="editor-body">
          <div className="editor-form">
            <section className="panel">
              <h3>Describe them</h3>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A sleepy grad student with round glasses, a green hoodie and messy brown hair" />
              <div className="row">
                <Button onClick={describe} busy={describing} disabled={!description.trim()}>Build from description</Button>
                <Button kind="ghost" onClick={randomize}>Surprise me</Button>
                {!status?.anthropic.configured && <span className="muted small">Without an Anthropic key this matches keywords only.</span>}
              </div>
              {note && <Notice kind="ok">{note}</Notice>}
            </section>

            <section className="panel">
              <h3>Identity</h3>
              <div className="form-grid">
                <Field label="Name"><input value={c.identity.name} maxLength={30} onChange={(e) => set('identity', { name: e.target.value })} /></Field>
                <Field label="Role in stories" hint={ROLE_HINT[c.identity.role]}><Seg value={c.identity.role} options={ROLES} onChange={(role) => set('identity', { role })} /></Field>
                <Field label="Personality" hint="One line. The writer uses this to give them a voice." wide><input value={c.identity.personality} maxLength={140} onChange={(e) => set('identity', { personality: e.target.value })} placeholder="Overconfident, never read the syllabus" /></Field>
                <Field label="Catchphrase" wide><input value={c.identity.catchphrase} maxLength={60} onChange={(e) => set('identity', { catchphrase: e.target.value })} placeholder="It is fine. Probably." /></Field>
              </div>
            </section>

            <section className="panel">
              <h3>Body</h3>
              <div className="form-grid">
                <Field label="Skin" wide><Swatches value={c.body.skin} colors={SKIN_TONES} onChange={(skin) => set('body', { skin })} custom /></Field>
                <Field label="Build"><Seg value={c.body.build} options={BUILDS} onChange={(build) => set('body', { build })} /></Field>
                <Field label={`Height ${Math.round(c.body.height * 100)}%`}><input type="range" min={0.75} max={1.15} step={0.01} value={c.body.height} onChange={(e) => set('body', { height: Number(e.target.value) })} /></Field>
              </div>
            </section>

            <section className="panel">
              <h3>Hair</h3>
              <div className="form-grid">
                <Field label="Style" wide><Seg value={c.hair.style} options={HAIR_STYLES} onChange={(v) => set('hair', { style: v })} /></Field>
                <Field label="Colour" wide><Swatches value={c.hair.color} colors={HAIR_COLORS} onChange={(color) => set('hair', { color })} custom /></Field>
              </div>
            </section>

            <section className="panel">
              <h3>Face</h3>
              <div className="form-grid">
                <Field label="Eyes"><Seg value={c.face.eyes} options={EYE_SHAPES} onChange={(eyes) => set('face', { eyes })} /></Field>
                <Field label="Brows"><Seg value={c.face.brows} options={BROWS} onChange={(brows) => set('face', { brows })} /></Field>
                <Field label="Nose"><Seg value={c.face.nose} options={NOSES} onChange={(nose) => set('face', { nose })} /></Field>
                <Field label="Mouth"><Seg value={c.face.mouth} options={MOUTHS} onChange={(mouth) => set('face', { mouth })} /></Field>
                <Field label="Glasses"><Seg value={c.face.glasses} options={GLASSES} onChange={(glasses) => set('face', { glasses })} /></Field>
                <Field label="Facial hair"><Seg value={c.face.facialHair} options={FACIAL_HAIR} onChange={(facialHair) => set('face', { facialHair })} /></Field>
                <Field label="Details">
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={c.face.freckles} onChange={(e) => set('face', { freckles: e.target.checked })} /> Freckles</label>
                    <label className="check"><input type="checkbox" checked={!!c.face.acne} onChange={(e) => set('face', { acne: e.target.checked })} /> Acne</label>
                    <label className="check"><input type="checkbox" checked={c.face.blush} onChange={(e) => set('face', { blush: e.target.checked })} /> Blush</label>
                  </div>
                </Field>
              </div>
            </section>

            <section className="panel">
              <h3>Wardrobe</h3>
              <div className="form-grid">
                <Field label="Top" wide><Seg value={c.wardrobe.top} options={TOPS} onChange={(top) => set('wardrobe', { top })} /></Field>
                <Field label="Top colour" wide><Swatches value={c.wardrobe.topColor} colors={CLOTH_COLORS} onChange={(topColor) => set('wardrobe', { topColor })} custom /></Field>
                <Field label="Bottoms"><Swatches value={c.wardrobe.bottomColor} colors={BOTTOM_COLORS} onChange={(bottomColor) => set('wardrobe', { bottomColor })} custom /></Field>
                <Field label="Shoes"><Swatches value={c.wardrobe.shoeColor} colors={SHOES} onChange={(shoeColor) => set('wardrobe', { shoeColor })} custom /></Field>
                <Field label="Accessory" wide><Seg value={c.wardrobe.accessory} options={ACCESSORIES} onChange={(accessory) => set('wardrobe', { accessory })} /></Field>
                {c.wardrobe.accessory !== 'none' && c.wardrobe.accessory !== 'gradcap' && (
                  <Field label="Accessory colour" wide><Swatches value={c.wardrobe.accessoryColor} colors={CLOTH_COLORS} onChange={(accessoryColor) => set('wardrobe', { accessoryColor })} custom /></Field>
                )}
              </div>
            </section>

            <section className="panel">
              <h3>Performance</h3>
              <div className="form-grid">
                <Field label="Walk"><Seg value={c.performance.walk} options={WALKS} onChange={(walk) => set('performance', { walk })} /></Field>
                <Field label="Energy" hint="How much they move while idle."><Seg value={c.performance.energy} options={ENERGIES} onChange={(energy) => set('performance', { energy })} /></Field>
              </div>
            </section>
          </div>

          <aside className="editor-stage">
            <Player bundle={bundle} autoPlay loop controls={false} muted fps={20} />
            <div className="style-row">
              {STYLE_IDS.map((s) => (
                <button key={s} className={`style-chip${s === look ? ' on' : ''}`} onClick={() => setLook(s)} title={STYLE_LABEL[s]}>
                  <Portrait character={c} style={s} size={54} />
                  <span>{STYLE_LABEL[s]}</span>
                </button>
              ))}
            </div>
            <p className="muted small">One character, four looks. The record is the same; each style draws it its own way.</p>
          </aside>
        </div>
      </div>
    </div>
  )
}
