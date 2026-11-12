// The shared prop set and burned-in captions. Every prop takes `t`, the frames since it
// appeared, and is tagged with data-qc so the QC stage can measure where it landed.
import { H, SAFE_TOP, W, type PropSpec } from '../../shared/types.ts'
import { STAMP_IMPACT, type CaptionChunk } from '../../shared/timeline.ts'
import { clamp, darken, easeOut, easeOutBack, lerp, lighten, luminance, mix, n1, poly, prog, rad, readableOn, rnd, rr, wobble } from './math.ts'
import { fitText, Ln, measure, Sh, Tx, usePaint, type StyleDef } from './style.tsx'

export interface Box { cx: number; cy: number; maxW: number; maxH: number }

/** Where a prop slot sits on screen. The top band is clear sky/wall; centre sits over the bodies. */
export function slotBox(slot: PropSpec['slot'], dy = 0): Box {
  switch (slot) {
    case 'left': return { cx: 292, cy: 420 + dy, maxW: 450, maxH: 250 }
    case 'right': return { cx: 788, cy: 420 + dy, maxW: 450, maxH: 250 }
    case 'center': return { cx: 540, cy: 1090 + dy, maxW: 900, maxH: 360 }
    default: return { cx: 540, cy: 420 + dy, maxW: 920, maxH: 260 }
  }
}

/** An accent colour that stays readable against the style's caption stroke. */
export function accentFor(style: StyleDef, accent: string): string {
  const lightText = luminance(style.caption.fill) > 0.5
  let c = accent
  for (let i = 0; i < 6; i++) {
    const l = luminance(c)
    if (lightText && l < 0.32) c = lighten(c, 0.25)
    else if (!lightText && l > 0.34) c = darken(c, 0.2)
    else break
  }
  return c
}

const toneColor = (tone: PropSpec['tone'], accent: string, ink: string) =>
  tone === 'bad' ? '#E11D48' : tone === 'good' ? '#16A34A' : tone === 'accent' ? accent : ink

// ---------- Speech bubble ----------
export interface BubbleProps {
  text: string
  /** Screen position of the speaker's head. */
  head: { x: number; y: number; r: number }
  bounds: [number, number]
  t: number
  dy?: number
  scale?: number
  sceneId: string
}

export function Bubble({ text, head, bounds, t, dy = 0, scale = 1, sceneId }: BubbleProps) {
  const { style } = usePaint()
  if (t < 0) return null
  const family = style.fonts.display
  const base = (style.id === 'stick' ? 66 : style.id === 'paper' ? 56 : 58) * scale
  const maxW = Math.min(500, bounds[1] - bounds[0] - 70)
  const { size, lines } = fitText(text, family, base, maxW, 3)
  const lh = size * 1.12
  const w = Math.max(170, Math.max(...lines.map((l) => measure(l, family, size))) + 76)
  const h = lines.length * lh + 50
  const cx = clamp(head.x, bounds[0] + w / 2, bounds[1] - w / 2)
  let bottom = head.y - head.r - 46 + dy
  let top = bottom - h
  if (top < SAFE_TOP + 8) {
    top = SAFE_TOP + 8
    bottom = top + h
  }
  const tx = clamp(head.x, cx - w / 2 + 56, cx + w / 2 - 56)
  const tipX = lerp(tx, head.x, 0.5)
  const tail = poly([[tx - 26, bottom - 8], [tx + 26, bottom - 8], [tipX, bottom + 38]])
  const s = easeOutBack(prog(t, 0, 7))
  return (
    <g data-qc="bubble" data-scene={sceneId} transform={`translate(${n1(tipX)} ${n1(bottom + 38)}) scale(${n1(s * 100) / 100}) translate(${n1(-tipX)} ${n1(-(bottom + 38))})`}>
      <Sh d={`${rr(cx - w / 2, top, w, h, style.bubble.radius)} ${tail}`} fill={style.bubble.fill} raw union />
      {lines.map((l, i) => (
        <Tx key={i} x={cx} y={top + 25 + lh * (i + 0.8)} size={size} fill={style.bubble.text}>{l}</Tx>
      ))}
    </g>
  )
}

// ---------- Props ----------
interface PropProps {
  prop: PropSpec
  box: Box
  /** Frames since the prop appeared. */
  t: number
  sceneId: string
}

