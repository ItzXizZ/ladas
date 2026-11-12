// Reel Studio API: every endpoint, behind the password gate. server/index.ts serves it locally
// (with the front end) and api/index.ts serves it on Vercel.
import express, { type NextFunction, type Request, type Response } from 'express'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultReelSettings, newId } from '../shared/starter.ts'
import { STYLE_IDS, type Cast, type CharacterRecord, type FootagePage, type Product, type ProductShot, type Reel, type ReelSettings, type SceneSpec, type ServerStatus, type Story, type StyleId } from '../shared/types.ts'
import { browserName } from './browser.ts'
import { describeCharacter, sanitizeCharacter } from './characters.ts'
import { mixIsCurrent } from './audio/mix.ts'
import { authRoutes, requireAuth } from './auth.ts'
import { scheduleFileSync } from './cloud.ts'
import { ensureDir, env, ffmpegPath, filePath, fileUrl, FILES } from './env.ts'
import { ingestProduct, linkFeatures, normalizeUrl } from './ingest.ts'
import { getJob, startJob } from './jobs.ts'
import { listModels, llmReady, pickModel } from './llm.ts'
import { ensureAudio, PRESETS, renderReel, type Preset } from './render.ts'
import { editScene, writeScript } from './script.ts'
import { bundleFor, db, getSettings, saveCharacter, saveReel, saveSettings } from './store.ts'
import { customStory, recommendStories } from './stories.ts'
import { kokoroPreview, listVoices } from './voice.ts'

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(express.json({ limit: '4mb' }))
app.get('/healthz', (_req, res) => { res.json({ ok: true }) })
app.use(authRoutes)
app.use('/api', requireAuth)
// Anything that changes data may have written or removed files (photos, covers); mirror them soon after.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => scheduleFileSync())
  next()
})
app.use('/files', requireAuth, express.static(FILES, { maxAge: '1h' }))

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const need = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new HttpError(404, `${what} not found`)
  return v
}
type Handler = (req: Request, res: Response) => unknown
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => { if (out !== undefined && !res.headersSent) res.json(out) })
    .catch(next)
}
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const param = (req: Request, name: string) => String(req.params[name] ?? '')

const castOf = (reel: Reel): CharacterRecord[] => bundleFor(reel).characters
const charactersByIds = (ids: unknown): CharacterRecord[] =>
  (Array.isArray(ids) ? ids : []).map((id) => db.characters.get(String(id))).filter((c): c is CharacterRecord => !!c).slice(0, 5)

// ---------- Status & settings ----------
app.get('/api/status', route(async (): Promise<ServerStatus> => {
  const [models, voices, browser] = await Promise.all([listModels(), listVoices(), browserName()])
  let model: string | undefined
  let error = models.error
  if (llmReady()) {
    try { model = await pickModel() } catch (e) { error = e instanceof Error ? e.message : String(e) }
  }
  return {
    anthropic: { configured: llmReady(), model, models: models.ids, error },
    elevenlabs: { configured: env.elevenKey.length > 0, error: voices.elevenError },
    ffmpeg: !!ffmpegPath(), browser, settings: getSettings(), voices: voices.voices,
  }
}))

app.put('/api/settings', route((req) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  const cur = getSettings()
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return saveSettings({
    model: typeof b.model === 'string' ? b.model.trim().slice(0, 80) : cur.model,
    defaultVoiceId: str(b.defaultVoiceId, 120) || cur.defaultVoiceId,
    defaultStyle: STYLE_IDS.includes(b.defaultStyle as StyleId) ? (b.defaultStyle as StyleId) : cur.defaultStyle,
    reelSeconds: b.reelSeconds === 20 || b.reelSeconds === 30 || b.reelSeconds === 38 ? b.reelSeconds : cur.reelSeconds,
    captions: typeof b.captions === 'boolean' ? b.captions : cur.captions,
    musicLevel: num(b.musicLevel, 0, 1, cur.musicLevel),
    sfxLevel: num(b.sfxLevel, 0, 1, cur.sfxLevel),
    renderWorkers: Math.round(num(b.renderWorkers, 1, 8, cur.renderWorkers)),
    capturePages: Math.round(num(b.capturePages, 1, 5, cur.capturePages)),
    qcVision: typeof b.qcVision === 'boolean' ? b.qcVision : cur.qcVision,
  })
}))

