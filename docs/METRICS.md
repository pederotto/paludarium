# Metrics: recording what the game does on a real screen

The game runs on machines nobody here can see: a Windows ARM laptop on Wi-Fi, a phone, a player's old desktop. The recorder in
`src/diag/` measures the page itself (frames, GPU latency, long tasks, resizes, load phases, errors, the device) and sends the
numbers to the computer serving the game, so a report replaces "it flashes and gets slow". The same recorder runs headless on
this Mac (`npm run metrics:run`), so a run here and a run on a laptop compare directly. Nothing is loaded or recorded unless the
address has `?metrics` (or the server was started to inject it).

## Use it

**On another computer** (the usual case):

```bash
npm run build
npm run metrics:serve              # http: the WebGL 2 fallback, the path weak machines get over plain http
npm run metrics:serve -- --https   # https with a self-made certificate: Chrome warns once (Advanced, Proceed), then the page is a
                                   # secure context and the game runs on WebGPU, exactly as on GitHub Pages
```

Open the address it prints (`http://192.168.x.x:4192/`). A small **● REC** chip appears at the bottom left: play as usual. Tap
**⚡ Flash** the moment a black flash happens and **🐢 Stutter** when it stutters (keys: `` ` `` and Shift+`` ` ``): each mark is
stored with what the machine was doing at that moment. **📷** saves a picture of the screen, **▶ Test** runs the hands-off test
(about a minute), **■ Done** stops and shows the result card with **Copy the result** and **Save the file** (use these when the page
could not reach the collector, e.g. a page opened from GitHub Pages with `?metrics`). Recordings land in
`metrics/sessions/<time>_<label>_<id>.ndjson` (git-ignored, copied by `npm run backup`).

`?metrics=<label>` names the recording (`?metrics=snapdragon`), `&bench` starts the hands-off test by itself, `&nooverlay` hides the
chip, `&metricsurl=off` does not look for a collector, `&nogpu` leaves out the GPU-latency probe (to check what it costs), `&perf` adds three.js GPU timestamps (a `gpuMs` gauge, where the browser
supports them). To compare builds rather than governors, pin the graphics: `&quality=low&fixedres&fps=60`.

**On this Mac** (headless Chrome with real Metal WebGPU, the same recorder):

```bash
npm run metrics:run -- --label=m1                              # the 55-second test of the build in dist/, WebGPU
npm run metrics:run -- --label=m1-gl2 --lan                    # through the LAN address: plain http, the WebGL 2 fallback
npm run metrics:run -- --label=mid --lan --cpu=4 --dpr=2 --size=1440x900    # a mid-range laptop's worth of CPU and pixels
npm run metrics:run -- --label=orig --outDir=../archive/original-build-perf-base     # another build; the recorder is injected
npm run metrics:run -- --label=pages --url=https://pederotto.github.io/paludarium/ --inject   # a page served by someone else
npm run metrics:run -- --label=x --screencast                  # also count what the compositor presented (frames, blank frames)
```

**Reading recordings:**

```bash
npm run metrics:report                    # the newest
npm run metrics:report -- --list          # one line each
npm run metrics:report -- <part of a name> [<another>]
npm run metrics:report -- --compare <baseline> <new>
npm run metrics:report -- --snaps         # writes the screen pictures to metrics/snapshots/<id>/
npm run metrics:report -- --json=out.json
```

Before and after any change to rendering, plants, animals or loading: record the same scenario on the same device, compare, and put
the numbers in the Baselines table below.

## What is recorded

