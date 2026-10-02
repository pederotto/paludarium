// Typed arrays to base64 and back, in the browser (btoa/atob) and in Node (Buffer). Little-endian on the wire.
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(str) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, 'base64'); return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toB64(typed) {
  if (typed instanceof Uint8Array) return bytesToB64(typed);
  if (typed instanceof Uint16Array) {
    if (LE) return bytesToB64(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    const dv = new DataView(new ArrayBuffer(typed.length * 2));
    typed.forEach((v, i) => dv.setUint16(i * 2, v, true));
    return bytesToB64(new Uint8Array(dv.buffer));
  }
  throw new TypeError('toB64: Uint8Array or Uint16Array only');
}
export function fromB64(str, Type = Uint8Array) {
  const b = b64ToBytes(str);
  if (Type === Uint8Array) return b;
  if (Type === Uint16Array) {
    const n = b.length >> 1, out = new Uint16Array(n), dv = new DataView(b.buffer, b.byteOffset, n * 2);
    for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, true);
    return out;
  }
  throw new TypeError('fromB64: Uint8Array or Uint16Array only');
}
