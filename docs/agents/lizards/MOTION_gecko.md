MOTION SHEET: mourning gecko. Written from frames only; nobody reading this needs the videos. M = measured from the named frames, E = estimated (angles +-20 deg unless stated).
Frames dir F = `/Users/rubykim/Documents/paludarium master/.agents/refs/rec-1300/frames/` (new sheets named `r1-*`; tiles are labelled with the video time). Videos live one level up (`rec-1300/`).

## Which video is which (verified)
- VID1 `ScreenRecording_10-04-2026 12-57-13_1.mov`, 9.31 s, 60 fps: a small brown gecko on a salmon-coloured cork-like branch among wet plants at night (water drops on leaves). Seen only in the 5-frame overview (`r1-overview-4videos.jpg`, row 1): not analysed. Species not certain.
- VID2 `... 12-58-27_1.mov`, 6.59 s, 1266x466 (landscape): mourning gecko on a pale grey surface. Hard cut at 3.07 s (M: frame difference 22 vs a median 2.6): clip A 0-3.07 s, clip B 3.07-6.59 s. Player icons overlay 0-1.5 s.
- VID3 `... 12-59-54_1.mov`, 23.62 s, 816x1346: 0-6.5 s gecko head-down on a vertical bark; a cut between 6.0 and 7.5 s (not located) to a night scene of soil, a leaf and a plank with a small gecko at the lower left, 7.5-23.6 s.
- All are 60 fps phone screen recordings of a hand-held video that pans and follows the animal: absolute speed and stride length are NOT measurable. Everything below is relative to the body.

## Behaviours seen (video, time, frame file)
| behaviour | where | frames (in F) |
|---|---|---|
| walk, 3/4 view toward camera-left | VID2 2.00-2.73 s | `r1-gecko-v2-walk-2.0-2.7s.jpg` (12 frames, 0.067 s apart) |
| walk, side view, head left | VID2 0-0.5 s, 4.5-6.0 s | `r1-gecko-v2-timeline-0-6s.jpg` |
| pause, head down, licks the surface | VID2 3.60-4.33 s (tongue out 4.00-4.20 s) | `r1-gecko-v2-lick-3.6-4.3s.jpg` |
| head up, looks round | VID2 5.5-6.0 s | `r1-gecko-v2-timeline-0-6s.jpg` |
| leaves frame (turn not clean) | VID2 1.0-1.8 s | same timeline |
| climbs down a vertical bark, head first; tongue out | VID3 0-6.0 s (tongue about 6.0 s) | `r1-gecko-v3-timeline-0-22s.jpg`, `r1-gecko-v3-climb-3.0-4.0s.jpg` (0.2 s apart) |
| sits nearly still in litter at night; later moves along the base of the bark | VID3 7.5-16.5 s still, 18-22.5 s moves | `r1-gecko-v3-timeline-0-22s.jpg` (animal is small, lower left) |
| crawls along a branch | VID1 0-9.3 s | `r1-overview-4videos.jpg` row 1 (overview only) |
Not shown: a clean turn, a start from rest, a startle, feeding, sleeping, a tail drop.

## Posture
- Walking on a flat surface (VID2, E): belly on or within a few mm of the surface (clearance below 0.05 body depth; the shadow joins the belly). Upper arm swung out sideways, nearly horizontal (60-90 deg from the trunk axis), elbow bent about 90 deg in plan view, forearm pointing forward-out and about 30-50 deg down, hand flat, five toes fanned, forefoot level with or ahead of the chin. Thigh out and back (70-90 deg from the trunk axis), shank forward about 60 deg, hind foot flat beside the pelvis, toes fanned forward-out. This is a sprawl, not a lift.
- Head (E): 10-15 deg below the trunk line when sniffing or licking (3.6-4.3 s), 15 deg above it at 5.5-6.0 s; yaw +-15-20 deg against the trunk, toward the stepping side.
- Tail (E): lifted from the base, never dragged. In side view it runs back and up at 20-35 deg above horizontal and the last third curls up (pale tip). In the 3/4 view (2.0-2.7 s) it stands nearly vertical at the top of the frame.
- Climbing (VID3 0-6 s, E): body flat to the bark, belly in contact, head down 60-75 deg below horizontal, limbs splayed in the plane of the bark with elbows and knees out, forearms down-and-out, toes spread; tail trails up out of frame. One forelimb lifts at a time (upper right limb up at 3.0 s, planted 3.4-3.6 s, up again 3.8-4.0 s: M from `r1-gecko-v3-climb-3.0-4.0s.jpg`).

