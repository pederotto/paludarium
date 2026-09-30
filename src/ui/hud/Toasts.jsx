import { S } from '../store.js';

export function Toasts() {
  return <div class="toasts">{S.toasts.value.map((t) => <div key={t.id} class={'toast glass strong ' + t.kind}>{t.text}</div>)}</div>;
}
