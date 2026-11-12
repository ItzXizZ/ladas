// The product section: real captured footage of the user's site inside a styled device frame,
// with scroll, push-in zooms, a zoom ring and a callout, presented by the cast. Shared by all
// styles; the frame, pill and ring are inked by the active style.
import { H, W, type ActorSpec, type CharacterRecord, type FootagePage, type Product, type Region, type SceneSpec } from '../../shared/types.ts'
import { Character } from './Character.tsx'
import { circ, clamp, darken, easeInOut, easeOut, easeOutBack, lerp, lighten, luminance, mix, n1, prog, readableOn, rr, saturation } from './math.ts'
import { Confetti, PropView, slotBox } from './Props.tsx'
import { actorFrame, type SceneCtx } from './Scene.tsx'
import { fitText, measure, Sh, tone, Tx, usePaint, type StyleDef } from './style.tsx'

export function backdropColor(style: StyleDef, primary: string): string {
  // Near-white or near-black brands still need a backdrop the site window stands out against.
  const base = saturation(primary) < 0.12 && luminance(primary) > 0.8 ? '#DCE7F5' : primary
  if (style.id === 'line') return style.paper
  if (style.id === 'stick') return lighten(base, 0.45)
  if (style.id === 'paper') return tone(style, base, 'bg')
  return base
}

function Backdrop({ f }: { f: number }) {
  const { style, brand } = usePaint()
  const bg = backdropColor(style, brand.primary)
  const light = luminance(bg) > 0.5
  const blob = light ? darken(bg, 0.06) : lighten(bg, 0.1)
  return (
    <>
      <path d={rr(-20, -20, W + 40, H + 40)} fill={bg} />
      <path d={circ(140 + Math.sin(f * 0.012) * 30, 300, 420)} fill={blob} />
      <path d={circ(980 + Math.cos(f * 0.01) * 30, 1500, 520)} fill={blob} />
      {style.id === 'line' && <path d={circ(900, 380, 210)} fill={mix(style.paper, brand.primary, 0.35)} />}
    </>
  )
}

export function pickPage(product: Product, shot: NonNullable<SceneSpec['product']>): FootagePage | undefined {
  const pages = product.footage
  return (
    pages.find((p) => p.id === shot.pageId) ??
    pages.find((p) => p.device === shot.device && (!shot.regionId || p.regions.some((r) => r.id === shot.regionId))) ??
    pages.find((p) => p.device === shot.device) ??
    pages[0]
  )
}

const hostOf = (scene: SceneSpec, characters: Map<string, CharacterRecord>): CharacterRecord[] => {
  const ids = scene.actors.map((a) => a.characterId)
  const list = (ids.length ? ids : [...characters.keys()]).map((id) => characters.get(id)).filter((r): r is CharacterRecord => !!r)
  return list
}

function Callout({ text, t, sceneId }: { text: string; t: number; sceneId: string }) {
  const { style, brand } = usePaint()
  if (t < 0 || !text) return null
  const family = style.fonts.display
  const { size, lines } = fitText(text, family, 66, 860, 2)
  const w = Math.max(...lines.map((l) => measure(l, family, size))) + 84
  const h = lines.length * size * 1.1 + 46
  const s = easeOutBack(prog(t, 0, 8), 1.7)
  const fill = brand.accent
  const cy = 286 + h / 2
  return (
    <g data-qc="callout" data-scene={sceneId} transform={`translate(${W / 2} ${n1(cy)}) scale(${n1(s * 100) / 100}) translate(${-W / 2} ${n1(-cy)})`}>
      <Sh d={rr(W / 2 - w / 2, 286, w, h, style.id === 'line' ? 8 : h / 2 > 60 ? 44 : h / 2)} fill={fill} raw pop />
      {lines.map((l, i) => (
        <Tx key={i} x={W / 2} y={286 + 23 + size * 1.1 * (i + 0.8)} size={size} fill={style.id === 'line' ? style.ink : readableOn(fill, style.ink)}>{l}</Tx>
      ))}
    </g>
  )
}