function Stamp({ prop, box, t, sceneId }: PropProps) {
  const { style, brand } = usePaint()
  const color = toneColor(prop.tone === 'plain' ? 'bad' : prop.tone, brand.accent, style.ink)
  const text = (prop.text ?? 'APPROVED').toUpperCase()
  const family = style.fonts.display
  const { size, lines } = fitText(text, family, 112, Math.min(box.maxW, 760) - 90, 2)
  const w = Math.max(...lines.map((l) => measure(l, family, size))) + 96
  const h = lines.length * size * 1.05 + 62
  const slam = prog(t, 0, STAMP_IMPACT)
  const after = prog(t, STAMP_IMPACT, 14)
  const s = t < STAMP_IMPACT ? lerp(2.9, 1, slam * slam) : 1 + wobble(after, 2) * 0.08
  const ring = prog(t, STAMP_IMPACT, 10)
  return (
    <g data-qc="stamp" data-scene={sceneId} transform={`translate(${box.cx} ${box.cy}) rotate(-9) scale(${n1(s * 100) / 100})`} opacity={clamp(slam * 1.6)}>
      {t >= STAMP_IMPACT && ring < 1 && <path d={rr(-w / 2 - ring * 60, -h / 2 - ring * 60, w + ring * 120, h + ring * 120, 30)} fill="none" stroke={color} strokeWidth={8 * (1 - ring)} opacity={1 - ring} />}
      <path d={rr(-w / 2, -h / 2, w, h, 20)} fill={style.id === 'line' ? style.paper : '#ffffff'} opacity={0.9} />
      <path d={rr(-w / 2, -h / 2, w, h, 20)} fill="none" stroke={color} strokeWidth={12} />
      <path d={rr(-w / 2 + 16, -h / 2 + 16, w - 32, h - 32, 10)} fill="none" stroke={color} strokeWidth={4} />
      {lines.map((l, i) => (
        <Tx key={i} x={0} y={-h / 2 + 31 + size * 1.05 * (i + 0.82)} size={size} fill={color} spacing={2}>{l}</Tx>
      ))}
    </g>
  )
}

function Sign({ prop, box, t, sceneId }: PropProps) {
  const { style, brand } = usePaint()
  const family = style.fonts.display
  const { size, lines } = fitText(prop.text ?? '', family, 76, box.maxW - 110, 2)
  const w = Math.max(240, Math.max(...lines.map((l) => measure(l, family, size))) + 90)
  const h = Math.min(box.maxH - 30, lines.length * size * 1.1 + 60)
  const drop = easeOutBack(prog(t, 0, 10), 1.3)
  const swing = wobble(prog(t, 2, 40), 2) * 7
  const fill = prop.tone === 'accent' ? brand.accent : prop.tone === 'bad' ? '#FECACA' : prop.tone === 'good' ? '#BBF7D0' : '#FDE68A'
  const top = box.cy - h / 2
  return (
    <g data-qc="sign" data-scene={sceneId} transform={`translate(0 ${n1((drop - 1) * (top + h + 80))}) rotate(${n1(swing)} ${box.cx} -100)`}>
      <Ln d={`M ${n1(box.cx - w * 0.32)} -40 L ${n1(box.cx - w * 0.32)} ${n1(top + 8)} M ${n1(box.cx + w * 0.32)} -40 L ${n1(box.cx + w * 0.32)} ${n1(top + 8)}`} sw={7} />
      <Sh d={rr(box.cx - w / 2, top, w, h, 16)} fill={fill} pop />
      {lines.map((l, i) => (
        <Tx key={i} x={box.cx} y={top + (h - lines.length * size * 1.1) / 2 + size * 1.1 * (i + 0.8)} size={size} fill={style.id === 'line' || style.id === 'stick' ? style.ink : readableOn(fill, style.ink)}>{l}</Tx>
      ))}
    </g>
  )
}

