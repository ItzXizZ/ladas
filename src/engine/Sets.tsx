// The four set kits plus a neutral backdrop. Each is described once as shapes; the style's
// painter decides how they are inked. Ground line is y = 1300. The band above y = 560 is kept
// plain on purpose: that is where bubbles and titles go, and busy backgrounds made text unreadable.
import type { SetId } from '../../shared/types.ts'
import { circ, ell, lighten, mix, n1, poly, rad, rr } from './math.ts'
import { Ln, Sh, usePaint } from './style.tsx'

export const GROUND = 1300
const X0 = -500
const FULL_W = 2080

const bgRect = (y: number, h: number) => rr(X0, y, FULL_W, h)

function Campus({ f }: { f: number }) {
  const drift = (f * 0.25) % 400
  return (
    <>
      <Sh k="bg" d={bgRect(-600, 1900)} fill="#8FD3FF" />
      {[[-140, 690, 1], [620, 630, 0.8]].map(([x, y, s], i) => (
        <Sh key={i} k="bg" d={[ell(x + drift, y, 110 * s, 34 * s), ell(x + drift - 50 * s, y - 26 * s, 60 * s, 36 * s), ell(x + drift + 40 * s, y - 34 * s, 70 * s, 44 * s)].join(' ')} fill="#ffffff" op={0.85} />
      ))}
      <Sh k="bg" d={ell(540, 1330, 1300, 190)} fill="#6CC56A" />
      <Sh d={rr(-20, 1010, 44, 300, 10)} fill="#8A5A34" />
      <Sh d={[circ(0, 900, 150), circ(-110, 980, 100), circ(110, 990, 96)].join(' ')} fill="#3FA34D" union pop />
      <Sh d={rr(1058, 1030, 44, 280, 10)} fill="#8A5A34" />
      <Sh d={[circ(1080, 930, 140), circ(980, 1010, 92), circ(1180, 1000, 100)].join(' ')} fill="#3FA34D" union pop />
      <Sh d={rr(210, 770, 660, 440, 6)} fill="#F2E2C4" />
      <Sh d={poly([[160, 778], [540, 610], [920, 778]])} fill="#E9CFA6" />
      <Sh d={circ(540, 712, 34)} fill="#ffffff" />
      <Ln d="M 540 712 L 540 692 M 540 712 L 554 720" sw={5} />
      {[0, 1, 2, 3, 4].map((i) => <Sh key={i} d={rr(250 + i * 134, 800, 46, 400, 8)} fill="#FFF5E0" />)}
      <Sh d={rr(486, 990, 108, 220, 54)} fill="#7A5230" pop />
      <Sh d={rr(176, 1204, 728, 44, 6)} fill="#E4D2B0" />
      <Sh d={rr(140, 1246, 800, 50, 6)} fill="#D9C49D" />
      <Sh k="bg" d={bgRect(1292, 900)} fill="#7BD06F" />
      <Sh k="bg" d={poly([[430, 1292], [650, 1292], [940, 2000], [140, 2000]])} fill="#F3E3BD" />
    </>
  )
}

function Office() {
  return (
    <>
      <Sh k="bg" d={bgRect(-600, 1900)} fill="#FBE9C9" />
      <Sh d={rr(60, 640, 340, 430, 12)} fill="#BDE6FF" />
      <Sh k="bg" d={[rr(84, 900, 60, 158), rr(150, 840, 70, 218), rr(226, 930, 54, 128), rr(286, 870, 86, 188)].join(' ')} fill="#8FB8D8" />
      <Ln d="M 230 640 L 230 1070 M 60 850 L 400 850" sw={7} />
      <Sh d={rr(600, 650, 400, 290, 10)} fill="#ffffff" />
      <Ln d="M 650 880 L 650 710 M 650 880 L 950 880" sw={5} op={0.7} />
      <Sh d={poly([[670, 860], [750, 820], [820, 836], [930, 720], [930, 860]])} fill="#34D399" pop sw={4} />
      <Sh d={rr(690, 960, 190, 130, 10)} fill="#334155" pop />
      <Sh d={rr(770, 1086, 30, 30, 2)} fill="#94A3B8" />
      <Sh d={rr(560, 1110, 480, 40, 8)} fill="#B67B45" />
      <Sh d={rr(590, 1146, 26, 150, 4)} fill="#9A6537" />
      <Sh d={rr(984, 1146, 26, 150, 4)} fill="#9A6537" />
      <Sh d={[ell(150, 1080, 44, 96), ell(100, 1110, 40, 80), ell(204, 1116, 40, 78)].join(' ')} fill="#3FA34D" union pop />
      <Sh d={poly([[100, 1176], [204, 1176], [188, 1296], [116, 1296]])} fill="#E07A4D" />
      <Sh k="bg" d={bgRect(1292, 900)} fill="#C99A6B" />
      <Sh k="bg" d={bgRect(1280, 22)} fill="#E8D2A8" />
    </>
  )
}