app.get('/api/voices/preview', route(async (req, res) => {
  const path = await kokoroPreview(str(req.query.id, 80)).catch((e: unknown) => { throw new HttpError(400, e instanceof Error ? e.message : String(e)) })
  res.sendFile(path)
}))

// ---------- Products ----------
const emptyProduct = (url: string): Product => ({
  id: newId('prod'), url, createdAt: new Date().toISOString(), status: 'ingesting',
  brief: { name: new URL(url).hostname.replace(/^www\./, ''), pitch: '', category: '', audience: '', features: [], tone: [], claims: [], notes: '' },
  brand: { primary: '#4F46E5', accent: '#F59E0B', ink: '#111827', fonts: [] }, footage: [], briefSource: 'heuristic',
})

function startIngest(product: Product) {
  return startJob('ingest', async (h) => {
    try {
      const done = await ingestProduct(product, h)
      db.products.put(done)
      return done
    } catch (e) {
      db.products.put({ ...product, status: 'failed', error: e instanceof Error ? e.message.split('\n')[0] : String(e) })
      throw e
    }
  })
}

app.get('/api/products', route(() => [...db.products.all()].reverse()))
app.get('/api/products/:id', route((req) => need(db.products.get(param(req, 'id')), 'Product')))
app.post('/api/products', route((req) => {
  let url: string
  try { url = normalizeUrl(str(req.body?.url, 500)) } catch (e) { throw new HttpError(400, e instanceof Error && !/Invalid URL/.test(e.message) ? e.message : 'That does not look like a website address') }
  const product = db.products.put(emptyProduct(url))
  return { product, job: startIngest(product) }
}))
app.post('/api/products/:id/recapture', route((req) => {
  const product = need(db.products.get(param(req, 'id')), 'Product')
  const next = db.products.put({ ...product, status: 'ingesting', error: undefined })
  return { product: next, job: startIngest(next) }
}))
app.patch('/api/products/:id', route((req) => {
  const product = need(db.products.get(param(req, 'id')), 'Product')
  const b = (req.body ?? {}) as { brief?: Partial<Product['brief']>; brand?: Partial<Product['brand']> }
  const list = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : undefined)
  const brief = { ...product.brief }
  if (b.brief) {
    for (const k of ['name', 'pitch', 'category', 'audience', 'pricePoint', 'notes'] as const) if (typeof b.brief[k] === 'string') brief[k] = str(b.brief[k], k === 'notes' ? 1000 : 240)
    brief.tone = list(b.brief.tone, 6, 40) ?? brief.tone
    brief.claims = list(b.brief.claims, 12, 240) ?? brief.claims
    if (Array.isArray(b.brief.features)) {
      brief.features = b.brief.features
        .map((f) => ({ name: str(f?.name, 80), benefit: str(f?.benefit, 240), where: str(f?.where, 120) || undefined }))
        .filter((f) => f.name).slice(0, 8)
    }
  }
  const brand = { ...product.brand }
  if (b.brand) for (const k of ['primary', 'accent', 'ink'] as const) if (/^#[0-9a-f]{6}$/i.test(str(b.brand[k]))) brand[k] = str(b.brand[k])
  if (b.brand?.logoUrl === '') delete brand.logoUrl
  const footage = structuredClone(product.footage)
  linkFeatures(brief, footage)
  return db.products.put({ ...product, brief, brand, footage })
}))
// ---------- Site photos ----------
const PHOTO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** An uploaded photo becomes one more footage page, so product shots frame it like a captured page. */
function photoPage(product: Product, id: string, url: string, title: string, w: number, h: number): FootagePage {
  const device = h / w > 1.3 ? 'mobile' : 'desktop'
  const viewH = Math.min(h, Math.round(w * (device === 'mobile' ? 844 / 390 : 0.625)))
  return {
    id, url: product.url, title, device, viewport: { w, h: viewH }, scale: 1, pageHeight: h,
    tiles: [{ y: 0, h, url }], regions: [{ id: `${id}-r0`, kind: 'media', label: title, rect: { x: 0, y: 0, w, h } }],
    hiddenOverlays: 0, uploaded: true,
  }
}

