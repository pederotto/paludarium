// A tiny event emitter.
export class Emitter {
  constructor() { this.h = new Map(); }
  on(name, fn) {
    if (!this.h.has(name)) this.h.set(name, new Set());
    this.h.get(name).add(fn);
    return () => this.h.get(name)?.delete(fn);
  }
  once(name, fn) { const off = this.on(name, (...a) => { off(); fn(...a); }); return off; }
  emit(name, ...args) { for (const fn of [...(this.h.get(name) ?? [])]) fn(...args); }
}
