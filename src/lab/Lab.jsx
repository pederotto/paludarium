// The test lab's panels: the clock and view bar on top, the arena and the animals on the left, the selected animal on the right.
// On a phone the three become one bottom sheet with tabs. Everything here calls window.lab (index.js), the same handle a headless run uses.
import { useEffect } from 'preact/hooks';
import { L, RATES } from './state.js';
import { tankChoices, GROUNDS, maxDepth } from './arena.js';
import { speciesList } from './spawn.js';
import { SHAPES, DRIVABLE, CLIMBERS } from './driver.js';
import { SPECIES as SIM_SPECIES, PERCH_PIECES } from '../sim/animals.js';
import { PANES } from '../sim/labdrive.js';
import { SHAPE_KINDS, PIECE_KINDS, isPiece, DEFAULTS } from './obstacles.js';
import { STYLES } from '../sim/labrandom.js';

const SPECIES = speciesList();
const GROUPS = [['frog', 'Frogs'], ['toad', 'Toads'], ['newt', 'Newts'], ['axolotl', 'Axolotl'], ['gecko', 'Gecko'], ['skink', 'Skink'], ['crab', 'Crabs'], ['crawlLand', 'Land crawlers'], ['crawlWater', 'Water crawlers'], ['swim', 'Fish and larvae'], ['fly', 'Flies']];
const BASE = import.meta.env.BASE_URL;
const picture = (id) => `${BASE}assets/portraits/animal-${id}.webp`;

function Top({ lab }) {
  const paused = L.paused.value, rate = L.rate.value;
  return (
    <div class="lab-top">
      <b class="lab-brand">Test Lab</b>
      <button class="ico" title={paused ? 'Run' : 'Pause'} onClick={() => lab.pause(!paused)}>{paused ? '▶' : '⏸'}</button>
      <button class="ico" title="Step one frame (1/60 s)" onClick={() => lab.step(1)}>⏭</button>
      <span class="chips" title="How fast animals move compared with real time">
        {RATES.map((r) => <button key={r} class={!paused && rate === r ? 'on' : ''} onClick={() => { lab.pause(false); lab.rate(r); }}>{r}×</button>)}
      </span>
      <span class="chips" title="Camera">
        {[['top', 'Top'], ['front', 'Front'], ['low', 'Low'], ['back', 'Back']].map(([id, n]) => <button key={id} onClick={() => lab.view(id)}>{n}</button>)}
      </span>
      <span class="grow" />
      <button title="Copy a link that opens this same lab" onClick={() => lab.copyLink()}>Link</button>
      <span class="lab-fps">{L.backend.value} · {Math.round(L.fps.value)} fps</span>
    </div>
  );
}

// Obstacles: exact-size shapes cut into the ground, and the game's own hardscape. Put one in an animal's way, or tap the floor.
function Obstacles({ lab }) {
  const ob = lab.obstacles, kind = L.obKind.value, piece = isPiece(kind), pick = L.pick.value;
  const choose = (k) => {
    L.obKind.value = k;
    if (DEFAULTS[k]) { L.obW.value = DEFAULTS[k].w; L.obD.value = DEFAULTS[k].d; L.obH.value = DEFAULTS[k].h; }
  };
  const slider = (label, sig, min, max, step, unit = ' cm') => <label>{label} <b>{sig.value}{unit}</b><input type="range" min={min} max={max} step={step} value={sig.value} onInput={(e) => { sig.value = +e.currentTarget.value; }} /></label>;
  return (
    <>
      <h3>Obstacles <button class="mini" onClick={() => ob.clear()}>Clear</button></h3>
      <div class="gname">Exact size</div>
      <div class="chipgrid">{Object.entries(SHAPE_KINDS).map(([k, n]) => <button key={k} class={kind === k ? 'on' : ''} onClick={() => choose(k)}>{n}</button>)}</div>
      <div class="gname">The game's hardscape</div>
      <div class="chipgrid">{Object.entries(PIECE_KINDS).map(([k, n]) => <button key={k} class={kind === k ? 'on' : ''} onClick={() => choose(k)}>{n}</button>)}</div>
      {piece ? slider('Size', L.obSize, 4, 50, 1) : (
        <>
          {slider('Width', L.obW, 1, 60, 0.5)}
          {slider('Depth', L.obD, 1, 40, 0.5)}
          {slider(kind === 'trench' ? 'Deep' : 'Height', L.obH, 0.5, 20, 0.5)}
        </>
      )}
      {slider('Turn', L.obRot, 0, 180, 5, '°')}
      <div class="addrow2">
        <button class="go" onClick={() => ob.inWay()}>Put it in its way</button>
        <button onClick={() => ob.place(L.ground.value === 'shore' ? -TANK_W() / 4 : 0, 0)}>At the middle</button>
      </div>
      <button class={`wide${pick === 'place' ? ' on' : ''}`} onClick={() => { L.pick.value = pick === 'place' ? null : 'place'; }}>{pick === 'place' ? 'Tapping the floor places them…' : 'Tap the floor to place'}</button>
      {L.obstacles.value.length ? (
        <ul class="census">{L.obstacles.value.map((o) => <li key={o.id}><span>{(SHAPE_KINDS[o.kind] ?? PIECE_KINDS[o.kind])} {o.size ? `${o.size} cm` : `${o.w}×${o.d}×${o.h}`}</span><button class="mini" onClick={() => ob.remove(o.id)}>✕</button></li>)}</ul>
      ) : null}
    </>
  );
}
const TANK_W = () => window.lab.TANK.w;

