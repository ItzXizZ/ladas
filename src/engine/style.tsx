// The style plug-in contract. A style is data (proportions, palette transform, fonts) plus a
// painter. Sets, props and characters are described once as shapes and the painter decides how
// each style inks them, so any scene spec renders in any style.
import { createContext, useContext, type ReactNode } from 'react'
import type { StyleId } from '../../shared/types.ts'
import { darken, desaturate, lighten, luminance, mix } from './math.ts'

export type Kind = 'bg' | 'obj'

export interface CharLook {
  headR: number
  legH: number
  torsoH: number
  shoulderW: number
  hipW: number
  limbW: number
  /** Stroke width around filled shapes. 0 means no outlines (paper). */
  outline: number
  /** tube: coloured thick limbs. line: single ink lines. */
  limb: 'tube' | 'line'
  /** shape: full torso. tunic: ink spine with a small coloured shirt (stick figures). */
  torso: 'shape' | 'tunic'
  eye: 'white' | 'dot'
}

export interface StyleDef {
  id: StyleId
  name: string
  tagline: string
  bestFor: string
  engine: string
  ink: string
  paper: string
  fonts: { display: string; body: string; caption: string }
  /** Characters and props animate every `step` frames. 1 is smooth; 2 gives a stop-motion feel. */
  step: number
  char: CharLook
  caption: { fill: string; stroke: string; strokeW: number; upper: boolean; size: number }
  bubble: { fill: string; text: string; radius: number }
  /** Paper grain laid over the whole frame. */
  grain: number
}

export const STYLES: Record<StyleId, StyleDef> = {
  cartoon: {
    id: 'cartoon', name: 'Bold Cartoon', tagline: 'Flat colour, thick outlines, big heads, speech bubbles',
    bestFor: 'Skits, "what if", relatable student or office comedy', engine: 'SVG rigs',
    ink: '#16130f', paper: '#FFF6E5',
    fonts: { display: 'Lilita One', body: 'Baloo 2', caption: 'Lilita One' },
    step: 1,
    char: { headR: 104, legH: 150, torsoH: 168, shoulderW: 136, hipW: 112, limbW: 34, outline: 7, limb: 'tube', torso: 'shape', eye: 'white' },
    caption: { fill: '#ffffff', stroke: '#16130f', strokeW: 18, upper: true, size: 92 },
    bubble: { fill: '#ffffff', text: '#16130f', radius: 44 },
    grain: 0,
  },
  stick: {
    id: 'stick', name: 'Stick Figure', tagline: 'Black stick people in a bright doodle world',
    bestFor: 'Fast explainers, lists, myth-busting', engine: 'SVG rigs',
    ink: '#111111', paper: '#FFFBEA',
    fonts: { display: 'Gochi Hand', body: 'Patrick Hand', caption: 'Gochi Hand' },
    step: 1,
    char: { headR: 62, legH: 190, torsoH: 170, shoulderW: 64, hipW: 36, limbW: 11, outline: 9, limb: 'line', torso: 'tunic', eye: 'dot' },
    caption: { fill: '#111111', stroke: '#ffffff', strokeW: 20, upper: false, size: 104 },
    bubble: { fill: '#ffffff', text: '#111111', radius: 30 },
    grain: 0,
  },
  paper: {
    id: 'paper', name: 'Paper Cut-out', tagline: 'Textured paper layers, hard shadows, documentary feel',
    bestFor: 'True stories, history, "the man who..."', engine: 'SVG rigs + paper grain',
    ink: '#2B2620', paper: '#EFE3CB',
    fonts: { display: 'DM Serif Display', body: 'DM Serif Display', caption: 'DM Serif Display' },
    step: 2,
    char: { headR: 90, legH: 166, torsoH: 176, shoulderW: 128, hipW: 108, limbW: 30, outline: 0, limb: 'tube', torso: 'shape', eye: 'dot' },
    caption: { fill: '#FFF8E7', stroke: '#2B2620', strokeW: 16, upper: false, size: 88 },
    bubble: { fill: '#FFF8E7', text: '#2B2620', radius: 14 },
    grain: 0.55,
  },
  line: {
    id: 'line', name: 'Kinetic Line Art', tagline: 'Minimal line drawings, offset colour, big animated type',
    bestFor: 'Stats, "this one number...", product comparisons', engine: 'SVG rigs + kinetic type',
    ink: '#141414', paper: '#F6F1E7',
    fonts: { display: 'Archivo Black', body: 'Space Grotesk', caption: 'Archivo Black' },
    step: 1,
    char: { headR: 66, legH: 205, torsoH: 186, shoulderW: 112, hipW: 84, limbW: 6, outline: 5, limb: 'line', torso: 'shape', eye: 'dot' },
    caption: { fill: '#141414', stroke: '#F6F1E7', strokeW: 18, upper: true, size: 84 },
    bubble: { fill: '#F6F1E7', text: '#141414', radius: 6 },
    grain: 0,
  },
}

