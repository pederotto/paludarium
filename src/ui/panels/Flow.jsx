// Flow balance: the pump circuit as a plain diagram (sump -> pump -> outlets ->
// ponds -> return), litres per hour on every link, a valve for each outlet,
// the pump rate, warnings in plain words, and the water quality of every pond.
// Reads world.water.hydro.ledger and world.water.bodies; opened from Care > Water.

import { S, toast } from '../store.js';
import { Sheet } from './Sheet.jsx';
import { ctx } from '../../app/ctx.js';
import { filterOf, filterClog } from '../../content/equipment.js';
import '../flow.css';

const refresh = () => { S.live.value = { ...S.live.value }; };
const lph = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1)) + ' L/h';
const grade = (b) => {
  const s = Math.max(b.ammonia / 0.6, b.nitrite / 0.8, Math.max(0, 5.5 - b.oxygen) / 2.5, Math.max(0, b.nitrate - 40) / 60);
  return s > 0.8 ? 'bad' : s > 0.35 ? 'warn' : 'ok';
};

function Node({ b, kind }) {
  if (!b) return null;
  const g = grade(b);
  return (
    <div class={'fl-node' + (kind === 'sump' ? ' sump' : '') + (g === 'bad' ? ' bad' : '')}>
      <span class={'fl-dot ' + g} /><b>{b.name}</b> <span style={{ color: 'var(--dim)' }}>{b.vol >= 10 ? Math.round(b.vol) : b.vol.toFixed(1)} L</span>
      {b.kind === 'pool' ? <div class="bar" title="How full, up to the spill lip"><i style={{ width: Math.round(Math.min(1, b.fill) * 100) + '%' }} /></div> : null}
    </div>
  );
}

const byKey0 = (B, k) => B.byKey(k);

// Follows the biggest outflow from a body until the water is back in the main pool.
function chainFrom(L, B, startKey) {
  const rows = [];
  const seen = new Set([startKey]);
  let key = startKey;
  for (let i = 0; i < 6; i++) {
    const outs = L.paths.filter((l) => l.from === key && l.lph > 0.5 && (l.to === 'sump' || B.byKey(l.to))).sort((a, b) => b.lph - a.lph);
    if (!outs.length) { rows.push({ dead: true, filling: (byKey0(B, key)?.fill ?? 1) < 0.95 }); break; }
    const l = outs[0];
    rows.push({ lph: l.lph, to: l.to, via: l.via });
    if (l.to === 'sump' || seen.has(l.to)) break;
    seen.add(l.to); key = l.to;
  }
  return rows;
}