| What | How | Why it matters |
|---|---|---|
| Every drawn frame: gap since the previous frame, time before the render call, time inside it, time in the tick hooks | wrappers on `game.frame` and `gfx.render` while recording, 0.1 ms resolution, typed arrays | frame time distribution, the CPU split, stutter |
| Warm-up frames (a tank loaded, a pipeline rebuilt, a time-lapse) | `gfx.governor.skip` and the tank-load wrappers | excluded from the steady numbers, like the governor does |
| GPU latency: submit to done, every 4th (WebGPU) or 6th (WebGL 2) frame | `queue.onSubmittedWorkDone()`, or a fence sync polled every 2 ms | tells a GPU that keeps up from the bottleneck, and a GPU that never rests (which freezes the desktop) |
| Display frames and refresh rate | the recorder's own `requestAnimationFrame` loop | 60 or 120 Hz, missed display frames |
| Canvas resizes, and whether they were drawn over | setters of `canvas.width/height` patched while recording | black flashes: see below |
| GPU/context loss, uncaptured GPU errors, console warnings and errors, uncaught errors | canvas events, `device.lost`, console wrappers | a screen that goes black and returns |
| Long tasks (50 ms or more) and long animation frames with the script that ran | `PerformanceObserver` (`longtask`, `long-animation-frame`) | what froze the page, and where in the code |
| Slow inputs (40 ms or more from touch to picture) | `PerformanceObserver` (`event`), grouped by interaction | whether it feels laggy to touch |
| Load timeline | navigation timing, paint, the game's marks (`src/util/trace.js`), the loading veil, downloads | load time by stage |
| Device: browser build and CPU architecture, OS, cores, memory, screen, window, GPU and adapter, battery | user-agent client hints, WebGL debug info, the WebGPU adapter, Battery API | an x64 browser emulated on an ARM laptop, unplugged laptops, software rendering |
| Per second: quality preset, resolution scale, frame cap, pixel ratio, canvas size, draw calls, triangles, animals, plants, JS heap | gauges read from `window.game` | what scene complexity the numbers belong to |
| Governor and settings changes, tank loads, pipeline builds, phase changes (title, play, bench) | wrappers on `gfx.apply`, `gfx.build`, `game.loadTank`, `S.screen` | context for the numbers |
| Marks from the player and pictures of the screen | the chip, the keys | what the person saw, tied to the numbers |

The recorder works through `window.game` and wrappers installed on the instance, so it can record builds that were not made for it
(`--outDir=…original…`, the live GitHub build with `--inject`). It costs about 3 to 5 microseconds a frame (reported in each
session as "recorder cost"). Nothing personal is recorded: the address, the user agent and hardware strings, the numbers.

## Reading the report

* **Headline** is steady play: the `play` phase (or the `bench:` phases except title, start and settle) without warm-up frames.
  `fps` is frames over the time they took, `p50/p95/p99` are frame gaps in milliseconds, `1% low` is 1000 / p99, "over 33 ms" and
  "over 100 ms" count frames. `before render` is simulation and camera, `render call` is the time inside `gfx.render()` on the main
  thread (when the GPU is behind it also includes waiting for it), `tick hooks` is the 4 Hz work after the render.
* **GPU latency** is a ceiling on one frame's GPU time as seen by the page (a busy main thread delays the callback). A frame is
  16.7 ms at 60 fps: an average above that, or one that keeps growing, means the GPU is the limit.
* **Findings** are the rules in `findings()` of `src/diag/report.js`: black-flash evidence, lost GPU, software rendering, p95 against
  the frame budget, GPU or CPU bound, long load, governor hunting, battery, emulated browser, slow inputs, memory growth.
* **Black flashes.** Assigning `canvas.width/height` clears a canvas. Resizing after the frame was drawn presents an empty frame:
  the recorder counts those ("empty frames in the making", `blank-risk`), and also resizes outside the frame loop that the game did
  not draw over before the next display frame ("presented empty", for example a window resize while the frame-rate cap skips the next
  frame). Checked against the compositor (CDP screencast) on the WebGL 2 path: the old broken build showed 7 blank frames for 7
  forced resolution changes and the recorder counted 7 resizes after render; the fixed build showed 0 and 0. On WebGPU Chrome keeps
  the drawn picture across a resize, so there the same bug showed no blank frame in the compositor (the recorder still flags the
  order). So flashes of this kind are a WebGL 2 problem, which is the path weak machines get over plain http.
* **Phases**: `boot` (until the first frame), `title`, `play`; the hands-off test names its own (`bench:title`, `bench:start`,
  `bench:settle`, `bench:hero`, `bench:orbit`, `bench:top`).

## What it cannot see

What the screen really showed (it infers blank frames from the order of calls; `metrics:run --screencast` checks that on the Mac), GPU
time to the microsecond (use `&perf` for timestamp queries where the browser has them), other programs competing for the machine,
and thermal throttling (the frame times show its effect, the cause stays unknown). A page in a background tab is throttled by the
browser: hidden frames are excluded.

## Files

`src/diag/` recorder, probes, adapter, GPU probe, sink, overlay, bench, report (it knows nothing of the game: the `diag` layer imports
nothing, see `tests/architecture.test.mjs`); `tools/metrics-collector.mjs` (Vite plugin: the endpoint, the recorder's source, the
injection), `tools/metrics-serve.mjs`, `tools/metrics-run.mjs`, `tools/metrics-report.mjs`; tests in `tests/metrics*.test.mjs`
and the browser check `tools/steps/metrics.mjs`. A recording is NDJSON, one `{sid, k, …}` object per line: `env` (device), `fr` (frames
as base64 typed arrays), `sec` (one bucket a second), `ev` (events), `snap` (a JPEG).