/** Takes a site photo back out of a scene, restoring what the scene showed before. */
function withoutPhoto(scene: SceneSpec): SceneSpec {
  if (scene.beforePhoto) return { ...scene, kind: scene.beforePhoto.kind, product: scene.beforePhoto.product, beforePhoto: undefined, fix: undefined }
  if (!scene.product) return scene
  const { pageId: _p, regionId: _r, ...rest } = scene.product
  return { ...scene, product: { ...rest, move: rest.move === 'zoom' ? 'hero' : rest.move }, fix: undefined }
}

app.post('/api/products/:id/photos', express.raw({ type: Object.keys(PHOTO_TYPES), limit: '25mb' }), route((req) => {
  const product = need(db.products.get(param(req, 'id')), 'Product')
  const ext = PHOTO_TYPES[String(req.headers['content-type'] ?? '').split(';')[0].trim()]
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Upload a PNG, JPEG or WebP image')
  const w = Math.round(Number(req.query.w))
  const h = Math.round(Number(req.query.h))
  if (!(w >= 200 && h >= 200)) throw new HttpError(400, 'That image is too small to show in a reel. Use one at least 200 px on each side.')
  if (w > 12000 || h > 40000) throw new HttpError(400, 'That image is too large. Keep it under 12000 px wide and 40000 px tall.')
  const id = newId('up')
  writeFileSync(join(ensureDir('products', product.id), `${id}.${ext}`), req.body)
  const title = str(req.query.name, 80).replace(/\.[a-z0-9]+$/i, '') || 'Site photo'
  return db.products.put({ ...product, footage: [...product.footage, photoPage(product, id, fileUrl('products', product.id, `${id}.${ext}`), title, w, h)] })
}))
app.delete('/api/products/:id/photos/:pageId', route((req) => {
  const product = need(db.products.get(param(req, 'id')), 'Product')
  const page = need(product.footage.find((p) => p.id === param(req, 'pageId') && p.uploaded), 'Photo')
  for (const reel of db.reels.all()) {
    if (reel.productId !== product.id || !reel.scenes.some((s) => s.product?.pageId === page.id)) continue
    saveReel(dropStaleMix({ ...reel, scenes: reel.scenes.map((s) => (s.product?.pageId === page.id ? withoutPhoto(s) : s)) }))
  }
  for (const t of page.tiles) rmSync(filePath(t.url.replace(/^\/files\//, '')), { force: true })
  return db.products.put({ ...product, footage: product.footage.filter((p) => p.id !== page.id) })
}))

app.delete('/api/products/:id', route((req) => {
  const id = param(req, 'id')
  if (db.reels.all().some((r) => r.productId === id)) throw new HttpError(409, 'This product is used by a reel. Delete the reel first.')
  return { ok: db.products.remove(id) }
}))

// ---------- Characters & casts ----------
app.get('/api/characters', route(() => db.characters.all()))
app.post('/api/characters/describe', route(async (req) => {
  const description = str(req.body?.description, 600)
  if (!description) throw new HttpError(400, 'Describe the character first')
  return describeCharacter(description)
}))
app.post('/api/characters', route((req) => {
  const rec = sanitizeCharacter({ ...(req.body as object), id: undefined })
  return saveCharacter({ ...rec, id: newId('char'), starter: undefined })
}))
app.put('/api/characters/:id', route((req) => {
  const prev = need(db.characters.get(param(req, 'id')), 'Character')
  return saveCharacter({ ...sanitizeCharacter({ ...(req.body as object), id: prev.id }, prev), id: prev.id })
}))
app.delete('/api/characters/:id', route((req) => {
  const id = param(req, 'id')
  if (db.reels.all().some((r) => r.characterIds.includes(id))) throw new HttpError(409, 'This character is in a reel. Remove them from the reel first.')
  for (const c of db.casts.all()) if (c.characterIds.includes(id)) db.casts.put({ ...c, characterIds: c.characterIds.filter((x) => x !== id) })
  return { ok: db.characters.remove(id) }
}))

app.get('/api/casts', route(() => db.casts.all()))
app.post('/api/casts', route((req) => {
  const ids = charactersByIds(req.body?.characterIds).map((c) => c.id)
  if (!ids.length) throw new HttpError(400, 'Pick at least one character')
  const cast: Cast = { id: newId('cast'), name: str(req.body?.name, 40) || 'My cast', description: str(req.body?.description, 120), characterIds: ids }
  return db.casts.put(cast)
}))
app.delete('/api/casts/:id', route((req) => ({ ok: db.casts.remove(param(req, 'id')) })))

// ---------- Stories ----------
/** Stories are kept on the reel they were written for, newest custom ones first. */
function keepStories(reelId: string | undefined, add: Story[], replaceRecommended: boolean) {
  const cur = reelId ? db.reels.get(reelId) : undefined
  if (!cur) return
  const old = (cur.storyOptions ?? []).filter((s) => !replaceRecommended || s.source === 'custom')
  saveReel({ ...cur, storyOptions: replaceRecommended ? [...old, ...add] : [...add, ...old].slice(0, 16) })
}

app.post('/api/stories/recommend', route((req) => {
  const reel = req.body?.reelId ? need(db.reels.get(str(req.body.reelId)), 'Reel') : undefined
  const product = need(db.products.get(reel?.productId ?? str(req.body?.productId)), 'Product')
  const cast = reel ? castOf(reel) : charactersByIds(req.body?.characterIds)
  const style = reel?.style ?? (STYLE_IDS.includes(req.body?.style) ? (req.body.style as StyleId) : getSettings().defaultStyle)
  return { job: startJob('stories', async (h) => {
    h.step(0.2, llmReady() ? 'Writing story ideas and scoring the hooks' : 'Picking stories from the library (no API key set)')
    const out = await recommendStories(product, cast, style)
    if (out.error) h.log(`Used the story library instead: ${out.error}`)
    keepStories(reel?.id, out.stories, true)
    return out
  }) }
}))
app.post('/api/stories/custom', route(async (req) => {
  const reel = req.body?.reelId ? need(db.reels.get(str(req.body.reelId)), 'Reel') : undefined
  const product = need(db.products.get(reel?.productId ?? str(req.body?.productId)), 'Product')
  const idea = str(req.body?.idea, 1200)
  if (idea.length < 8) throw new HttpError(400, 'Describe the story in a sentence or two')
  const out = await customStory(product, idea, reel ? castOf(reel) : charactersByIds(req.body?.characterIds))
  keepStories(reel?.id, [out.story], false)
  return out
}))

// ---------- Reels ----------
const requireReel = (req: Request) => need(db.reels.get(param(req, 'id')), 'Reel')
const pinVersions = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, db.characters.get(id)?.version ?? 1]))
/** A mix only stays on the reel while it matches the script, style and levels, so the preview never plays stale sound. */
const dropStaleMix = (reel: Reel): Reel => (reel.voice?.mixUrl && !mixIsCurrent(reel) ? { ...reel, voice: { ...reel.voice, mixUrl: undefined } } : reel)

