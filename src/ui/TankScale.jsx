// Tank sizes drawn to scale, so choosing a size feels like choosing a size. Each tank is a box: its front (width by
// height) with the top and side receding at 45 degrees by a quarter of its depth and a band of substrate along the
// bottom. A 30 cm rule stands beside them for the real thing. All boxes share one scale (SVG units are centimetres).

import { TANKS, TANK_ORDER } from '../content/tanks.js';
import './tanks.css';

export const litres = (t) => Math.round((t.w * t.d * t.h) / 1000);
export const sizeText = (t) => `${t.w} × ${t.d} × ${t.h} cm · ${litres(t)} L`;

const SLANT = 0.245;   // how far the depth recedes, per centimetre of depth, both across and up
const RULE = 30;

function Box({ t, x, cls = '', onClick, label }) {
  const s = t.d * SLANT, W = t.w, H = t.h, soil = Math.min(H * 0.2, 9);
  const pts = (a) => a.map((p) => p.join(',')).join(' ');
  return (
    <g class={'tk ' + cls} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={label}>
      {label ? <title>{label}</title> : null}
      <polygon class="top" points={pts([[x, -H], [x + s, -H - s], [x + W + s, -H - s], [x + W, -H]])} />
      <polygon class="side" points={pts([[x + W, -H], [x + W + s, -H - s], [x + W + s, -s], [x + W, 0]])} />
      <rect class="front" x={x} y={-H} width={W} height={H} rx={t.closed ? 3 : 0} />
      {cls.includes('ref') ? null : <rect class="soil" x={x} y={-soil} width={W} height={soil} />}
    </g>
  );
}

// A 30 cm rule standing upright with a tick every 10 cm.
const Rule = ({ x }) => (
  <g class="tk-rule">
    <rect x={x} y={-RULE} width={4} height={RULE} />
    {[0, 10, 20, 30].map((y) => <line key={y} x1={x + 4} x2={x + 8} y1={-y} y2={-y} />)}
  </g>
);

// Every tank side by side, smallest to grandest; the picked one is highlighted and a click picks another.
export function TankLineup({ pick, onPick, ids = TANK_ORDER }) {
  const gap = 12;
  let x = 16;
  const boxes = ids.map((id) => { const t = TANKS[id], at = x; x += t.w + t.d * SLANT + gap; return { id, t, at }; });
  const top = Math.max(...ids.map((id) => TANKS[id].h + TANKS[id].d * SLANT)) + 3;
  return (
    <svg class="tank-lineup" viewBox={`-1 ${-top} ${x - gap + 3} ${top + 3}`} role="group" aria-label="Tank sizes to scale">
      <Rule x={0} />
      {boxes.map(({ id, t, at }) => <Box key={id} t={t} x={at} cls={id === pick ? 'on' : ''} onClick={onPick ? () => onPick(id) : undefined} label={`${t.name}: ${sizeText(t)}`} />)}
    </svg>
  );
}

// One tank beside another (the one you have, dashed) at the scale every card shares, so a list of cards compares too.
// Sized for the biggest tank the custom sliders allow (200 x 80 x 100 cm).
export function TankCompare({ t, against }) {
  const vh = 100 + 80 * SLANT + 4;
  return (
    <svg class="tank-compare" viewBox={`-1 ${-vh + 2} ${16 + 200 + 80 * SLANT + 4} ${vh}`} preserveAspectRatio="xMinYMax meet" role="img" aria-label={`${sizeText(t)}${against ? `, beside the ${against.name}` : ''}`}>
      <Rule x={0} />
      <Box t={t} x={16} cls="on" />
      {against && against !== t ? <Box t={against} x={16} cls="ref" /> : null}
    </svg>
  );
}
