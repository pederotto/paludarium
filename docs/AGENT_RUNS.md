# Agent runs: the lead's sheet

For the session that leads a multi-agent run. Base workers do not read this file; they get a one-page brief from the
lead. The binding rules are in docs/RULES.md (loaded with CLAUDE.md). Condensed on 6 October 2026 from the master
document's "Guide: how agents broke the rules" (run "next", 4 October: 31 breaks in 24 agents, most from measurements
that did not measure the target, not from wrong code). Its incident log stays in the master document's History tab.

## Before the run
- Write one brief file for the run (rules the agents need, facts already established, where the owner's references
  are, the output format) and point every agent at it. Agents never read the master document or the boards
  themselves: the lead reads them once and puts what matters in the brief.
- Write each task row with every file the change will need: generated outputs, data tables, UI labels, render hooks.
- Set each builder's cap at about 1.5 times its own estimate (reruns included) plus 2 for the hand-back, and below the
  agent type's turn limit (checker 30, scout 25).
- Tasks run in parallel only when their files do not overlap; shared files get one builder at a time, under a lock.
- Read the clock (`date`) before writing a time. Never cd the session into a worktree.

## Measurement rules (put them in every builder's and checker's brief)
- Every probe prints a stamp only the code under test can produce; a run without it does not count.
- The proposal shows its check failing for the right reason: the behaviour the target is about, not an empty or
  fallback value.
- The same metric before and after; never change a metric between runs.
- Every number says how much data it rests on: under 10 events or 3 seeds is "inconclusive".
- Hang guard: nothing printed in 5 minutes means stop and report.
- Performance numbers only on a quiet machine, production builds, before and after interleaved (docs/METRICS.md).

## During the run
- A watchdog prints STALE after 8 silent minutes; re-arm it every 29 minutes and act on a STALE line at once.
- When the watchdog warns at 80 % of a cap, tell the agent to write its output now; agents write it in full at two
  thirds of their cap.
- Checkers write their report after each task. Return reports over 25 lines.
- Stop each dev server when its agent ends; before stopping one, check no running or parked agent still needs it.

## Before a push
- Tell the owner what is verified and what is not.
- Report a changed target as a change, never as met. A third attempt needs the owner's word and a root-cause note.

## Patterns that cost the most (run "next")
| Pattern | Cost | Prevention |
| --- | --- | --- |
| The probe did not measure the target (wrong level of detail, bodies still loading, an old probe) | 6 of the first 11 builder tasks missed | Stamp, failure for the right reason, same metric |
| Sample too small to judge | Numbers that decide nothing | State the sample; under the threshold is "inconclusive" |
| Budget estimated without reruns | 4 agents ran out with work left | Cap at 1.5 x estimate + 2 |
| Silent while working | Stuck work the lead could not see (up to 23 minutes) | Watchdog with STALE lines |
| Task rows drawn too narrow | One round trip each | List generated files, data tables, UI labels, render hooks |
| Machine contention (WebGL 2 runs hung, journeys on a loaded Mac) | Paths left unverified | Two-Chrome gate, timeouts, performance only on a quiet Mac |