## Baselines

Same scenario each time: `npm run metrics:run`, the 55-second test, 1280x720, on the MacBook Pro (M1, 8 GB) in headless Chrome 154.
Plug the Mac in first: on battery below about 20% Chrome's Energy Saver caps frames at 30 a second (the report says so).

| Date | Build, path | Load: screen lifts / Start to tank | Steady play | Notes |
|---|---|---|---|---|
| 2026-10-01 | `arch/optimize` (fa6e238 + metrics), WebGPU | 0.80 s / 0.24 s | 60.0 fps, p95 18.4 ms, GPU 11.7 ms, render call 3.1 ms | 106 animals, 51 plants, 212 draw calls, 2331k triangles; recorder 3 µs a frame (battery 27%, valid) |
| 2026-10-01 | same, WebGL 2 over the LAN address (plain http) | 0.82 s / 0.31 s | 53.7 fps, p95 33.4 ms, GPU 18.4 ms, render call 10.6 ms | **froze 20.8 s at 19.4 s**: the governor stepped Balanced to High, which recompiles every scene shader in one frame. Fixed afterwards: on WebGL 2 Auto never goes above the starting preset (`autoCeiling`, battery 26%, valid) |
| 2026-10-02 | `arch/optimize` (e90f27d), WebGPU, plugged in (72%) | 0.98 s / 0.28 s | 60.0 fps, p95 18.1 ms, GPU 13.6 ms, render call 3.4 ms | 145 draw calls, 1421k triangles; one 1.1 s freeze at the start (the title tank's first pipeline build) |
| 2026-10-02 | same, https (`metrics:serve --https`, port 4193) | 1.09 s / 0.33 s | 60.0 fps, p95 18.4 ms, GPU 13.0 ms, render call 3.3 ms | "Nothing wrong was seen" |
| 2026-10-02 | same, WebGL 2 over the LAN address | 0.93 s / 0.30 s | 59.9 fps, p95 17.4 ms, GPU 28.1 ms, render call 3.6 ms | no freeze in play: the 20.8 s one is gone (`autoCeiling`); a 1.8 s freeze at the start |
| 2026-10-02 | original build (`archive/original-build-perf-base`), WebGPU | 2.81 s / 2.25 s | 56.6 fps, p95 20.4 ms, GPU 48.9 ms, render call 5.6 ms | 258 draw calls, 2342k triangles; 12 freezes, 8.8 s frozen. Replaces the 2026-10-01 try, made on battery |
| 2026-10-02 | live GitHub Pages build (`main`), WebGPU, `--inject` | 3.76 s / 2.28 s | 56.3 fps, p95 20.6 ms, GPU 50.6 ms, render call 6.1 ms | 257 draw calls, 2334k triangles; 12 freezes, 9.2 s frozen. Replaces the 2026-10-01 try, made on battery |

**Frog swim and the animals rework, before and after (2026-10-02, not decided).** The committed build (`dist/`) against the working
tree with the frog swim, the rig rework and the crab work in progress (`test-output/dist-frog`), three WebGPU runs each and one WebGL 2
run each, interleaved. The CPU split taken from the raw per-frame data does not differ (time before the render p10 1.6 to 1.7 ms in
both builds, the render call p10 2.2 to 2.5 ms in both), draw calls and triangles do not differ either (139 to 216 calls and 1422k to
2355k triangles in both, depending on where the camera is when the number is read), and no freeze in play came from the new meshes
(only the start-up and tank-start warm-up frames). The frame rate and p95 are not conclusive: over the three WebGPU runs of each
build they swung from 53.8 to 60.0 fps and from 18 to 28 ms p95 in both, because the Mac was short of memory (swap 93% full) and
another session's browser was running at the same time (the governor lowered the resolution scale to 0.7 to 0.95 in five of the
eight runs). Repeat on a quiet machine, or on the Windows laptop, before reading anything into the frame rate.

Findings the recorder has made so far: the governor freeze above; the black flash of a resize after the draw is a WebGL 2 problem
only (compositor check); over plain http the browser hides its CPU architecture, memory and battery state (`--https` shows them);
on a machine that is short of memory or shared with other browsers the governor steps the resolution down and the frame rate
wanders, so read the load numbers and the CPU split before the frame rate.
