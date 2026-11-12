// Product ingestion and the footage agent. One browser visit turns a URL into a Product Brief
// (what the story engine writes from) and a Footage Pack (what the pivot section is cut from).
//
// Safety rails: read-only. The agent never types, clicks, submits forms or signs up. It honours
// robots.txt, and overlays it hides for a clean shot are restored before the page is closed.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import type { BrandKit, Feature, FootagePage, Product, ProductBrief, Region } from '../shared/types.ts'
import { launchBrowser, NAME_SHIM } from './browser.ts'
import { ensureDir, fileUrl } from './env.ts'
import type { JobHandle } from './jobs.ts'
import { llmReady, structured, WRITER_RULES } from './llm.ts'
import { getSettings } from './store.ts'

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }
const MOBILE = {
  viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}
const MAX_VIEWPORTS = 9

interface SiteFacts {
  title: string
  description: string
  siteName: string
  themeColor: string
  headings: { tag: string; text: string; next: string }[]
  paragraphs: string[]
  ctas: string[]
  nav: { text: string; href: string }[]
  buttons: { color: string; area: number }[]
  linkColor: string
  bodyBg: string
  fonts: string[]
  logo: { kind: 'img' | 'svg' | 'icon' | 'none'; src?: string; bg?: string }
}

export function normalizeUrl(input: string): string {
  let u = input.trim()
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  const parsed = new URL(u)
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http and https sites can be captured')
  return parsed.toString()
}

/** Minimal robots.txt check for the `*` group. Missing or unreadable robots.txt means allowed. */
async function robotsAllows(url: string): Promise<(path: string) => boolean> {
  const allowAll = () => true
  try {
    const res = await fetch(new URL('/robots.txt', url), { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return allowAll
    const rules: { allow: boolean; path: string }[] = []
    let applies = false
    for (const raw of (await res.text()).split('\n')) {
      const line = raw.split('#')[0].trim()
      const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
      if (!m) continue
      const key = m[1].toLowerCase()
      const val = m[2].trim()
      if (key === 'user-agent') applies = val === '*'
      else if (applies && (key === 'disallow' || key === 'allow') && val) rules.push({ allow: key === 'allow', path: val })
    }
    return (path: string) => {
      let best: { allow: boolean; path: string } | null = null
      for (const r of rules) {
        const prefix = r.path.replace(/\*.*$/, '')
        if (path.startsWith(prefix) && (!best || prefix.length > best.path.length)) best = { allow: r.allow, path: prefix }
      }
      return best ? best.allow : true
    }
  } catch {
    return allowAll
  }
}

async function openPage(ctx: BrowserContext, url: string): Promise<Page> {
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 })
  await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {})
  return page
}

