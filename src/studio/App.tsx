// The Studio shell: sidebar, routes, and the data every screen shares.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Cast, CharacterRecord, ServerStatus } from '../../shared/types.ts'
import { errorText, get } from '../api.ts'
import { CharactersPage } from './Characters.tsx'
import { Home } from './Home.tsx'
import { NewProduct } from './ProductStep.tsx'
import { ReelWorkspace } from './Reel.tsx'
import { SettingsPage } from './Settings.tsx'
import { go, StudioCtx, useRoute, type Studio } from './ui.tsx'

interface Toast { id: number; message: string; kind: 'ok' | 'error' }

export function App() {
  const route = useRoute()
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [characters, setCharacters] = useState<CharacterRecord[]>([])
  const [casts, setCasts] = useState<Cast[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [offline, setOffline] = useState<string | null>(null)

  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, message, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3200)
  }, [])
  const reloadStatus = useCallback(async () => {
    try {
      setStatus(await get<ServerStatus>('/api/status'))
      setOffline(null)
    } catch (e) { setOffline(errorText(e)) }
  }, [])
  const reloadCharacters = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([get<CharacterRecord[]>('/api/characters'), get<Cast[]>('/api/casts')])
      setCharacters(c)
      setCasts(k)
    } catch (e) { setOffline(errorText(e)) }
  }, [])
  useEffect(() => { void reloadStatus(); void reloadCharacters() }, [reloadStatus, reloadCharacters])

  const studio = useMemo<Studio>(() => ({ status, characters, casts, reloadStatus, reloadCharacters, toast }), [status, characters, casts, reloadStatus, reloadCharacters, toast])
  const [section, a, b] = route

  let view
  if (section === 'new' && a) view = <NewProduct key={a} productId={a} />
  else if (section === 'reel' && a) view = <ReelWorkspace key={a} reelId={a} step={b ?? 'cast'} />
  else if (section === 'characters') view = <CharactersPage selected={a} />
  else if (section === 'settings') view = <SettingsPage />
  else view = <Home />

  const nav = [
    { id: '', label: 'Reels', href: '/' },
    { id: 'characters', label: 'Characters', href: '/characters' },
    { id: 'settings', label: 'Settings', href: '/settings' },
  ]
  const current = section === 'new' || section === 'reel' || !section ? '' : section
  const dot = (ok: boolean) => <i className={`dot ${ok ? 'dot-ok' : 'dot-off'}`} />

  return (
    <StudioCtx.Provider value={studio}>
      <div className="shell">
        <aside className="side">
          <button className="brand" onClick={() => go('/')}>
            <span className="brand-mark" aria-hidden><i /><i /><i /></span>
            <span>Reel<br />Studio</span>
          </button>
          <nav>
            {nav.map((n) => (
              <button key={n.id} className={`nav${current === n.id ? ' on' : ''}`} onClick={() => go(n.href)}>{n.label}</button>
            ))}
          </nav>
          <div className="side-status">
            {status ? (
              <>
                <div title={status.anthropic.error ?? status.anthropic.model}>{dot(status.anthropic.configured && !status.anthropic.error)} Claude writer</div>
                <div title={status.elevenlabs.error}>{dot(status.elevenlabs.configured && !status.elevenlabs.error)} Premium voices</div>
                <div>{dot(status.ffmpeg && !!status.browser)} Renderer</div>
              </>
            ) : <div>Connecting</div>}
          </div>
        </aside>
        <main className="main">
          {offline && <div className="notice notice-error">The Studio server is not answering ({offline}). Start it with <code>npm run dev</code> and reload.</div>}
          {view}
        </main>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>)}
        </div>
      </div>
    </StudioCtx.Provider>
  )
}