export const STYLE_LIST = Object.values(STYLES)

/** How a style recolours a source colour. */
export function tone(style: StyleDef, c: string, k: Kind, pop = false): string {
  switch (style.id) {
    case 'cartoon':
      return c
    case 'stick':
      return k === 'bg' || pop ? c : lighten(c, 0.8)
    case 'paper':
      return mix(desaturate(c, k === 'bg' ? 0.3 : 0.2), '#E6D3AF', k === 'bg' ? 0.22 : 0.1)
    case 'line':
      return k === 'bg' ? mix(c, style.paper, 0.9) : pop ? mix(c, '#ffffff', 0.1) : style.paper
  }
}

export interface PaintCtx {
  style: StyleDef
  /** Brand colours of the product the reel is for. */
  brand: { primary: string; accent: string }
  uid: string
}
const Ctx = createContext<PaintCtx>({ style: STYLES.cartoon, brand: { primary: '#3B82F6', accent: '#F59E0B' }, uid: 'r' })
export const PaintProvider = ({ value, children }: { value: PaintCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>
export const usePaint = () => useContext(Ctx)

interface ShProps {
  d: string
  fill: string
  k?: Kind
  /** Outline width override. */
  sw?: number
  /** A shape that keeps its colour in the low-colour styles. */
  pop?: boolean
  op?: number
  /** Use the fill exactly as given, skipping the style's palette transform. */
  raw?: boolean
  /** Subpaths are drawn as one merged silhouette (no inner outlines). */
  union?: boolean
}

/** A filled shape, inked the way the active style inks things. */
export function Sh({ d, fill, k = 'obj', sw, pop, op, raw, union }: ShProps) {
  const { style } = usePaint()
  const f = raw ? fill : tone(style, fill, k, pop)
  if (k === 'bg') return <path d={d} fill={f} opacity={op} />
  if (style.id === 'paper') {
    return (
      <g opacity={op}>
        <path d={d} fill="#1b130a" opacity={0.2} transform="translate(6 8)" />
        <path d={d} fill={f} />
      </g>
    )
  }
  const w = sw ?? (style.id === 'stick' ? 7 : style.id === 'line' ? 4.5 : style.char.outline)
  if (style.id === 'line') {
    const base = raw ? fill : style.paper
    return (
      <g opacity={op}>
        <path d={d} fill={base} stroke={style.ink} strokeWidth={w} strokeLinejoin="round" />
        {union && <path d={d} fill={base} />}
        {pop && <path d={d} fill={raw ? fill : f} transform="translate(9 9)" style={{ mixBlendMode: 'multiply' }} opacity={0.9} />}
      </g>
    )
  }
  return (
    <g opacity={op}>
      <path d={d} fill={f} stroke={w > 0 ? style.ink : 'none'} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" />
      {union && <path d={d} fill={f} />}
    </g>
  )
}

/** A detail line: creases, strings, whiskers of ink. */
export function Ln({ d, sw, color, op }: { d: string; sw?: number; color?: string; op?: number }) {
  const { style } = usePaint()
  const w = sw ?? (style.id === 'stick' ? 6 : style.id === 'line' ? 4 : style.id === 'paper' ? 5 : 6)
  return <path d={d} fill="none" stroke={color ?? style.ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={op ?? (style.id === 'paper' ? 0.75 : 1)} />
}

/** A limb: a thick stroked path with the style's outline or shadow. */
export function Tube({ d, color, w, raw }: { d: string; color: string; w: number; raw?: boolean }) {
  const { style } = usePaint()
  const c = raw ? color : tone(style, color, 'obj', true)
  const common = { d, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  if (style.id === 'paper') {
    return (
      <>
        <path {...common} stroke="#1b130a" strokeWidth={w} opacity={0.2} transform="translate(5 7)" />
        <path {...common} stroke={c} strokeWidth={w} />
      </>
    )
  }
  return (
    <>
      <path {...common} stroke={style.ink} strokeWidth={w + style.char.outline * 2} />
      <path {...common} stroke={c} strokeWidth={w} />
    </>
  )
}

interface TxProps {
  x: number
  y: number
  size: number
  children: ReactNode
  font?: 'display' | 'body' | 'caption'
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
  stroke?: string
  strokeW?: number
  weight?: number
  spacing?: number
  op?: number
}

/** Text with its stroke painted under the fill, so heavy outlines never thin the letters. */
export function Tx({ x, y, size, children, font = 'display', fill, anchor = 'middle', stroke, strokeW, weight, spacing, op }: TxProps) {
  const { style } = usePaint()
  return (
    <text
      x={x} y={y} fontFamily={`"${style.fonts[font]}", sans-serif`} fontSize={size} textAnchor={anchor}
      fill={fill ?? style.ink} stroke={stroke} strokeWidth={stroke ? strokeW ?? size * 0.16 : undefined}
      strokeLinejoin="round" paintOrder="stroke" fontWeight={weight ?? (font === 'body' ? 700 : 400)}
      letterSpacing={spacing} opacity={op}
    >
      {children}
    </text>
  )
}

// ---------- Text measuring (canvas, cached) ----------
let canvas: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()
export function measure(text: string, family: string, size: number, weight = 400): number {
  const key = `${family}|${weight}|${text}`
  let w = cache.get(key)
  if (w === undefined) {
    if (!canvas && typeof document !== 'undefined') canvas = document.createElement('canvas').getContext('2d')
    if (canvas) {
      canvas.font = `${weight} 100px "${family}", sans-serif`
      w = canvas.measureText(text).width / 100
    } else {
      w = text.length * 0.55
    }
    cache.set(key, w)
  }
  return w * size
}
/** Fonts arriving late change every measurement, so the cache is dropped once they are ready. */
export const resetMeasure = () => cache.clear()

export function wrapText(text: string, family: string, size: number, maxW: number, weight = 400): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && measure(next, family, size, weight) > maxW) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}

/** Largest font size (up to `size`) at which the text wraps into at most `maxLines` lines of `maxW`. */
export function fitText(text: string, family: string, size: number, maxW: number, maxLines: number, weight = 400): { size: number; lines: string[] } {
  let s = size
  for (let i = 0; i < 14; i++) {
    const lines = wrapText(text, family, s, maxW, weight)
    const widest = Math.max(...lines.map((l) => measure(l, family, s, weight)))
    if (lines.length <= maxLines && widest <= maxW) return { size: s, lines }
    s *= 0.9
  }
  return { size: s, lines: wrapText(text, family, s, maxW, weight) }
}

// ---------- Colour roles for characters ----------
export function skinFor(style: StyleDef, skin: string): string {
  if (style.id === 'stick') return '#ffffff'
  if (style.id === 'line') return style.paper
  if (style.id === 'paper') return tone(style, skin, 'obj')
  return skin
}
export function hairFor(style: StyleDef, hair: string): string {
  if (style.id === 'line') return luminance(hair) > 0.45 ? style.paper : style.ink
  if (style.id === 'paper') return tone(style, hair, 'obj')
  return hair
}
export const shade = (c: string, t = 0.16) => darken(c, t)
