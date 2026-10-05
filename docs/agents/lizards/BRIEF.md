# Brief: lizard pipeline, open backlog, UI and presets

You are the lead on a large job in this project, Paludarium, a 3D tank and habitat simulation. I am explicitly opting in to multi-agent orchestration for it: subagents (nested pod managers are fine) and, where a mechanical fan-out fits, a workflow. The ceiling is 15 agents in total, managers included. That is a ceiling, not a target: use the fewest the real parallelism supports.

Earlier multi-agent runs here burned enormous amounts of tokens, took very long, and produced wrong work that nobody checked or coordinated. This brief sets a lean protocol to prevent that. Follow it unless the codebase gives you a concrete reason not to, and tell me when you deviate.

If this brief is not already a file in the repo, save it as `BRIEF.md` in the blackboard folder (see "How to run it") before anything else, so it survives compaction and agents can read sections of it.

## What you don't know yet

- **The frog is the template.** Another session (running Fable) built the frog's "complex behaviors" pipeline: bone structure, then muscles, then behavior model, then animation. It is still working on it right now. Its files, data formats and tests define how a species is done here. That work may sit on another branch or worktree (`git worktree list`, recent branches). Read it; never edit it.
- **New assets.** There are new `.glb` models and reference images for the gecko and for the red-eyed dragon (the red-eyed crocodile skink; older notes call it "the skink"), plus reference videos for both. Find them among recently added models, images and videos. If there is more than one gecko species or model, treat each as its own species. If it is not clear which files are meant, ask me once.
- **A previous session attempted the backlog below with poor results.** Treat its notes as leads, not facts. "Fix found, not written" means not done.

## Outcomes

### A. Lizards: gecko and red-eyed crocodile skink (start here)

Mirror the frog pipeline stage for stage, with the same file layout, formats, test style and level of fidelity. Per species:

1. **Bone structure.** Dump the rig from the `.glb` with a script (never read the binary): bone names, hierarchy, rest pose, segment lengths, skin-weight coverage, existing clips, scale and axes. Map bones to anatomy (skull and neck, trunk, sacrum, tail segments, shoulder and hip girdles, limb segments, digits), record joint axes and ranges of motion, and list rig gaps with the workaround. Do not re-rig or re-export a `.glb` without asking me.
2. **Muscles.** The same muscle layer the frog has, for the groups that drive a lizard: trunk (side-to-side bending), tail base (it pulls the hind leg back, so tail base and hind legs move together), limb swing and push, elbow, knee, wrist, ankle, digits (gecko toe attach and peel), jaw, throat.
3. **Behavior model.** An ethogram per species built from the reference videos and the project's own species data: states, triggers, durations, day and night schedule, habitat preferences, reactions to other animals. Starting hypotheses to confirm against the references, not facts: the gecko is active at dusk and night, climbs glass and vertical surfaces, rests hidden by day, licks droplets, stalks prey; the skink is secretive, ground-dwelling in damp litter near water, hides under cover, moves slowly, freezes when startled, does not climb glass.
4. **Animation.** Procedural, on the real rig: sprawling lizard walk (diagonal leg pairs, trunk wave, tail counter-sway, steady head), feet planted without sliding, turning, starting and stopping, idle. Gecko: climbing on vertical glass and bark with the body held close to the surface (old notes say its raised body sits too far off a wall). Skink: freeze, and entering a hide. Timing and posture come from the motion sheets, not from guesswork.

**Reference handling.** One scout turns images and videos into text once: a few frames per behavior with ffmpeg (downscaled contact sheets), then one motion sheet per species with postures (belly clearance, limb angles), footfall order, stride length and frequency relative to body length, trunk and tail bend, typical behavior durations. Everyone else works from the sheet. Nobody else opens frames.

### B. Backlog left by the previous session

