// Pure helpers. Every animation in the engine is a function of the frame number, so a frame
// renders identically in the live preview and in the final render.

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Progress 0..1 of frame f through [start, start+len]. */
export const prog = (f: number, start: number, len: number) => clamp((f - start) / Math.max(1, len))
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeIn = (t: number) => t * t * t
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** Overshoots then settles: the "pop". */
export const easeOutBack = (t: number, k = 1.9) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2)
/** Damped bounce that settles on 0, for impacts. */
export const wobble = (t: number, cycles = 2.5) => Math.sin(t * Math.PI * 2 * cycles) * Math.pow(1 - clamp(t), 2)

/** Deterministic pseudo-random 0..1 from integers. */
export function rnd(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return ((h >>> 0) % 100000) / 100000
}

export const rad = (deg: number) => (deg * Math.PI) / 180
export const n1 = (v: number) => Math.round(v * 10) / 10

// ---------- Colour ----------
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [128, 128, 128]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t))
}
export const darken = (c: string, t: number) => mix(c, '#000000', t)
export const lighten = (c: string, t: number) => mix(c, '#ffffff', t)
export function luminance(c: string): number {
  const [r, g, b] = hexToRgb(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function desaturate(c: string, t: number): string {
  const [r, g, b] = hexToRgb(c)
  const grey = 0.3 * r + 0.59 * g + 0.11 * b
  return rgbToHex(lerp(r, grey, t), lerp(g, grey, t), lerp(b, grey, t))
}
/** Black or white, whichever reads on the given background. */
export const readableOn = (bg: string, dark = '#16130f', light = '#ffffff') => (luminance(bg) > 0.42 ? dark : light)
export function saturation(c: string): number {
  const [r, g, b] = hexToRgb(c)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

// ---------- Path builders (no arc commands, so paths can be scaled numerically) ----------
const K = 0.5523
export function circ(cx: number, cy: number, r: number): string {
  return ell(cx, cy, r, r)
}
export function ell(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K
  const ky = ry * K
  return `M ${n1(cx - rx)} ${n1(cy)} C ${n1(cx - rx)} ${n1(cy - ky)} ${n1(cx - kx)} ${n1(cy - ry)} ${n1(cx)} ${n1(cy - ry)} C ${n1(cx + kx)} ${n1(cy - ry)} ${n1(cx + rx)} ${n1(cy - ky)} ${n1(cx + rx)} ${n1(cy)} C ${n1(cx + rx)} ${n1(cy + ky)} ${n1(cx + kx)} ${n1(cy + ry)} ${n1(cx)} ${n1(cy + ry)} C ${n1(cx - kx)} ${n1(cy + ry)} ${n1(cx - rx)} ${n1(cy + ky)} ${n1(cx - rx)} ${n1(cy)} Z`
}
export function rr(x: number, y: number, w: number, h: number, r = 0): string {
  const q = Math.min(r, w / 2, h / 2)
  if (q <= 0) return `M ${n1(x)} ${n1(y)} L ${n1(x + w)} ${n1(y)} L ${n1(x + w)} ${n1(y + h)} L ${n1(x)} ${n1(y + h)} Z`
  return `M ${n1(x + q)} ${n1(y)} L ${n1(x + w - q)} ${n1(y)} Q ${n1(x + w)} ${n1(y)} ${n1(x + w)} ${n1(y + q)} L ${n1(x + w)} ${n1(y + h - q)} Q ${n1(x + w)} ${n1(y + h)} ${n1(x + w - q)} ${n1(y + h)} L ${n1(x + q)} ${n1(y + h)} Q ${n1(x)} ${n1(y + h)} ${n1(x)} ${n1(y + h - q)} L ${n1(x)} ${n1(y + q)} Q ${n1(x)} ${n1(y)} ${n1(x + q)} ${n1(y)} Z`
}
export const poly = (pts: [number, number][]) => 'M ' + pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join(' L ') + ' Z'
/** Trapezoid with rounded corners: top edge half-width tw at y1, bottom half-width bw at y2. */
export function trap(cx: number, y1: number, tw: number, y2: number, bw: number, r = 14): string {
  return `M ${n1(cx - tw + r)} ${n1(y1)} L ${n1(cx + tw - r)} ${n1(y1)} Q ${n1(cx + tw)} ${n1(y1)} ${n1(cx + tw + (bw - tw) * 0.08)} ${n1(y1 + r)} L ${n1(cx + bw)} ${n1(y2 - r)} Q ${n1(cx + bw)} ${n1(y2)} ${n1(cx + bw - r)} ${n1(y2)} L ${n1(cx - bw + r)} ${n1(y2)} Q ${n1(cx - bw)} ${n1(y2)} ${n1(cx - bw)} ${n1(y2 - r)} L ${n1(cx - tw - (bw - tw) * 0.08)} ${n1(y1 + r)} Q ${n1(cx - tw)} ${n1(y1)} ${n1(cx - tw + r)} ${n1(y1)} Z`
}
/** Scales (and optionally mirrors/offsets) a path made of M/L/C/Q/Z commands. */
export function xf(d: string, s: number, ox = 0, oy = 0, flip = 1): string {
  let isX = true
  return d.replace(/-?\d*\.?\d+/g, (m) => {
    const v = parseFloat(m)
    const out = isX ? v * s * flip + ox : v * s + oy
    isX = !isX
    return String(n1(out))
  })
}