/** Reads everything the brief and brand kit are built from. Runs inside the page. */
function extractFacts(): SiteFacts {
  const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content')?.trim() ?? ''
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }
  const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).slice(0, 40).map((h) => {
    let next = h.nextElementSibling
    if (!next || txt(next).length < 20) next = h.parentElement?.querySelector('p') ?? null
    return { tag: h.tagName, text: txt(h).slice(0, 160), next: txt(next).slice(0, 320) }
  }).filter((h) => h.text.length > 2)
  const paragraphs = [...document.querySelectorAll('p,li')].filter(visible).map(txt).filter((t) => t.length >= 40 && t.length <= 420).slice(0, 50)
  const clickables = [...document.querySelectorAll('a,button,[role=button],input[type=submit]')].filter(visible)
  const buttons: { color: string; area: number }[] = []
  const ctas: string[] = []
  for (const el of clickables) {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s.backgroundColor)
    const alpha = m ? (m[4] === undefined ? 1 : Number(m[4])) : 0
    if (m && alpha > 0.6 && r.width < 600 && r.height < 120 && r.height > 20) {
      buttons.push({ color: `${m[1]},${m[2]},${m[3]}`, area: r.width * r.height })
      const t = txt(el)
      if (t.length > 1 && t.length < 40) ctas.push(t)
    }
  }
  const nav = [...document.querySelectorAll('header a[href], nav a[href]')].filter(visible).map((a) => ({ text: txt(a).slice(0, 40), href: (a as HTMLAnchorElement).href })).filter((a) => a.text.length > 1).slice(0, 40)

  // Logo: a header image, else an inline SVG (tagged for an element screenshot), else an icon link.
  const bgOf = (el: Element | null): string => {
    for (let cur = el; cur; cur = cur.parentElement) {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(cur).backgroundColor)
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return `${m[1]},${m[2]},${m[3]}`
    }
    return '255,255,255'
  }
  let logo: SiteFacts['logo'] = { kind: 'none' }
  const sized = (el: Element) => {
    const r = el.getBoundingClientRect()
    return visible(el) && r.width >= 16 && r.width <= 420 && r.height >= 12 && r.height <= 200 && r.top < 400
  }
  const img = [...document.querySelectorAll<HTMLImageElement>('header img, nav img, [class*="logo" i] img, img[class*="logo" i], img[alt*="logo" i], a[href="/"] img')].find(sized)
  const svg = [...document.querySelectorAll('header svg, nav svg, [class*="logo" i] svg, svg[class*="logo" i], a[href="/"] svg')].find(sized)
  if (img && (img.currentSrc || img.src)) logo = { kind: 'img', src: img.currentSrc || img.src, bg: bgOf(img) }
  else if (svg) {
    svg.setAttribute('data-rs-logo', '1')
    logo = { kind: 'svg', bg: bgOf(svg) }
  } else {
    // Sites with no header often open with their mark: the first small image above the headline.
    const mark = [...document.querySelectorAll('img, svg')].find((el) => {
      const r = el.getBoundingClientRect()
      return sized(el) && r.width >= 32 && r.width <= 220 && r.height >= 32 && r.width / r.height < 3.2 && r.top < 330
    })
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="apple-touch-icon"], link[rel~="icon"][type="image/svg+xml"], link[rel~="icon"][type="image/png"], link[rel~="icon"][href$=".png"], link[rel~="icon"][href$=".svg"]')
    if (mark instanceof HTMLImageElement && (mark.currentSrc || mark.src)) logo = { kind: 'img', src: mark.currentSrc || mark.src, bg: bgOf(mark) }
    else if (mark) {
      mark.setAttribute('data-rs-logo', '1')
      logo = { kind: 'svg', bg: bgOf(mark) }
    } else if (icon?.href) logo = { kind: 'icon', src: icon.href, bg: '255,255,255' }
  }
  const firstLink = document.querySelector('main a, p a, a')
  const rgb = (c: string) => (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c) ?? []).slice(1, 4).join(',')
  return {
    title: document.title.trim(),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
    themeColor: meta('meta[name="theme-color"]'),
    headings, paragraphs, ctas: [...new Set(ctas)].slice(0, 12), nav, buttons,
    linkColor: firstLink ? rgb(getComputedStyle(firstLink).color) : '',
    bodyBg: rgb(getComputedStyle(document.body).backgroundColor),
    fonts: [...new Set([getComputedStyle(document.body).fontFamily, getComputedStyle(document.querySelector('h1,h2') ?? document.body).fontFamily].map((f) => f.split(',')[0].replace(/["']/g, '').trim()))],
    logo,
  }
}

/** Hides cookie banners, chat widgets and pop-ups so they do not sit on the shot. Runs in the page. */
function hideOverlays(): number {
  const kw = /cookie|consent|gdpr|onetrust|cmp-|intercom|crisp|drift|hubspot-messages|chat|tawk|zendesk|launcher|popup|pop-up|modal|newsletter|subscribe|toast|tooltip|tour|announcement/i
  let n = 0
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const s = getComputedStyle(el)
    if (s.position !== 'fixed' && s.position !== 'sticky') continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const label = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-label') ?? ''}`
    const topBar = r.top <= 4 && r.height < 170 && r.width > innerWidth * 0.6
    const navLike = el.tagName === 'HEADER' || el.tagName === 'NAV' || !!el.querySelector('nav')
    const big = r.width * r.height > innerWidth * innerHeight * 0.5
    const bottomStrip = r.bottom >= innerHeight - 4 && r.top > innerHeight * 0.45
    const corner = r.width < 440 && r.height < 440 && r.right > innerWidth - 60 && r.bottom > innerHeight - 60
    const hide = kw.test(label) ? !(topBar && navLike) : s.position === 'fixed' && !topBar && (bottomStrip || corner || (big && Number(s.zIndex) > 10))
    if (hide) {
      el.setAttribute('data-rs-hidden', el.style.getPropertyValue('visibility') || '-')
      el.style.setProperty('visibility', 'hidden', 'important')
      n++
    }
  }
  return n
}

function restoreOverlays(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-rs-hidden]')) {
    const prev = el.getAttribute('data-rs-hidden')
    if (prev && prev !== '-') el.style.setProperty('visibility', prev)
    else el.style.removeProperty('visibility')
    el.removeAttribute('data-rs-hidden')
  }
}

/** Finds the regions worth zooming into: hero, feature cards, headed sections, CTAs, media. Runs in the page. */
function findRegions(maxH: number): { kind: Region['kind']; label: string; rect: Region['rect'] }[] {
  const vw = innerWidth
  const out: { kind: Region['kind']; label: string; rect: Region['rect'] }[] = []
  const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const rectOf = (el: Element) => {
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.left + scrollX), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) }
  }
  const visible = (el: Element) => {
    const s = getComputedStyle(el)
    const b = el.getBoundingClientRect()
    return b.width > 4 && b.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.2
  }
  const iou = (a: Region['rect'], b: Region['rect']) => {
    const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
    const inter = x * y
    return inter / (a.w * a.h + b.w * b.h - inter || 1)
  }
  const push = (kind: Region['kind'], label: string, r: Region['rect']) => {
    if (r.w < 110 || r.h < 36 || r.x < -2 || r.x + r.w > vw + 2 || r.y < 0 || r.y + r.h > maxH) return
    if (out.some((o) => iou(o.rect, r) > 0.6)) return
    out.push({ kind, label: label.slice(0, 90), rect: r })
  }
  const container = (el: Element, minH: number, maxHh: number): Element => {
    let best: Element = el
    let cur = el.parentElement
    for (let i = 0; i < 5 && cur && cur !== document.body; i++, cur = cur.parentElement) {
      const r = rectOf(cur)
      if (r.h > maxHh) break
      if (r.h >= minH && r.w >= 220) {
        best = cur
        if (r.h >= 170) break
      }
    }
    return best
  }
  const h1 = [...document.querySelectorAll('h1')].find(visible)
  if (h1) push('hero', txt(h1), rectOf(container(h1, 200, 760)))
  for (const h of [...document.querySelectorAll('h2,h3')].filter(visible).slice(0, 40)) {
    const label = txt(h)
    if (label.length < 3) continue
    const r = rectOf(container(h, 110, 700))
    push(r.w < vw * 0.62 ? 'card' : 'heading', label, r)
  }
  for (const el of [...document.querySelectorAll('img,video,canvas')].filter(visible)) {
    const r = rectOf(el)
    if (r.w >= Math.min(400, vw * 0.7) && r.h >= 220 && r.h <= 760) push('media', el.getAttribute('alt') || 'Product screenshot', r)
  }
  for (const el of [...document.querySelectorAll('a,button')].filter(visible)) {
    const t = txt(el)
    if (/^(get started|try|start|sign up|join|download|book|buy|install|create|launch)/i.test(t) && t.length < 36) {
      const r = rectOf(el)
      push('cta', t, { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 24), w: Math.min(vw, r.w + 80), h: r.h + 48 })
    }
  }
  return out.slice(0, 28)
}

