// Step 5: edit the script scene by scene, choose the voice and sound, and watch the live preview.
import { useEffect, useMemo, useRef, useState } from 'react'
import { scriptHash, tokenize, WORD_TARGET } from '../../shared/timeline.ts'
import type { FootagePage, Job, ProductShot, Reel, ReelSettings, SceneSpec, VoiceOption } from '../../shared/types.ts'
import { del, errorText, post, useJob } from '../api.ts'
import { Player } from '../engine/Player.tsx'
import { usePrepared } from '../engine/ReelFrame.tsx'
import type { StepProps } from './Reel.tsx'
import { Button, Field, Notice, Progress, SceneThumb, Seg, useStudio } from './ui.tsx'

const BEAT_LABEL: Record<string, string> = { hook: 'Hook', setup: 'Setup', escalation: 'Escalation', turn: 'Turn', bridge: 'Bridge', product: 'Product', cta: 'Call to action' }
const MUSIC = ['auto', 'upbeat', 'curious', 'chill', 'none'] as const
const PHOTO_MOVES: { id: ProductShot['move']; label: string; tallOnly?: boolean }[] = [
  { id: 'zoom', label: 'Zoom in' }, { id: 'scroll', label: 'Scroll down', tallOnly: true }, { id: 'hero', label: 'Slow push' },
]

const isTall = (p: FootagePage) => p.pageHeight > p.viewport.h * 1.35

/** Upload site photos and place one in a scene, framed in a browser or phone like captured footage. */
function ScenePhoto({ scene, photos, onPlace, onUpload, onDelete }: {
  scene: SceneSpec; photos: FootagePage[]
  onPlace: (pageId: string | null, move?: ProductShot['move'], callout?: string) => Promise<void>
  onUpload: (files: File[]) => Promise<void>; onDelete: (page: FootagePage) => Promise<void>
}) {
  const file = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const placed = photos.find((p) => p.id === scene.product?.pageId)
  const [callout, setCallout] = useState(placed ? scene.product?.callout ?? '' : '')
  useEffect(() => { setCallout(placed ? scene.product?.callout ?? '' : '') }, [placed, scene.product?.callout])
  const move = placed ? scene.product?.move : undefined

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true)
    await onUpload([...list])
    setUploading(false)
    if (file.current) file.current.value = ''
  }

  return (
    <div className="scene-photo">
      <div className="row-between">
        <strong className="small">Show a photo from your site</strong>
        <Button small busy={uploading} onClick={() => file.current?.click()}>Upload photos</Button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void upload(e.target.files)} />
      </div>
      {photos.length === 0 ? (
        <p className="muted small">Upload screenshots or images of your site, then pick one to show in this scene.</p>
      ) : (
        <div className="photo-strip">
          {photos.map((p) => (
            <div key={p.id} className={`photo-thumb${placed?.id === p.id ? ' on' : ''}`}>
              <button onClick={() => void onPlace(placed?.id === p.id ? null : p.id, undefined, callout)} title={placed?.id === p.id ? 'Take this photo out of the scene' : `Show "${p.title}" in this scene`}>
                <img src={p.tiles[0]?.url} alt={p.title} />
              </button>
              <button className="photo-del" onClick={() => { if (window.confirm(`Delete "${p.title}"? Scenes that show it go back to what they showed before.`)) void onDelete(p) }} title="Delete this photo">✕</button>
            </div>
          ))}
        </div>
      )}
      {placed && (
        <>
          <Seg
            value={move ?? 'zoom'} onChange={(m) => void onPlace(placed.id, m, callout)}
            options={PHOTO_MOVES.filter((m) => !m.tallOnly || isTall(placed)).map((m) => m.id)}
            labels={Object.fromEntries(PHOTO_MOVES.map((m) => [m.id, m.label]))}
          />
          <div className="direct">
            <input value={callout} maxLength={34} placeholder="Callout over the photo (optional)" onChange={(e) => setCallout(e.target.value)}
              onBlur={() => { if (callout.trim() !== (scene.product?.callout ?? '')) void onPlace(placed.id, move, callout) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <Button small kind="ghost" onClick={() => void onPlace(null)}>Remove photo</Button>
          </div>
        </>
      )}
    </div>
  )
}