/** The fallback when a site could not be captured: a clean product card instead of footage. */
function NoFootage({ product, callout }: { product: Product; callout?: string }) {
  const { style, brand } = usePaint()
  const family = style.fonts.display
  const name = fitText(product.brief.name, family, 120, 760, 2)
  const text = fitText(callout || product.brief.pitch, style.fonts.body, 52, 740, 4, 700)
  return (
    <g>
      <Sh d={rr(110, 470, 860, 620, 40)} fill="#ffffff" raw />
      <path d={rr(110, 470, 860, 26, 0)} fill={brand.accent} />
      {name.lines.map((l, i) => <Tx key={i} x={W / 2} y={620 + name.size * 1.05 * i} size={name.size} fill={style.ink}>{l}</Tx>)}
      {text.lines.map((l, i) => <Tx key={i} x={W / 2} y={800 + text.size * 1.25 * i} size={text.size} font="body" fill="#334155" weight={700}>{l}</Tx>)}
    </g>
  )
}

interface DeviceGeom {
  /** Screen rect of the page viewport inside the device. */
  x: number
  y: number
  w: number
  h: number
  /** Screen px per CSS px. */
  k: number
}

function deviceGeom(page: FootagePage): DeviceGeom {
  if (page.device === 'mobile') {
    const h = 900
    const k = h / page.viewport.h
    const w = page.viewport.w * k
    return { x: W / 2 - w / 2, y: 420, w, h, k }
  }
  const w = 980
  const k = w / page.viewport.w
  return { x: 50, y: 500, w, h: page.viewport.h * k, k }
}

function DeviceFrame({ page, g, scrollY, domain, ring, ringT, uid }: { page: FootagePage; g: DeviceGeom; scrollY: number; domain: string; ring?: Region; ringT: number; uid: string }) {
  const { style, brand } = usePaint()
  const clipId = `${uid}-dev-${page.id}`
  const visible = page.tiles.filter((t) => t.y + t.h > scrollY - 40 && t.y < scrollY + page.viewport.h + 40)
  const mobile = page.device === 'mobile'
  const chrome = style.id === 'line' ? style.paper : style.id === 'paper' ? '#E9DCC3' : '#F1F5F9'
  const ringP = easeOut(prog(ringT, 0, 9))
  const pulse = 1 + Math.sin(Math.max(0, ringT) * 0.22) * 0.012
  const body = mobile ? rr(g.x - 20, g.y - 26, g.w + 40, g.h + 52, 58) : rr(g.x - 8, g.y - 70, g.w + 16, g.h + 78, 26)
  return (
    <g>
      <Sh d={body} fill={mobile ? '#111827' : chrome} raw sw={style.id === 'cartoon' ? 8 : undefined} />
      {!mobile && (
        <>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => <path key={c} d={circ(g.x + 30 + i * 34, g.y - 36, 11)} fill={style.id === 'line' ? style.ink : c} />)}
          <path d={rr(g.x + 150, g.y - 58, g.w - 300, 44, 22)} fill={style.id === 'line' ? mix(style.paper, style.ink, 0.08) : '#ffffff'} />
          <Tx x={g.x + g.w / 2} y={g.y - 25} size={27} font="body" fill="#475569" weight={700}>{domain}</Tx>
        </>
      )}
      <clipPath id={clipId}>
        <path d={rr(g.x, g.y, g.w, g.h, mobile ? 36 : 14)} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <path d={rr(g.x, g.y, g.w, g.h)} fill="#ffffff" />
        <g transform={`translate(${n1(g.x)} ${n1(g.y - scrollY * g.k)}) scale(${n1(g.k * 10000) / 10000})`}>
          {visible.map((t) => (
            <image key={t.url} href={t.url} x={0} y={t.y} width={page.viewport.w} height={t.h} preserveAspectRatio="none" />
          ))}
          {ring && ringT >= 0 && (
            <path
              d={rr(ring.rect.x - 10, ring.rect.y - 10, ring.rect.w + 20, ring.rect.h + 20, 16)}
              fill="none" stroke={brand.accent} strokeWidth={9 / g.k} strokeLinejoin="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1 - ringP}
              transform={`translate(${ring.rect.x + ring.rect.w / 2} ${ring.rect.y + ring.rect.h / 2}) scale(${n1(pulse * 1000) / 1000}) translate(${-(ring.rect.x + ring.rect.w / 2)} ${-(ring.rect.y + ring.rect.h / 2)})`}
            />
          )}
        </g>
      </g>
      {mobile && <path d={rr(W / 2 - 62, g.y - 12, 124, 24, 12)} fill="#111827" />}
    </g>
  )
}

