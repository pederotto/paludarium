# Rules for every agent in the lizard run

Read this once at the start. The full brief is `BRIEF.md` in this folder (read sections by line range, not the whole file).

## Paths (quote them: the parent folder has a space)

- `REPO` = `/Users/rubykim/Documents/paludarium master/.agents/wt-lizards` (git worktree, branch `feat/lizards`, started from 916eb5a). All edits, tests and commits of this run happen here. `cd` here first.
- `BB` = `REPO/docs/agents/lizards` (this blackboard)
- `MAIN` = `/Users/rubykim/Documents/paludarium master/paludarium` (the main checkout, other sessions use it): read-only for this run.
- `AG` = `/Users/rubykim/Documents/paludarium master/.agents` (earlier sessions' notes, patches, worktrees, reference videos; not git)
- Dev server for browser checks: `http://127.0.0.1:4630/` serves `REPO` (the lead runs it; do not start another one and do not stop it).

## Tokens (the user's standing order: be strict)

- Every tool call costs about 4k tokens of your budget. S = 20 calls, M = 45, L = 90. Your prompt gives your cap; the harness cuts you off at the hard cap **without warning**, so write your output file early and refine it.
- Search before reading (`grep -n`); read line ranges, never whole large files. `src/sim/animals.js` is 4613 lines: never read more than 120 lines of it in one call.
- Never open binaries, `.glb`, lockfiles, `node_modules`, `dist`, caches. A `.glb` is inspected only through `BB/tools/glb-dump.mjs`.
- Cap every command's output (`| tail -n 30`). Run the narrowest test (`node --test tests/<one>.test.mjs`), never the whole suite unless your row says so.
- Images: only the reference scout and the final checker open images, downscaled (`sips -Z 900`), as few as the task needs. Builders check with numbers.
- No web research unless your row says so. Biology comes from `MOTION_*.md` and the project's species data.
- No scope creep. Do what the row says; anything else is one line under "noticed".
- Do not re-run checks that already pass. Do not restate the task in reports. Do not re-derive what `MAP.md` or `TRIAGE.md` already states: start from their file:line pointers.

## Safety (each of these broke an earlier run)

- Never `git stash`. Never `git push`, never merge, never `git checkout`/`reset`/`restore` files you do not own, never `git add -A` or `git add .` (add your own files by path).
- Never `pkill -f`, `killall` or any pattern kill. Kill only PIDs you started.
- This Mac has 8 GB. One browser probe at a time per agent; after it, check `ps` for the Chrome it started and kill those PIDs. Do not start a dev server.
- Do not install software.
- Never touch `AG/wt-water2` or `MAIN`. The frog pipeline's files are read-only (list in `CONTRACTS.md`).
- If the build or a test breaks in a file you do not own: do not debug it. Recheck once after a minute, then report.

## Edits

- Scouts and checkers write only inside `BB`. Builders edit only the files in their board row.
- A file named in more than one board row needs its lock (see `CONTRACTS.md`, "Locks").
- Shared interfaces are written into `CONTRACTS.md` before the change.
- Commit per task: `git add <your files>` then `git commit -m "<task id>: <what changed>"`. The secrets hook must pass; never bypass it.

## Reporting

- Proposal: `BB/reports/<task>.proposal.md`, 15 lines at most. Report: `BB/reports/<task>.md`, 25 lines at most: result, files and lines changed, check command with three lines of output, open risks, noticed-not-touched.
- An unrelated follow-up task may go to a fresh agent (small context). Your proposal or report is therefore also a hand-off: end it with a "Hand-off" section, 8 lines at most, giving the file:line pointers, commands and traps the next agent needs so it does not have to rediscover them. If you are that next agent: start from the hand-off, do not re-explore.
- Reply to your parent in 8 lines at most: status plus the path of what you wrote.
- Say "not found" or "not verified" plainly. A guess must be labelled as a guess.