function SceneRow({ scene, index, count, bundle, active, onSeek, onLine, onMove, onRemove, onDirect, photo }: {
  scene: SceneSpec; index: number; count: number; bundle: StepProps['bundle']; active: boolean
  onSeek: () => void; onLine: (line: string) => Promise<void>; onMove: (by: number) => void; onRemove: () => void; onDirect: (instruction: string) => Promise<string | undefined>
  photo: Omit<Parameters<typeof ScenePhoto>[0], 'scene'>
}) {
  const [line, setLine] = useState(scene.line)
  const [directing, setDirecting] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { setLine(scene.line) }, [scene.line])

  const direct = async () => {
    setBusy(true)
    setNote(null)
    const n = await onDirect(instruction)
    setBusy(false)
    if (n !== undefined) { setInstruction(''); setNote(n || 'Scene updated.') }
  }

  return (
    <div className={`scene-row${active ? ' on' : ''}`}>
      <button className="scene-thumb" onClick={onSeek} title="Show this scene in the preview"><SceneThumb bundle={bundle} scene={index} /></button>
      <div className="scene-body">
        <div className="scene-head">
          <span className="chip">{index + 1} · {BEAT_LABEL[scene.beat] ?? scene.beat}</span>
          {scene.kind === 'product' && <span className="chip chip-brand">{photo.photos.some((p) => p.id === scene.product?.pageId) ? 'Your photo' : 'Your site'}</span>}
          <span className="muted small">{tokenize(line).length} words</span>
          <span className="grow" />
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} title="Move earlier">↑</button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={index === count - 1} title="Move later">↓</button>
          <button className="icon-btn" onClick={onRemove} disabled={count <= 2} title="Remove this scene">✕</button>
        </div>
        <textarea
          rows={2} value={line} aria-label={`Narration for scene ${index + 1}`}
          onChange={(e) => setLine(e.target.value)}
          onBlur={() => { if (line.trim() && line.trim() !== scene.line) void onLine(line); else setLine(scene.line) }}
        />
        {directing ? (
          <>
            <div className="direct">
              <input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Make Maya look shocked and add a REJECTED stamp" onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim() && !busy) void direct() }} autoFocus />
              <Button small kind="primary" onClick={direct} busy={busy} disabled={!instruction.trim()}>Apply</Button>
              <Button small kind="ghost" onClick={() => setDirecting(false)}>Done</Button>
            </div>
            <ScenePhoto scene={scene} {...photo} />
          </>
        ) : (
          <button className="link" onClick={() => setDirecting(true)}>Direct this scene</button>
        )}
        {note && <p className="muted small">{note}</p>}
      </div>
    </div>
  )
}

