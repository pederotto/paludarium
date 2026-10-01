// UI-only state of the tool rail and its options card (no game logic): collapsed chip, Advanced accordion,
// the Add group's Kits tab, and the last tool used in each group (so a group button reopens where you left it).

import { signal, effect } from '@preact/signals';
import { S } from '../store.js';
import { groupOf } from '../../tools/defs.js';

export const R = {
  collapsed: signal(false),     // the options card is shrunk to a chip
  adv: signal({}),              // { [tab id]: true } Advanced accordions that are open
  kitsTab: signal(false),       // Add > Kits tab (the Hardscape tool with the kit list)
  dirty: false,                 // something was placed since the card was last expanded (phones auto-collapse on orbit)
};
const lastTool = {};
export const lastOf = (g) => lastTool[g.id] ?? g.tools[0];

let prevTool = null, prevDepth = 0;
effect(() => {
  const t = S.tool.value;
  lastTool[groupOf(t).id] = t;
  if (t !== prevTool) { R.collapsed.value = false; if (t !== 'rock') R.kitsTab.value = false; prevTool = t; }
});
effect(() => {
  const d = S.undoDepth.value;
  if (d > prevDepth) R.dirty = true;
  prevDepth = d;
});

// The camera frames the tank in the free area (ui/layout.js re-measures on resize): tell it when the card folds or opens.
let first = true;
effect(() => {
  R.collapsed.value; S.left.value;
  if (first) { first = false; return; }
  setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
});

// Phones: once something has been placed, starting to orbit or pinch folds the card away so the tank is clear.
export function bindAutoCollapse(controls) {
  if (!controls?.addEventListener) return () => {};
  const onStart = () => {
    if (!S.compact.value || groupOf(S.tool.value).id === 'look' || !R.dirty) return;
    R.dirty = false; R.collapsed.value = true;
  };
  controls.addEventListener('control', onStart);
  return () => controls.removeEventListener('control', onStart);
}