function Screen({ prop, box, t, sceneId }: PropProps) {
  const { style, brand } = usePaint()
  const family = style.fonts.display
  const w = Math.min(box.maxW, 860)
  const h = Math.min(box.maxH, 250)
  const { size, lines } = fitText((prop.text ?? '').toUpperCase(), family, 84, w - 90, 2)
  const on = prog(t, 0, 5)
  const flicker = t < 9 && t % 3 === 1 ? 0.55 : 1
  const glow = prop.tone === 'bad' ? '#FF6B81' : prop.tone === 'good' ? '#6EE7A8' : prop.tone === 'accent' ? lighten(brand.accent, 0.35) : '#FDF6C8'
  const top = box.cy - h / 2
  return (
    <g data-qc="screen" data-scene={sceneId} transform={`translate(0 ${n1((easeOut(on) - 1) * 60)})`} opacity={on}>
      <Sh d={rr(box.cx - w / 2, top, w, h, 22)} fill="#1E293B" pop />
      <path d={rr(box.cx - w / 2 + 18, top + 18, w - 36, h - 36, 10)} fill="#0B1220" />
      <g opacity={flicker}>
        {lines.map((l, i) => (
          <Tx key={i} x={box.cx} y={top + (h - lines.length * size * 1.08) / 2 + size * 1.08 * (i + 0.82)} size={size} fill={glow}>{l}</Tx>
        ))}
      </g>
    </g>
  )
}

function Device({ prop, box, t, sceneId, kind }: PropProps & { kind: 'phone' | 'laptop' }) {
  const { style, brand } = usePaint()
  const pop = easeOutBack(prog(t, 0, 9), 1.4)
  const family = style.fonts.body
  if (kind === 'phone') {
    const h = Math.min(box.maxH + 120, 470)
    const w = h * 0.52
    const { size, lines } = fitText(prop.text ?? '', family, 40, w - 70, 4, 700)
    const bh = lines.length * size * 1.15 + 34
    const tint = prop.tone === 'bad' ? '#FECACA' : prop.tone === 'good' ? '#BBF7D0' : '#ffffff'
    return (
      <g data-qc="device" data-scene={sceneId} transform={`translate(${box.cx} ${box.cy}) rotate(${n1(-6 + wobble(prog(t, 0, 30), 2) * 5)}) scale(${n1(pop * 100) / 100})`}>
        <Sh d={rr(-w / 2, -h / 2, w, h, 34)} fill="#111827" pop />
        <path d={rr(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 24)} fill={lighten(brand.primary, 0.7)} />
        <path d={rr(-36, -h / 2 + 20, 72, 14, 7)} fill="#111827" />
        <path d={rr(-w / 2 + 24, -bh / 2, w - 48, bh, 16)} fill={tint} />
        {lines.map((l, i) => (
          <Tx key={i} x={0} y={-bh / 2 + 17 + size * 1.15 * (i + 0.8)} size={size} font="body" fill="#111827" weight={700}>{l}</Tx>
        ))}
      </g>
    )
  }
  const w = Math.min(box.maxW, 640)
  const h = Math.min(box.maxH, 330)
  const { size, lines } = fitText(prop.text ?? '', family, 50, w - 110, 3, 700)
  return (
    <g data-qc="device" data-scene={sceneId} transform={`translate(${box.cx} ${box.cy}) scale(${n1(pop * 100) / 100})`}>
      <Sh d={rr(-w / 2, -h / 2, w, h - 30, 16)} fill="#334155" pop />
      <path d={rr(-w / 2 + 16, -h / 2 + 16, w - 32, h - 62, 8)} fill="#ffffff" />
      <Sh d={rr(-w / 2 - 44, h / 2 - 32, w + 88, 30, 12)} fill="#94A3B8" pop />
      {lines.map((l, i) => (
        <Tx key={i} x={0} y={-h / 2 + 16 + (h - 62 - lines.length * size * 1.15) / 2 + size * 1.15 * (i + 0.8)} size={size} font="body" fill={toneColor(prop.tone, darken(brand.accent, 0.15), '#111827')} weight={700}>{l}</Tx>
      ))}
    </g>
  )
}

