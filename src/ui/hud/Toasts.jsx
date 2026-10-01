import { useEffect, useState } from 'preact/hooks';
import { S } from '../store.js';

export function Toasts() {
  return <div class="toasts">{S.toasts.value.map((t) => <div key={t.id} class={'toast glass strong ' + t.kind}>{t.text}</div>)}</div>;
}

// The tool hint, as a toast that fades after about 4 s whenever the hint changes (re-shown by Learn > Show tip).
export function HintToast() {
  const h = S.hint.value;
  const pulse = S.hintPulse.value;
  const [show, setShow] = useState(true);
  useEffect(() => {
    if (!h) { setShow(false); return undefined; }
    setShow(true);
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, [h, pulse]);
  if (!h) return null;
  return <div class={'hinttoast glass' + (show && !S.hub.value ? ' on' : '')} role="status" aria-live="polite">{h}</div>;
}