function World({ lab, tab }) {
  const census = L.census.value;
  return (
    <section class={`card lab-world${tab === 'world' ? ' open' : ''}`}>
      <h3>Arena</h3>
      <label>Tank
        <select value={L.tank.value} onChange={(e) => lab.arena({ tank: e.currentTarget.value })}>
          {tankChoices().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label>Ground
        <select value={L.ground.value} onChange={(e) => lab.arena({ ground: e.currentTarget.value, depth: L.depth.value })}>
          {Object.entries(GROUNDS).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
      </label>
      <label>Water {L.ground.value === 'shore' ? 'in the pool' : 'over the floor'} <b>{L.depth.value ? `${L.depth.value} cm` : 'dry'}</b>
        <input type="range" min="0" max={maxDepth(L.ground.value)} step="1" value={L.depth.value} onInput={(e) => lab.depth(+e.currentTarget.value)} />
      </label>
      <Obstacles lab={lab} />
      <button class="wide" onClick={() => lab.reset()}>Start fresh (empty arena)</button>
      <label class="check"><input type="checkbox" checked={L.background.value} onChange={(e) => { L.background.value = e.currentTarget.checked; if (!e.currentTarget.checked) lab.background.stop(); else if (document.hidden) lab.background.start(); }} /> Keep running while this tab is hidden</label>
      <h3>Animals <button class="mini" onClick={() => lab.clear()}>Clear all</button></h3>
      {census.length === 0 ? <p class="dim">Nobody yet.</p> : (
        <ul class="census">{census.map((c) => <li key={c.id}><span>{c.name}</span><b>{c.n}</b></li>)}</ul>
      )}
    </section>
  );
}

function Add({ lab, tab }) {
  const sel = L.species.value;
  return (
    <section class={`card lab-add${tab === 'animals' ? ' open' : ''}`}>
      <h3>Add animals</h3>
      <div class="species">
        {GROUPS.map(([kind, title]) => {
          const list = SPECIES.filter((s) => s.kind === kind);
          if (!list.length) return null;
          return (
            <div key={kind} class="group">
              <div class="gname">{title}</div>
              <div class="pics">
                {list.map((s) => (
                  <button key={s.id} class={`pic${sel === s.id ? ' on' : ''}`} title={s.name} onClick={() => { L.species.value = s.id; }}>
                    <img src={picture(s.id)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div class="addrow">
        <label>How many
          <input type="number" min="1" max="60" value={L.count.value} onInput={(e) => { L.count.value = Math.max(1, Math.min(60, +e.currentTarget.value || 1)); }} />
        </label>
        <button class="go" onClick={() => lab.add(L.species.value, L.count.value)}>Add at the middle</button>
      </div>
      <label class="check"><input type="checkbox" checked={L.tapAdds.value} onChange={(e) => { L.tapAdds.value = e.currentTarget.checked; }} /> A tap on the floor adds them there</label>
    </section>
  );
}

// The Drive section of the selected animal: send it somewhere, round a path, or after a dot. The lab only says where; the animal gets there itself.
function Drive({ lab, info }) {
  const dr = lab.driver, tab = L.dtab.value, pick = L.pick.value, frogish = info.kind === 'frog' || info.kind === 'toad';
  const n = L.census.value.find((c) => c.id === info.sp)?.n ?? 1;
  if (!DRIVABLE.has(info.kind)) return <p class="dim">The lab cannot drive this kind of animal yet: it keeps its own mind.</p>;
  const glassClimber = !!SIM_SPECIES[info.sp]?.perch;     // (the red-eyed tree frog, the reed frog: a frog that climbs the glass)
  const tabs = [['free', 'Free'], ['goto', 'Go to'], ['path', 'Path'], ['follow', 'Follow'], ...(glassClimber ? [['climb', 'Climb']] : [])];
  return (
    <div class="drive">
      <h3>Drive</h3>
      <div class="seg">{tabs.map(([id, n2]) => <button key={id} class={tab === id ? 'on' : ''} onClick={() => { L.dtab.value = id; if (id !== 'goto' && id !== 'path') L.pick.value = null; if (id === 'free') dr.free(); }}>{n2}</button>)}</div>
      {tab === 'free' ? <p class="dim">It lives by its own mind.</p> : null}
      {tab === 'goto' ? (
        <>
          <button class={pick === 'goto' ? 'on' : ''} onClick={() => { L.pick.value = pick === 'goto' ? null : 'goto'; }}>{pick === 'goto' ? (CLIMBERS.has(info.kind) ? 'Tap the floor or the wall…' : 'Tap the floor…') : (CLIMBERS.has(info.kind) ? 'Pick a point on the floor or the wall' : 'Pick a point on the floor')}</button>
          {CLIMBERS.has(info.kind) ? <p class="dim">A point on the wall: it walks to the foot of the wall, climbs, and goes to that spot. Turn the camera to Back to see the wall.</p> : null}
        </>
      ) : null}
      {tab === 'path' ? (
        <>
          <div class="shapes">{Object.entries(SHAPES).map(([id, n2]) => <button key={id} onClick={() => lab.driver.path(id)}>{n2}</button>)}</div>
          <label>Width <b>{L.size.value} cm</b><input type="range" min="10" max="80" step="2" value={L.size.value} onInput={(e) => { L.size.value = +e.currentTarget.value; }} /></label>
          <label>Goes <select value={L.pathMode.value} onChange={(e) => { L.pathMode.value = e.currentTarget.value; }}><option value="loop">round and round</option><option value="once">once</option><option value="pingpong">back and forth</option></select></label>
          <div class="gname">A random path</div>
          <div class="rndrow">
            <select value={L.rndStyle.value} onChange={(e) => { L.rndStyle.value = e.currentTarget.value; }}>{Object.entries(STYLES).map(([id, n2]) => <option key={id} value={id}>{n2}</option>)}</select>
            <input type="number" min="1" max="999999" value={L.rndSeed.value} title="Seed: the same seed gives the same path" onInput={(e) => { L.rndSeed.value = Math.max(1, Math.min(999999, +e.currentTarget.value | 0)); }} />
          </div>
          <label>Length <b>{L.rndLength.value} cm</b><input type="range" min="60" max="600" step="20" value={L.rndLength.value} onInput={(e) => { L.rndLength.value = +e.currentTarget.value; }} /></label>
          <div class="addrow2">
            <button class="go" onClick={() => { L.rndSeed.value = 1 + ((Math.random() * 999998) | 0); lab.driver.random(); }}>Roll a new one</button>
            <button onClick={() => lab.driver.random()}>Again, this seed</button>
          </div>
          <div class="addrow2">
            <button class={pick === 'draw' ? 'on' : ''} onClick={() => { L.pick.value = pick === 'draw' ? null : 'draw'; }}>{pick === 'draw' ? `Tapping… ${L.draft.value.length} points` : 'Draw my own'}</button>
            {L.draft.value.length > 1 ? <button class="go" onClick={() => lab.driver.drawn()}>Go</button> : null}
            {L.draft.value.length ? <button class="mini" onClick={() => { L.draft.value = []; }}>Clear</button> : null}
          </div>
        </>
      ) : null}
      {tab === 'climb' ? (
        <>
          <div class="gname">A wall: the glass</div>
          <div class="seg">{PANES.map((id) => <button key={id} class={L.pane.value === id ? 'on' : ''} onClick={() => { L.pane.value = id; }}>{id[0].toUpperCase() + id.slice(1)}</button>)}</div>
          <button class="go" onClick={() => lab.driver.climb(L.pane.value)}>Send it up the {L.pane.value} glass</button>
          <div class="gname">An object in the arena</div>
          {(() => { const objs = L.obstacles.value.filter((o) => PERCH_PIECES.has(o.kind)); return objs.length ? (
            <>
              {objs.map((o) => <div key={o.id} class="dotrow"><span>{PIECE_KINDS[o.kind]} · #{o.id}</span><button class="mini" onClick={() => lab.driver.climbObject(o.id)}>Climb it</button></div>)}
              <button class={pick === 'climb' ? 'on' : ''} onClick={() => { L.pick.value = pick === 'climb' ? null : 'climb'; }}>{pick === 'climb' ? 'Tap an object…' : 'Or tap an object'}</button>
            </>
          ) : <p class="dim">Put a log, roots, a stump, a piece of cork or a bamboo pole in the arena (the Obstacles tab) first; it can then be climbed.</p>; })()}
          <p class="dim">It walks to the foot of the climb in its crawl and climbs by its own limbs, belly to the glass or the wood. The readout shows its phase and how it ended (no way, something in the way, gave up). Turn the camera to see it from outside.</p>
        </>
      ) : null}
      {tab === 'follow' ? (
        <>
          <label>The dot <select value={L.dotKind.value} onChange={(e) => { L.dotKind.value = e.currentTarget.value; }}><option value="wander">wanders at random</option><option value="orbit">goes round in a circle</option><option value="fixed">stands still</option></select></label>
          <label>Dot speed <b>{L.dotSpeed.value} cm/s</b><input type="range" min="1" max="12" step="0.5" value={L.dotSpeed.value} onInput={(e) => { L.dotSpeed.value = +e.currentTarget.value; }} /></label>
          <label>Stops this near <b>{L.keep.value} cm</b><input type="range" min="1" max="15" step="0.5" value={L.keep.value} onInput={(e) => { L.keep.value = +e.currentTarget.value; }} /></label>
          <button class="go" onClick={() => lab.driver.follow()}>Add a dot and follow it</button>
          {L.dots.value.map((d) => <div key={d.id} class="dotrow"><span>{d.id} · {d.kind}</span><button class="mini" onClick={() => lab.driver.removeDot(d.id)}>Remove</button></div>)}
        </>
      ) : null}
      {tab !== 'free' ? (
        <>
          <label>Pace <b>{L.pace.value.toFixed(1)}× its own walk</b><input type="range" min="0.3" max="1.6" step="0.1" value={L.pace.value} onInput={(e) => lab.driver.setPace(+e.currentTarget.value)} /></label>
          {frogish ? <label>Gait <select value={L.gait.value} onChange={(e) => lab.driver.setGait(e.currentTarget.value)}><option value="auto">its own choice</option><option value="walk">walk only</option><option value="hop">hop only</option></select></label> : null}
          {n > 1 ? <label class="check"><input type="checkbox" checked={L.all.value} onChange={(e) => { L.all.value = e.currentTarget.checked; }} /> Send all {n} of this kind</label> : null}
        </>
      ) : null}
    </div>
  );
}

function Selected({ lab, tab }) {
  const info = L.info.value;
  return (
    <section class={`card lab-sel${tab === 'sel' ? ' open' : ''}`}>
      <h3>Selected {info ? <button class="mini" onClick={() => lab.remove()}>Remove</button> : null}</h3>
      {!info ? <p class="dim">Tap an animal to select it.</p> : (
        <>
          <div class="who"><img src={picture(info.sp)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /><div><b>{info.name}</b><span class="dim"> #{info.id}</span></div></div>
          <table class="rows"><tbody>{info.rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
          <Drive lab={lab} info={info} />
        </>
      )}
    </section>
  );
}

// Random scenarios: each seed a whole situation, run for a few seconds, the radar's findings kept against it.
function Fuzz({ lab, tab }) {
  const f = L.fuzz.value;
  const num = (sig, min, max) => (e) => { sig.value = Math.max(min, Math.min(max, +e.currentTarget.value | 0 || min)); };
  return (
    <section class={`card lab-fuzz${tab === 'fuzz' ? ' open' : ''}`}>
      <h3>Random scenarios</h3>
      <p class="dim">Each seed builds a random situation: the ground and water, obstacles, a mix of animals, each on a random path. What the radar finds is kept against the seed, and a seed can be watched again.</p>
      <div class="fuzzin">
        <label>How many<input type="number" value={L.fuzzN.value} onInput={num(L.fuzzN, 1, 40)} /></label>
        <label>Seconds each<input type="number" value={L.fuzzSeconds.value} onInput={num(L.fuzzSeconds, 4, 90)} /></label>
        <label>From seed<input type="number" value={L.rndSeed.value} onInput={num(L.rndSeed, 1, 999999)} /></label>
      </div>
      <div class="addrow2">
        {f?.running ? <button onClick={() => lab.fuzz.stop()}>Stop</button> : <button class="go" onClick={() => lab.fuzz.run()}>Run {L.fuzzN.value}</button>}
        <button onClick={() => lab.fuzz.watch(L.rndSeed.value)}>Watch this seed</button>
      </div>
      {f ? <p class="dim">{f.running ? `Running ${f.done + 1} of ${f.n}… (seed ${f.seed0 + f.done})` : `Done: ${f.rows.length} of ${f.n}.`} <button class="mini" onClick={async () => { const t = lab.fuzz.text(); if (!(await navigator.clipboard?.writeText(t).then(() => true, () => false))) L.report.value = t; else L.note.value = 'Copied the list.'; }}>Copy list</button></p> : null}
      {f?.rows.length ? (
        <ul class="log fuzzlist">
          {f.rows.map((r) => (
            <li key={r.seed} class={r.bad ? 'bad' : r.warn ? 'warn' : ''} onClick={() => lab.fuzz.watch(r.seed)} title={(r.first ?? []).join('\n') || 'Nothing found'}>
              <span class="t">#{r.seed}</span>
              <span><b>{r.bad ? `${r.bad} bad` : r.warn ? `${r.warn} to look at` : 'clean'}</b> · {r.animals} animals, {r.obstacles} obstacles{r.depth ? `, ${r.depth} cm water` : ''}<br /><i>{r.species.slice(0, 4).join(', ')}{Object.keys(r.kinds).length ? ' — ' + Object.entries(r.kinds).map(([k, n]) => `${k} ${n}`).join(', ') : ''}</i></span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Radar({ lab, tab }) {
  const rows = L.log.value;
  return (
    <section class={`card lab-radar${tab === 'radar' ? ' open' : ''}`}>
      <h3>
        Bug radar <span class={`badge${L.bugs.value ? ' hot' : ''}`}>{L.bugs.value}</span>
        <label class="inl"><input type="checkbox" checked={L.pauseOnBug.value} onChange={(e) => { L.pauseOnBug.value = e.currentTarget.checked; }} /> pause on a bug</label>
        <button class="mini" onClick={() => lab.radar.clear()}>Clear</button>
        <button class="mini go" onClick={() => lab.copyReport()}>Copy report</button>
      </h3>
      {rows.length === 0 ? <p class="dim">Nothing found. It watches every animal: stuck, popped by the engine, through the ground, jumps, spins, shivers, bodies inside each other.</p> : (
        <ul class="log">
          {rows.slice(0, 40).map((r) => (
            <li key={r.key} class={r.sev} onClick={() => lab.focus(r.animal)} title="Tap to look at it">
              <span class="t">{Math.round(r.t)}s</span><b>{r.name} #{r.id}</b> {r.msg}{r.n > 1 ? <i> ×{r.n}</i> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Note() {
  const n = L.note.value;
  return n ? <div class="lab-note">{n}</div> : null;
}

// Where the browser would not let the report onto the clipboard: the text, to select and copy by hand.
function ReportBox() {
  const text = L.report.value;
  if (!text) return null;
  return (
    <div class="lab-modal" onClick={(e) => { if (e.target === e.currentTarget) L.report.value = null; }}>
      <div class="card">
        <h3>Report <button class="mini" onClick={() => { L.report.value = null; }}>Close</button></h3>
        <p class="dim">Select all and copy.</p>
        <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()} />
      </div>
    </div>
  );
}

function Tabs() {
  const tab = L.tab.value;
  return (
    <nav class="lab-tabs">
      {[['animals', 'Add'], ['world', 'Arena'], ['sel', 'Selected'], ['radar', `Radar${L.bugs.value ? ' ' + L.bugs.value : ''}`], ['fuzz', 'Random']].map(([id, n]) => (
        <button key={id} class={tab === id ? 'on' : ''} onClick={() => { L.tab.value = tab === id ? null : id; }}>{n}</button>
      ))}
    </nav>
  );
}

// Keep the tank clear of the panels: the camera rig centres it in what is left (the game does the same, ui/layout.js).
function useInsets(game) {
  const tab = L.tab.value;
  useEffect(() => {
    const W = innerWidth, H = innerHeight;
    if (W > 860) game.rig.setInset(280, 270, 48, 190, W, H);
    else game.rig.setInset(0, 0, 44, tab ? Math.round(H * 0.42) : 48, W, H);
  }, [tab]);
  useEffect(() => {
    const on = () => game.resize();
    addEventListener('orientationchange', on);
    return () => removeEventListener('orientationchange', on);
  }, []);
}

export function Lab({ game }) {
  const lab = window.lab;
  const tab = L.tab.value;
  useInsets(game);
  return (
    <div class="lab">
      <Top lab={lab} />
      <div class="lab-left"><World lab={lab} tab={tab} /><Add lab={lab} tab={tab} /><Fuzz lab={lab} tab={tab} /></div>
      <div class="lab-right"><Selected lab={lab} tab={tab} /></div>
      <Radar lab={lab} tab={tab} />
      <Note />
      <ReportBox />
      <Tabs />
    </div>
  );
}