1. **Fire salamander.** It walks toward its shelter, stalls 12–18 cm short for hours, and sometimes ends up standing in water. The cause was traced to the code that walks it home; the fix was never written. Separately, a new placement can drop it on a pool floor. Fix both.
2. **Tadpoles** never rest on the bottom. They should, for a believable share of the time.
3. **Salamander larvae** are still drawn as frog tadpoles. They need their own look: long body, feathery external gills, four legs (confirm against references).
4. **Interactions.** Frogs and geckos pile up in the karst tank, and single steps pass through solids.
5. **Water.**
   - *Fish and flow.* Do not hard-code fish to face into the current; that is not natural behavior. The current is a force that pushes them, and where a fish points follows from where it wants to go. Make its behavior model (its "brain") energy-aware, as a real fish's is: swimming against the flow costs more, so a fish holds and rests in slack water, rides the flow when it goes its way, and picks routes and resting spots that save energy.
   - *Plants* bend and trail the way the water pushes them, more in stronger flow.
   - *Filter.* The last filter type is still missing; build it like the others.
   - *Water below the substrate.* The water that sits under the substrate at the bottom of the tank has never been drawn. Make it visible at the level the sim models, and confirm in the code what is modelled.
6. **Lizard check.** Look at the gecko and the skink in a real tank, including the gecko on the glass. This becomes the final QA for outcome A.

### C. UI

1. Clicking an animal or a plant used to open an information panel. It no longer appears. Find when it broke (git history on the panel code), restore it, and make sure it covers the two lizards.
2. While following or zoomed in on something, the menu should be hidden. Esc or a single click (or tap) should return the camera to its initial position and bring the menu back. The one exception: a double-click or long-tap on another animal switches the follow to that animal instead of exiting.

### D. Presets

More presets, and more variety among them. Presets are the ready-made tank setups (the karst tank is one). The new ones are biotope-style: each is built around one featured animal, recreates its natural habitat, and gives it ideal conditions in everything the sim models (temperature, humidity, light, water share and flow, substrate, plants, hides, perches, compatible tank mates), so that animal is the highlight of the tank. Inventory what exists, then propose a list in the plan that at least doubles the count, naming the featured animal and habitat for each, with variety in tank shape, water share, plant palette and filter type. Start this after the salamander placement fix and the interactions fix have landed, and make every preset pass the same automated checks: nothing spawned in water or inside solids, no pile-ups, nothing stuck, and the featured animal's conditions inside the preferred ranges in its species data.

## How to run it

**Blackboard.** One folder (suggest `docs/agents/lizards/`) holds everything agents share:
`BRIEF.md` · `MAP.md` · `RIG_<species>.md` · `MOTION_<species>.md` · `TRIAGE.md` · `BOARD.md` · `CONTRACTS.md` · `reports/<task>.md`.
An agent's prompt is its board row plus pointers (paths, line ranges), never pasted code or conversation history. If an agent runs in its own worktree, give it the absolute path to this folder.

**Checks before fixes.** Every task gets a check that fails before the change and passes after. Prefer numbers from a headless, seeded, fast-forwarded sim run that dumps per-animal state (position, behavior state, surface contact) over screenshots; keep screenshots for look-and-feel. If no such harness exists, building it is task zero. Reuse the frog session's if it has one.

**Round 1: analysis and planning.** Read-only, at most four scouts in parallel, small budgets.

- *Map:* how to build, run, test and screenshot; where animals, behaviors, animation, collision, water, UI and presets live (file:line); a digest of the frog pipeline (stages, files, formats, tests). Output `MAP.md`, 150 lines at most.
- *References:* rig dumps and motion sheets. Output `RIG_*.md`, `MOTION_*.md`.
- *Triage:* for every item in B, C and D, where the code is, the likely cause with evidence, what the previous session left behind (notes, diffs, stashes, branches), and a proposed check. Output `TRIAGE.md`.

Then write `BOARD.md`, one row per task: id, owner role, model, files owned, depends on, check command, budget, status. Add the wave order and the projected total. Show me the board (40 lines at most) with anything you need decided, and **wait for my go**. Agent budgets are authorized individually at this point, not before.

**Round 2: pods.**

- *Pod A, lizards:* a manager plus one builder per species. Each builder owns its species end to end (rig, muscles, behavior, animation) and is resumed between stages instead of replaced, so it keeps its context. Shared lizard code (gait, foot placement, surface adhesion) has exactly one owner; the other species consumes it. No parallel re-implementations.
- *Pod B, simulation backlog:* a manager plus builders for salamander; tadpoles and larvae; interactions (sole owner of shared collision and steering code); water. UI and presets are two more builders under this manager.
- *Cross-check:* each manager verifies the other pod's finished tasks with fresh eyes: task row, diff, check command. The job is to break it, not to approve it. Disagreements come to you.
- *Final QA:* one checker runs every check together on the integrated result, confirms the frog's tests still pass, and does the lizard check in a real tank (gecko on glass side-on, on bark, on the ground; skink on the ground, under cover, at the water's edge) against the reference frames.

