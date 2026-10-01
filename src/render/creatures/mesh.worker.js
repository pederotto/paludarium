// Meshes bodies off the main thread. Receives { id, key, detail } (a BODIES id: defs hold functions and cannot be
// posted), answers { id, arrays } with the buffers transferred, or { id, error }.
//
// Colour morphs ('axolotl:golden' …) share their species' shape: the surface net runs once per shape and each morph
// only repaints. The shape is reused only when shapeSignature (box, cell and 64 sdf samples) matches, so a morph that
// really differs in shape is meshed on its own.
import { BODIES } from './bodies/index.js';
import { bodyShape, bodyArrays, shapeSignature } from './shape.js';

const SHAPES = new Map();   // `${group}|${detail}` -> { sig, shape }, the last shape built for that species

self.onmessage = (e) => {
  const { id, key, detail } = e.data;
  try {
    const def = BODIES[key]();
    const group = `${key.split(':')[0]}|${detail}`;
    const sig = shapeSignature(def, detail);
    let hit = SHAPES.get(group);
    if (!hit || hit.sig !== sig) { hit = { sig, shape: bodyShape(def, detail) }; SHAPES.set(group, hit); }
    const a = bodyArrays(def, detail, hit.shape);
    // The cached shape keeps its own normals and indices: hand over copies of what is shared, the rest by transfer.
    const out = { ...a, normal: a.normal.slice(), index: a.index.slice() };
    self.postMessage({ id, arrays: out }, [out.position.buffer, out.normal.buffer, out.color.buffer, out.rig.buffer, out.index.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
