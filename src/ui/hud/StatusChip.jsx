// Top right: one status chip ("Thriving", "Needs attention (2)", "In trouble") with three micro gauges,
// the career wallet beside it, and the display buttons. Tapping the chip toggles the status drawer.
import './hud2.css';
import { Icon } from '../icons.jsx';
import { S, openModal, hudRules } from '../store.js';
import { ctx } from '../../app/ctx.js';
import { Care } from '../../app/actions.js';
import { chemChip, plainWhy } from '../../app/modes.js';
import { SPECIES } from '../../sim/animals.js';
import { waterScore, waterWord } from './Vitals.jsx';

const level3 = (v, lo, hi, warn) => {
  const dev = v < lo ? lo - v : v > hi ? v - hi : 0;
  return dev === 0 ? 'good' : dev < warn ? 'warn' : 'bad';
};

// Reads the live snapshot into { state, label, gauges, concerns }. Concerns are plain-word problems, worst first,
// each with an optional one-tap fix (a Care action) or a place to read more.
export function assess(live) {
  const e = live.env, hud = hudRules(), W = ctx.game?.world;
  const hygro = !!W?.equipment.has('hygro'), testKit = !!W?.equipment.has('testKit');
  const concerns = [];
  const add = (id, level, text, fix, more) => concerns.push({ id, level, text, fix, more });
  const wScore = waterScore(e);
  const gauges = {
    temp: hygro ? level3(e.temp, 20, 27, 3) : 'off',
    hum: hygro ? level3(e.humidity, 70, 96, 12) : 'off',
    water: level3(wScore, 0.7, 1, 0.25),
  };
  const mist = { label: 'Mist', icon: 'drop', fn: Care.mist };
  if (hygro) {
    if (e.temp > 27) add('hot', e.temp > 30 ? 'bad' : 'warn', hud.numbers ? `Too warm: ${e.temp.toFixed(1)}°C` : 'It is too warm in the tank', null, ['lab', 'temp']);
    else if (e.temp < 20) add('cold', e.temp < 17 ? 'bad' : 'warn', hud.numbers ? `Too cool: ${e.temp.toFixed(1)}°C` : 'It is too cool in the tank', null, ['lab', 'temp']);
    if (e.humidity < 70) add('dry', e.humidity < 58 ? 'bad' : 'warn', hud.numbers ? `Air is dry: ${Math.round(e.humidity)}% humidity` : 'The air is too dry', mist, ['lab', 'humidity']);
    else if (e.humidity > 96) add('damp', 'warn', hud.numbers ? `Air is saturated: ${Math.round(e.humidity)}%` : 'The air is very damp', null, ['lab', 'humidity']);
  }
  const chem = chemChip(e);
  if (!chem.ok || wScore < 0.6) {
    add('water', wScore < 0.35 ? 'bad' : 'warn', hud.numbers && testKit ? `Water quality is ${waterWord(e).toLowerCase()}: ${chem.why || 'check nitrogen'}` : 'The water is dirty', { label: 'Water change', icon: 'flask', fn: Care.waterChange }, ['codex', 'concept:nitrogen-cycle']);
  }
  if (e.algae > 0.3) add('algae', 'warn', 'Algae is blooming', { label: 'Scrub algae', icon: 'eraser', fn: Care.scrubAlgae }, ['codex', 'concept:algae']);
  if (e.mold > 0.35) add('mould', e.mold > 0.6 ? 'bad' : 'warn', e.mold > 0.6 ? 'Mould is spreading' : 'Mould is appearing', null, ['codex', 'concept:mould']);
  if (e.soil < 0.2) add('soil', 'warn', 'The soil is dry', mist, ['codex', 'concept:soil-moisture']);
  else if (e.soil > 0.92) add('soggy', 'warn', 'The soil is soggy', null, ['codex', 'concept:soil-moisture']);
  if (e.condense > 0.5) add('fog', 'warn', 'The glass is fogged with dew', { label: 'Wipe glass', icon: 'eraser', fn: Care.wipe }, ['codex', 'concept:dew-point']);
  if (live.water.outlets && !live.water.pumpRunning && live.water.pumpOn) add('pump', 'bad', 'The pump has stopped', null, hud.flowPanel ? ['flow'] : ['care']);
  for (const c of live.census) {
    const hungry = c.why === 'hungry' || c.hunger > 0.75;
    if (c.hp < 0.6 || c.why || hungry) {
      const aquatic = SPECIES[c.id]?.group === 'Fish';
      const why = hungry && !c.why ? 'hungry' : c.why;
      add('an:' + c.id, c.hp < 0.35 ? 'bad' : 'warn', `${c.name}: ${why ? (hud.numbers ? why : plainWhy(why)) : 'not well'}`,
        hungry ? (aquatic ? { label: 'Feed fish', icon: 'bowl', fn: Care.feed } : { label: 'Add flies', icon: 'bug', fn: Care.flies }) : /dry/.test(why ?? '') ? mist : null, ['codex', 'animal:' + c.id]);
    }
  }
  // More of a species than fit in a tank this size (game/stocking.js): they stress each other.
  for (const o of live.stock?.over ?? []) {
    if (concerns.some((c) => c.id === 'an:' + o.id && /crowd|too many/.test(c.text))) continue;   // the animals already say so
    const nm = SPECIES[o.id]?.name ?? o.id;
    add('crowd:' + o.id, o.n > o.room * 1.5 ? 'bad' : 'warn', hud.numbers ? `${nm}: ${o.n} where about ${o.room} fit in this tank` : `Too many ${nm.toLowerCase()} for this tank`, null, ['codex', 'animal:' + o.id]);
  }
  if (live.plants.sick) add('plants', live.plants.sick > 2 ? 'warn' : 'warn', `${live.plants.sick} plant${live.plants.sick > 1 ? 's' : ''} struggling`, null, ['care']);
  concerns.sort((a, b) => (b.level === 'bad') - (a.level === 'bad'));
  const bad = concerns.some((c) => c.level === 'bad');
  const state = bad ? 'bad' : concerns.length ? 'warn' : 'good';
  const label = bad ? 'In trouble' : concerns.length ? `Needs attention (${concerns.length})` : 'Thriving';
  const short = bad ? 'Trouble' : concerns.length ? `Attention (${concerns.length})` : 'Thriving';
  return { state, label, short, gauges, concerns };
}