// The filter's own loop: its pump pulls the main pool's water in, through the filter, and pushes it back cleaned. The hoses
// with their size and the water's speed in them, the head its pump works against and how clogged each media stage is
// (sim/filterflow.js, Env.filterFlow).
const speed = (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' cm/s';
function FilterLoop({ E }) {
  const F = filterOf(E), clog = filterClog(E), ext = (E.filterKind ?? 'sponge') !== 'matten';
  const where = ext ? 'in the cabinet' : 'in the pool';
  const ff = E.filterFlow, on = !!E.filter, q = on ? E.filterLph ?? 0 : 0;
  const hose = (role) => { const h = ff?.hoses.find((x) => x.role === role); return h ? <span style={{ display: 'block', color: 'var(--dim)' }}>{h.id}/{h.od} mm, {on ? speed(h.v) : 'still'} {h.dir}</span> : null; };
  return (
    <div class="fl-chain">
      <h4 style={{ margin: 0, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
        <span>Filter <span class="tag">{F.name.toLowerCase()} {where}</span></span>
        <b>{on ? lph(q) : 'off'}</b>
      </h4>
      <div class="fl-chain-row">
        <div class="fl-node sump">Main pool</div>
        <div class="fl-arrow"><b>{lph(q)}</b>{ext ? 'overflow drain' : 'through the foam'}{ext ? hose('intake') : null}</div>
        <div class={'fl-node' + (clog > 0.6 ? ' bad' : '')}>{F.name}{clog > 0.15 ? ` · ${Math.round(clog * 100)}% clogged` : ''}</div>
        <div class="fl-arrow"><b>{lph(q)}</b>{ext ? 'return' : 'riser'}{hose(ext ? 'return' : 'riser')}</div>
        <div class="fl-node sump">Main pool</div>
      </div>
      {ff ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ff.stages.map((s) => (
            <div class={'fl-node' + (s.clog > 0.7 ? ' bad' : '')} style={{ flex: '1 1 110px' }} title={`${{ mech: 'Mechanical', bio: 'Biological', chem: 'Chemical' }[s.id] ?? ''} stage: ${Math.round(s.clog * 100)}% clogged`}>
              {s.name} <span style={{ color: 'var(--dim)' }}>{{ mech: 'mechanical', bio: 'biological', chem: 'chemical' }[s.id]}</span>
              <div class="bar" title="How clogged"><i style={{ width: Math.round(s.clog * 100) + '%' }} /></div>
            </div>
          ))}
        </div>
      ) : null}
      <small>
        Its own pump pushes the water through the media, which keep the particles and the bacteria.
        {ff && on ? ` The pump (${F.pump.lph} L/h free, ${F.pump.hmax} cm at most) works against ${Math.round(ff.head)} cm: ${ext ? 'the lift from the cabinet to the water line' : 'the lift over the foam'} (${Math.round(ff.lift)} cm), the media and the hose; clogged media and a higher lift cost it flow.` : ''}
        {on ? (clog > 0.6 ? ' Rinse it soon (Care > Water).' : '') : ' Switched off: nothing is filtered.'}
      </small>
    </div>
  );
}

export function FlowPanel() {
  const W = ctx.game.world, H = W.water.hydro, B = W.water.bodies, L = H.ledger;
  const live = S.live.value; void live;
  const P = L.pump ?? {};
  const sump = B.sump;
  const byKey = (k) => B.byKey(k);
  const rank = { bad: 0, warn: 1, info: 2 };
  const warns = [...(L.warnings ?? [])].sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
  const sumpNode = L.nodes.find((n) => n.key === 'sump');
  const sumpNet = sumpNode ? sumpNode.dStoreLph : 0;
  const pumpState = !H.pump.on ? 'switched off' : H.resVol <= 1 ? 'dry' : P.submerge < 0.9 ? 'starving' : 'running';
  const all = B.list.filter((b) => b.kind !== 'sump');
  const bodies = all.filter((b) => b.kind === 'pool' || b.vol >= 0.05).slice(0, 10);
  const hidden = all.length - bodies.length;
  return (
    <Sheet title="Flow balance" icon="drop" wide={false}>
      <div class="fl">
        <div class="fl-warns">
          {warns.length ? warns.map((w, i) => <div key={i} class={'fl-warn ' + w.level}>{w.text}</div>)
            : <div class="fl-warn ok">The circuit is balanced: what the pump sends out comes back.</div>}
        </div>

        <div class="fl-head">
          <div class="fl-box fl-sump">
            <h4>Main pool (sump)</h4>
            <small>{sump.vol.toFixed(1)} L, level {H.level.toFixed(1)} cm</small>
            <small>in {lph(sumpNode?.inLph ?? 0)} · out {lph(sumpNode?.outLph ?? 0)}</small>
            <small style={{ color: Math.abs(sumpNet) < 3 ? 'var(--moss)' : 'var(--amber)' }}>{Math.abs(sumpNet) < 3 ? 'level steady' : sumpNet > 0 ? `rising ${lph(sumpNet)}` : `falling ${lph(-sumpNet)}`}</small>
          </div>
          <div class="fl-arrow"><b>{lph(P.lph ?? 0)}</b>intake</div>
          <div class="fl-box fl-pump">
            <h4>Pump <span class={'tag ' + (pumpState === 'running' ? 'moss' : 'coral')}>{pumpState}</span></h4>
            <div class="fl-valve"><span style={{ width: 60 }}>Rated</span>
              <input type="range" min={20} max={600} step={10} value={H.pump.rate} onInput={(e) => { H.pump.rate = +e.currentTarget.value; refresh(); }} />
              <output>{H.pump.rate}</output></div>
            <small>Intake {P.intakeDepth?.toFixed(1) ?? 0} cm under water. Delivers {lph(P.lph ?? 0)}{P.bypassLph > 0.5 ? `, ${lph(P.bypassLph)} of it straight back through the bypass` : ''}.</small>
            <div class="chips" style={{ marginTop: 6 }}>
              <button class={'chip' + (H.pump.on ? ' on' : '')} onClick={() => { H.pump.on = !H.pump.on; refresh(); }}>Pump {H.pump.on ? 'on' : 'off'}</button>
              <button class={'chip' + (H.topUp ? ' on' : '')} onClick={() => { H.topUp = !H.topUp; if (H.topUp) H.targetTotal = Math.max(H.targetTotal, H.total()); refresh(); }} title="Replaces evaporated water like a float valve">Auto top-up</button>
            </div>
            {L.evapLph > 0.01 ? <small>Evaporation {L.evapLph.toFixed(2)} L/h{L.topUpLph > 0.01 ? `, topped up ${L.topUpLph.toFixed(2)} L/h` : ''}.</small> : null}
          </div>
        </div>

        <FilterLoop E={W.env} />

        {H.outlets.length === 0 ? <p class="note">No outlets yet. Use the Water tool to place one on the ground or the background: the pump sends water there, over the hardscape, and it runs back down.</p> : null}
        {H.outlets.map((o, i) => {
          const key = 'o' + i;
          const node = L.nodes.find((n) => n.key === key);
          const dests = L.paths.filter((l) => l.from === key && (l.to === 'sump' || B.byKey(l.to)) && l.lph > Math.max(1, 0.04 * (node?.inLph ?? 0))).sort((a, b) => b.lph - a.lph).slice(0, 3);
          return (
            <div class="fl-chain" key={i}>
              <h4 style={{ margin: 0, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                <span>Outlet {i + 1} <span class="tag">{o.wall ? 'background spring' : 'on the ground'}</span></span>
                <b>{lph(node?.inLph ?? 0)}</b>
              </h4>
              <div class="fl-valve"><span style={{ width: 60 }}>Valve</span>
                <input type="range" min={0} max={1} step={0.05} value={o.valve ?? 1} onInput={(e) => { o.valve = +e.currentTarget.value; refresh(); }} />
                <output>{Math.round((o.valve ?? 1) * 100)}%</output></div>
              <div class="fl-chain-row">
                <div class="fl-node sump">Main pool</div>
                <div class="fl-arrow"><b>{lph(node?.inLph ?? 0)}</b>pump</div>
                <div class="fl-node">Outlet {i + 1}</div>
                {dests.length ? dests.map((l, k) => {
                  const tail = l.to === 'sump' ? [] : chainFrom(L, B, l.to);
                  return (
                    <span key={k} style={{ display: 'contents' }}>
                      <div class="fl-arrow"><b>{lph(l.lph)}</b>{l.via?.length ? 'via ' + l.via.slice(0, 2).join(', ') : 'flows to'}</div>
                      <Node b={byKey(l.to)} kind={l.to === 'sump' ? 'sump' : ''} />
                      {tail.map((t, j) => (t.dead ? <span key={j} class={t.filling ? 'note' : 'fl-dead'}>{t.filling ? 'still filling' : 'no way out'}</span> : (
                        <span key={j} style={{ display: 'contents' }}>
                          <div class="fl-arrow"><b>{lph(t.lph)}</b>{t.via?.length ? 'via ' + t.via.slice(0, 2).join(', ') : t.to === 'sump' ? 'returns' : 'spills to'}</div>
                          <Node b={byKey(t.to)} kind={t.to === 'sump' ? 'sump' : ''} />
                        </span>
                      )))}
                    </span>
                  );
                }) : <span class="fl-dead">{(o.valve ?? 1) < 0.05 ? 'valve closed' : 'nothing leaves yet: the pool or the ground is filling'}</span>}
              </div>
            </div>
          );
        })}

        <div class="fl-box">
          <h4>Water in each place</h4>
          <div class="fl-scroll">
            <table class="fl-table">
              <thead><tr><th>Body</th><th>Litres</th><th>In</th><th>Out</th><th>NH₃</th><th>NO₂</th><th>NO₃</th><th>O₂</th><th>°C</th><th>Algae</th></tr></thead>
              <tbody>
                {[sump, ...bodies].map((b) => {
                  const g = grade(b);
                  return (
                    <tr key={b.key}>
                      <td><span class={'fl-dot ' + g} />{b.name}</td>
                      <td>{b.vol >= 10 ? Math.round(b.vol) : b.vol.toFixed(1)}</td>
                      <td>{lph(b.inLph)}</td><td>{lph(b.outLph)}</td>
                      <td class={b.ammonia > 0.5 ? 'bad' : b.ammonia > 0.2 ? 'warn' : ''}>{b.ammonia.toFixed(2)}</td>
                      <td class={b.nitrite > 0.5 ? 'bad' : b.nitrite > 0.2 ? 'warn' : ''}>{b.nitrite.toFixed(2)}</td>
                      <td class={b.nitrate > 60 ? 'bad' : b.nitrate > 40 ? 'warn' : ''}>{Math.round(b.nitrate)}</td>
                      <td class={b.oxygen < 4 ? 'bad' : b.oxygen < 5.5 ? 'warn' : ''}>{b.oxygen.toFixed(1)}</td>
                      <td>{b.temp.toFixed(1)}</td>
                      <td>{b.algae > 0.3 ? 'bloom' : b.algae > 0.12 ? 'some' : 'little'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hidden > 0 ? <p class="note">{hidden} thin streams not listed: they carry the water of the ponds above them.</p> : null}
          <p class="note">A planted shallow pond cleans itself; a deep pond with fish loads up. Turn on the Water quality lens (L) to see them on the tank.</p>
        </div>
      </div>
    </Sheet>
  );
}
void toast;