app.get('/api/reels', route(() => [...db.reels.all()].reverse().map((r) => ({
  id: r.id, name: r.name, updatedAt: r.updatedAt, style: r.style, productId: r.productId,
  productName: db.products.get(r.productId)?.brief.name ?? '', hook: r.story?.hook ?? '', scenes: r.scenes.length,
  coverUrl: r.renders[0]?.coverUrl, mp4Url: r.renders[0]?.mp4Url,
}))))
app.post('/api/reels', route((req) => {
  const product = need(db.products.get(str(req.body?.productId)), 'Product')
  const ids = charactersByIds(req.body?.characterIds).map((c) => c.id)
  const settings = getSettings()
  const now = new Date().toISOString()
  const reel: Reel = {
    id: newId('reel'), name: str(req.body?.name, 80) || `${product.brief.name} reel`, createdAt: now, updatedAt: now, productId: product.id,
    characterIds: ids.length ? ids : db.casts.all()[0].characterIds.slice(0, 3), characterVersions: {},
    style: STYLE_IDS.includes(req.body?.style) ? req.body.style : settings.defaultStyle, scenes: [], settings: defaultReelSettings(settings), renders: [],
  }
  reel.characterVersions = pinVersions(reel.characterIds)
  return db.reels.put(reel)
}))
app.get('/api/reels/:id', route((req) => requireReel(req)))
app.get('/api/reels/:id/bundle', route((req) => bundleFor(requireReel(req))))
app.delete('/api/reels/:id', route((req) => ({ ok: db.reels.remove(param(req, 'id')) })))