async function capturePage(ctx: BrowserContext, url: string, device: 'desktop' | 'mobile', productId: string, pageId: string): Promise<FootagePage> {
  const page = await openPage(ctx, url)
  try {
    const vp = page.viewportSize()!
    if (device === 'mobile') {
      // Some products only run on desktop and show phones a placeholder. That is not footage.
      const text = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500))
      if (text.length < 420 && /desktop|mac or pc|larger screen|computer|laptop/i.test(text) && /visit|use|open|switch|arriving soon|coming soon|not supported|unsupported|not available|engineered for|best (viewed|experienced)/i.test(text)) {
        throw new Error('The mobile site asks visitors to use a desktop, so only desktop footage is used')
      }
    }
    // Walk the page once so lazy images load and scroll-reveal animations have played.
    const fullH = await page.evaluate(() => document.documentElement.scrollHeight)
    const walkTo = Math.min(fullH, vp.height * (MAX_VIEWPORTS + 1))
    for (let y = 0; y < walkTo; y += Math.round(vp.height * 0.8)) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y)
      await page.waitForTimeout(140)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    const hidden = await page.evaluate(hideOverlays)
    const pageHeight = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), vp.height * MAX_VIEWPORTS)
    const dir = ensureDir('products', productId)
    const tiles: FootagePage['tiles'] = []
    for (let y = 0, i = 0; y < pageHeight; y += vp.height, i++) {
      const h = Math.min(vp.height, pageHeight - y)
      if (h < 8) break
      const name = `${pageId}-t${i}.jpg`
      await page.screenshot({ path: join(dir, name), type: 'jpeg', quality: 88, fullPage: true, clip: { x: 0, y, width: vp.width, height: h }, animations: 'disabled', caret: 'hide' })
      tiles.push({ y, h, url: fileUrl('products', productId, name) })
    }
    const found = await page.evaluate(findRegions, pageHeight)
    const title = await page.title()
    const dsf = device === 'mobile' ? MOBILE.deviceScaleFactor : DESKTOP.deviceScaleFactor
    await page.evaluate(restoreOverlays)
    return {
      id: pageId, url, title, device, viewport: { w: vp.width, h: vp.height }, scale: dsf, pageHeight, tiles, hiddenOverlays: hidden,
      regions: found.map((r, i) => ({ id: `${pageId}-r${i}`, ...r })),
    }
  } finally {
    await page.close()
  }
}