function Home() {
  return (
    <>
      <Sh k="bg" d={bgRect(-600, 1900)} fill="#FFD9C7" />
      <Sh d={rr(690, 620, 300, 390, 10)} fill="#BDE6FF" />
      <Ln d="M 840 620 L 840 1010 M 690 815 L 990 815" sw={7} />
      <Sh d={poly([[660, 600], [760, 600], [720, 1030], [660, 1030]])} fill="#FF9E7A" pop />
      <Sh d={poly([[1020, 600], [920, 600], [960, 1030], [1020, 1030]])} fill="#FF9E7A" pop />
      <Sh d={rr(120, 690, 130, 160, 6)} fill="#ffffff" />
      <Sh d={poly([[136, 834], [176, 760], [204, 800], [222, 780], [236, 834]])} fill="#7BD06F" sw={4} />
      <Sh d={rr(280, 730, 170, 120, 6)} fill="#ffffff" />
      <Sh d={circ(365, 790, 32)} fill="#FFD84D" sw={4} pop />
      <Sh d={rr(110, 1000, 540, 220, 44)} fill="#5B8DEF" pop />
      <Sh d={rr(70, 1100, 110, 180, 36)} fill="#4A7BE0" />
      <Sh d={rr(580, 1100, 110, 180, 36)} fill="#4A7BE0" />
      <Sh d={rr(150, 1150, 460, 130, 30)} fill="#78A4F5" />
      <Ln d="M 880 1296 L 880 900" sw={9} />
      <Sh d={poly([[820, 906], [940, 906], [912, 790], [848, 790]])} fill="#FFE08A" pop />
      <Sh d={ell(880, 1296, 60, 12)} fill="#8A5A34" />
      <Sh k="bg" d={bgRect(1292, 900)} fill="#D8A77A" />
      <Sh k="bg" d={ell(540, 1440, 560, 100)} fill="#E46C6C" />
      <Sh k="bg" d={ell(540, 1440, 470, 76)} fill="#F08A8A" />
    </>
  )
}

const BUILDINGS: [number, number, number, string][] = [
  [-140, 250, 470, '#F6A6B2'], [110, 220, 600, '#FFD38C'], [330, 260, 430, '#9ED9C4'],
  [590, 210, 640, '#B8B5FF'], [800, 250, 500, '#F9C79B'], [1050, 240, 580, '#F6A6B2'],
]
function Street() {
  return (
    <>
      <Sh k="bg" d={bgRect(-600, 1900)} fill="#A7D8FF" />
      {BUILDINGS.map(([x, w, h, c], i) => (
        <g key={i}>
          <Sh d={rr(x, GROUND - h, w, h + 4, 6)} fill={c} />
          {Array.from({ length: Math.max(1, Math.floor((h - 190) / 110)) }).flatMap((_, r) =>
            [0, 1].map((col) => <Sh key={`${r}-${col}`} d={rr(x + 34 + col * (w - 68 - 54), GROUND - h + 50 + r * 110, 54, 64, 6)} fill="#FFF8D6" sw={4} />),
          )}
        </g>
      ))}
      <Sh d={poly([[330, 1090], [590, 1090], [620, 1150], [300, 1150]])} fill="#EF4444" pop />
      <Sh d={rr(420, 1160, 80, 136, 4)} fill="#7A5230" />
      <Ln d="M 930 1296 L 930 800 L 880 800" sw={10} />
      <Sh d={rr(840, 790, 60, 30, 10)} fill="#FFE08A" pop />
      <Sh k="bg" d={bgRect(1292, 160)} fill="#D9D4C7" />
      <Sh k="bg" d={bgRect(1440, 800)} fill="#5E6470" />
      <Sh k="bg" d={bgRect(1436, 12)} fill="#B9B4A6" />
      {[-200, 180, 560, 940].map((x) => <Sh key={x} k="bg" d={rr(x, 1640, 200, 22, 6)} fill="#F8E08E" />)}
    </>
  )
}

function Neutral({ f }: { f: number }) {
  const { brand, style } = usePaint()
  const base = style.id === 'line' ? style.paper : lighten(brand.primary, 0.74)
  const ray = style.id === 'line' ? mix(style.paper, brand.primary, 0.12) : lighten(brand.primary, 0.6)
  const spin = f * 0.12
  const rays = Array.from({ length: 12 }).map((_, i) => {
    const a = rad(i * 30 + spin)
    const b = rad(i * 30 + 15 + spin)
    return `M 540 960 L ${n1(540 + Math.cos(a) * 2200)} ${n1(960 + Math.sin(a) * 2200)} L ${n1(540 + Math.cos(b) * 2200)} ${n1(960 + Math.sin(b) * 2200)} Z`
  })
  return (
    <>
      <Sh k="bg" raw d={bgRect(-600, 3200)} fill={base} />
      <Sh k="bg" raw d={rays.join(' ')} fill={ray} />
      <Sh k="bg" raw d={bgRect(1292, 1200)} fill={style.id === 'line' ? mix(style.paper, brand.primary, 0.2) : lighten(brand.primary, 0.5)} />
      <Sh k="bg" raw d={ell(540, 1300, 470, 46)} fill={style.id === 'line' ? mix(style.paper, style.ink, 0.12) : mix(lighten(brand.primary, 0.5), '#000000', 0.12)} />
    </>
  )
}

export function SetView({ set, f }: { set: SetId; f: number }) {
  switch (set) {
    case 'campus': return <Campus f={f} />
    case 'office': return <Office />
    case 'home': return <Home />
    case 'street': return <Street />
    default: return <Neutral f={f} />
  }
}
