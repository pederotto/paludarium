# Rules for every session and agent

The owner's binding rules, moved here on 6 October 2026 from the master document's "Rules dictated so far" so that every
session and every agent loads them with CLAUDE.md. This file is the one place they live: when the owner changes a rule,
edit it here and note the change in the master document's handoff. Git, publishing, secrets, assets and speed rules
are in CLAUDE.md itself.

## Documents
- The master document's "Start here" tab and the rig playbook are kept current by the session doing the work, in that
  session and before its turn ends, whenever it changes what is live, what is left, a rule, a tool or how animals are
  built. The document first, then the report. Edit only the sections your change touches; read a section before
  rewriting it (several sessions share both documents).
- Agent work and notes live under `paludarium master/.agents/` on the Mac (a cloud scratchpad is wiped on restart).

## Agents and cost
- Models (owner, 6 Oct 2026, replacing "Opus only"): base workers run on Sonnet 5.5 at high effort; leads, checkers and
  coordinators on Opus 5.5 at high effort.
- At most 30 agents in a run unless the owner raises it (45 for run "next", 20 for run "repos"); about 5 at once on
  the 8 GB Mac. Call caps are enforced from outside the agent: caps written in a prompt were ignored.
- A fresh agent for each unrelated task; resume one only when its context is needed. The lead plans, approves and
  integrates; it does not write feature code. Leads follow docs/AGENT_RUNS.md.

## How work is done and checked
- Every task has a check that fails before the change and passes after it. Numbers from a seeded run beat
  screenshots. Every number says how much data it rests on; too little is "inconclusive".
- A builder first sends an analysis with a proposal of at most 15 lines, then implements after approval. Above 50 %
  more lines than proposed, or any new file: stop and ask.
- Two failed attempts on the same check: stop and report. A third only with the owner's word and a root-cause note
  with file:line evidence.
- Done means committed, its check passing, confirmed by a second agent, and passing with everything else integrated.
- Reports at most 25 lines, replies 8. What did not get done is reported as plainly as what did. Report against the
  real-world target, never against how much better it is than before; a changed target is reported as a change.
- Search before reading, read line ranges, never open binaries, cap command output, run the narrowest test. Only the
  reference scout and checkers open images. No web research unless the task says so. No scope creep.
- Logic goes into a module; `src/sim/animals.js` gets only the call site, so module work runs without its lock.

## Files and other sessions
- The frog pipeline's files are read, never edited (lizard brief; approved exception: the lizard hook in
  skeleton.js and the bone limit raised to 25).
- Tell another session before changing code it depends on, and keep those changes small.
- Tasks run in parallel only when their files do not overlap. A shared file is edited by one builder at a time, under
  a lock.
- Commit per task on a dedicated branch. No merge to main and no push without the owner.

## Animals and models
- Every animal gets an anatomical skeleton, then muscles, then skin, as close to reality as possible (the game is to be
  sold), checked against the owner's scans, photos and videos. Lizards follow the frog pipeline stage for stage.
- Animals are their real size (gecko 4.4 cm snout to vent, skink 9 cm). Timing and posture come from motion sheets and
  published figures; a guess is labelled as one.
- A model is not re-rigged or re-exported without asking. Originals stay untouched in `art-src/raw/`. The source
  credited for the owner's models is always Peder Winterniz.

## Equipment and water
- Filters behave like real hardware: pump-driven, no air systems; external ones in the cabinet under the tank, fed by
  the overflow drain. Real pump logic; an installation gets the bigger pump when its lift needs it; a pump's head is
  never inflated. Figures come from real product sheets.
- The game shows invented names only: real product names and links stay out of the game and its code.
- Fish are never hard-coded to face the current: it pushes them, and where they point follows from where they want to
  go and what it costs.
- Water under the substrate is drawn at the level the sim models, in all three set-ups: false bottom, LECA layer, plain
  substrate.

## Machine safety
- Never `git stash`: the stash is shared by every worktree.
- Never kill processes by pattern; kill only what you started. Stop each dev server when its agent ends.