// ---------- Brand kit ----------
const hex = (rgb: string) => '#' + rgb.split(',').map((v) => Number(v).toString(16).padStart(2, '0')).join('')
function hsl(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(',').map((v) => Number(v) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, s, l]
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}
const hexToRgbStr = (h: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(',') : ''
}

function brandFrom(facts: SiteFacts): Pick<BrandKit, 'primary' | 'accent' | 'ink' | 'fonts'> {
  const score = new Map<string, number>()
  for (const b of facts.buttons) {
    const [, s, l] = hsl(b.color)
    if (s < 0.25 || l < 0.12 || l > 0.9) continue
    score.set(b.color, (score.get(b.color) ?? 0) + Math.sqrt(b.area) * (0.5 + s))
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const theme = hexToRgbStr(facts.themeColor)
  const candidates = [...ranked, theme, facts.linkColor].filter((c) => c && hsl(c)[1] >= 0.25 && hsl(c)[2] > 0.12 && hsl(c)[2] < 0.9)
  const primaryRgb = candidates[0]
  if (!primaryRgb) return { primary: '#4F46E5', accent: '#F59E0B', ink: '#16130f', fonts: facts.fonts }
  const [h, s, l] = hsl(primaryRgb)
  const second = candidates.find((c) => {
    const d = Math.abs(hsl(c)[0] - h)
    return Math.min(d, 360 - d) > 40
  })
  // No second brand colour on the site: derive a warm or cool counterpart that pops beside the primary.
  const accent = second ? hex(second) : fromHsl((h + (h > 180 && h < 330 ? 190 : 160)) % 360, Math.max(0.75, s), 0.55)
  return { primary: fromHsl(h, s, Math.min(0.62, Math.max(0.32, l))), accent, ink: '#16130f', fonts: facts.fonts }
}

async function saveLogo(page: Page, facts: SiteFacts, productId: string): Promise<string | undefined> {
  const dir = ensureDir('products', productId)
  try {
    if (facts.logo.kind === 'svg') {
      const el = page.locator('[data-rs-logo]').first()
      await el.screenshot({ path: join(dir, 'logo.png'), omitBackground: true, scale: 'device' })
      return fileUrl('products', productId, 'logo.png')
    }
    if ((facts.logo.kind === 'img' || facts.logo.kind === 'icon') && facts.logo.src) {
      if (facts.logo.src.startsWith('data:')) {
        const m = /^data:image\/(png|jpeg|svg\+xml|webp|gif);base64,(.+)$/.exec(facts.logo.src)
        if (!m) return undefined
        const ext = m[1] === 'svg+xml' ? 'svg' : m[1] === 'jpeg' ? 'jpg' : m[1]
        writeFileSync(join(dir, `logo.${ext}`), Buffer.from(m[2], 'base64'))
        return fileUrl('products', productId, `logo.${ext}`)
      }
      const res = await fetch(facts.logo.src, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return undefined
      const type = res.headers.get('content-type') ?? ''
      const ext = /svg/.test(type) ? 'svg' : /png/.test(type) ? 'png' : /jpe?g/.test(type) ? 'jpg' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : ''
      if (!ext) return undefined
      writeFileSync(join(dir, `logo.${ext}`), Buffer.from(await res.arrayBuffer()))
      return fileUrl('products', productId, `logo.${ext}`)
    }
  } catch {
    // A missing logo is not worth failing ingestion for; the CTA card falls back to the name.
  }
  return undefined
}

// ---------- Product Brief ----------
const BRIEF_TOOL = {
  name: 'save_product_brief',
  description: 'Save the structured Product Brief extracted from the website.',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Product or brand name as the site writes it' },
      pitch: { type: 'string', description: 'One-line pitch, at most 14 words, plain language' },
      category: { type: 'string' },
      audience: { type: 'string', description: 'Who it is for, one phrase' },
      pricePoint: { type: 'string', description: 'Public price point, or empty string if not stated' },
      features: {
        type: 'array', minItems: 1, maxItems: 5,
        items: { type: 'object', properties: { name: { type: 'string' }, benefit: { type: 'string', description: 'What the user gets, one short sentence' }, where: { type: 'string', description: 'Heading text on the site where this feature is shown' } }, required: ['name', 'benefit', 'where'] },
      },
      tone: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'Tone words from the site copy' },
      claims: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Claims the site itself makes, quoted closely' },
    },
    required: ['name', 'pitch', 'category', 'audience', 'pricePoint', 'features', 'tone', 'claims'],
  },
}

