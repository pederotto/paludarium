# G1c report: a viewer that shows the skinned lizard walking, with numbers — done (claude-opus-5-5, 22 calls)
Result: +tools/steps/lizard-cycle.mjs (standalone like swim-cycle.mjs; shot.mjs --steps not needed). Starter tank -> World.empty() (flat substrate, no water, stone background), noon, every animal out, ONE lizard, world paused, Animals.move in <=0.04 s slices, Math.random reseeded per frame: two ground-side runs gave the same ph and v in every frame. Walk forced each slice through the herp mind (patrol, goal 40 cm ahead). Wall: a.onWall/a.wallMode + yaw PI at 10 cm up the background; the game's geckoMove keeps it there (wall=true in every frame).
How skinned is known: CreatureMesh.put is patched on the prototype of the live CreatureLODs (found from window.game) and records which mesh drew the animal: `skinned=yes bones=25 body=baked GLB length=7.05 cm` in all 3 runs. The numbers are read from the game's own bone rows (skin.js boneData, the copy whose `live` set holds that mesh).
Commands (gecko; defaults url http://127.0.0.1:4630/, frames 8, dt 0.04, warm 1, seed 7):
  node tools/steps/lizard-cycle.mjs --species=gecko --surface=ground --view=side   (then --view=top; then --surface=wall --view=side)
Sheets (not opened): test-output/lizard/gecko-ground-side.png, test-output/lizard/gecko-ground-top.png, test-output/lizard/gecko-wall-side.png (.txt beside each)
Ranges, cm and deg (ground side | ground top | wall side):
  foot thighL -0.02..0.11 | -0.01..0.04 | 0.10..0.46;  armL 0.02..0.26 | -0.04..0.28 | 0.06..0.37
  foot thighR 0.03..0.32 | 0.11..0.32 | 0.21..0.44;  armR 0.02..0.16 | 0.04..0.16 | 0.22..0.46
  belly 0.27 CONSTANT | 0.27 CONSTANT | 0.39 CONSTANT;  bend 0.00 CONSTANT | -1.20..0.24 | -0.34..0.07
  headYaw 0.00 CONSTANT | -7.34..1.47 | -2.05..0.44;  tailX -0.08..0.13 | -0.28..0.17 | -0.11..0.04;  v 4.49..4.50 | 3.60..4.21 | 4.74..6.88 cm/s
Verdict: legs move (each foot lifts 0.14-0.36 cm; phase 9.4 rad/s = 1.5 cycles/s, so about 3 cm a stride at 4.5 cm/s); the tail tip sways only ±0.1-0.3 cm. Trunk and head do NOT move in a straight walk: bend and head yaw exactly 0, belly constant (no lateral undulation, no bob); they move only while turning or fleeing. No NaN; no foot far below (lowest -0.04 cm).
Plainly wrong: on the wall thighR and armR never come closer than 0.21 cm to it and the belly sits 0.12 cm higher than on the ground. Guess: my +0.5 cm start offset survives (animals.js:1105-1107 keeps the offset along the relief); not verified.
Also: top and wall runs start in mode=flee at f0 (the close camera seems to scare the gecko), so motion differs by view; the same command still gives the same frames.
Not verified: --species=skink and --view=three (not run); the sheets' pictures (builders check numbers).
Noticed: a headless Chrome (PID 64936, parent gone) was alive after my first runs; not attributable to me, left alone.

## Hand-off
- Output per run: `skinned=yes|no bones= body=` line, one line per frame, then ranges flagged NaN / CONSTANT / BELOW SURFACE (< -0.3 cm); .txt beside the sheet.
- Feet are named by the limb's upper bone (rig.chains c.u: thighL/R, armL/R); foot height = lowest head/tail of the bones under c.u except c.w, above T.heightAt (ground) or Wl.zAt (wall, +z is out of the wall).
- bend = pelvis->spine against spine->neck heads, headYaw = head bone against pelvis->neck, both in the body's own xz plane; tailX = last tail bone's tip off the pelvis->neck line, cm.
- Trap: import('/src/render/creatures/instanced.js') from the page is a second module copy (the game's has a ?t= stamp after an edit): patching that prototype sees nothing. The tool finds the class through window.game's CreatureLODs.
- Trap: a close camera turns the forced walk into flee (top/three, wall); --view=side on the ground gives the cleanest straight walk.
- Gait/muscle tasks: a straight walk gives zero C-bend. Guess: the rig2 bend channel (b2, read in instanced.js:128) only comes from turning; a gait-driven lateral undulation would go into lizardpose.js axial.