app.patch('/api/reels/:id', route((req) => {
  const reel = requireReel(req)
  const b = (req.body ?? {}) as Partial<Reel> & { settings?: Partial<ReelSettings> }
  const next: Reel = { ...reel }
  if (typeof b.name === 'string' && b.name.trim()) next.name = str(b.name, 80)
  if (b.style && STYLE_IDS.includes(b.style)) next.style = b.style
  if (Array.isArray(b.characterIds)) {
    const ids = charactersByIds(b.characterIds).map((c) => c.id)
    if (ids.length) {
      // Re-cast written scenes: each old character's part goes to the new one in the same seat.
      const swap = new Map(reel.characterIds.map((old, i) => [old, ids[i % ids.length]]))
      next.scenes = reel.scenes.map((s) => {
        const seen = new Set<string>()
        const actors = s.actors
          .map((a) => ({ ...a, characterId: swap.get(a.characterId) ?? a.characterId }))
          .filter((a) => ids.includes(a.characterId) && !seen.has(a.characterId) && !!seen.add(a.characterId))
        return { ...s, actors, fix: undefined }
      })
      next.characterIds = ids
      next.characterVersions = pinVersions(ids)
    }
  }
  if (b.story !== undefined) next.story = b.story as Story
  if (b.settings) {
    const s = b.settings
    const level = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
    next.settings = {
      voiceId: str(s.voiceId, 120) || reel.settings.voiceId,
      music: (['auto', 'upbeat', 'curious', 'chill', 'none'] as const).includes(s.music as ReelSettings['music']) ? (s.music as ReelSettings['music']) : reel.settings.music,
      musicLevel: level(s.musicLevel, reel.settings.musicLevel), sfxLevel: level(s.sfxLevel, reel.settings.sfxLevel),
      captions: typeof s.captions === 'boolean' ? s.captions : reel.settings.captions, captionAccent: reel.settings.captionAccent,
    }
  }
  if (Array.isArray(b.scenes)) {
    // The editor can reword, reorder and remove scenes. Staging changes go through the scene-edit
    // endpoint, which re-validates them, so everything else on a scene is kept as stored.
    const byId = new Map(next.scenes.map((s) => [s.id, s]))
    const scenes: SceneSpec[] = []
    for (const patch of b.scenes as Partial<SceneSpec>[]) {
      const cur = byId.get(String(patch?.id))
      if (!cur || scenes.includes(cur)) continue
      const line = typeof patch.line === 'string' ? patch.line.replace(/\s+/g, ' ').trim().slice(0, 400) : cur.line
      if (!line) continue
      const emphasis = Array.isArray(patch.emphasis) ? patch.emphasis.map((w) => str(w, 30)).filter(Boolean).slice(0, 4) : cur.emphasis
      scenes.push(line === cur.line && emphasis === cur.emphasis ? cur : { ...cur, line, emphasis })
    }
    if (scenes.length) next.scenes = scenes
  }
  return saveReel(dropStaleMix(next))
}))

