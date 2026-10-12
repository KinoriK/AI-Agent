// Original pixel-art staff and furniture, drawn as SVG rects. Each agent gets a stable look from its name.
import type { CSSProperties } from 'react';

const HAT = [
  '...hhhhhh...',
  '..hhhhhhhh..',
  '.bbbbbbbbbb.',
];
const HAIR = [
  '....rrrr....',
  '..rrrrrrrr..',
  '..rrssssrr..',
];
const BODY = [
  '...ssssss...',
  '...seesse...',
  '...ssssss...',
  '....smms....',
  '..cccwwccc..',
  '.cclcwtclcc.',
  '.ccccwtcccc.',
  'cccccwtccccc',
  'cccccccccccc',
];

const SKIN = ['#f1c9a5', '#d9a77c', '#b07a52', '#8a5a3b', '#5e3d2a', '#e8b896'];
const COAT = ['#8c7a55', '#3d4148', '#2b3242', '#5a2f34', '#6b6255', '#24262b', '#4a3b2a'];
const HATC = ['#24262b', '#3b3128', '#4a4f58', '#1a1b1f'];
const HAIRC = ['#1b1612', '#3d2a1c', '#7a5230', '#b9b2a6', '#2a2522'];
const TIE = ['#c9a227', '#ffb000', '#8f2d2d', '#5ec8ff', '#a0a6ad'];

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export function Character({ name, size = 3 }: { name: string; size?: number }) {
  const h = hash(name);
  const pick = <T,>(a: T[], shift: number) => a[(h >>> shift) % a.length];
  const hat = h % 3 !== 0;
  const pal: Record<string, string> = {
    h: pick(HATC, 3), b: '#0e0f12', r: pick(HAIRC, 7), s: pick(SKIN, 11), e: '#141414', m: '#6b3a2e',
    c: pick(COAT, 15), l: '#00000033', w: '#d9d3c4', t: pick(TIE, 19),
  };
  const rows = [...(hat ? HAT : HAIR), ...BODY];
  return (
    <svg className="char" width={12 * size} height={rows.length * size} viewBox={`0 0 12 ${rows.length}`} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) => [...row].map((k, x) => pal[k] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pal[k]} /> : null))}
    </svg>
  );
}

// Desk with an old CRT monitor and a brass lamp; the lamp and screen come on while the agent works.
export function Desk({ name, working, label, ghost, style }: { name: string; working: boolean; label?: string; ghost?: boolean; style?: CSSProperties }) {
  return (
    <div className={`desk ${working ? 'on' : ''} ${ghost ? 'ghost' : ''}`} style={style} title={name}>
      {working && label && <div className="bubble">{label}</div>}
      <div className="lamp-glow" />
      <div className="seat"><Character name={ghost ? name.replace(/#\d+$/, '') : name} /></div>
      <svg className="furniture" viewBox="0 0 48 22" shapeRendering="crispEdges" aria-hidden>
        <rect x="0" y="8" width="48" height="14" fill="#3a2a1d" />
        <rect x="0" y="8" width="48" height="2" fill="#5a412b" />
        <rect x="0" y="21" width="48" height="1" fill="#1a120c" />
        {/* CRT monitor */}
        <rect x="30" y="0" width="14" height="10" fill="#2a2d33" />
        <rect className="screen" x="31.5" y="1.5" width="11" height="7" fill="#101418" />
        <rect className="screen-line" x="33" y="3" width="7" height="1" fill="transparent" />
        <rect className="screen-line two" x="33" y="5" width="5" height="1" fill="transparent" />
        <rect x="35" y="10" width="4" height="1" fill="#1d1f24" />
        {/* lamp */}
        <rect x="5" y="7" width="1" height="2" fill="#8a6d1a" />
        <rect x="3" y="9" width="5" height="1" fill="#8a6d1a" />
        <rect className="lamp-shade" x="2" y="4" width="7" height="3" fill="#2f5d3a" />
        <rect className="lamp-bulb" x="4" y="7" width="3" height="1" fill="#3a3a2a" />
        {/* papers */}
        <rect x="14" y="10" width="7" height="4" fill="#d9d3c4" opacity=".8" />
        <rect x="16" y="11" width="7" height="4" fill="#e8e1cf" opacity=".9" />
      </svg>
      <div className="plate">{name}</div>
    </div>
  );
}