## Gait
- Footfall order: NOT resolved from the frames. Head yaw alternates in 2.00-2.73 s (left 2.00-2.07, ahead 2.27-2.33, left 2.40-2.53, ahead 2.60-2.73: M), which is what a diagonal trot gives (the game uses diagonal pairs 1+4, 2+3, `src/render/creatures/instanced.js:11-13`); not proven.
- Stride frequency: E about 2 Hz walking (1.5-3), from the head-yaw period 0.4-0.5 s; E about 1 Hz climbing (forelimb re-planted every 0.8-1.0 s).
- Duty factor: not readable (E above 0.6 for a slow walk). Stride length and speed: not measurable. Climb: E under 0.2 body lengths of descent in 3.0-4.0 s.
- Game, for the checker (not measured here): gecko `speed: 4` (unit not verified, `src/sim/animals.js:322`), `stride: 0.75` (`:325`), walks of 4-14 cm and pauses of 1.2-6 s, darts 0.35-1.3 s (`src/sim/herp.js:101`).

## Trunk and tail
- E: side-to-side bend of +-15-20 deg at the shoulders (head against pelvis axis) and about +-10 deg mid-trunk; largest at the neck and at the tail base. The tail counters mainly by lifting and curling its tip, with a small lateral wobble (10 deg or less); in the 3/4 view its base shifts opposite to the head yaw (not proven).

## Durations (M, from frame times)
- VID2: walking at least 0.73 s (2.00-2.73 s, still going); still at least 0.73 s (3.60-4.33 s) with tongue out at least 0.2 s (four frames); walking again 4.5-6.0 s (1.5 s).
- VID3: slow descent 6 s; in the litter about 9 s almost still (7.5-16.5 s). Freeze after a startle: not shown.

## Hypotheses (confirmed / contradicted / not shown)
- Active at dusk and night: CONSISTENT, not proven. VID1 and VID3 7.5-23.6 s are dark scenes under a lamp; the footage carries no clock. Project: `herp.js:17-18`, `animals.js:326`, `docs/HERPS.md:22`.
- Climbs glass and vertical surfaces: CONFIRMED for vertical bark and a branch; glass NOT SHOWN.
- Rests hidden by day: NOT SHOWN.
- Licks droplets: PARTLY. Licking is confirmed (VID2 4.0-4.2 s on a dry surface, VID3 about 6.0 s tongue out) and drops sit on the leaves in VID1, but drop-licking and eye-licking are NOT SHOWN. The game licks only drops and eyes: surface-licking while exploring is a behaviour to add.
- Stalks prey: NOT SHOWN (no prey in the frames; pale specks near the VID3 litter gecko are unverified).
- Darts and pauses (`docs/HERPS.md:24`): CONSISTENT (walk then pause 0.7 s or more then walk). Belly-down sprawl contradicts the high-standing pose of the new model (see `RIG_gecko.md`).

## Reference frames for the final checker (open these, compare game screenshots against them)
1. `r1-gecko-v2-walk-2.0-2.7s.jpg` (sprawled walk, tail up, head yaw)  2. `r1-gecko-v2-lick-3.6-4.3s.jpg` (belly-down pause, head low, tongue)
3. `r1-gecko-v2-timeline-0-6s.jpg` (side view, tail carriage)  4. `r1-gecko-v3-climb-3.0-4.0s.jpg` and `r1-gecko-v3-timeline-0-22s.jpg` (vertical climb, litter)
5. `r1-skeletons-crested-tokay.jpg` (bone proportions)  Earlier sheets I did not open: `rec1.jpg`, `rec2.jpg`, `rec3.jpg`, `gecko-dense.jpg`, `gecko-walk.jpg`.