export function ProductScene(c: SceneCtx & { product: Product; prevWasProduct: boolean }) {
  const { style } = usePaint()
  const { uid } = usePaint()
  const { scene, time, f, product } = c
  const shot = scene.product ?? { device: 'desktop' as const, move: 'hero' as const }
  const page = pickPage(product, shot)
  const local = f - time.start
  const domain = (() => {
    try { return new URL(product.url).hostname.replace(/^www\./, '') } catch { return product.url }
  })()

  // Presenters: the lead stands bottom-left; with a phone there is room for a second on the right.
  const hosts = hostOf(scene, c.characters)
  const mobile = page?.device === 'mobile'
  const presenters = hosts.slice(0, mobile ? 2 : 1).map((rec, i) => {
    const spec: ActorSpec = scene.actors.find((a) => a.characterId === rec.id) ?? {
      characterId: rec.id, slot: i === 0 ? 'left' : 'right', pose: 'raise', expression: 'grin', enter: 'none', outfit: 'default', holding: 'none', speaks: i === 0,
    }
    const placed: ActorSpec = { ...spec, slot: i === 0 ? 'left' : 'right', bubble: undefined, enter: c.prevWasProduct ? 'none' : 'pop' }
    const fr = actorFrame(placed, rec, { ...c, scene: { ...scene, actors: [placed, placed] } }, style, { x: i === 0 ? 150 : W - 150, ground: 1368, scale: 0.6 })
    return { rec, spec: placed, fr }
  })

  let content
  if (!page) {
    content = <NoFootage product={product} callout={shot.callout} />
  } else {
    const g = deviceGeom(page)
    const maxScroll = Math.max(0, page.pageHeight - page.viewport.h)
    const region = shot.regionId ? page.regions.find((r) => r.id === shot.regionId) : undefined
    let scrollY = 0
    let cam = { s: 1, cx: W / 2, cy: g.y + g.h / 2, tx: 0, ty: 0 }
    let ringT = -1
    if (shot.move === 'scroll') {
      // Scroll at a readable pace: about one viewport per second, never past the end of the page.
      const dist = Math.min(maxScroll, (time.duration / 30) * page.viewport.h * 1.05)
      scrollY = easeInOut(prog(local, 5, Math.max(10, time.duration - 12))) * dist
    } else if (shot.move === 'zoom' && region) {
      scrollY = clamp(region.rect.y + region.rect.h / 2 - page.viewport.h / 2, 0, maxScroll)
      const rw = region.rect.w * g.k
      const rh = region.rect.h * g.k
      const z = clamp(Math.min(900 / rw, 640 / rh), 1.12, page.scale / g.k)
      const p = easeInOut(prog(local, 5, 16))
      const rcx = g.x + (region.rect.x + region.rect.w / 2) * g.k
      const rcy = g.y + (region.rect.y - scrollY + region.rect.h / 2) * g.k
      // Push in on the region: it travels from where it sits to the middle of the frame.
      cam = { s: lerp(1, z, p), cx: rcx, cy: rcy, tx: lerp(0, W / 2 - rcx, p), ty: lerp(0, 830 - rcy, p) }
      ringT = local - 18
    } else if (shot.move === 'zoom') {
      cam = { s: lerp(1, 1.12, easeInOut(prog(local, 0, time.duration))), cx: W / 2, cy: g.y + g.h * 0.3, tx: 0, ty: 0 }
    } else {
      cam = { s: lerp(1, 1.05, easeInOut(prog(local, 0, time.duration))), cx: W / 2, cy: g.y + g.h / 2, tx: 0, ty: 0 }
    }
    const enter = c.prevWasProduct ? 1 : easeOutBack(prog(local, 0, 10), 1.2)
    content = (
      <g transform={`translate(0 ${n1((1 - enter) * 700)})`}>
        <g transform={`translate(${n1(cam.cx + cam.tx)} ${n1(cam.cy + cam.ty)}) scale(${n1(cam.s * 1000) / 1000}) translate(${n1(-cam.cx)} ${n1(-cam.cy)})`}>
          <DeviceFrame page={page} g={g} scrollY={scrollY} domain={domain} ring={region} ringT={ringT} uid={uid} />
        </g>
      </g>
    )
  }

  return (
    <g>
      <Backdrop f={f} />
      {content}
      {presenters.map(({ rec, spec, fr }) => (
        <g key={rec.id} data-qc="actor" data-scene={scene.id} transform={`translate(${n1(fr.x)} ${n1(fr.y)}) scale(${n1(fr.scale * 1000) / 1000})`} opacity={fr.opacity}>
          <Character rec={rec} pose={fr.pose} face={fr.face} outfit={spec.outfit} />
        </g>
      ))}
      <Callout text={shot.callout ?? ''} t={local - (shot.move === 'zoom' ? 20 : 8)} sceneId={scene.id} />
      {scene.props.filter((p) => p.kind === 'confetti' || p.kind === 'sparkle').map((p, i) => (
        <PropView key={i} prop={p} box={slotBox(p.slot)} t={local - Math.round(p.at * time.duration)} sceneId={scene.id} />
      ))}
    </g>
  )
}

