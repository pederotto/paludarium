// The terrarium generator and its preset list are loaded on demand. Using
// import.meta.glob (instead of a plain import) keeps the game building even
// if the generator files are absent.

const PRESETS = import.meta.glob('../content/presets.js');
const GENERATOR = import.meta.glob('../sim/generator.js');

export async function loadPresets() {
  const f = Object.values(PRESETS)[0];
  return f ? (await f()).PRESETS ?? [] : [];
}

export async function loadGenerator() {
  const f = Object.values(GENERATOR)[0];
  return f ? f() : null;
}
