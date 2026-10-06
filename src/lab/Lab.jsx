// The test lab's panels: the clock and view bar on top, the arena and the animals on the left, the selected animal on the right.
// On a phone the three become one bottom sheet with tabs. Everything here calls window.lab (index.js), the same handle a headless run uses.
import { useEffect } from 'preact/hooks';
import { L, RATES } from './state.js';
import { tankChoices, GROUNDS, maxDepth } from './arena.js';
import { speciesList } from './spawn.js';
import { SHAPES, DRIVABLE } from './driver.js';

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
      <span class="lab-fps">{L.backend.value} · {Math.round(L.fps.value)} fps</span>
    </div>
  );
}

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
      <h3>In the arena <button class="mini" onClick={() => lab.clear()}>Clear all</button></h3>
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
  const tabs = [['free', 'Free'], ['goto', 'Go to'], ['path', 'Path'], ['follow', 'Follow']];
  return (
    <div class="drive">
      <h3>Drive</h3>
      <div class="seg">{tabs.map(([id, n2]) => <button key={id} class={tab === id ? 'on' : ''} onClick={() => { L.dtab.value = id; if (id !== 'goto' && id !== 'path') L.pick.value = null; if (id === 'free') dr.free(); }}>{n2}</button>)}</div>
      {tab === 'free' ? <p class="dim">It lives by its own mind.</p> : null}
      {tab === 'goto' ? (
        <>
          <button class={pick === 'goto' ? 'on' : ''} onClick={() => { L.pick.value = pick === 'goto' ? null : 'goto'; }}>{pick === 'goto' ? 'Tap the floor…' : 'Pick a point on the floor'}</button>
        </>
      ) : null}
      {tab === 'path' ? (
        <>
          <div class="shapes">{Object.entries(SHAPES).map(([id, n2]) => <button key={id} onClick={() => lab.driver.path(id)}>{n2}</button>)}</div>
          <label>Width <b>{L.size.value} cm</b><input type="range" min="10" max="80" step="2" value={L.size.value} onInput={(e) => { L.size.value = +e.currentTarget.value; }} /></label>
          <label>Goes <select value={L.pathMode.value} onChange={(e) => { L.pathMode.value = e.currentTarget.value; }}><option value="loop">round and round</option><option value="once">once</option><option value="pingpong">back and forth</option></select></label>
          <div class="addrow2">
            <button class={pick === 'draw' ? 'on' : ''} onClick={() => { L.pick.value = pick === 'draw' ? null : 'draw'; }}>{pick === 'draw' ? `Tapping… ${L.draft.value.length} points` : 'Draw my own'}</button>
            {L.draft.value.length > 1 ? <button class="go" onClick={() => lab.driver.drawn()}>Go</button> : null}
            {L.draft.value.length ? <button class="mini" onClick={() => { L.draft.value = []; }}>Clear</button> : null}
          </div>
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
      {[['animals', 'Add'], ['world', 'Arena'], ['sel', 'Selected'], ['radar', `Radar${L.bugs.value ? ' ' + L.bugs.value : ''}`]].map(([id, n]) => (
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
      <div class="lab-left"><World lab={lab} tab={tab} /><Add lab={lab} tab={tab} /></div>
      <div class="lab-right"><Selected lab={lab} tab={tab} /></div>
      <Radar lab={lab} tab={tab} />
      <Note />
      <ReportBox />
      <Tabs />
    </div>
  );
}