export function CtaScene(c: SceneCtx & { product: Product }) {
  const { style, brand } = usePaint()
  const { scene, time, f, product } = c
  const local = f - time.start
  const family = style.fonts.display
  const name = fitText(product.brief.name, family, 132, 720, 2)
  const pitch = fitText(product.brief.pitch, style.fonts.body, 46, 720, 3, 700)
  const domain = (() => {
    try { return new URL(product.url).hostname.replace(/^www\./, '') } catch { return product.url }
  })()
  const logo = product.brand.logoUrl
  const logoH = logo ? 120 : 0
  const nameH = name.lines.length * name.size * 1.05
  const pitchH = pitch.lines.length * pitch.size * 1.25
  const cardH = 70 + logoH + (logo ? 26 : 0) + nameH + 22 + pitchH + 40 + 84 + 56
  const top = 330
  const pop = easeOutBack(prog(local, 0, 10), 1.4)
  let y = top + 70
  const pill = fitText(domain, family, 50, 560, 1)
  const pillW = measure(pill.lines[0], family, pill.size) + 90
  const cast = hostOf(scene, c.characters).slice(0, 3)
  const xs = cast.length === 1 ? [W / 2] : cast.length === 2 ? [330, 750] : [220, 540, 860]
  const ground = clamp(top + cardH + 462, 1290, 1362)
  const hostScale = 0.6 * Math.min(1, (ground - top - cardH) / 462)

  const logoY = y
  if (logo) y += logoH + 26
  const nameY = y
  y += nameH + 22
  const pitchY = y
  y += pitchH + 40
  const pillY = y

  return (
    <g>
      <Backdrop f={f} />
      <Confetti t={local - 6} seed={3} />
      <g data-qc="card" data-scene={scene.id} transform={`translate(${W / 2} ${top + cardH / 2}) scale(${n1(pop * 100) / 100}) translate(${-W / 2} ${-(top + cardH / 2)})`}>
        <Sh d={rr(110, top, 860, cardH, 46)} fill="#ffffff" raw />
        {logo && <image href={logo} x={W / 2 - 180} y={logoY} width={360} height={logoH} preserveAspectRatio="xMidYMid meet" />}
        {name.lines.map((l, i) => <Tx key={i} x={W / 2} y={nameY + name.size * 1.05 * (i + 0.82)} size={name.size} fill={style.ink}>{l}</Tx>)}
        {pitch.lines.map((l, i) => <Tx key={i} x={W / 2} y={pitchY + pitch.size * 1.25 * (i + 0.8)} size={pitch.size} font="body" fill="#475569" weight={700}>{l}</Tx>)}
        <Sh d={rr(W / 2 - pillW / 2, pillY, pillW, 84, style.id === 'line' ? 8 : 42)} fill={brand.accent} raw pop />
        <Tx x={W / 2} y={pillY + 42 + pill.size * 0.34} size={pill.size} fill={style.id === 'line' ? style.ink : readableOn(brand.accent, style.ink)}>{pill.lines[0]}</Tx>
      </g>
      {cast.map((rec, i) => {
        const spec: ActorSpec = { characterId: rec.id, slot: i === 0 ? 'left' : i === 1 && cast.length === 2 ? 'right' : i === 1 ? 'center' : 'right', pose: i === 1 && cast.length === 3 ? 'wave' : 'cheer', expression: i === 0 ? 'grin' : i === 1 ? 'proud' : 'happy', enter: 'pop', outfit: 'default', holding: 'none', speaks: i === 0 }
        const fr = actorFrame(spec, rec, { ...c, scene: { ...scene, actors: [spec, spec] } }, style, { x: xs[i], ground, scale: hostScale })
        return (
          <g key={rec.id} data-qc="actor" data-scene={scene.id} transform={`translate(${n1(fr.x)} ${n1(fr.y)}) scale(${n1(fr.scale * 1000) / 1000})`} opacity={fr.opacity}>
            <Character rec={rec} pose={fr.pose} face={fr.face} />
          </g>
        )
      })}
    </g>
  )
}