function VoicePicker({ voices, value, onPick }: { voices: VoiceOption[]; value: string; onPick: (id: string) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  useEffect(() => () => { audio.current?.pause() }, [])
  const preview = (v: VoiceOption) => {
    audio.current?.pause()
    if (playing === v.id || !v.previewUrl) { setPlaying(null); return }
    const a = new Audio(v.previewUrl)
    audio.current = a
    setLoading(v.id)
    a.oncanplay = () => setLoading((l) => (l === v.id ? null : l))
    a.onended = () => setPlaying((p) => (p === v.id ? null : p))
    a.onerror = () => { setLoading(null); setPlaying(null) }
    setPlaying(v.id)
    void a.play().catch(() => setPlaying(null))
  }
  const group = (provider: VoiceOption['provider'], title: string, hint: string) => {
    const list = voices.filter((v) => v.provider === provider)
    if (!list.length) return null
    return (
      <div className="voice-group">
        <div className="voice-title"><strong>{title}</strong><span className="muted small">{hint}</span></div>
        {list.map((v) => (
          <div key={v.id} className={`voice${value === v.id ? ' on' : ''}`}>
            <button className="voice-main" onClick={() => onPick(v.id)} aria-pressed={value === v.id}>
              <strong>{v.name}</strong>
              <span className="muted small">{v.blurb || v.tags.join(' · ')}</span>
            </button>
            {v.previewUrl && <button className="icon-btn" onClick={() => preview(v)} title="Hear a sample">{loading === v.id ? '…' : playing === v.id ? '❚❚' : '▶'}</button>}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="voices">
      {group('elevenlabs', 'Premium voices', 'ElevenLabs. Ready in seconds, exact word timing.')}
      {group('kokoro', 'Free voices', 'Run on this PC. A 40 second reel takes a few minutes.')}
    </div>
  )
}

export function ScriptStep({ bundle, setReel, save, reload, next }: StepProps) {
  const { status, toast } = useStudio()
  const { reel } = bundle
  const prepared = usePrepared(bundle)
  const [seek, setSeek] = useState<{ frame: number; n: number } | null>(null)
  const [activeScene, setActiveScene] = useState(0)
  const voices = status?.voices ?? []

  const voiceJob = useJob<Reel>(`voice:${reel.id}`, (r) => { setReel(r); toast('Voice recorded') })
  const record = () => voiceJob.start(() => post<{ job: Job }>(`/api/reels/${reel.id}/voice`))

  const words = useMemo(() => reel.scenes.reduce((n, s) => n + tokenize(s.line).length, 0), [reel.scenes])
  const target = WORD_TARGET[reel.seconds ?? status?.settings.reelSeconds ?? 30] ?? WORD_TARGET[30]
  const seconds = Math.round(prepared.timeline.duration)

  const voice = reel.voice
  const scriptMatches = !!voice && voice.scriptHash === scriptHash(reel.scenes)
  const voiceMatches = !!voice && voice.voiceId === reel.settings.voiceId
  const audio: 'none' | 'stale-script' | 'stale-voice' | 'unmixed' | 'ready' =
    !voice ? 'none' : !scriptMatches ? 'stale-script' : !voiceMatches ? 'stale-voice' : !voice.mixUrl ? 'unmixed' : 'ready'

  const patchScenes = (scenes: { id: string; line?: string }[]) => save({ scenes })
  const all = () => reel.scenes.map((s) => ({ id: s.id }))
  const setSettings = (changes: Partial<ReelSettings>) => save({ settings: { ...reel.settings, ...changes } })

  const direct = async (scene: SceneSpec, instruction: string): Promise<string | undefined> => {
    try {
      const r = await post<{ reel: Reel; note?: string }>(`/api/reels/${reel.id}/scenes/${scene.id}/edit`, { instruction })
      setReel(r.reel)
      return r.note ?? ''
    } catch (e) {
      toast(errorText(e), 'error')
      return undefined
    }
  }

  const photos = bundle.product.footage.filter((p) => p.uploaded)
  const productPath = `/api/products/${bundle.product.id}`

  const uploadPhotos = async (files: File[]) => {
    let added = 0
    for (const file of files) {
      try {
        const img = await createImageBitmap(file)
        const q = new URLSearchParams({ w: String(img.width), h: String(img.height), name: file.name })
        img.close()
        const res = await fetch(`${productPath}/photos?${q}`, { method: 'POST', headers: { 'content-type': file.type }, body: file })
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Upload failed (${res.status})`)
        added++
      } catch (e) {
        toast(`${file.name}: ${errorText(e)}`, 'error')
      }
    }
    if (added) {
      await reload()
      toast(added === 1 ? 'Photo added. Pick it to show it in this scene.' : `${added} photos added`)
    }
  }
  const placePhoto = async (scene: SceneSpec, pageId: string | null, move?: ProductShot['move'], callout?: string) => {
    try {
      setReel(await post<Reel>(`/api/reels/${reel.id}/scenes/${scene.id}/photo`, { pageId, move, callout }))
    } catch (e) { toast(errorText(e), 'error') }
  }
  const deletePhoto = async (page: FootagePage) => {
    try {
      await del(`${productPath}/photos/${page.id}`)
      await reload()
    } catch (e) { toast(errorText(e), 'error') }
  }

  const picked = voices.find((v) => v.id === reel.settings.voiceId)

  return (
    <div className="split split-script">
      <div className="stack">
        <div className="card card-pad">
          <div className="section-head">
            <div>
              <h2>Script</h2>
              <p className="muted">
                {reel.scenes.length} scenes · {words} words · about {seconds} s.{' '}
                {words > target[1] + 6 ? `That is long for this reel; aim for ${target[0]} to ${target[1]} words.` : words < target[0] - 6 ? `That is short for this reel; aim for ${target[0]} to ${target[1]} words.` : 'Reel length follows the narration.'}
              </p>
            </div>
            {reel.scriptWrittenBy === 'template' && <span className="chip">Template script</span>}
          </div>
          <div className="scene-list">
            {reel.scenes.map((s, i) => (
              <SceneRow
                key={s.id} scene={s} index={i} count={reel.scenes.length} bundle={bundle} active={i === activeScene}
                onSeek={() => setSeek({ frame: prepared.timeline.scenes[i]?.start ?? 0, n: Date.now() })}
                onLine={async (line) => { await patchScenes(reel.scenes.map((x) => (x.id === s.id ? { id: x.id, line } : { id: x.id }))) }}
                onMove={(by) => { const list = all(); const [m] = list.splice(i, 1); list.splice(i + by, 0, m); void patchScenes(list) }}
                onRemove={() => { if (window.confirm(`Remove scene ${i + 1}?`)) void patchScenes(all().filter((x) => x.id !== s.id)) }}
                onDirect={(instruction) => direct(s, instruction)}
                photo={{ photos, onPlace: (pageId, move, callout) => placePhoto(s, pageId, move, callout), onUpload: uploadPhotos, onDelete: deletePhoto }}
              />
            ))}
          </div>
        </div>
      </div>

      <aside className="sticky sticky-script">
        <Player bundle={bundle} seek={seek} onScene={setActiveScene} />

        <div className="card card-pad audio-card">
          {audio === 'none' && <Notice kind="info">No voice yet. The preview is silent and uses estimated timing.</Notice>}
          {audio === 'stale-script' && <Notice kind="warn">The script changed since the voice was recorded. Record again to hear it.</Notice>}
          {audio === 'stale-voice' && <Notice kind="warn">You picked a different voice. Record again to hear {picked?.name ?? 'it'}.</Notice>}
          {audio === 'unmixed' && <Notice kind="info">Music and sound effects are not mixed in yet.</Notice>}
          {audio === 'ready' && <Notice kind="ok">Voice, music and sound effects are up to date.</Notice>}
          {voiceJob.running ? <Progress job={voiceJob.job} label="Recording the voice" /> : (
            <div className="row">
              {audio !== 'ready' && <Button kind="primary" onClick={record}>{audio === 'unmixed' ? 'Mix the sound' : voice ? 'Record again' : 'Record the voice'}</Button>}
              <Button kind={audio === 'ready' ? 'primary' : 'default'} onClick={next}>Continue to export</Button>
            </div>
          )}
          {voiceJob.error && <Notice kind="error">{voiceJob.error}</Notice>}
        </div>

        <div className="card card-pad">
          <h3>Voice</h3>
          <VoicePicker voices={voices} value={reel.settings.voiceId} onPick={(voiceId) => setSettings({ voiceId })} />
          {status && !status.elevenlabs.configured && <p className="muted small">Add an ElevenLabs key in Settings for premium voices.</p>}
          {status?.elevenlabs.error && <Notice kind="warn">Premium voices could not be loaded: {status.elevenlabs.error}</Notice>}
        </div>

        <div className="card card-pad">
          <h3>Sound</h3>
          <Field label="Music"><Seg value={reel.settings.music} options={MUSIC} onChange={(music) => setSettings({ music })} labels={{ auto: 'Auto', upbeat: 'Upbeat', curious: 'Curious', chill: 'Chill', none: 'None' }} /></Field>
          <Level label="Music level" value={reel.settings.musicLevel} onCommit={(musicLevel) => setSettings({ musicLevel })} />
          <Level label="Sound effects" value={reel.settings.sfxLevel} onCommit={(sfxLevel) => setSettings({ sfxLevel })} />
          <label className="check"><input type="checkbox" checked={reel.settings.captions} onChange={(e) => setSettings({ captions: e.target.checked })} /> Burn captions into the video</label>
          <p className="muted small">The mix is levelled for Reels and TikTok, with the music dipped under the voice.</p>
        </div>
      </aside>
    </div>
  )
}

/** A slider that saves when released, not on every pixel of drag. */
function Level({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  const commit = () => { if (v !== value) onCommit(v) }
  return (
    <Field label={`${label} ${Math.round(v * 100)}%`}>
      <input type="range" min={0} max={1} step={0.05} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </Field>
  )
}
