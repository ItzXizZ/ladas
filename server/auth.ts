// Shared-password gate for the whole site. One password (SITE_PASSWORD), a signed httpOnly cookie.
// Locally with no password set the gate is off. On a host (Vercel, NODE_ENV=production) a missing
// password closes the site instead of opening it.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'

const COOKIE = 'rs_session'
const MAX_AGE_S = 60 * 60 * 24 * 7

const password = (process.env.SITE_PASSWORD ?? '').trim()
const hosted = !!process.env.VERCEL || process.env.NODE_ENV === 'production'

export const authRequired = password.length > 0 || hosted
/** Changing the password changes the key, which signs everyone out. */
const key = createHash('sha256').update(`reel-studio:${process.env.SESSION_SECRET ?? ''}:${password}`).digest()

const sign = (payload: string) => createHmac('sha256', key).update(payload).digest('base64url')
const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
const newToken = () => {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S)
  return `${exp}.${sign(exp)}`
}
function validToken(token: string | undefined): boolean {
  if (!token) return false
  const [exp, sig] = token.split('.')
  return !!exp && !!sig && same(sig, sign(exp)) && Number(exp) > Date.now() / 1000
}

function cookieOf(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

export const isAuthed = (req: Request) => !authRequired || (password.length > 0 && validToken(cookieOf(req)))

/** The server's own headless browser loads the render page from itself and needs to be let in. */
export const internalCookie = () => ({ name: COOKIE, value: newToken() })

const misses = new Map<string, { n: number; until: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_MISSES = 8

export const authRoutes = Router()

authRoutes.get('/api/auth/me', (req, res) => {
  res.json({ required: authRequired, authed: isAuthed(req), configured: password.length > 0 || !hosted })
})

authRoutes.post('/api/auth/login', async (req, res) => {
  if (!password) {
    res.status(authRequired ? 503 : 200).json(authRequired ? { error: 'The site password is not set on the server (SITE_PASSWORD).' } : { ok: true })
    return
  }
  const ip = req.ip ?? 'unknown'
  const now = Date.now()
  const rec = misses.get(ip)
  if (rec && rec.until > now && rec.n >= MAX_MISSES) {
    res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' })
    return
  }
  const given = typeof req.body?.password === 'string' ? req.body.password : ''
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const ok = same(createHash('sha256').update(given).digest('base64'), createHash('sha256').update(password).digest('base64'))
  if (!ok) {
    misses.set(ip, { n: (rec && rec.until > now ? rec.n : 0) + 1, until: now + WINDOW_MS })
    await new Promise((r) => setTimeout(r, 600))
    res.status(401).json({ error: 'Wrong password' })
    return
  }
  misses.delete(ip)
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(COOKIE, newToken(), { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE_S * 1000, path: '/' })
  res.json({ ok: true })
})

authRoutes.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

/** Everything except the sign-in endpoints needs a session. The static front end only shows a sign-in screen. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthed(req)) return next()
  const message = authRequired && !password ? 'The site password is not set on the server (SITE_PASSWORD).' : 'Sign in required'
  res.status(authRequired && !password ? 503 : 401).json({ error: message })
}
