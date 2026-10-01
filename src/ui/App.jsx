import { S } from './store.js';
import { Title } from './Title.jsx';
import { TopBar } from './hud/TopBar.jsx';
import { ToolRail } from './hud/ToolRail.jsx';
import { ToolOptions } from './hud/ToolOptions.jsx';
import { Vitals } from './hud/Vitals.jsx';
import { Bottom } from './hud/Bottom.jsx';
import { Toasts } from './hud/Toasts.jsx';
import { InfoBanner } from './hud/InfoBanner.jsx';
import { Coach } from './hud/Coach.jsx';
import { Photo } from './hud/Photo.jsx';
import { Timelapse } from './hud/Timelapse.jsx';
import { KidsHud } from './kids/Kids.jsx';
import { Modals } from './panels/Modals.jsx';

export function App() {
  const playing = S.screen.value === 'play';
  const photo = S.photo.value;
  const lapse = !!S.timelapse.value;
  const kids = S.kids.value;
  return (
    <>
      {playing && kids ? <KidsHud /> : null}
      {playing && !kids && !photo && !lapse ? (
        <>
          <TopBar />
          <ToolRail />
          <ToolOptions />
          <Vitals />
          <Bottom />
          <InfoBanner />
          <Coach />
        </>
      ) : null}
      {playing && !kids && photo ? <Photo /> : null}
      {playing && !kids ? <Timelapse /> : null}
      {S.screen.value === 'title' ? <Title /> : null}
      <Toasts />
      <Modals />
      {S.busy.value ? <div class="busy"><div class="box glass strong"><div class="spin" /><div>{S.busy.value.text}</div></div></div> : null}
    </>
  );
}
