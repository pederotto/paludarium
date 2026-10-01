// Five hearts that fill to show how happy the tank (or one animal) is.

const HEART = 'M12 20s-8-5-8-11a4.500 4.500 0 0 1 8-2.500A4.500 4.500 0 0 1 20 9c0 6-8 11-8 11z';

export function Hearts({ value, size = 30, label = 'How happy everyone is' }) {
  const v = Math.max(0, Math.min(1, value)) * 5;
  return (
    <div class={'k-hearts' + (value < 0.45 ? ' low' : '')} role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => {
        const f = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} class="k-heart" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 24 24"><path d={HEART} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.4)" stroke-width="1.4" stroke-linejoin="round" /></svg>
            <span class="fill" style={{ width: Math.round(f * 100) + '%' }}>
              <svg width={size} height={size} viewBox="0 0 24 24"><path d={HEART} fill="#ff5d8f" stroke="#ffb3c9" stroke-width="1.4" stroke-linejoin="round" /></svg>
            </span>
          </span>
        );
      })}
    </div>
  );
}
