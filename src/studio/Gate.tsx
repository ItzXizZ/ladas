// Sign-in screen for the shared site password. Shows the studio once the server accepts the cookie.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { errorText, get, post } from '../api.ts'

interface Me { required: boolean; authed: boolean; configured: boolean }

export function Gate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    get<Me>('/api/auth/me').then(setMe).catch((e) => setError(errorText(e)))
  }, [])

  // Any API call that comes back 401 later (an expired cookie) sends the user back here.
  useEffect(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const res = await original(...args)
      const url = String(args[0] instanceof Request ? args[0].url : args[0])
      if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) setMe((m) => (m ? { ...m, authed: false } : m))
      return res
    }
    return () => { window.fetch = original }
  }, [])

  if (me?.authed) return <>{children}</>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await post('/api/auth/login', { password })
      setPassword('')
      setMe(await get<Me>('/api/auth/me'))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form className="card card-pad" onSubmit={submit} style={{ width: 'min(380px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="brand-mark" aria-hidden><i /><i /><i /></span>
          <h1 style={{ fontSize: 26, lineHeight: 1.05 }}>Reel Studio</h1>
        </div>
        {me && !me.configured ? (
          <p className="field-hint">This site is closed: no password has been set on the server yet.</p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Password</span>
              <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!me || busy} />
            </label>
            {error && <div role="alert" style={{ color: 'var(--bad)', fontWeight: 700, fontSize: 14 }}>{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={!me || busy || !password}>{busy ? 'Checking' : 'Enter'}</button>
          </>
        )}
      </form>
    </div>
  )
}
