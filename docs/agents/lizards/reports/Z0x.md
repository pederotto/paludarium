# Z0x report: state-dump determinism (DRAFT, in progress)
Model: claude-opus-5-5.
Cause (from grep, run proof pending): behaviour is keyed on the animal id: src/sim/animals.js:3552 and 3670 `a.id % 2` pick the side, 3531 and 3655 `cos/sin(a.id*2.4)` set the push direction. The id counter `let nextId = 1` (animals.js:558) is module-private, is only ever incremented (845-846), and the title tank runs on real time first, so it lands on 107 or 108. Parity flips, so the geckos split by t=10 s.
Fix (harness only, no hook): in init, after loadTank and before seeding, one throwaway `A.add` runs while `A.all` is temporarily an array of fake ids 1..K-1 (K = 4096). The game's own skip loop (animals.js:846, "a loaded save may already use this number") pushes the counter to K, then `A.remove` drops the throwaway. Every page load then numbers animals K+1, K+2, ...
Runner: watchdog, so 120 s with no output kills the Chrome process group it started and exits 2.
