// drawCharacter(record, pose, expression, mouth): one component, driven by the style's CharLook,
// so the same record is recognisable in every style: same hair silhouette, colours, glasses, build.
import type { CharacterRecord, HairStyle, Held, Outfit } from '../../shared/types.ts'
import { circ, darken, ell, lighten, n1, poly, rr, trap, xf } from './math.ts'
import { computeRig, FACE, type FaceState, type PoseState, type Pt } from './rig.ts'
import { hairFor, Ln, Sh, shade, skinFor, Tube, usePaint } from './style.tsx'

// Hair silhouettes in head units (head radius 1, centre 0,0, up is negative y).
const CAP = 'M -1.08 -0.12 C -1.2 -0.85 -0.6 -1.3 0.05 -1.26 C 0.7 -1.26 1.22 -0.8 1.08 -0.1 C 0.98 -0.42 0.78 -0.66 0.45 -0.7 C 0.05 -0.6 -0.5 -0.62 -0.8 -0.5 C -0.95 -0.4 -1.02 -0.28 -1.08 -0.12 Z'
const FRINGE = 'M -1.1 -0.1 C -1.2 -0.8 -0.65 -1.28 0 -1.25 C 0.65 -1.28 1.2 -0.8 1.1 -0.1 C 0.95 -0.45 0.75 -0.6 0.5 -0.66 C 0.1 -0.42 -0.5 -0.45 -0.8 -0.62 C -0.95 -0.45 -1.05 -0.3 -1.1 -0.1 Z'
const curls = (pts: [number, number, number][]) => pts.map(([x, y, r]) => ell(x, y, r, r)).join(' ')
const HAIR: Record<HairStyle, { back?: string; front?: string; union?: boolean; bare?: boolean; hairline?: string }> = {
  short: { front: CAP },
  messy: {
    front: 'M -1.1 -0.1 C -1.25 -0.5 -1.15 -0.9 -0.85 -1.08 L -0.95 -1.32 L -0.62 -1.2 L -0.5 -1.48 L -0.22 -1.26 L 0.02 -1.52 L 0.22 -1.26 L 0.52 -1.44 L 0.62 -1.18 L 0.98 -1.26 L 0.92 -0.98 C 1.2 -0.75 1.2 -0.4 1.1 -0.08 C 1 -0.35 0.9 -0.5 0.72 -0.62 L 0.6 -0.38 L 0.38 -0.66 L 0.2 -0.4 L -0.02 -0.68 L -0.25 -0.42 L -0.45 -0.68 L -0.68 -0.45 L -0.82 -0.6 C -0.95 -0.48 -1.04 -0.3 -1.1 -0.1 Z',
  },
  sidepart: {
    front: 'M -1.08 -0.05 C -1.22 -0.8 -0.7 -1.28 0 -1.24 C 0.75 -1.24 1.2 -0.78 1.08 -0.05 C 1 -0.35 0.9 -0.55 0.7 -0.72 C 0.2 -0.5 -0.35 -0.6 -0.62 -0.98 C -0.8 -0.7 -0.98 -0.4 -1.08 -0.05 Z',
  },
  spiky: {
    front: 'M -1.08 -0.1 C -1.15 -0.5 -1.05 -0.8 -0.9 -0.95 L -1 -1.4 L -0.6 -1.15 L -0.45 -1.6 L -0.15 -1.22 L 0.1 -1.68 L 0.3 -1.22 L 0.62 -1.55 L 0.68 -1.1 L 1.08 -1.3 L 0.95 -0.9 C 1.1 -0.7 1.15 -0.4 1.08 -0.1 C 0.95 -0.45 0.7 -0.7 0.3 -0.72 C -0.2 -0.74 -0.8 -0.6 -1.08 -0.1 Z',
  },
  buzz: { front: 'M -1.05 -0.2 C -1.1 -0.85 -0.55 -1.12 0 -1.1 C 0.55 -1.12 1.1 -0.85 1.05 -0.2 C 0.9 -0.6 0.5 -0.8 0 -0.8 C -0.5 -0.8 -0.9 -0.6 -1.05 -0.2 Z' },
  bald: {},
  bob: {
    back: 'M -1.2 -0.3 C -1.35 -1 -0.7 -1.4 0 -1.36 C 0.7 -1.4 1.35 -1 1.2 -0.3 C 1.3 0.2 1.28 0.6 1.1 0.92 L -1.1 0.92 C -1.28 0.6 -1.3 0.2 -1.2 -0.3 Z',
    front: FRINGE,
  },
  long: {
    back: 'M -1.22 -0.3 C -1.36 -1 -0.7 -1.42 0 -1.38 C 0.7 -1.42 1.36 -1 1.22 -0.3 C 1.3 0.5 1.42 1.2 1.25 1.8 L -1.25 1.8 C -1.42 1.2 -1.3 0.5 -1.22 -0.3 Z',
    front: 'M -1.1 -0.05 C -1.22 -0.8 -0.7 -1.28 0 -1.25 C 0.72 -1.25 1.2 -0.8 1.1 -0.05 C 1.02 -0.4 0.9 -0.6 0.72 -0.74 C 0.3 -0.45 -0.3 -0.55 -0.55 -0.95 C -0.8 -0.7 -1 -0.4 -1.1 -0.05 Z',
  },
  ponytail: {
    back: 'M 0.7 -0.8 C 1.5 -0.95 1.8 -0.2 1.58 0.5 C 1.48 0.88 1.2 1.08 1.04 0.96 C 1.26 0.5 1.24 0 0.84 -0.36 Z',
    front: CAP,
  },
  bun: { back: ell(0, -1.34, 0.42, 0.4), front: CAP },
  curly: {
    back: curls([[-1.1, 0.12, 0.34], [1.1, 0.12, 0.34], [-1.02, 0.5, 0.28], [1.02, 0.5, 0.28]]),
    front:
      'M -1.05 -0.2 C -1.1 -0.9 -0.5 -1.2 0 -1.2 C 0.5 -1.2 1.1 -0.9 1.05 -0.2 C 0.8 -0.62 0.4 -0.72 0 -0.72 C -0.4 -0.72 -0.8 -0.62 -1.05 -0.2 Z ' +
      curls([[-1.02, -0.36, 0.33], [-0.84, -0.84, 0.35], [-0.42, -1.16, 0.35], [0.08, -1.26, 0.35], [0.56, -1.1, 0.35], [0.9, -0.74, 0.35], [1.04, -0.3, 0.32], [-0.5, -0.72, 0.26], [0.02, -0.82, 0.27], [0.5, -0.7, 0.26]]),
    union: true,
  },
  afro: {
    back: ell(0, -0.36, 1.52, 1.44),
    front: 'M -1.07 -0.18 C -1 -0.72 -0.5 -0.94 0 -0.92 C 0.5 -0.94 1 -0.72 1.07 -0.18 C 1.25 -0.5 1.1 -1.1 0.6 -1.3 C 0.2 -1.42 -0.2 -1.42 -0.6 -1.3 C -1.1 -1.1 -1.25 -0.5 -1.07 -0.18 Z',
    bare: true,
    hairline: 'M -1.07 -0.18 C -1 -0.72 -0.5 -0.94 0 -0.92 C 0.5 -0.94 1 -0.72 1.07 -0.18',
  },
}

