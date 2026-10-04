MOTION SHEET: red-eyed crocodile skink. Written from frames only; nobody reading this needs the video. M = measured from the named frames, E = estimated (angles +-20 deg).
Frames dir F = `/Users/rubykim/Documents/paludarium master/.agents/refs/rec-1300/frames/` (new sheets `r1-*`, tiles labelled with video time).

## Source (verified)
- Only one video shows the skink: VID4 `ScreenRecording_10-04-2026 13-01-10_1.mov`, 9.62 s, 790x1332, 60 fps. A phone screen recording (overlay icons at 0-0.7 s) of a hand-held close-up: a skink on dark soil in a potted planter with dried flower stalks, pot rim bottom left, an orange-ringed eye. The camera moves and zooms (it pulls back at 4.6 s and sweeps from 5.4 s), so absolute speed and stride length are NOT measurable; all gait numbers are relative or estimated.
- The other three videos are geckos (see `MOTION_gecko.md`). The earlier note's order was wrong: VID1 = branch gecko, VID2 = walking gecko, VID3 = bark and litter gecko, VID4 = skink.

## Behaviours seen (time, frame file)
| behaviour | time | frames (in F) |
|---|---|---|
| alert stand, forebody propped, head scanning left and right, body does not travel | 0.0-5.0 s (M) | `r1-skink-timeline-0-5s.jpg` (every 0.33 s), `r1-skink-pose-crops.jpg` (0.67, 1.33, 2.33, 3.33, 4.0, 5.0 s) |
| dash across the frame to the right, head first, body low, tail behind | 6.2-7.3 s (M) | `r1-skink-dash-6.2-7.3s.jpg` (0.1 s apart) |
| out of sight behind dry stalks (no orange eye pixels) | 7.0-8.4 s (M, colour count) | not framed; `r1-overview-4videos.jpg` row 4 |
| back at the pot rim facing the camera, same stance as at 0 s | 8.5-9.6 s | `r1-overview-4videos.jpg` row 4 (8.5 s tile) |
| 5.0-6.2 s: camera pulls away, skink small at upper left | not analysed | - |
Not shown: a slow forage walk, a clean turn, soaking, basking, feeding, playing dead, squeaking, climbing.

## Posture (E, from `r1-skink-pose-crops.jpg`; camera looks from above and in front)
- All four feet planted. Forelimb: upper arm out and down, elbow bent about 90-110 deg and pointing out, forearm close to vertical, hand with long spread toes just in front of the chest. The chest is clear of the soil: clearance about 20-30% of trunk depth under the front, hind quarters not visible. Pitch of the trunk not measurable from this angle.
- Head: large, triangular, helmet-like casque; carried level or 0-10 deg raised; the eye ring is big and orange. While scanning the head yaws +-30-45 deg against the trunk and rolls 20-30 deg: right at 0.0-0.67 s, toward the camera 1.33-2.33 s, left of camera 3.0-4.0 s, right again 5.0 s (a scan cycle of about 2-2.5 s).
- Back and tail: four rows of keeled spiky scales from the nape on to the tail, two rows clearly visible in the crops. The tail is carried arched up and away from the soil (base about level, then rising 30-45 deg, tip curled): visible in the crops and at 6.5 s. NOTE: the new model's tail slopes DOWN to the ground (`RIG_skink.md`); the game's carriage is not checked.
- Dash (6.2-7.3 s): trunk low and flat, belly near the soil, dorsal keels sharp against a blurred background, tail sweeping in S-curves behind; legs are motion-blurred and cannot be read.

## Gait
- Footfall order, duty factor, stride length and frequency: NOT shown (blur, close camera). The game uses a diagonal pair gait (`instanced.js:11-13`).
- Speed, E (the camera also moves; take as a rough bound): in the dash the head leaves the crop within 0.2 s (6.2-6.4 s) and the whole body passes by 6.4-7.3 s, so about one body length in 0.5-0.9 s, roughly 1-2 body lengths per second.
- Game, for the checker: `speed: 3.2` cm/s walking, a startled run 2x (`src/sim/skink.js:36`), body about 17 cm: 0.19 and 0.38 body lengths per second. The footage dash is faster than both if the camera effect is small. Forage rhythm in the game: pause 1-5 s, walk 1.5-4 s, freeze 1-4 s (`skink.js:45-47`); `stride: 0.6`, `lift: 0.15`, `amp: 0.4` (`src/sim/animals.js:407`).

## Trunk and tail
- Standing (M, 0-5 s): no trunk bend visible; the head and neck do the looking. Dash (E): S-curve of the tail and a gentle trunk wave; amplitude not measurable (guess about +-15-20 deg at the shoulders, larger in the tail, tail swinging against the pelvis).

## Durations (M, frame times)
- Alert stand at least 5.0 s, no body travel. Dash at least 0.9 s. Out of sight at least 1.4 s. Visible again 8.5-9.6 s, standing.
- The freeze before the dash (at least 5 s) is longer than the game's 1-4 s.

## Hypotheses (confirmed / contradicted / not shown)
- Secretive: NOT SHOWN as hiding; it stays in the open for 5 s under a close camera, then vanishes behind stalks (7.0-8.4 s). Project: `species-info.js:55-58`, `skink.js:5-9`.
- Ground-dwelling in damp litter near water: CONFIRMED for ground and dark moist litter; water NOT SHOWN.
- Hides under cover: NOT SHOWN directly (it goes out of sight behind stalks).
- Moves slowly: PARTLY CONTRADICTED. Motionless 0-5 s, but the dash at 6.2-7.3 s is fast (about 1-2 body lengths/s, E) against the game's 0.19 body lengths/s walk and 0.38 startled.
- Freezes when startled: CONSISTENT. Motionless alert pose with head scans, then a dash; the trigger is not visible (probably the close camera).
- Does not climb glass: NOT SHOWN.

## Reference frames for the final checker
1. `r1-skink-pose-crops.jpg` (stance, forelimb angles, head size and orange ring, keels, tail carriage)  2. `r1-skink-timeline-0-5s.jpg` (alert stand, head scan over 5 s)
3. `r1-skink-dash-6.2-7.3s.jpg` (dash, low trunk, tail)  4. `r1-overview-4videos.jpg` row 4 (context, 8.5 s stance)
Earlier sheets I did not open: `rec4.jpg`, `skink-dense.jpg`. No skink skeleton picture exists in `AG/refs` (gecko drawings only: `r1-skeletons-crested-tokay.jpg`).