function heuristicBrief(facts: SiteFacts, url: string): ProductBrief {
  const host = new URL(url).hostname.replace(/^www\./, '')
  const fromTitle = facts.title.split(/\s[|\-–—:·]\s/)[0].trim()
  const name = facts.siteName || (fromTitle.length > 1 && fromTitle.length <= 28 ? fromTitle : host.split('.')[0].replace(/^./, (c) => c.toUpperCase()))
  const h1 = facts.headings.find((h) => h.tag === 'H1')?.text ?? ''
  const firstSentence = (facts.description || h1 || facts.paragraphs[0] || `${name} at ${host}`).split(/(?<=[.!?])\s/)[0]
  const pitch = firstSentence.split(/\s+/).slice(0, 16).join(' ')
  const features: Feature[] = facts.headings
    .filter((h) => h.tag !== 'H1' && h.text.length >= 4 && h.text.length <= 70 && h.next.length >= 20)
    .slice(0, 4)
    .map((h) => ({ name: h.text, benefit: h.next.split(/(?<=[.!?])\s/)[0].slice(0, 140), where: h.text }))
  while (features.length < 3 && facts.paragraphs[features.length]) {
    const p = facts.paragraphs[features.length]
    features.push({ name: p.split(/\s+/).slice(0, 4).join(' '), benefit: p.split(/(?<=[.!?])\s/)[0].slice(0, 140) })
  }
  return {
    name, pitch, category: 'Not detected', audience: 'Not detected, please edit', features,
    tone: ['clear', 'friendly'], claims: [facts.description, h1].filter((c) => c.length > 8).slice(0, 3), notes: '',
  }
}

