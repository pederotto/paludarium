// Paints one guppy look onto a model's maps off the main thread (guppypaint.js paintGuppyModel). Receives { id, look, maps } (maps:
// { N, coords, parts, base } as byte arrays, kept by the worker after the first message for that sex), answers { id, rgba } transferred.
import { paintGuppyModel } from './guppypaint.js';

const MAPS = {};
self.onmessage = (e) => {
  const { id, look, sex, maps } = e.data;
  try {
    if (maps) MAPS[sex] = maps;
    const img = paintGuppyModel(look, MAPS[sex]);
    self.postMessage({ id, rgba: img.rgba, N: img.N, H: img.H }, [img.rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