export function toggleDrawer() { S.hub.value = null; S.right.value = !S.right.value; }

export function StatusChip() {
  const live = S.live.value;
  const career = S.career.value;
  if (!live) return null;
  const a = assess(live);
  const e = live.env;
  const open = S.right.value;
  const tip = {
    temp: `Temperature ${e.temp.toFixed(1)}°C`, hum: `Humidity ${Math.round(e.humidity)}%`, water: `Water: ${waterWord(e)}`,
  };
  const isCareer = career && career.mode === 'career';
  return (
    <div class="topr">
      <div class="statusbar glass">
        {isCareer ? (
          <>
            <div class="funds" title="Funds"><Icon name="coin" size={15} /><span class="num">{Math.round(career.funds).toLocaleString()}</span></div>
            <button class="rk" onClick={() => openModal('studio', 'career')} title={`${career.rank} · ${career.rep} rep`} aria-label={`Rank ${career.rank}`}>
              <span class="ring" style={{ '--p': Math.round(career.levelProgress * 100) }}><span>{career.level}</span></span>
              <span class="rk-t"><b>{career.rank}</b><small>{career.nextIn > 0 ? `${career.nextIn} to next` : 'Max rank'}</small></span>
            </button>
            <i class="vsep" />
          </>
        ) : null}
        <button class={'schip ' + a.state + (open ? ' open' : '')} onClick={toggleDrawer} aria-expanded={open} data-testid="status-chip" title="Tank status: tap for details (H hides panels)">
          <i class="sdot" />
          <span class="slabel">{a.label}</span><span class="slabel-s">{a.short}</span>
          <span class="mbars" aria-hidden="true">
            {['temp', 'hum', 'water'].map((k) => <i key={k} class={'mb ' + a.gauges[k]} title={tip[k]} />)}
          </span>
          <Icon name={open ? 'chevronR' : 'chevronL'} size={13} />
        </button>
      </div>
    </div>
  );
}
