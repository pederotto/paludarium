// The entry the preview server injects into a page (tools/metrics-collector.mjs), so any build can be recorded, one that does
// not contain the recorder included. The game's own build reaches the same code through a dynamic import in main.jsx.
import { start } from './index.js';
start();
