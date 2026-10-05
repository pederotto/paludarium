// Kids' story sheet (N18): the chapter's lines, its building challenges with a tick when the
// game's state meets them, and "Did you know?" facts from the species data once earned.
import { Icon } from '../icons.jsx';
import { Portrait } from '../panels/Portrait.jsx';
import * as KK from '../../app/kids.js';
import { STORY, STORY_END, currentChallenge } from '../../content/kids-story.js';

const { K } = KK;

export function StorySheet({ Sheet }) {
  const p = K.story.value;
  const ch = STORY[p.chapter];
  const cur = currentChallenge(p);
  if (!ch) {
    return (
      <Sheet id="story">
        <div class="k-story">
          <div class="k-st-lines">{STORY_END.map((l) => <p key={l}>{l}</p>)}</div>
          <button class="go" onClick={KK.restartStory}>Start the story again</button>
        </div>
      </Sheet>
    );
  }
  const facts = [...(ch.facts ?? []), ...ch.challenges.filter((x) => p.done[x.id]).flatMap((x) => x.facts ?? [])];
  return (
    <Sheet id="story">
      <div class="k-story">
        <div class="k-st-dots">{STORY.map((c, i) => <i key={c.id} class={i < p.chapter ? 'done' : i === p.chapter ? 'on' : ''} />)}</div>
        <div class="k-st-head">
          <Portrait kind="animal" id={ch.card} size={72} />
          <div><small>Chapter {p.chapter + 1}</small><h4>{ch.title}</h4></div>
        </div>
        <div class="k-st-lines">{ch.story.map((l) => <p key={l}>{l}</p>)}</div>
        <ul class="k-st-goals">
          {ch.challenges.map((x) => {
            const done = !!p.done[x.id], now = cur?.x === x;
            const held = x.hold && !done ? Math.min(1, (p.held?.[x.id] ?? 0) / x.hold) : 0;
            return (
              <li key={x.id} class={(done ? 'done' : '') + (now ? ' now' : '')}>
                <span class="tick">{done ? <Icon name="check" size={22} stroke={3} /> : null}</span>
                <span class="txt">{x.text}{held ? <span class="bar"><i style={{ width: Math.round(held * 100) + '%' }} /></span> : null}</span>
                {now && x.act ? <button class="go" onClick={() => KK.act(x.act)}>Go</button> : null}
              </li>
            );
          })}
        </ul>
        {facts.length ? (
          <div class="k-st-facts"><b>Did you know?</b>{facts.map((f) => <p key={f.text}>{f.text}</p>)}</div>
        ) : null}
      </div>
    </Sheet>
  );
}
