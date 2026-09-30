// The time-lapse overlay: progress while it runs, a short report when it ends.

import { Icon } from '../icons.jsx';
import { S } from '../store.js';
import { finishTimelapse, endTimelapse } from '../../app/timelapse.js';

export function Timelapse() {
  const t = S.timelapse.value;
  if (!t) return null;
  const pct = Math.min(100, Math.round((t.day / t.days) * 100));
  return (
    <div class="lapse glass strong">
      {t.done ? (
        <>
          <h3><Icon name="clock" size={17} /> {t.done.days} days later</h3>
          <ul>{t.done.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <div class="acts"><button class="btn primary" onClick={endTimelapse}>Back to the tank</button></div>
        </>
      ) : (
        <>
          <h3><Icon name="clock" size={17} /> Time-lapse · day {Math.floor(t.day) + 1} of {t.days}</h3>
          <div class="bar"><i style={{ width: pct + '%' }} /></div>
          <div class="acts"><button class="btn sm" onClick={finishTimelapse}><Icon name="pause" size={14} /> Stop</button></div>
        </>
      )}
    </div>
  );
}