function Card({ prop, box, t, sceneId }: PropProps) {
  const { style, brand } = usePaint()
  const family = style.fonts.display
  const w = Math.min(box.maxW, 780)
  const { size, lines } = fitText(prop.text ?? '', family, 72, w - 100, 3)
  const h = Math.min(box.maxH, lines.length * size * 1.12 + 78)
  const pop = easeOutBack(prog(t, 0, 9), 1.5)
  const band = toneColor(prop.tone === 'plain' ? 'accent' : prop.tone, brand.accent, style.ink)
  return (
    <g data-qc="card" data-scene={sceneId} transform={`translate(${box.cx} ${box.cy}) rotate(${n1(-3 + wobble(prog(t, 0, 24), 1.5) * 4)}) scale(${n1(pop * 100) / 100})`}>
      <Sh d={rr(-w / 2, -h / 2, w, h, 18)} fill="#ffffff" raw />
      <path d={rr(-w / 2, -h / 2, 26, h, 0)} fill={band} />
      {lines.map((l, i) => (
        <Tx key={i} x={13} y={-h / 2 + (h - lines.length * size * 1.12) / 2 + size * 1.12 * (i + 0.8)} size={size} fill={style.ink}>{l}</Tx>
      ))}
    </g>
  )
}

const CONFETTI = ['#FFD84D', '#FF6B6B', '#34D399', '#60A5FA', '#ffffff']
export function Confetti({ t, seed = 1 }: { t: number; seed?: number }) {
  const { brand } = usePaint()
  if (t < 0) return null
  const colors = [brand.primary, brand.accent, ...CONFETTI]
  return (
    <g>
      {Array.from({ length: 64 }).map((_, i) => {
        const speed = 13 + rnd(i, seed) * 15
        const delay = rnd(i, seed + 1) * 26
        const life = (H + 200) / speed
        const local = (t - delay) % (life + 10)
        if (t < delay) return null
        const x = rnd(i, seed + 2) * W + Math.sin((t + i * 9) * 0.09) * 36
        const y = -80 + local * speed
        const w = 16 + rnd(i, seed + 3) * 16
        return <rect key={i} x={-w / 2} y={-w * 0.3} width={w} height={w * 0.6} rx={3} fill={colors[i % colors.length]} transform={`translate(${n1(x)} ${n1(y)}) rotate(${n1((t * (6 + rnd(i, seed + 4) * 10) + i * 40) % 360)})`} />
      })}
    </g>
  )
}

/** A starburst behind the subject. Drawn in the world layer, before the actors. */
export function Burst({ t, cx, cy, tone }: { t: number; cx: number; cy: number; tone: PropSpec['tone'] }) {
  const { style, brand } = usePaint()
  if (t < 0) return null
  const s = easeOutBack(prog(t, 0, 8), 1.6)
  const base = tone === 'bad' ? '#FF5A5F' : tone === 'good' ? '#34D399' : tone === 'plain' ? '#FFD84D' : brand.accent
  const pts: [number, number][] = []
  for (let i = 0; i < 32; i++) {
    const a = rad(i * 11.25 + t * 0.5)
    const r = i % 2 === 0 ? 620 : 420
    pts.push([cx + Math.cos(a) * r * s, cy + Math.sin(a) * r * s])
  }
  return (
    <g>
      <Sh d={poly(pts)} fill={style.id === 'line' ? mix(style.paper, base, 0.5) : lighten(base, 0.25)} raw />
    </g>
  )
}

const STARS: [number, number, number][] = [[170, 620, 1], [900, 560, 0.8], [260, 980, 0.7], [860, 940, 1.1], [540, 500, 0.9], [120, 1180, 0.8], [960, 1200, 0.7]]
export function Sparkle({ t }: { t: number }) {
  const { style } = usePaint()
  if (t < 0) return null
  return (
    <g>
      {STARS.map(([x, y, k], i) => {
        const s = clamp(prog(t, i * 2, 6)) * k * (0.75 + 0.35 * Math.sin((t + i * 7) * 0.32))
        const r = 46 * s
        const d = `M ${x} ${n1(y - r)} Q ${n1(x + r * 0.16)} ${n1(y - r * 0.16)} ${n1(x + r)} ${y} Q ${n1(x + r * 0.16)} ${n1(y + r * 0.16)} ${x} ${n1(y + r)} Q ${n1(x - r * 0.16)} ${n1(y + r * 0.16)} ${n1(x - r)} ${y} Q ${n1(x - r * 0.16)} ${n1(y - r * 0.16)} ${x} ${n1(y - r)} Z`
        return <path key={i} d={d} fill="#FFE66D" stroke={style.id === 'paper' ? 'none' : style.ink} strokeWidth={style.id === 'cartoon' ? 5 : 3.5} strokeLinejoin="round" />
      })}
    </g>
  )
}

