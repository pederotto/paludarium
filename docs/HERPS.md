# Salamanders, newts, axolotls and geckos

How the fire salamander, paddle-tail newt, axolotl and mourning gecko decide what to do, how they move, and how they are drawn.
The earlier versions were a timer: pick a random point, walk, rest, repeat. They had no needs, no home and no reason.

## The mind: `src/sim/herp.js`

Pure (no three.js, no world), like `crab.js`; `tests/herp.test.mjs` runs scenes against it. `Animals.herp()` in `animals.js` senses the
world, calls `herpThink()` once per step and carries the intent out (walks, swims, climbs). The strike itself is still `hunter()` and
`strikes()`, so the sim's hunger and meal timing are unchanged.

Every animal has **drives** (0 … 1) and **one mode at a time**, chosen by priority, each kept for a minimum time so nothing flickers:

| Mode | Who | When |
|---|---|---|
| `warn` → `retreat` | fire salamander | something large close by: freezes, turns its flank and arches (the colours show), then withdraws; it never bolts |
| `flee` | newt, axolotl, gecko | fear above a threshold: a burst of tail strokes or a sprint to its shelter, then freezes |
| `air` | newt, axolotl | the air need is up (faster when warm or the water is low in oxygen): swims straight up, gulps at the surface, sinks back |
| `soak` | fire salamander | skin drying: walks to the water's edge and sits in the shallows until wet |
| `drink` | gecko | thirsty and water drops about (rain, misting, dew on the glass, or the water's edge): licks the droplets |
| `hunt` | all | hungry and food in sight or smell (or ordered by the sim): creeps in short moves, freezes when the prey moves, stops short of the reach and holds still for the strike; the gecko waves its tail |
| `hide` | all | not the hour to be out (lamp on, dry air, too warm, axolotls: bright light): goes to its shelter and tucks in; geckos sleep with eyes shut, curled, and prefer to sleep together |
| `shore` / `return` | newt | a damp night: climbs out to wander the bank, goes back before it dries |
| `forage` / `patrol` | all | out and about: a patrol of short legs, each followed by a pause with the head sweeping (snout down, sniffing); the gecko darts and pauses along the wall and now and then licks an eye |
| `shed` | all | the skin is due (every 8 to 60 days by species; it goes dull and milky for the last two): goes home, writhes, rubs its head, peels the skin off and eats it |
| `court` / `receive` / `follow` | newt, axolotl, fire salamander | a grown male with a ready female near (and fed, not too warm): approaches, displays (a water male fans his tail, a land male leans and nudges), leads off and waits; she, if she accepts (70 %), watches and follows; the pair is made and `sim.js` breeds a courted pair 2.5 times as readily |
| `larviposit` | fire salamander | pregnant (5 to 8 days after mating): walks to the shallows, stands in them and gives birth to 3 to 6 larvae, which are tadpoles with a fire salamander parent and climb out as young salamanders |
| `rest` | all | otherwise |

Activity (`awake()`) is `habitat.js nightActivity` (dark, damp nights and rain) times heat, with hunger overriding it and, for the
axolotl, a light-shyness term. A tank that is too warm keeps a fire salamander in its hide all night: that is meant.

A **shelter** is chosen by `Animals.herpFindHome` (`hideScore` on land; a ledge, root or rock close to the bottom in water; a crevice
on the wall near other geckos for a gecko) and kept: they come back to the same one.

Slow senses (shelter, shore, wet spot) are refreshed every 2 to 4 s and the prey search 3 to 4 times a second; nothing here is a per-frame
scan. Waiting times use game minutes capped at 5x, so a breath is not all an animal does at fast-forward.

Profiles (`PROFILES` in `herp.js`) hold the numbers per species; another species of the same kind (`newt`, `gecko`) falls back to the
nearest one (`profileFor`).

## The rig: `rig2` in `render/creatures/instanced.js`

A species whose `anim.rig2` is set (`{ neck, s0, s1, neckY, len }`) gets a second per-instance vector, `iAnim2` = head yaw, head pitch,
body bend, tail swing. The vertex shader turns the part ahead of the neck about the neck (weight 1 at `s0`, 0 at `s1`, never the
legs), curves the body in a C about the shoulders and swings the tail. Nothing is allocated for other species. The mind sets them
(sniffing sweeps, looking at prey, the warning arch, the gecko's tail wave and eye lick, the axolotl's head-up at the surface) and
`Animals.draw` adds the gait: the head swings against the body wave as the feet step, and follows the wave late when swimming.

**Tail and skin.** A gecko caught by something very close (`threat.d < 2.8`, fear above 0.6) drops its tail: the tail comes off, falls and thrashes for about 20 s (an extra instance of the gecko mesh showing only the part beyond the cut), and the gecko has a blunt stump that regrows over about 25 days to at most 85 % of the tail. The skin dulls to a milky tint before a shed (a varying in `material.js`).

The channels are packed: WebGPU allows 8 vertex buffers a pipeline and the creature meshes already use them (a third attribute made the shadow pipeline fail), so `iAnim2` is (head yaw, head pitch, A, B) with bend and tail in A and tail length, dullness and the tail piece's cut in B (`util/gait.js rig2Pack`, `material.js rig2Unpack`, tested).

Walking numbers (`anim.stride`, `lift`, `amp`) were raised to real proportions (a fire salamander's stride is about 4 cm, not 1.4). The
leg cycle still follows the distance walked (`util/gait.js strideRate`), so planted feet do not slip.

## The models

* **Gecko** (`bodies/salamanders.js`): rebuilt: a flat body wider than tall, a triangular head on a pinched neck with canthal ridges, brow
  and nostrils, thicker legs, wide toe pads with lamellae and small claws, a tail thick at the vent; fine granular skin at the close level;
  the mourning gecko's pattern (dorsolateral stripes from the nostril through the eye, irregular blotches, cream flecks, banded tail).
* **Axolotl**: gills sweep back as fuller frills instead of upright twigs.
* **Newt**, **fire salamander** (scan): unchanged.

## Checking

* `npm run test:unit` (`tests/herp.test.mjs`: sleeps by day and is out on damp nights; heat, hunger, fear; soak; creep-and-freeze; air
  gulps; light shyness; gecko drinking, stalking, eye licking).
* `node tools/steps/herps.mjs --cool=22 --hunt=1` (or `--life=1`: sheds, matings, births, dropped tails) in the real game: mode table per species, strikes and catches, stuck animals. Address the dev server as 127.0.0.1 when another dev server holds port 5173 on IPv6.
* `node tools/bench.mjs gecko --pose=walk|look|nod|arch|tailwave --views=top,side` for the rig; `tools/animals-seq.mjs --night=1
  --cool=15 --force=go` for a walk in the tank (it is dark at night: the bench is easier to read).

## Not done

* A gecko lays where it happens to be (the sim's egg laying); there is no search for a laying site and no communal sites.
* Newt and axolotl eggs, and their courtship, are the sim's chance of breeding made 2.5 times likelier by a courtship; the spermatophore is not drawn.
* Burrow-style hides are not dug: they use the pieces and moss that are there.
* A dropped tail is not eaten by anything.
