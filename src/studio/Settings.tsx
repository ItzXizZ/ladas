// Settings: defaults for new reels, the writing model, render speed, and what is connected.
import { useEffect, useState } from 'react'
import { STYLE_IDS, type AppSettings } from '../../shared/types.ts'
import { errorText, put } from '../api.ts'
import { Button, Field, Notice, Seg, STYLE_LABEL, useStudio } from './ui.tsx'

export function SettingsPage() {
  const { status, reloadStatus, toast } = useStudio()
  const [s, setS] = useState<AppSettings | null>(status?.settings ?? null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (status && !s) setS(status.settings) }, [status, s])
  if (!status || !s) return <div className="page"><p className="muted">Loading</p></div>

  const dirty = JSON.stringify(s) !== JSON.stringify(status.settings)
  const set = (changes: Partial<AppSettings>) => setS({ ...s, ...changes })
  const save = async () => {
    setSaving(true)
    try {
      await put<AppSettings>('/api/settings', s)
      await reloadStatus()
      toast('Settings saved')
    } catch (e) { toast(errorText(e), 'error') } finally { setSaving(false) }
  }
  const row = (ok: boolean, title: string, detail: string) => (
    <div className="status-row"><i className={`dot ${ok ? 'dot-ok' : 'dot-off'}`} /><div><strong>{title}</strong><span className="muted small">{detail}</span></div></div>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Settings</h1><p className="muted">Defaults for new reels. Each reel can still change its own voice, style and sound.</p></div>
        <Button kind="primary" onClick={save} busy={saving} disabled={!dirty}>Save settings</Button>
      </div>

      <div className="card card-pad">
        <h2>Connections</h2>
        {row(status.anthropic.configured && !status.anthropic.error, 'Claude writer', status.anthropic.configured ? (status.anthropic.error ?? `Writing with ${status.anthropic.model ?? 'the default model'}`) : 'No key set. Stories and scripts use built-in templates.')}
        {row(status.elevenlabs.configured && !status.elevenlabs.error, 'ElevenLabs premium voices', status.elevenlabs.configured ? (status.elevenlabs.error ?? 'Connected') : 'No key set. The free voices still work.')}
        {row(status.ffmpeg, 'Video encoder (ffmpeg)', status.ffmpeg ? 'Ready' : 'Missing. Run npm run setup in the project folder.')}
        {row(!!status.browser, 'Browser for capture and rendering', status.browser ?? 'Chrome or Edge was not found.')}
        <Notice kind="info">Keys live in the <code>.env</code> file in the project folder (<code>ANTHROPIC_API_KEY</code>, <code>ELEVENLABS_API_KEY</code>). They never leave this PC except to call those two services. Restart the Studio after changing them.</Notice>
      </div>

      <div className="card card-pad">
        <h2>New reels</h2>
        <div className="form-grid">
          <Field label="Style"><Seg value={s.defaultStyle} options={STYLE_IDS} onChange={(defaultStyle) => set({ defaultStyle })} labels={STYLE_LABEL} /></Field>
          <Field label="Length"><Seg value={s.reelSeconds} options={[20, 30, 38] as const} onChange={(reelSeconds) => set({ reelSeconds })} labels={{ 20: '20 s', 30: '30 s', 38: '38 s' }} /></Field>
          <Field label="Voice">
            <select value={s.defaultVoiceId} onChange={(e) => set({ defaultVoiceId: e.target.value })}>
              {status.voices.map((v) => <option key={v.id} value={v.id}>{v.provider === 'elevenlabs' ? 'Premium' : 'Free'} · {v.name}</option>)}
            </select>
          </Field>
          <Field label="Captions"><label className="check"><input type="checkbox" checked={s.captions} onChange={(e) => set({ captions: e.target.checked })} /> Burn captions into the video</label></Field>
          <Field label={`Music level ${Math.round(s.musicLevel * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={s.musicLevel} onChange={(e) => set({ musicLevel: Number(e.target.value) })} /></Field>
          <Field label={`Sound effects ${Math.round(s.sfxLevel * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={s.sfxLevel} onChange={(e) => set({ sfxLevel: Number(e.target.value) })} /></Field>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Writing and rendering</h2>
        <div className="form-grid">
          <Field label="Writing model" hint="Auto picks the best model your key can use.">
            <select value={s.model} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Auto</option>
              {status.anthropic.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label={`Pages to capture per site: ${s.capturePages}`}><input type="range" min={1} max={5} step={1} value={s.capturePages} onChange={(e) => set({ capturePages: Number(e.target.value) })} /></Field>
          <Field label={`Render workers: ${s.renderWorkers}`} hint="More is faster but uses more memory."><input type="range" min={1} max={8} step={1} value={s.renderWorkers} onChange={(e) => set({ renderWorkers: Number(e.target.value) })} /></Field>
          <Field label="Visual review"><label className="check"><input type="checkbox" checked={s.qcVision} onChange={(e) => set({ qcVision: e.target.checked })} /> Have the model look over finished frames</label></Field>
        </div>
      </div>
    </div>
  )
}
