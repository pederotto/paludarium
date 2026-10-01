// A species portrait, rendered lazily from the game's own model.

import { useState, useEffect } from 'preact/hooks';
import { ctx } from '../../app/ctx.js';
import { Portraits } from '../../engine/portraits.js';

export function Portrait({ kind, id, size = 64, silhouette = false }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    ctx.portraits ??= new Portraits();
    ctx.portraits.get(kind, id).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [kind, id]);
  return (
    <div class="portrait" style={{ width: size, height: size, flex: 'none', borderRadius: size > 80 ? 14 : 8, background: size > 80 ? 'radial-gradient(circle at 50% 40%, #fbf6e6, #ddd3b4)' : 'rgba(255,255,255,.06)', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '1px solid rgba(120,100,40,.25)' }}>
      {url ? <img src={url} width={size} height={size} alt="" style={{ objectFit: 'contain', filter: silhouette ? 'brightness(0) opacity(.45)' : 'none' }} /> : <span style={{ width: size * 0.3, height: size * 0.3, borderRadius: '50%', background: 'rgba(120,100,40,.25)' }} />}
    </div>
  );
}