const mid = (a: Pt, b: Pt, t = 0.5): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const P = (p: Pt) => `${n1(p.x)} ${n1(p.y)}`

export interface CharacterProps {
  rec: CharacterRecord
  pose: PoseState
  face: FaceState
  outfit?: Outfit
  holding?: Held
}

export function Character({ rec, pose, face, outfit = 'default', holding = 'none' }: CharacterProps) {
  const { style } = usePaint()
  const L = style.char
  const over = rec.styleOverrides?.[style.id]
  const rig = computeRig(rec, L, pose)
  const R = rig.headR * (over?.headScale ?? 1)
  const sk = L.limbW / 34
  const fine = style.id === 'cartoon' || style.id === 'paper'
  const lineLimb = L.limb === 'line'
  const dir = pose.facing || 1

  const skin = skinFor(style, rec.body.skin)
  const hairC = hairFor(style, rec.hair.color)
  const top = outfit === 'gown' ? 'gown' : outfit === 'labcoat' ? 'labcoat' : outfit === 'suit' ? 'blazer' : rec.wardrobe.top
  const topColor = outfit === 'gown' ? '#27324A' : outfit === 'labcoat' || top === 'labcoat' ? '#F4F6FA' : outfit === 'suit' ? '#1F2937' : rec.wardrobe.topColor
  const accessory = outfit === 'gown' ? 'gradcap' : rec.wardrobe.accessory
  const accColor = outfit === 'gown' ? '#27324A' : rec.wardrobe.accessoryColor
  const shortSleeve = top === 'tee' || top === 'dress'
  const legColor = top === 'dress' ? rec.body.skin : rec.wardrobe.bottomColor
  const detail = shade(topColor, 0.2)
  const mouthDark = style.id === 'cartoon' ? '#4A1420' : style.ink

  const { hip, neck, head, shoulder, elbow, hand, hipJoint, foot } = rig
  const tw = rig.shoulderW / 2
  const bw = rig.hipW / 2
  const y1 = neck.y + 8
  const cx = (neck.x + hip.x) / 2

  // ----- limbs -----
  const arm = (i: 0 | 1) => {
    const path = `M ${P(shoulder[i])} L ${P(elbow[i])} L ${P(hand[i])}`
    if (lineLimb) {
      return (
        <g key={`arm${i}`}>
          <Ln d={path} sw={L.limbW} />
          {style.id === 'line' ? <Sh d={circ(hand[i].x, hand[i].y, 10)} fill={style.paper} raw sw={4} /> : <path d={circ(hand[i].x, hand[i].y, L.limbW * 0.78)} fill={style.ink} />}
        </g>
      )
    }
    const w = L.limbW * (top === 'gown' ? 1.22 : 1)
    return (
      <g key={`arm${i}`}>
        {shortSleeve ? (
          <>
            <Tube d={path} color={skin} w={w * 0.86} raw />
            <Tube d={`M ${P(shoulder[i])} L ${P(mid(shoulder[i], elbow[i], 0.6))}`} color={topColor} w={w * 1.06} />
          </>
        ) : (
          <Tube d={path} color={topColor} w={w} />
        )}
        <Sh d={circ(hand[i].x, hand[i].y, L.limbW * 0.6)} fill={skin} raw />
      </g>
    )
  }

  const legs = ([0, 1] as const).map((i) => {
    const path = `M ${P(hipJoint[i])} L ${P(foot[i])}`
    const shoeX = foot[i].x + dir * 12 * sk
    if (lineLimb) {
      return (
        <g key={`leg${i}`}>
          <Ln d={path} sw={L.limbW} />
          <Ln d={`M ${P(foot[i])} L ${n1(foot[i].x + dir * 26)} ${n1(foot[i].y)}`} sw={L.limbW} />
        </g>
      )
    }
    return (
      <g key={`leg${i}`}>
        <Tube d={path} color={legColor} w={L.limbW * 1.1} raw={top === 'dress'} />
        <Sh d={ell(shoeX, foot[i].y - 9 * sk, 31 * sk, 17 * sk)} fill={rec.wardrobe.shoeColor} pop />
      </g>
    )
  })

  // ----- torso -----
  let torso
  if (L.torso === 'tunic') {
    const long = top === 'gown' || top === 'labcoat' || top === 'dress'
    torso = (
      <>
        <Ln d={`M ${P(neck)} L ${P(hip)}`} sw={L.limbW} />
        <Sh d={trap(cx, neck.y + 20, 30, long ? hip.y + 46 : hip.y - 30, long ? 50 : 36, 10)} fill={topColor} pop />
      </>
    )
  } else {
    const coat = top === 'labcoat'
    const y2 = top === 'gown' ? hip.y + L.legH * 0.72 : coat ? hip.y + L.legH * 0.42 : top === 'dress' ? hip.y - 6 : hip.y + 16
    const bottomW = top === 'gown' ? bw * 1.5 : coat ? bw * 1.22 : bw
    torso = (
      <>
        {top === 'dress' && <Sh d={trap(cx, hip.y - 34, bw * 0.9, hip.y + L.legH * 0.52, bw * 1.62, 10)} fill={topColor} pop />}
        <Sh d={trap(cx, y1, tw, y2, bottomW, 16)} fill={topColor} pop />
        {fine && top === 'hoodie' && (
          <>
            <Sh d={rr(cx - 36, hip.y - 56, 72, 42, 14)} fill={detail} sw={style.id === 'cartoon' ? 5 : 0} />
            <Ln d={`M ${n1(neck.x - 13)} ${n1(y1 + 12)} L ${n1(neck.x - 15)} ${n1(y1 + 58)}`} sw={4} color={lighten(topColor, 0.55)} />
            <Ln d={`M ${n1(neck.x + 13)} ${n1(y1 + 12)} L ${n1(neck.x + 15)} ${n1(y1 + 58)}`} sw={4} color={lighten(topColor, 0.55)} />
          </>
        )}
        {(top === 'blazer' || coat) && (
          <>
            <Sh d={poly([[neck.x - tw * 0.5, y1], [neck.x, y1 + L.torsoH * 0.56], [neck.x + tw * 0.5, y1]])} fill={coat ? rec.wardrobe.topColor : '#F8FAFC'} sw={style.id === 'cartoon' ? 5 : undefined} pop={coat} />
            {fine && <path d={circ(cx, hip.y - 26, 5)} fill={style.ink} opacity={0.7} />}
          </>
        )}
        {fine && top === 'shirt' && (
          <>
            <Ln d={`M ${n1(neck.x)} ${n1(y1 + 22)} L ${n1(cx)} ${n1(hip.y + 8)}`} sw={3.5} op={0.5} />
            <Sh d={poly([[neck.x - 30, y1 - 2], [neck.x - 4, y1 + 26], [neck.x, y1 + 2]])} fill={topColor} sw={style.id === 'cartoon' ? 5 : 0} />
            <Sh d={poly([[neck.x + 30, y1 - 2], [neck.x + 4, y1 + 26], [neck.x, y1 + 2]])} fill={topColor} sw={style.id === 'cartoon' ? 5 : 0} />
          </>
        )}
        {fine && top === 'sweater' && <Sh d={rr(cx - bw + 2, hip.y - 4, bw * 2 - 4, 20, 8)} fill={detail} sw={style.id === 'cartoon' ? 5 : 0} />}
        {fine && top === 'dress' && <Sh d={rr(cx - bw * 0.92, hip.y - 40, bw * 1.84, 16, 6)} fill={detail} sw={0} />}
        {fine && top === 'gown' && <Ln d={`M ${n1(neck.x)} ${n1(y1 + 10)} L ${n1(cx)} ${n1(y2 - 8)}`} sw={4} op={0.45} />}
      </>
    )
  }

  const accessoryBody = () => {
    if (accessory === 'tie' && (top === 'shirt' || top === 'blazer') && L.torso === 'shape') {
      return <Sh d={poly([[neck.x - 9, y1 + 6], [neck.x + 9, y1 + 6], [neck.x + 6, y1 + 22], [neck.x + 14, y1 + 78], [neck.x, y1 + 96], [neck.x - 14, y1 + 78], [neck.x - 6, y1 + 22]])} fill={accColor} sw={style.id === 'cartoon' ? 5 : undefined} pop />
    }
    if (accessory === 'scarf') {
      const s = L.torso === 'tunic' ? 0.6 : 1
      return (
        <>
          <Sh d={rr(neck.x + 8 * s, neck.y + 10, 26 * s, 70 * s, 8)} fill={accColor} pop />
          <Sh d={rr(neck.x - 44 * s, neck.y - 8, 88 * s, 32 * s, 15)} fill={accColor} pop />
        </>
      )
    }
    if (accessory === 'backpack' && L.torso === 'shape') {
      return (
        <>
          <Sh d={poly([[neck.x - tw * 0.72, y1 + 2], [neck.x - tw * 0.48, y1 + 2], [cx - bw * 0.62, hip.y - 14], [cx - bw * 0.88, hip.y - 14]])} fill={accColor} sw={style.id === 'cartoon' ? 5 : undefined} pop />
          <Sh d={poly([[neck.x + tw * 0.72, y1 + 2], [neck.x + tw * 0.48, y1 + 2], [cx + bw * 0.62, hip.y - 14], [cx + bw * 0.88, hip.y - 14]])} fill={accColor} sw={style.id === 'cartoon' ? 5 : undefined} pop />
        </>
      )
    }
    return null
  }

  // ----- head -----
  const F = FACE[face.expression]
  const fx = pose.facing * R * 0.2
  const white = L.eye === 'white'
  const eyeScale = over?.eyeScale ?? 1
  const eyeDX = R * (white ? 0.39 : 0.34)
  const ey = -R * (white ? 0.02 : 0.06)
  const shapeK = { round: 1.12, oval: 1.36, narrow: 0.82, sleepy: 0.96 }[rec.face.eyes]
  const lid = rec.face.eyes === 'sleepy' ? 0.78 : 1
  const rx = R * 0.215 * eyeScale
  const openness = F.eyeOpen * lid * (1 - face.blink * 0.94)
  const ry = rx * shapeK * openness
  const browW = { thin: 5, medium: 8, thick: 12 }[rec.face.brows] * (R / 104) * (white ? 1 : 0.9) + (white ? 0 : 1.5)
  const browColor = style.id === 'cartoon' ? darken(rec.hair.color, 0.35) : style.ink

  const eyes = ([-1, 1] as const).map((s) => {
    const ex = fx + s * eyeDX
    const closed = ry < rx * 0.3 || F.arcEyes
    const by = ey - R * (white ? 0.37 : 0.3) - F.browLift * R - (s === dir ? F.browAsym * R : 0)
    const bl = R * 0.21
    const brow = `M ${n1(ex - s * bl)} ${n1(by + F.browTilt * R * 0.3)} L ${n1(ex + s * bl)} ${n1(by - F.browTilt * R * 0.2)}`
    let eye
    if (closed) {
      const up = F.arcEyes ? -1 : 0.6
      eye = <Ln d={`M ${n1(ex - rx * 0.9)} ${n1(ey + rx * 0.2)} Q ${n1(ex)} ${n1(ey + rx * 0.2 + up * rx * 0.95)} ${n1(ex + rx * 0.9)} ${n1(ey + rx * 0.2)}`} sw={white ? 6 : 5.5} />
    } else if (white) {
      const pr = Math.min(R * 0.108 * F.pupil * eyeScale, ry * 0.82)
      const px = ex + pose.facing * R * 0.07
      eye = (
        <>
          <Sh d={ell(ex, ey, rx, ry)} fill="#ffffff" raw sw={5} />
          <path d={circ(px, ey + ry * 0.06, pr)} fill={style.ink} />
          <path d={circ(px + pr * 0.35, ey - pr * 0.3, pr * 0.3)} fill="#ffffff" />
        </>
      )
    } else if (F.eyeOpen > 1.2) {
      eye = (
        <>
          <Sh d={circ(ex, ey, R * 0.16)} fill="#ffffff" raw sw={style.id === 'paper' ? 0 : 4} />
          <path d={circ(ex, ey, R * 0.06)} fill={style.ink} />
        </>
      )
    } else {
      const r = R * 0.088 * eyeScale
      eye = <path d={ell(ex, ey, r, r * Math.min(1.15, Math.max(0.45, openness)))} fill={style.ink} />
    }
    return (
      <g key={s}>
        {eye}
        <Ln d={brow} sw={browW} color={browColor} op={1} />
      </g>
    )
  })

  const mouth = () => {
    const mx = fx * 1.1
    const my = R * 0.5
    const mw = R * { small: 0.36, medium: 0.48, wide: 0.62 }[rec.face.mouth]
    const x1 = mx - mw / 2
    const x2 = mx + mw / 2
    const lw = (white ? 6 : 5.5) * Math.max(0.8, R / 104)
    if (face.mouth > 0.12) {
      const h = R * (0.08 + 0.32 * face.mouth)
      const cy = my - F.curve * R * 0.2
      const d = `M ${n1(x1 + mw * 0.1)} ${n1(cy)} Q ${n1(mx)} ${n1(cy - h * 0.12)} ${n1(x2 - mw * 0.1)} ${n1(cy)} Q ${n1(mx)} ${n1(cy + h * 2.1)} ${n1(x1 + mw * 0.1)} ${n1(cy)} Z`
      return (
        <>
          <Sh d={d} fill={mouthDark} raw sw={style.id === 'paper' ? 0 : lw * 0.8} />
          {white && h > R * 0.2 && <path d={ell(mx, cy + h * 0.74, mw * 0.2, h * 0.26)} fill="#E8657A" />}
        </>
      )
    }
    switch (F.mouth) {
      case 'grin': {
        const d = `M ${n1(x1)} ${n1(my - 3)} Q ${n1(mx)} ${n1(my + R * 0.06)} ${n1(x2)} ${n1(my - 3)} Q ${n1(mx)} ${n1(my + R * 0.66)} ${n1(x1)} ${n1(my - 3)} Z`
        const teeth = `M ${n1(x1 + mw * 0.1)} ${n1(my + 2)} Q ${n1(mx)} ${n1(my + R * 0.09)} ${n1(x2 - mw * 0.1)} ${n1(my + 2)} L ${n1(x2 - mw * 0.17)} ${n1(my + R * 0.13)} Q ${n1(mx)} ${n1(my + R * 0.2)} ${n1(x1 + mw * 0.17)} ${n1(my + R * 0.13)} Z`
        return (
          <>
            <Sh d={d} fill={mouthDark} raw sw={style.id === 'paper' ? 0 : lw * 0.8} />
            <path d={teeth} fill="#ffffff" />
          </>
        )
      }
      case 'o':
        return <Sh d={ell(mx, my + R * 0.06, R * 0.15, R * 0.21)} fill={mouthDark} raw sw={style.id === 'paper' ? 0 : lw * 0.8} />
      case 'smirk':
        return <Ln d={`M ${n1(x1)} ${n1(my + R * 0.05)} Q ${n1(mx + dir * R * 0.1)} ${n1(my + R * 0.15)} ${n1(dir > 0 ? x2 : x1)} ${n1(my - R * 0.1)} ${dir > 0 ? '' : `M ${n1(x1)} ${n1(my - R * 0.1)} Q ${n1(mx - R * 0.1)} ${n1(my + R * 0.15)} ${n1(x2)} ${n1(my + R * 0.05)}`}`} sw={lw} />
      case 'wavy':
        return <Ln d={`M ${n1(x1)} ${n1(my + R * 0.04)} Q ${n1(mx - mw * 0.25)} ${n1(my - R * 0.1)} ${n1(mx)} ${n1(my + R * 0.02)} Q ${n1(mx + mw * 0.25)} ${n1(my + R * 0.14)} ${n1(x2)} ${n1(my + R * 0.02)}`} sw={lw} />
      default:
        return <Ln d={`M ${n1(x1)} ${n1(my)} Q ${n1(mx)} ${n1(my + F.curve * R * 0.95)} ${n1(x2)} ${n1(my)}`} sw={lw} />
    }
  }

  const hair = HAIR[rec.hair.style]
  const hs = R * 1.04
  const hairShift = pose.facing * R * 0.05
  const flip = rec.hair.style === 'ponytail' ? -dir : 1
  const beardShift = fx * 0.5

  const headwear = () => {
    const u = (d: string, f = 1) => xf(d, hs, 0, 0, f)
    switch (accessory) {
      case 'cap':
        return (
          <>
            <Sh d={u('M 0.25 -0.5 L 1.78 -0.4 C 1.84 -0.24 1.72 -0.16 1.6 -0.16 L 0.4 -0.24 Z', dir)} fill={darken(accColor, 0.18)} pop />
            <Sh d={u('M -1.12 -0.36 C -1.16 -1 -0.6 -1.33 0 -1.31 C 0.6 -1.33 1.16 -1 1.12 -0.36 Z')} fill={accColor} pop />
          </>
        )
      case 'beanie':
        return (
          <>
            <Sh d={u('M -1.1 -0.4 C -1.2 -1.2 -0.6 -1.52 0 -1.52 C 0.6 -1.52 1.2 -1.2 1.1 -0.4 Z')} fill={accColor} pop />
            <Sh d={rr(-1.16 * hs, -0.66 * hs, 2.32 * hs, 0.36 * hs, 0.14 * hs)} fill={lighten(accColor, 0.18)} pop />
          </>
        )
      case 'headphones':
        return (
          <>
            <Ln d={u('M -1.12 -0.05 C -1.3 -1.75 1.3 -1.75 1.12 -0.05')} sw={lineLimb ? 6 : 13} color={style.id === 'paper' ? darken(accColor, 0.3) : style.ink} op={1} />
            <Sh d={rr(-1.3 * hs, -0.24 * hs, 0.34 * hs, 0.58 * hs, 0.14 * hs)} fill={accColor} pop />
            <Sh d={rr(0.96 * hs, -0.24 * hs, 0.34 * hs, 0.58 * hs, 0.14 * hs)} fill={accColor} pop />
          </>
        )
      case 'gradcap':
        return (
          <>
            <Sh d={u('M -0.92 -1.02 L 0.92 -1.02 L 0.98 -0.6 L -0.98 -0.6 Z')} fill={accColor} pop />
            <Sh d={u('M -1.6 -1.14 L 0 -1.56 L 1.6 -1.14 L 0 -0.84 Z')} fill={accColor} pop />
            <Ln d={u('M 0 -1.2 L 1.15 -1.04 L 1.15 -0.42')} sw={5} color="#F5B301" op={1} />
            <path d={circ(1.15 * hs, -0.38 * hs, 9)} fill="#F5B301" />
          </>
        )
      default:
        return null
    }
  }

  const held = () => {
    if (holding === 'none') return null
    const both = pose.pose === 'hold'
    const at = both ? mid(hand[0], hand[1]) : hand[rig.active]
    const s = Math.max(0.75, sk) * (lineLimb ? 1.25 : 1)
    const tf = `translate(${n1(at.x)} ${n1(at.y)}) scale(${n1(s)})`
    switch (holding) {
      case 'phone':
        return (
          <g transform={`${tf} rotate(${dir * 8})`}>
            <Sh d={rr(-22, -70, 44, 80, 9)} fill="#1F2937" pop />
            <path d={rr(-16, -62, 32, 60, 4)} fill="#7DD3FC" />
          </g>
        )
      case 'laptop':
        return (
          <g transform={tf}>
            <Sh d={rr(-84, -74, 168, 104, 10)} fill="#CBD5E1" pop />
            <path d={circ(0, -22, 12)} fill="#ffffff" opacity={0.9} />
          </g>
        )
      case 'sign':
        return (
          <g transform={tf}>
            <Ln d="M 0 10 L 0 -120" sw={9} />
            <Sh d={rr(-96, -232, 192, 116, 10)} fill="#FDE68A" pop />
            <Ln d="M -60 -196 L 60 -196 M -60 -168 L 30 -168" sw={7} op={0.6} />
          </g>
        )
      case 'paper':
        return (
          <g transform={`${tf} rotate(${dir * -6})`}>
            <Sh d={rr(-38, -92, 76, 100, 4)} fill="#ffffff" raw />
            <Ln d="M -22 -70 L 22 -70 M -22 -52 L 22 -52 M -22 -34 L 8 -34" sw={4} op={0.45} />
          </g>
        )
      case 'coffee':
        return (
          <g transform={tf}>
            <Sh d={poly([[-18, -52], [18, -52], [14, 6], [-14, 6]])} fill="#ffffff" raw />
            <Sh d={rr(-21, -62, 42, 14, 5)} fill="#7C2D12" pop />
          </g>
        )
    }
  }

  const squash = `scale(${n1(rec.body.height * (1 + 0.14 * pose.squash) * 100) / 100} ${n1(rec.body.height * (1 - 0.2 * pose.squash) * 100) / 100})`

  return (
    <g transform={squash}>
      {/* behind the body */}
      {accessory === 'backpack' && L.torso === 'shape' && <Sh d={rr(neck.x - tw - 14, y1 + 12, tw * 2 + 28, L.torsoH * 0.74, 26)} fill={darken(accColor, 0.12)} pop />}
      {hair.back && (
        <g transform={`translate(${n1(head.x + hairShift)} ${n1(head.y)}) rotate(${n1(pose.tilt)})`}>
          <Sh d={xf(hair.back, hs, 0, 0, flip)} fill={hairC} raw union={hair.union} />
        </g>
      )}
      {([0, 1] as const).filter((i) => rig.behind[i]).map(arm)}
      {legs}
      {!lineLimb && <Sh d={rr(neck.x - 17 * sk, neck.y - 16, 34 * sk, 40, 8)} fill={skin} raw />}
      {fine && top === 'hoodie' && <Sh d={ell(neck.x, neck.y + 6, tw * 0.74, 30)} fill={detail} />}
      {torso}
      {accessoryBody()}

      {/* head */}
      <g transform={`translate(${n1(head.x)} ${n1(head.y)}) rotate(${n1(pose.tilt)})`}>
        {fine && (
          <>
            <Sh d={circ(-R * 1.0, R * 0.1, R * 0.17)} fill={skin} raw />
            <Sh d={circ(R * 1.0, R * 0.1, R * 0.17)} fill={skin} raw />
          </>
        )}
        <Sh d={ell(0, 0, R * 1.04, R)} fill={skin} raw />
        {fine && rec.face.blush && (
          <>
            <path d={circ(fx - R * 0.62, R * 0.3, R * 0.15)} fill="#FF7A90" opacity={0.42} />
            <path d={circ(fx + R * 0.62, R * 0.3, R * 0.15)} fill="#FF7A90" opacity={0.42} />
          </>
        )}
        {fine && rec.face.freckles && (
          <g fill={darken(rec.body.skin, 0.3)} opacity={0.7}>
            {[-1, 1].flatMap((s) => [[0.5, 0.2], [0.62, 0.3], [0.44, 0.34]].map(([x, y], i) => <path key={`${s}${i}`} d={circ(fx + s * R * x, R * y, R * 0.028)} />))}
          </g>
        )}
        {rec.face.acne && (
          <g>
            {[[-0.6, 0.36, 0.075], [-0.42, 0.5, 0.055], [-0.7, 0.14, 0.05], [0.58, 0.42, 0.07], [0.68, 0.2, 0.05], [0.24, -0.5, 0.06], [-0.3, -0.42, 0.05], [0.14, 0.8, 0.06]].map(([x, y, r], i) => (
              <g key={`acne${i}`}>
                <path d={circ(fx + R * x, R * y, R * r * 1.7)} fill="#E0475B" opacity={0.28} />
                <path d={circ(fx + R * x, R * y, R * r)} fill="#D93A4E" />
                <path d={circ(fx + R * (x - r * 0.3), R * (y - r * 0.3), R * r * 0.38)} fill="#FFE4E1" opacity={0.85} />
              </g>
            ))}
          </g>
        )}
        {rec.face.facialHair === 'beard' && (
          <g transform={`translate(${n1(beardShift)} 0)`}>
            <Sh d={xf('M -1.02 0.05 C -1.02 1 -0.4 1.32 0 1.32 C 0.4 1.32 1.02 1 1.02 0.05 C 0.78 0.36 0.4 0.3 0 0.3 C -0.4 0.3 -0.78 0.36 -1.02 0.05 Z', hs)} fill={hairC} raw />
          </g>
        )}
        {rec.face.facialHair === 'stubble' && fine && (
          <path d={xf('M -0.84 0.3 C -0.7 1.02 -0.3 1.0 0 1.0 C 0.3 1.0 0.7 1.02 0.84 0.3 C 0.5 0.76 -0.5 0.76 -0.84 0.3 Z', R, beardShift)} fill={rec.hair.color} opacity={0.28} />
        )}
        {eyes}
        {fine && rec.face.nose !== 'none' && (
          rec.face.nose === 'pointed' ? (
            <Ln d={`M ${n1(fx * 1.25)} ${n1(R * 0.08)} L ${n1(fx * 1.25 + dir * R * 0.12)} ${n1(R * 0.24)} L ${n1(fx * 1.25)} ${n1(R * 0.26)}`} sw={5} op={0.8} />
          ) : rec.face.nose === 'round' ? (
            <path d={ell(fx * 1.25, R * 0.2, R * 0.1, R * 0.075)} fill={darken(rec.body.skin, 0.16)} opacity={style.id === 'paper' ? 0.8 : 1} />
          ) : (
            <Ln d={`M ${n1(fx * 1.25 - R * 0.06)} ${n1(R * 0.18)} Q ${n1(fx * 1.25)} ${n1(R * 0.27)} ${n1(fx * 1.25 + R * 0.06)} ${n1(R * 0.18)}`} sw={5} op={0.8} />
          )
        )}
        {mouth()}
        {rec.face.facialHair === 'mustache' && (
          <Sh d={xf('M -0.34 0.4 Q 0 0.2 0.34 0.4 Q 0 0.47 -0.34 0.4 Z', R, fx * 1.1)} fill={hairC} raw sw={fine ? 4 : undefined} />
        )}
        {hair.front && (
          <g transform={`translate(${n1(hairShift)} 0)`}>
            <Sh d={xf(hair.front, hs, 0, 0, rec.hair.style === 'sidepart' || rec.hair.style === 'long' ? dir : 1)} fill={hairC} raw union={hair.union} sw={hair.bare ? 0 : undefined} />
            {hair.hairline && style.id !== 'paper' && <Ln d={xf(hair.hairline, hs)} sw={L.outline * 0.8} />}
          </g>
        )}
        {rec.face.glasses !== 'none' && (
          <g fill="rgba(255,255,255,0.28)" stroke={style.ink} strokeWidth={white ? 6 : 4.5}>
            {[-1, 1].map((s) =>
              rec.face.glasses === 'round'
                ? <path key={s} d={circ(fx + s * eyeDX, ey, R * (white ? 0.31 : 0.24))} />
                : <path key={s} d={rr(fx + s * eyeDX - R * (white ? 0.31 : 0.25), ey - R * (white ? 0.27 : 0.19), R * (white ? 0.62 : 0.5), R * (white ? 0.52 : 0.38), R * 0.07)} />,
            )}
            <path d={`M ${n1(fx - eyeDX + R * (white ? 0.31 : 0.24))} ${n1(ey)} L ${n1(fx + eyeDX - R * (white ? 0.31 : 0.24))} ${n1(ey)}`} fill="none" />
          </g>
        )}
        {headwear()}
        {face.sweat && (
          <g fill="#8ED8FF" stroke={style.ink} strokeWidth={fine ? 3.5 : 3}>
            {[0, 1].map((i) => {
              const fall = ((face.t * 1.6 + i * 17) % 34) / 34
              const sx = -dir * R * (0.92 + i * 0.22)
              const sy = -R * (0.62 - i * 0.2) + fall * R * 0.5
              return <path key={i} opacity={1 - fall * 0.85} d={`M ${n1(sx)} ${n1(sy - R * 0.16)} Q ${n1(sx + R * 0.12)} ${n1(sy + R * 0.04)} ${n1(sx)} ${n1(sy + R * 0.09)} Q ${n1(sx - R * 0.12)} ${n1(sy + R * 0.04)} ${n1(sx)} ${n1(sy - R * 0.16)} Z`} />
            })}
          </g>
        )}
      </g>

      {/* in front of the body */}
      {([0, 1] as const).filter((i) => !rig.behind[i] && i !== rig.active).map(arm)}
      {pose.pose !== 'hold' && held()}
      {([0, 1] as const).filter((i) => !rig.behind[i] && i === rig.active).map(arm)}
      {pose.pose === 'hold' && held()}
    </g>
  )
}