async function writeBrief(facts: SiteFacts, url: string): Promise<{ brief: ProductBrief; source: Product['briefSource']; error?: string }> {
  if (llmReady()) {
    try {
      const b = await structured<Omit<ProductBrief, 'notes'>>({
        system: `You read a product website's extracted text and write a faithful Product Brief for an ad writer.\n${WRITER_RULES}\nOnly state what the site states. Leave pricePoint empty if no price is shown.\nThe pitch says plainly what the product is and does, in the site's own terms, in 16 words or fewer. It is shown on screen in the ad, so write it as a line a viewer would read: no hedges such as "described as" or "claims to be", and no superlatives the site does not use itself.\nIf the site says little, write fewer features rather than padding: every feature must be something the site actually shows or says.`,
        prompt: `URL: ${url}\n\nExtracted site content (JSON):\n${JSON.stringify({ title: facts.title, description: facts.description, siteName: facts.siteName, headings: facts.headings.slice(0, 30), paragraphs: facts.paragraphs.slice(0, 30), buttons: facts.ctas, nav: facts.nav.map((n) => n.text).slice(0, 20) }).slice(0, 14000)}`,
        tool: BRIEF_TOOL,
        maxTokens: 1500,
      })
      return {
        source: 'llm',
        brief: {
          name: String(b.name ?? '').trim() || heuristicBrief(facts, url).name,
          pitch: String(b.pitch ?? '').trim(), category: String(b.category ?? '').trim(), audience: String(b.audience ?? '').trim(),
          pricePoint: String(b.pricePoint ?? '').trim() || undefined,
          features: (Array.isArray(b.features) ? b.features : []).slice(0, 5).map((f) => ({ name: String(f.name ?? ''), benefit: String(f.benefit ?? ''), where: f.where ? String(f.where) : undefined })).filter((f) => f.name),
          tone: (Array.isArray(b.tone) ? b.tone : []).map(String).slice(0, 4),
          claims: (Array.isArray(b.claims) ? b.claims : []).map(String).slice(0, 8),
          notes: '',
        },
      }
    } catch (e) {
      return { brief: heuristicBrief(facts, url), source: 'heuristic', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { brief: heuristicBrief(facts, url), source: 'heuristic' }
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3))
/** Labels each clip region with the feature it shows, so the scene compiler can place zooms and callouts. */
export function linkFeatures(brief: ProductBrief, pages: FootagePage[]): void {
  for (const page of pages) for (const r of page.regions) delete r.feature
  for (const f of brief.features) {
    const want = words(`${f.name} ${f.where ?? ''}`)
    for (const page of pages) {
      let best: Region | null = null
      let bestScore = 0
      for (const r of page.regions) {
        if (r.kind === 'cta' || r.feature) continue
        const have = words(r.label)
        let s = 0
        for (const w of want) if (have.has(w)) s++
        if ((f.where && r.label.toLowerCase() === f.where.toLowerCase()) || r.label.toLowerCase() === f.name.toLowerCase()) s += 5
        if (s > bestScore) { bestScore = s; best = r }
      }
      if (best && bestScore >= 1) best.feature = f.name
    }
  }
}

export async function ingestProduct(product: Product, h: JobHandle): Promise<Product> {
  const url = normalizeUrl(product.url)
  const settings = getSettings()
  h.step(0.03, 'Checking robots.txt')
  const allowed = await robotsAllows(url)
  if (!allowed(new URL(url).pathname)) throw new Error(`robots.txt on ${new URL(url).hostname} disallows this page, so it was not captured`)

  h.step(0.08, 'Opening the site in a browser')
  const browser = await launchBrowser()
  try {
    const desktop = await browser.newContext(DESKTOP)
    await desktop.addInitScript({ content: NAME_SHIM })
    const home = await openPage(desktop, url)
    const facts = await home.evaluate(extractFacts)
    const brand: BrandKit = { ...brandFrom(facts), logoUrl: await saveLogo(home, facts, product.id) }
    await home.close()

    const footage: FootagePage[] = []
    h.step(0.25, 'Capturing the home page at 2x')
    footage.push(await capturePage(desktop, url, 'desktop', product.id, 'd0'))

    // Extra pages: same-origin nav links that look like they show features.
    const origin = new URL(url).origin
    const seen = new Set([new URL(url).pathname.replace(/\/$/, '')])
    const extra = facts.nav
      .filter((n) => {
        try {
          const u = new URL(n.href)
          const path = u.pathname.replace(/\/$/, '')
          if (u.origin !== origin || seen.has(path) || !allowed(u.pathname)) return false
          if (/log.?in|sign.?(in|up)|register|account|cart|checkout|privacy|terms|legal|blog|careers|contact/i.test(n.text + ' ' + path)) return false
          seen.add(path)
          return true
        } catch { return false }
      })
      .sort((a, b) => Number(/feature|product|how|pricing|solution|demo|use/i.test(b.text + b.href)) - Number(/feature|product|how|pricing|solution|demo|use/i.test(a.text + a.href)))
      .slice(0, Math.max(0, settings.capturePages - 1))
    for (const [i, link] of extra.entries()) {
      h.step(0.35 + (0.2 * i) / Math.max(1, extra.length), `Capturing ${link.text}`)
      try {
        footage.push(await capturePage(desktop, link.href, 'desktop', product.id, `d${i + 1}`))
      } catch (e) {
        h.log(`Skipped ${link.href}: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
      }
    }
    await desktop.close()

    h.step(0.6, 'Capturing the mobile site at 3x')
    try {
      const mobile = await browser.newContext(MOBILE)
      await mobile.addInitScript({ content: NAME_SHIM })
      footage.push(await capturePage(mobile, url, 'mobile', product.id, 'm0'))
      await mobile.close()
    } catch (e) {
      h.log(`No mobile footage: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    }

    h.step(0.78, llmReady() ? 'Writing the Product Brief' : 'Drafting a basic Product Brief (no API key set)')
    const { brief, source, error } = await writeBrief(facts, url)
    if (error) h.log(`Brief fell back to the basic draft: ${error}`)
    linkFeatures(brief, footage)
    const overlays = footage.reduce((n, p) => n + p.hiddenOverlays, 0)
    h.step(0.98, `Captured ${footage.length} pages, ${footage.reduce((n, p) => n + p.regions.length, 0)} regions, hid ${overlays} overlays`)
    return { ...product, url, status: 'ready', error: undefined, brief, brand, footage: [...footage, ...product.footage.filter((p) => p.uploaded)], briefSource: source }
  } finally {
    await browser.close()
  }
}