app.post('/api/reels/:id/script', route((req) => {
  const reel = requireReel(req)
  const story = (req.body?.story as Story | undefined) ?? reel.story
  if (!story) throw new HttpError(400, 'Pick a story first')
  const product = need(db.products.get(reel.productId), 'Product')
  const seconds = [20, 30, 38].includes(req.body?.seconds) ? (req.body.seconds as number) : getSettings().reelSeconds
  return { job: startJob('script', async (h) => {
    h.step(0.2, llmReady() ? 'Writing the script and staging the scenes' : 'Building the script from the story template (no API key set)')
    const out = await writeScript(story, product, castOf(reel), reel.style, seconds)
    if (out.error) h.log(`Fell back to the template script: ${out.error}`)
    const cur = need(db.reels.get(reel.id), 'Reel')
    const saved = saveReel({ ...cur, story, seconds, scenes: out.scenes, scriptWrittenBy: out.writtenBy, voice: undefined, characterVersions: pinVersions(cur.characterIds) })
    return { reel: saved, writtenBy: out.writtenBy, error: out.error }
  }) }
}))

app.post('/api/reels/:id/scenes/:sceneId/edit', route(async (req) => {
  const reel = requireReel(req)
  const scene = need(reel.scenes.find((s) => s.id === param(req, 'sceneId')), 'Scene')
  const instruction = str(req.body?.instruction, 600)
  if (!instruction) throw new HttpError(400, 'Say what to change')
  const product = need(db.products.get(reel.productId), 'Product')
  const out = await editScene(scene, instruction, product, castOf(reel))
  const cur = need(db.reels.get(reel.id), 'Reel')
  const beforePhoto = out.scene.product?.pageId === scene.product?.pageId ? scene.beforePhoto : undefined
  const saved = saveReel(dropStaleMix({ ...cur, scenes: cur.scenes.map((s) => (s.id === scene.id ? { ...out.scene, id: scene.id, beforePhoto, fix: undefined } : s)) }))
  return { reel: saved, note: out.note }
}))

/** Shows one of the uploaded site photos in a scene, or takes it out again with no pageId. */
app.post('/api/reels/:id/scenes/:sceneId/photo', route((req) => {
  const reel = requireReel(req)
  const scene = need(reel.scenes.find((s) => s.id === param(req, 'sceneId')), 'Scene')
  const product = need(db.products.get(reel.productId), 'Product')
  const pageId = str(req.body?.pageId, 80)
  let next: SceneSpec
  if (!pageId) next = withoutPhoto(scene)
  else {
    const page = need(product.footage.find((p) => p.id === pageId && p.uploaded), 'Photo')
    const tall = page.pageHeight > page.viewport.h * 1.35
    const asked = req.body?.move
    const move: ProductShot['move'] = asked === 'hero' || asked === 'zoom' || (asked === 'scroll' && tall) ? asked : tall ? 'scroll' : 'zoom'
    next = {
      ...scene, kind: 'product', fix: undefined,
      beforePhoto: scene.beforePhoto ?? { kind: scene.kind, product: scene.product },
      product: { device: page.device, move, pageId: page.id, regionId: move === 'zoom' && !tall ? page.regions[0]?.id : undefined, callout: str(req.body?.callout, 34) || undefined },
    }
  }
  const cur = need(db.reels.get(reel.id), 'Reel')
  return saveReel(dropStaleMix({ ...cur, scenes: cur.scenes.map((s) => (s.id === scene.id ? next : s)) }))
}))

app.post('/api/reels/:id/voice', route((req) => {
  const reel = requireReel(req)
  if (!reel.scenes.length) throw new HttpError(400, 'Write the script first')
  return { job: startJob('voice', async (h) => ensureAudio(reel.id, h)) }
}))

app.post('/api/reels/:id/renders', route((req) => {
  const reel = requireReel(req)
  if (!reel.scenes.length) throw new HttpError(400, 'Write the script first')
  const asked: unknown[] = Array.isArray(req.body?.presets) ? req.body.presets : ['reel']
  const presets = (Object.keys(PRESETS) as Preset[]).filter((p) => asked.includes(p))
  return { job: startJob('render', async (h) => ({ renders: await renderReel(reel.id, presets, h), reel: db.reels.get(reel.id) })) }
}))

app.get('/api/jobs/:id', route((req) => need(getJob(param(req, 'id')), 'Job')))

app.use('/api', (_req, res) => { res.status(404).json({ error: 'No such endpoint' }) })

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500
  const message = err instanceof Error ? err.message : String(err)
  if (status >= 500) console.error(err)
  if (!res.headersSent) res.status(status).json({ error: message.split('\n')[0] })
})

export default app
