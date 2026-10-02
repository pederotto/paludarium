// The recorder's small face on the page: a chip that says it is recording, with big buttons for the person at the screen
// (⚡ a black flash just happened, 🐢 it stuttered, ■ done), and the result card at the end. Plain DOM, no animation, no blur,
// updated once a second: it must not add to the cost of what it measures.

const CSS = `
.pm{position:fixed;left:8px;bottom:8px;z-index:2147483000;font:12px/1.4 ui-monospace,Consolas,Menlo,monospace;color:#d8efe2;background:rgba(5,11,8,.88);border:1px solid rgba(125,255,176,.35);border-radius:10px;padding:6px 8px;max-width:min(94vw,440px);-webkit-user-select:none;user-select:none;touch-action:manipulation;box-sizing:border-box}
.pm.r{left:auto;right:8px}.pm.t{bottom:auto;top:60px}   /* below the game's own top row */
.pm .l1{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.pm .rec{color:#ff6b6b;font-weight:700}.pm .l2{opacity:.65;font-size:11px;margin-top:1px}
.pm .bt{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.pm button{font:inherit;color:inherit;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px 10px;min-height:36px;cursor:pointer}
.pm button:active{background:rgba(255,255,255,.25)}.pm button.go{border-color:#7dffb0;color:#7dffb0}.pm button.mv{padding:6px 8px;opacity:.7}
.pm .ok{color:#7dffb0}.pm .no{color:#ffb454}
.pm.min{padding:4px 8px}.pm.min .bt,.pm.min .l2{display:none}
.pmc{position:fixed;inset:0;z-index:2147483001;background:rgba(2,6,4,.8);display:grid;place-items:center;font:13px/1.45 ui-monospace,Consolas,Menlo,monospace;color:#d8efe2}
.pmc .box{background:#08130d;border:1px solid rgba(125,255,176,.4);border-radius:12px;width:min(94vw,640px);max-height:88vh;overflow:auto;padding:14px 16px;box-sizing:border-box}
.pmc h3{margin:0 0 8px;font-size:15px;color:#7dffb0}.pmc ul{margin:6px 0 10px;padding-left:0;list-style:none}.pmc li{margin:3px 0}
.pmc .bad{color:#ff7a7a}.pmc .warn{color:#ffc56b}.pmc .okk{color:#7dffb0}.pmc .info{color:#9fb3a8}
.pmc pre{margin:8px 0;white-space:pre-wrap;font:inherit;opacity:.9}
.pmc .bt{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.pmc button{font:inherit;color:inherit;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:8px 12px;min-height:40px;cursor:pointer}
`;

function h(doc, tag, props = {}, ...kids) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v); }
  for (const c of kids) e.append(c);
  return e;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function createOverlay({ win, onMark, onSnap, onBench, onStop }) {
  const doc = win.document;
  const style = h(doc, 'style'); style.textContent = CSS;
  const l1 = h(doc, 'div', { class: 'l1' }), l2 = h(doc, 'div', { class: 'l2' });
  // The buttons give up keyboard focus at once: a focused button would take the game's Space (pause) as a click.
  const btn = (label, fn, cls = '', title = '') => h(doc, 'button', { type: 'button', tabindex: '-1', class: cls, title, onclick: (e) => { e.currentTarget.blur(); fn(e); } }, label);
  const corner = btn('⇄', () => { root.classList.toggle('r'); }, 'mv', 'move to the other side'),
    top = btn('⇅', () => { root.classList.toggle('t'); }, 'mv', 'move up or down');
  const bt = h(doc, 'div', { class: 'bt' }, btn('⚡ Flash', () => onMark('flash'), '', 'a black flash just happened (key: `)'), btn('🐢 Stutter', () => onMark('stutter'), '', 'it just stuttered (key: Shift + `)'), btn('📷', onSnap, '', 'save a picture of the screen'), btn('▶ Test', onBench, '', 'run the hands-off test (about a minute)'), btn('■ Done', onStop, 'go', 'stop recording and show the result'), corner, top);
  const root = h(doc, 'div', { class: 'pm', 'data-pm': '' }, l1, l2, bt);
  // On a narrow screen the chip is one line, so it does not cover the game's own buttons; ⋯ opens the rest.
  const more = btn('⋯', () => root.classList.toggle('min'), 'mv', 'show or hide the buttons');
  if (win.innerWidth < 700) root.classList.add('min', 't');
  let cardEl = null;
  const mount = () => { doc.head.appendChild(style); doc.body.appendChild(root); };
  if (doc.body) mount(); else doc.addEventListener('DOMContentLoaded', mount, { once: true });

  return {
    update(i) {
      l1.replaceChildren(h(doc, 'span', { class: 'rec' }, i.done ? '■ stopped' : '● REC'), h(doc, 'span', {}, clock(i.secs)), h(doc, 'span', {}, `${i.fps} fps`), h(doc, 'span', {}, `p95 ${i.p95} ms`), h(doc, 'span', {}, `worst ${i.worst} ms`), i.marks ? h(doc, 'span', {}, `${i.marks} marked`) : '', more);
      l2.replaceChildren(i.line, ' · ', h(doc, 'span', { class: i.sink === 'ok' ? 'ok' : 'no' }, i.sink === 'ok' ? 'sending ✓' : i.sink === 'offline' ? 'send failing, kept here' : i.sink === 'probing' ? 'looking for the collector' : 'kept on this page'));
    },
    // The result card. `lines`: [{sev, text}], `text`: the whole report (what Copy takes), `onSave`, `onAgain`.
    card({ title, lines, summary, text, sink, onSave, onAgain }) {
      cardEl?.remove();
      const copy = btn('Copy the result', async (e) => { try { await win.navigator.clipboard.writeText(text); e.target.textContent = 'Copied ✓'; } catch { const ta = h(doc, 'textarea'); ta.value = text; doc.body.appendChild(ta); ta.select(); doc.execCommand?.('copy'); ta.remove(); e.target.textContent = 'Copied ✓'; } });
      const box = h(doc, 'div', { class: 'box' },
        h(doc, 'h3', {}, title),
        h(doc, 'ul', {}, ...lines.map((x) => h(doc, 'li', { class: x.sev === 'ok' ? 'okk' : x.sev }, (x.sev === 'bad' ? '✗ ' : x.sev === 'warn' ? '! ' : x.sev === 'ok' ? '✓ ' : '· ') + x.text))),
        h(doc, 'pre', {}, summary),
        h(doc, 'div', { class: sink === 'ok' ? 'okk' : 'warn' }, sink === 'ok' ? 'The full recording was sent to the computer running the game server.' : 'This page could not reach a collector: use Copy or Save and send it over.'),
        h(doc, 'div', { class: 'bt' }, copy, btn('Save the file', onSave), btn('Record again', () => { cardEl.remove(); onAgain(); }), btn('Close', () => cardEl.remove())));
      cardEl = h(doc, 'div', { class: 'pmc' }, box);
      doc.body.appendChild(cardEl);
    },
    remove() { root.remove(); style.remove(); cardEl?.remove(); },
  };
}