**Every builder works in two steps.** First, analysis: reproduce, find the cause or the approach, write the failing check, and return a proposal of 15 lines at most (cause with evidence, files to touch, shared interfaces affected, budget needed). The manager approves or corrects it and authorizes that agent's budget. Then the same agent is resumed to implement. Two failed attempts on the same check means stop and report; the manager escalates to a stronger model with the failure report instead of allowing a third blind try.

**Communication.**

- *Vertical:* an agent updates its board row when it claims, proposes and finishes. Its report file is 25 lines at most (result, files and lines changed, check command with three lines of output, open risks, things noticed but not touched). Its reply to its parent is 8 lines at most: status plus report path. Each manager sends you a digest of 10 lines at most per wave.
- *Horizontal:* `CONTRACTS.md` holds anything two tasks share: function signatures, config fields, units and axes, shared constants, files with more than one consumer. Write the entry before making the change; everyone re-reads it at their three checkpoints. At each wave boundary, pass a 5-line digest between the managers.
- *Other sessions:* the frog session is live, and other sessions of mine may be working in this project too. Do not edit the frog's files. Before changing code it also depends on (shared animal base, locomotion, collision, UI), tell it in one short cross-session message what you will change, and keep those diffs small. If you cannot reach it, list those files for me in the plan.

**Files.** Run tasks in parallel only when their file sets are disjoint; the board row lists what each task may edit. Share one working tree by default. Give a subagent its own worktree only when two tasks must edit the same file at the same time, and merge serially. If the build breaks in a file you do not own, do not debug it: recheck once after a minute, then report. Commit per task on a dedicated branch. Do not merge to the main branch or push without me. If this is not a git repository, do not initialise one; tell me.

## Budgets, models, effort

You are running on Fable at max effort. That is for your own planning, adjudication and integration. Subagents inherit your model and effort level unless you set them, which is how fifteen agents end up on the most expensive settings, so set them every time.

| Role | Model | Effort | Turn cap | May edit | Used for |
|---|---|---|---|---|---|
| scout | sonnet | medium | 30 | blackboard only | recon, rig dumps, triage |
| builder | sonnet (opus for 3D math, IK, collision) | medium | 80 | its board row's files | implementation |
| checker | opus | high | 30 | blackboard only | cross-checks, final QA |
| pod-manager | opus | high | 120 | integration, board | running a pod, verifying the other |

Effort and turn caps can only be set in subagent definition files. If `.claude/agents/` exists, write these four definitions there (they load within seconds). If it does not, create them for next time and, for this run, use general-purpose agents with the model passed per call and the cap written into the prompt. No subagent runs on Fable unless I approve it in the plan.

Budget sizes for the board: S is about 80k tokens, M about 200k, L about 400k. Agents count turns, since they cannot see their own token use; if a usage line comes back with an agent's result, record it next to its budget. Hitting a turn cap is a forced check-in, not a failure: the manager decides whether to authorize more.

## Token rules for every agent

- Search before reading; read line ranges, not whole files. Never open binaries, `.glb`, lockfiles, vendored code or caches.
- Cap command output (`| tail -n 40`); run the narrowest test, not the whole suite.
- Only the reference scout and the final checker look at images, downscaled, and only as many as the task needs.
- No web research unless the board row says so. Biology comes from the motion sheets and the project's species data.
- No scope creep. Fix what the row says; log anything else in one line under "noticed".
- Do not re-run checks that already pass, and do not restate the task in reports.
- You, the lead, read the board and report headers. Delegate anything verbose and do not write feature code yourself.

## Done

An item is done when its change is written and committed, its check passes, another agent has confirmed that independently, and the integrated result passes all checks together. Finish with one table for me: item, status (done and verified / partial / not done), evidence path, tokens used against budget. Report what did not get done as plainly as what did.