function Title({ prop, box, t, sceneId }: PropProps) {
  const { style, brand } = usePaint()
  const upper = style.id === 'cartoon' || style.id === 'line'
  const text = upper ? (prop.text ?? '').toUpperCase() : prop.text ?? ''
  const family = style.fonts.display
  const { size, lines } = fitText(text, family, 124, box.maxW, 2)
  const lh = size * 1.06
  const top = box.cy - (lines.length * lh) / 2
  const accent = accentFor(style, toneColor(prop.tone === 'plain' ? 'accent' : prop.tone, brand.accent, style.ink))
  let wi = 0
  return (
    <g data-qc="title" data-scene={sceneId}>
      {lines.map((line, li) => {
        const words = line.split(' ')
        const total = measure(line, family, size)
        const space = measure(' ', family, size)
        let x = box.cx - total / 2
        return words.map((word, k) => {
          const ww = measure(word, family, size)
          const index = wi++
          const s = easeOutBack(prog(t, index * 2, 6), 2.2)
          const cx = x + ww / 2
          const cy = top + lh * (li + 0.8)
          x += ww + space
          if (s <= 0) return null
          return (
            <g key={`${li}-${k}`} transform={`translate(${n1(cx)} ${n1(cy - size * 0.3)}) scale(${n1(s * 100) / 100}) translate(${n1(-cx)} ${n1(-(cy - size * 0.3))})`}>
              <Tx x={cx} y={cy} size={size} font="display" fill={li === lines.length - 1 && k === words.length - 1 ? accent : style.caption.fill} stroke={style.caption.stroke} strokeW={Math.max(14, size * 0.17)}>{word}</Tx>
            </g>
          )
        })
      })}
    </g>
  )
}

export function PropView(p: PropProps) {
  if (p.t < 0) return null
  switch (p.prop.kind) {
    case 'stamp': return <Stamp {...p} />
    case 'sign': return <Sign {...p} />
    case 'screen': return <Screen {...p} />
    case 'phone': return <Device {...p} kind="phone" />
    case 'laptop': return <Device {...p} kind="laptop" />
    case 'card': return <Card {...p} />
    case 'title': return <Title {...p} />
    case 'confetti': return <Confetti t={p.t} />
    case 'sparkle': return <Sparkle t={p.t} />
    default: return null
  }
}

// ---------- Captions ----------
export const CAPTION_Y = 1452

export function Captions({ chunk, f }: { chunk: CaptionChunk | undefined; f: number }) {
  const { style, brand } = usePaint()
  if (!chunk) return null
  const cap = style.caption
  const family = style.fonts.caption
  const words = chunk.words.map((w) => ({ ...w, text: cap.upper ? w.text.toUpperCase() : w.text }))
  const line = words.map((w) => w.text).join(' ')
  let size = cap.size
  const full = measure(line, family, size)
  if (full > 940) size *= 940 / full
  const space = measure(' ', family, size)
  const total = measure(line, family, size)
  const accent = accentFor(style, brand.accent)
  let x = W / 2 - total / 2
  const cy = CAPTION_Y - size * 0.32
  // The whole chunk pops in together; the word being spoken is lit and gives a small kick.
  const appear = 0.82 + 0.18 * easeOutBack(prog(f - chunk.start, 0, 5), 2)
  let active = 0
  words.forEach((w, i) => { if (f >= w.start) active = i })
  return (
    <g data-qc="caption" transform={`translate(${W / 2} ${n1(cy)}) scale(${n1(appear * 100) / 100}) translate(${-W / 2} ${n1(-cy)})`}>
      {words.map((w, i) => {
        const ww = measure(w.text, family, size)
        const cx = x + ww / 2
        x += ww + space
        const age = f - w.start
        const lit = i === active || (w.accent && age >= 0)
        const s = i === active && words.length > 1 ? 1 + 0.1 * (1 - easeOut(prog(age, 0, 7))) : 1
        return (
          <g key={i} transform={s !== 1 ? `translate(${n1(cx)} ${n1(cy)}) scale(${n1(s * 100) / 100}) translate(${n1(-cx)} ${n1(-cy)})` : undefined}>
            <Tx x={cx} y={CAPTION_Y} size={size} font="caption" fill={lit ? accent : cap.fill} stroke={cap.stroke} strokeW={cap.strokeW * (size / cap.size)}>{w.text}</Tx>
          </g>
        )
      })}
    </g>
  )
}