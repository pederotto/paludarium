// The frog's hind-limb muscles (docs/MUSCLES.md), the template every anuran shares: named landmarks on the 17-bone skeleton
// (tools/rig/skeleton.mjs frogBones), and the muscles, or functional groups of them, as paths between those landmarks with their mass
// share, fibres and tendon. A species overrides numbers, never the list. Every number says where it comes from (`src`) and how sure
// it is (`tag`: measured on the species or a homologous muscle, scaled from another species or by a stated rule, or a guess).
//
// Anatomy: Collings & Richards 2019, PeerJ 7:e7003, Table 2 (origins and insertions of 41 muscles, Phlyctimantis maculatus); the
// functional groups of Leavey, Richards & Porro 2024, J Anat 245:751, Table 1; the hip actions of Collings et al. 2022, Front Bioeng
// 10:806174, Table 6 (moment arms of a MuJoCo model of the same frog). Ids are the papers' abbreviations; a group lists its members.
//
// Landmarks: on a bone of the skeleton, `t` along it (bone lengths from its head; < 0 or > 1 past its ends), then across it in that
// bone's flesh radii (the skeleton's `r`): `post` toward the flexor side (the side the next bone folds onto: the back of the thigh,
// the calf, the sole), `dors` toward the frog's back, `out` away from the midline (pelvis only). A pelvis landmark is placed from the
// hip of its side (`at: 'hip'`, the acetabulum) or from the pelvis' axis (`at: 'axis'`, the midline: urostyle). The skeleton's hip
// sits where the thigh leaves the body, lateral of the real acetabulum, so the pelvic landmarks are set from it with the real
// offsets (behind, above, below it) and the lines of pull about the joint the skin turns about stay true (docs/MUSCLES.md).
import { framePoint, pathLength, wrapLength, across, vec } from '../util/musculo.js';
import { HOP } from '../util/gait.js';

export const MUSCLES_SCHEMA = 1;
const HIPR_AT = [10, 45, 90, 135];       // (the femur's whole tested range, Collings 2022: a retractor throughout)          // bump when a field's meaning changes (the bake and the runtime check it)

const { sub, add, mul, cross, norm, dot, len } = vec;

// --- Landmarks ---------------------------------------------------------------------------------------------------------------------
// soft: a soft-tissue anchor (an aponeurosis, a tendon's bend over a joint), not on the bone itself; it must still lie inside the skin.
export const ANURAN_LANDMARKS = {
  // pelvis (bone 'pelvis', vent to sacrum): `t` in pelvis lengths, across in the pelvis' flesh radius
  urostyle_post:   { bone: 'pelvis', at: 'axis', t: 0.10, dors: 0.70, what: 'posterior urostyle, dorsal midline over the vent' },
  urostyle_ant:    { bone: 'pelvis', at: 'axis', t: 0.80, dors: 0.75, what: 'anterior half of the urostyle' },
  sacrum:          { bone: 'pelvis', at: 'hip', t: 0.95, dors: 0.35, out: -0.15, what: 'sacral diapophysis, dorsal' },
  ilium_ant:       { bone: 'pelvis', at: 'hip', t: 0.80, dors: 0.15, out: -0.10, what: 'anterior iliac shaft by the sacroiliac joint' },
  ilium_lat:       { bone: 'pelvis', at: 'hip', t: 0.45, dors: 0.05, out: 0.05, what: 'lateral iliac shaft' },
  ilium_med:       { bone: 'pelvis', at: 'hip', t: 0.45, dors: -0.05, out: -0.30, what: 'medial iliac shaft' },
  ilium_dors:      { bone: 'pelvis', at: 'hip', t: 0.10, dors: 0.40, out: -0.05, what: 'dorsal rim of the ilium above the acetabulum' },
  ilium_vent:      { bone: 'pelvis', at: 'hip', t: 0.18, dors: -0.30, out: -0.05, what: 'ventral ilium in front of the acetabulum' },
  ilium_vent_acet: { bone: 'pelvis', at: 'hip', t: 0.06, dors: -0.35, out: -0.05, what: 'ventral border of the ilium at the acetabulum' },
  // (the pelvic disc is thin from side to side, so its rims sit almost straight behind, above and below the acetabulum)
  ischium_dors:    { bone: 'pelvis', at: 'hip', t: -0.12, dors: 0.30, out: -0.08, what: 'dorsal rim of the ischium' },
  ischium_post:    { bone: 'pelvis', at: 'hip', t: -0.16, dors: 0.00, out: -0.08, what: 'posterior ischium' },
  ischium_vent:    { bone: 'pelvis', at: 'hip', t: -0.10, dors: -0.35, out: -0.08, what: 'ventral border of the ischium, behind the acetabulum' },
  pubis:           { bone: 'pelvis', at: 'hip', t: 0.10, dors: -0.45, out: -0.08, what: 'ventral rim of the disc in front of the ischium (pubis): placed so the straps\' line of pull protracts, as Collings 2022 finds' },
  // femur (bone 'thigh')
  femur_prox:      { bone: 'thigh', t: 0.12, post: 0.15, what: 'proximal femur' },
  troch_post:      { bone: 'thigh', t: 0.03, post: 0.45, dors: 0.05, soft: true, what: 'behind the femoral head: the short retractors pass round it' },
  femur_prox_ant:  { bone: 'thigh', t: 0.10, post: -0.35, dors: 0.15, what: 'proximal femur, anterior: the line of the iliac muscles over the hip' },
  femur_prox2:     { bone: 'thigh', t: 0.28, post: 0.20, dors: -0.05, what: 'proximal femur below the head (quadratus femoris, gemellus, obturator externus spread to here)' },
  femur_mid:       { bone: 'thigh', t: 0.50, post: 0.20, dors: -0.15, what: 'mid femoral shaft, posteroventral' },
  femur_dist:      { bone: 'thigh', t: 0.80, post: 0.20, dors: -0.20, what: 'distal third of the femoral shaft' },
  knee_ant:        { bone: 'thigh', t: 0.92, post: -0.60, dors: 0.10, soft: true, what: 'anterior knee aponeurosis, above the knee (it wraps over the knee: wraps.knee)' },
  knee_post:       { bone: 'thigh', t: 0.97, post: 0.35, dors: -0.05, soft: true, what: 'posterior knee aponeurosis' },
  knee_med:        { bone: 'thigh', t: 0.96, post: 0.35, dors: -0.55, soft: true, what: 'medial (ventral) knee aponeurosis' },
  knee_lat:        { bone: 'thigh', t: 0.98, post: 0.10, dors: 0.55, soft: true, what: 'lateral (dorsal) knee aponeurosis' },
  // tibiofibula (bone 'shin'): `post` is the calf side
  tib_prox_ant:    { bone: 'shin', t: 0.10, post: -0.50, what: 'proximal tibiofibula, anterior crest' },
  tib_prox_post:   { bone: 'shin', t: 0.10, post: 0.30, what: 'proximal tibiofibula, posterior' },
  tib_prox_vent:   { bone: 'shin', t: 0.12, post: 0.20, dors: -0.30, what: 'proximal tibiofibula, ventral' },
  tib_prox_lat:    { bone: 'shin', t: 0.08, post: 0.05, dors: 0.35, what: 'proximal tibiofibula, lateral (fibular) side' },
  tib_mid_ant:     { bone: 'shin', t: 0.40, post: -0.30, what: 'anterior tibiofibula' },
  tib_mid_post:    { bone: 'shin', t: 0.40, post: 0.30, what: 'posterior tibiofibula, mid-shaft (the tibialis posticus arises along 0.33-1.0, CR19 Table 2)' },
  tib_dist_lat:    { bone: 'shin', t: 0.85, post: -0.05, dors: 0.30, what: 'distal tibiofibula, lateral' },
  tib_dist_antmed: { bone: 'shin', t: 0.65, post: -0.30, dors: -0.20, what: 'distal tibiofibula, anteromedial' },
  calf:            { bone: 'shin', t: 0.50, post: 0.50, what: 'the calf, along the back of the tibiofibula' },
  heel_post:       { bone: 'shin', t: 0.92, post: 0.45, soft: true, what: 'above the back of the heel (the plantaris tendon wraps over the heel: wraps.heel)' },
  // astragalus and calcaneum (bone 'foot', the long tarsus): `post` is the sole
  tars_prox_plant: { bone: 'foot', t: 0.06, post: 0.45, what: 'proximal astragalus and calcaneum, plantar' },
  tars_prox_ant:   { bone: 'foot', t: 0.10, post: -0.45, what: 'proximal astragalus, medial and dorsal' },
  tars_prox_side:  { bone: 'foot', t: 0.06, post: 0.20, dors: 0.30, what: 'proximal calcaneum, lateral border' },
  // the foot (bone 'toes')
  plantar_apo:     { bone: 'toes', t: 0.15, post: 0.45, soft: true, what: 'plantar aponeurosis' },
};

// --- Muscles -----------------------------------------------------------------------------------------------------------------------
// id        a muscle or functional group, members: the papers' abbreviations (CONTRACTS.md)
// path      landmarks from origin through via-points to insertion
// belly     the fleshy part, as fractions of the path's rest length (the rest is tendon or aponeurosis)
// seg       the segment whose muscle mass it shares: 'thigh' or 'shank'; share: its fraction of that segment's muscle mass
// fibre     lf: optimal fibre length over the belly's length; alpha: pennation at optimal length (deg); ln0: fibre length over optimal
//           in the sitting frog's crouch (extensors are stretched there, ready to push: Lutz & Rome 1994 for Rana's semimembranosus)
// e0        tendon strain at the muscle's maximum force
// hipAt     femur protractions (deg, protractionAt) its hip action holds at, from its source (Collings 2022: 45-135); default [90]
// acts      its action on each joint it crosses, as its source names it: hip protractor (flexor) / retractor (extensor), knee and
//           ankle flexor / extensor; 'variable' when the source finds it changes with posture (no sign asserted)
// drive     when it fires: 'push' with the hop's take-off and the kick's thrust, 'recover' as the legs fold back (excitation below)
// visible   a superficial belly that shapes the skin (render/creatures/muscles.js draws these); deep ones only work
const G = (note) => ({ src: 'none yet', tag: 'guess', note });
export const ANURAN_MUSCLES = [
  // thigh
  { id: 'TRI', drive: 'push', members: ['CR', 'GL', 'TFL'], name: 'triceps femoris: cruralis, gluteus magnus, tensor fasciae latae',
    path: ['ilium_vent', 'femur_prox_ant', 'knee_ant', 'tib_prox_ant'], wraps: { knee: 'ant' }, belly: [0.06, 0.8], seg: 'thigh', share: 0.28,
    fibre: { lf: 0.35, alpha: 20, ln0: 1.1 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'protractor', knee: 'extensor' },
    actSrc: 'hip: Collings 2022 Table 6 (CR/GL one MTU); knee: Leavey 2024 Table 1', visible: true,
    num: G('cruralis the largest, most pinnate thigh muscle (Leavey 2024); share, fibres and tendon wait for R1') },
  { id: 'SM', drive: 'push', members: ['SM'], name: 'semimembranosus',
    path: ['ischium_dors', 'knee_lat', 'tib_prox_lat'], belly: [0.05, 0.9], seg: 'thigh', share: 0.15,
    fibre: { lf: 0.75, alpha: 0, ln0: 1.15 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'retractor', knee: 'variable' },
    // (into the knee aponeurosis laterally and ventrally, Collings & Richards 2019 Table 2; until 5 Oct 15:1x it ran behind the knee,
    // a pure flexor by its path while its action is posture-dependent: anatomy specialist A1, control/anatomy-A1.md item 2)
    actSrc: 'hip: Collings 2022 Table 6; knee changes with posture (Kargo & Rome 2002)', visible: true,
    num: G('internal oblique septum (Collings 2019 Fig 9): may act as two parts') },
  { id: 'GR', drive: 'push', members: ['GRma', 'GRmi'], name: 'gracilis major and minor',
    path: ['ischium_post', 'knee_med', 'tib_prox_vent'], belly: [0.04, 0.9], seg: 'thigh', share: 0.15,
    fibre: { lf: 0.7, alpha: 0, ln0: 1.1 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'retractor', knee: 'variable' },
    actSrc: 'hip: Collings 2022 Table 6', visible: true, num: G('major has a U-shaped tendinous septum') },
  { id: 'IFB', drive: 'push', members: ['IFB'], name: 'iliofibularis',
    path: ['ilium_dors', 'knee_lat', 'tib_prox_lat'], belly: [0.05, 0.9], seg: 'thigh', share: 0.03,
    fibre: { lf: 0.85, alpha: 0, ln0: 1.0 }, e0: 0.04, acts: { hip: 'variable', knee: 'variable' },
    actSrc: 'hip: Collings 2022 Table 6 (protractor in swing, retractor in stance)', visible: true, num: G('') },
  { id: 'ST', drive: 'recover', members: ['ST'], name: 'semitendinosus (two heads, one tendon)',
    path: ['ischium_post', 'femur_dist', 'tib_prox_vent'], belly: [0.05, 0.7], seg: 'thigh', share: 0.05,
    fibre: { lf: 0.8, alpha: 0, ln0: 0.95 }, e0: 0.04, acts: { knee: 'flexor' },
    actSrc: 'knee: Leavey 2024 Table 1', visible: true, num: G('ventral head passes through the adductor magnus') },
  { id: 'SA_AL', drive: 'recover', members: ['SA', 'AL'], name: 'sartorius and adductor longus',
    path: ['pubis', 'femur_mid', 'knee_med', 'tib_prox_vent'], belly: [0.04, 0.85], seg: 'thigh', share: 0.05,
    fibre: { lf: 0.9, alpha: 0, ln0: 0.95 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'protractor' },
    actSrc: 'hip: Collings 2022 Table 6 (both)', visible: true, num: G('') },
  { id: 'AM', drive: 'push', members: ['AM'], name: 'adductor magnus (dorsal and ventral heads)',
    path: ['ischium_vent', 'femur_dist'], belly: [0.05, 0.95], seg: 'thigh', share: 0.11,
    fibre: { lf: 0.6, alpha: 10, ln0: 1.05 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'retractor' },
    actSrc: 'hip: Collings 2022 Table 6 (Leavey 2024 Table 1 groups it with the protractors: posture)', visible: true, num: G('') },
  { id: 'ILI', drive: 'recover', members: ['II', 'IE'], name: 'iliacus internus and externus',
    path: ['ilium_med', 'ilium_vent', 'femur_prox'], belly: [0.05, 0.85], seg: 'thigh', share: 0.06,
    fibre: { lf: 0.6, alpha: 10, ln0: 0.9 }, e0: 0.04, hipAt: [45, 90, 135], acts: { hip: 'protractor' },
    actSrc: 'hip: Collings 2022 Table 6 (II, IE)', visible: false, num: G('II wraps ventrally round the ilium') },
  { id: 'HIPR', drive: 'push', members: ['PY', 'QF', 'GE'], name: 'short hip retractors: pyriformis, quadratus femoris, gemellus',
    path: ['urostyle_post', 'troch_post', 'femur_prox2'], belly: [0.05, 0.9], seg: 'thigh', share: 0.05,
    fibre: { lf: 0.8, alpha: 5, ln0: 1.1 }, e0: 0.04, acts: { hip: 'retractor' }, hipAt: HIPR_AT,
    // (the pyriformis' line from the posterior urostyle, Collings & Richards 2019 Table 2: its extensor moment "gets stronger with
    // retraction", Collings 2022 Table 6. From the ischium, as until 15:1x, the group turned protractor below about 60 deg: C1b round 3
    // item 6, A1 item 6)
    actSrc: 'hip: Collings 2022 Table 6 (PY: extensor, stronger with retraction); Leavey 2024 Table 1 (QF, GE retract)', visible: false,
    num: G('the obturator internus (a ring round the hip that turns the femur about its length) is not modelled: a straight path cannot hold it') },
  { id: 'OE_PEC', drive: 'push', members: ['OE', 'PEC'], name: 'obturator externus and pectineus',
    path: ['ischium_vent', 'femur_mid'], belly: [0.05, 0.9], seg: 'thigh', share: 0.04,
    fibre: { lf: 0.8, alpha: 5, ln0: 1.05 }, e0: 0.04, acts: { hip: 'variable' },
    actSrc: 'OE retracts (Leavey 2024 Table 1), PEC stabilises the femur (Leavey 2024): the group is not asserted', visible: false, num: G('shared fleshy origin on the ventral ischium (Collings 2019 Table 2)') },
  { id: 'IFM', drive: 'recover', members: ['IFM'], name: 'iliofemoralis',
    path: ['ilium_vent_acet', 'femur_mid'], belly: [0.05, 0.9], seg: 'thigh', share: 0.03,
    fibre: { lf: 0.9, alpha: 0, ln0: 0.85 }, e0: 0.04, acts: { hip: 'variable' },
    actSrc: 'hip: Collings 2022 Table 6 (changes from protractor in swing to retractor in stance)', visible: false, num: G('') },
  // shank
  { id: 'PL', drive: 'push', members: ['PL'], name: 'plantaris longus',
    path: ['knee_post', 'calf', 'heel_post', 'tars_prox_plant', 'plantar_apo'], wraps: { ankle: 'post' }, belly: [0.03, 0.5], seg: 'shank', share: 0.55,
    fibre: { lf: 0.35, alpha: 25, ln0: 1.2 }, e0: 0.05, acts: { ankle: 'extensor', knee: 'variable' },
    actSrc: 'ankle: Leavey 2024 Table 1; two joints (Collings 2019)', visible: true,
    num: G('the main jumping and swimming muscle; its tendon is the catapult (R2). Fibres 0.35 of the belly: raised from 0.30 so they stay at or above 0.5 of optimal at take-off (tests/anuran-muscles.test.mjs); bounded by the validator, not measured') },
  { id: 'TiAL', drive: 'push', members: ['TiAL'], name: 'tibialis anticus longus (two heads)',
    path: ['knee_lat', 'tib_mid_ant', 'tars_prox_side'], belly: [0.05, 0.8], seg: 'shank', share: 0.17,     // (along the shank's front: CR19; A1 item 12)
    fibre: { lf: 0.5, alpha: 15, ln0: 1.0 }, e0: 0.04, acts: { ankle: 'variable' },
    actSrc: 'ankle: Leavey 2024 Table 1 groups it with the ankle extensors; it inserts on the borders of the proximal tarsals, near the heel\'s axis, so its sign is posture-dependent and not asserted until moment arms are read (R1)', visible: true, num: G('head 1 to the calcaneum, head 2 to the astragalus') },
  { id: 'TiP', drive: 'push', members: ['TiP'], name: 'tibialis posticus',
    path: ['tib_mid_post', 'heel_post', 'tars_prox_plant'], wraps: { ankle: 'post' }, belly: [0.05, 0.8], seg: 'shank', share: 0.08,     // (from the posterior shaft 0.33-1.0: CR19 Table 2; A1 item 11)
    fibre: { lf: 0.6, alpha: 15, ln0: 1.05 }, e0: 0.04, acts: { ankle: 'extensor' },     // (lf 0.5 to 0.6 with the shorter origin: a guess, bounded by the fibre validator: 0.47 of optimal at 0.5, 0.56 at 0.6)
    actSrc: 'ankle: Leavey 2024 Table 1', visible: false, num: G('') },
  { id: 'TiAB', drive: 'recover', members: ['TiAB'], name: 'tibialis anticus brevis',
    path: ['tib_mid_ant', 'tars_prox_ant'], belly: [0.05, 0.8], seg: 'shank', share: 0.07,
    fibre: { lf: 0.6, alpha: 10, ln0: 0.9 }, e0: 0.04, acts: { ankle: 'flexor' },
    actSrc: 'ankle (dorsiflexion and inversion): Leavey 2024 Table 1', visible: false, num: G('') },
  { id: 'PER_ECB', drive: 'push', members: ['PER', 'ECB'], name: 'peroneus and extensor cruris brevis',
    path: ['knee_ant', 'tib_prox_ant', 'tib_dist_lat'], wraps: { knee: 'ant' }, belly: [0.08, 0.9], seg: 'shank', share: 0.13,
    fibre: { lf: 0.6, alpha: 10, ln0: 0.95 }, e0: 0.04, acts: { knee: 'extensor' },
    actSrc: 'knee (shank): Leavey 2024 Table 1', visible: true, num: G('') },
];

// The cylinders tendons wrap over (musculo.js wrapLength): at the knee the aponeurosis over the femur's condyles, at the ankle (heel) the
// plantaris tendon over the calcaneum; radius in the proximal bone's flesh radius. Guesses until moment arms are read (R1).
export const ANURAN_WRAPS = {
  knee: { parent: 'thigh', child: 'shin', rho: 0.3, src: 'none yet', tag: 'guess' },
  ankle: { parent: 'shin', child: 'foot', rho: 0.35, src: 'none yet', tag: 'guess' },
};

// The visible bellies' slots in the bone texture (render/creatures/skin.js: one texel each after the bones), left then right, in the
// template's order, as `${id}${side}`; the bake writes each skin vertex's two slots (_MUSC), so this order is part of the schema.
export const MAX_SLOTS = 21;                 // texels 54 ... 74 of a 75-texel row are free on an 18-bone frog (spineB); 20 bellies are visible
export function visibleSlots(defs = ANURAN_MUSCLES) {
  const ids = defs.filter((d) => d.visible).map((d) => d.id), out = [...ids.map((i) => i + 'L'), ...ids.map((i) => i + 'R')];
  if (out.length > MAX_SLOTS) throw new Error(`${out.length} visible muscles, the row has room for ${MAX_SLOTS}`);
  return out;
}

// The whole-limb numbers a species scales its muscles by (overridden per species; all guesses until the research rows land).
export const ANURAN_WHOLE = {
  // (Roberts, Abbott & Azizi 2011 Table 1, "% leg muscle", all hind-limb muscles but the iliosacral, "combined limb": read as both legs,
  // not stated, control/round-4.md: Rhinella marina 13, Osteopilus septentrionalis 18, Rana pipiens 25; a dart frog walks and hops
  // short, so the walker-hopper's; no dendrobatid number found)
  hindlimbOfBody: { value: 0.13, band: [0.13, 0.25], src: 'Roberts, Abbott & Azizi 2011, Phil Trans R Soc B 366:1488, Table 1', tag: 'scaled', note: 'hind-limb muscle mass, both legs, over body mass' },
  segOfHindlimb: { thigh: 0.58, shank: 0.42, src: 'none yet', tag: 'guess', note: 'pelvic and foot muscles not modelled yet' },
  sigma: { value: 21.4, unit: 'N/cm2', src: 'Roberts, Abbott & Azizi 2011 Table 1, P0 in vitro (Osteopilus; Rana 22.7, Rhinella 20.2)', tag: 'measured', note: 'the table does not name the muscle (control/round-4.md)' },
  density: { value: 1.0, unit: 'g/cm3', src: 'none yet', tag: 'guess', note: 'the whole frog, for its mass from the scan volume' },
};

// --- Frames on a baked skeleton ------------------------------------------------------------------------------------------------------
const UP = [0, 1, 0];

// Each bone's frame in the rest pose (musculo.js `frame`), keyed by bone name. The pelvis: along it vent to sacrum, `dors` the body's
// up, `out` its side (+x on the right). A leg bone: `post` the side its distal neighbour folds onto (the thigh's back, the shin's calf,
// the tarsus' sole; the leg folds in a Z, so the shin's calf faces the thigh and the tarsus' sole faces away from the shin), `dors`
// across both, toward the back.
export function anuranFrames(skel) {
  const B = skel.bones, by = Object.fromEntries(B.map((b) => [b.name, b]));
  const F = {};
  const base = (b) => ({ o: b.head, a: norm(sub(b.tail, b.head)), L: len(sub(b.tail, b.head)), r: b.r ?? 0.2 });
  const P = by.pelvis;
  if (!P) return null;
  const fp = base(P);
  fp.dors = across(UP, fp.a);
  fp.post = mul(fp.dors, -1);
  F.pelvis = fp;
  for (const s of ['L', 'R']) {
    const th = by['thigh' + s], sh = by['shin' + s], ft = by['foot' + s], to = by['toes' + s];
    if (!th || !sh || !ft || !to) return null;
    const ft_ = base(th), fs = base(sh), ff = base(ft), fo = base(to);
    ft_.post = across(fs.a, ft_.a);                    // the shin folds onto the back of the thigh
    fs.post = across(mul(ft_.a, -1), fs.a);            // the calf faces the thigh
    ff.post = across(fs.a, ff.a);                      // the sole faces away from the shin
    fo.post = across(ff.post, fo.a);
    const side = s === 'L' ? -1 : 1;
    for (const f of [ft_, fs, ff, fo]) {
      let d = norm(cross(f.a, f.post));
      if (dot(d, fp.dors) < 0) d = mul(d, -1);
      f.dors = d;
    }
    // the pelvis' side for this hip: out = dors x along, signed by side
    F['out' + s] = mul(norm(cross(fp.dors, fp.a)), side * Math.sign(norm(cross(fp.dors, fp.a))[0] || 1));
    Object.assign(F, { ['thigh' + s]: ft_, ['shin' + s]: fs, ['foot' + s]: ff, ['toes' + s]: fo });
  }
  return F;
}

// A landmark's rest position (cm) for side s ('L' or 'R') of a skeleton, from its frames.
export function landmarkAt(skel, F, id, s, L = ANURAN_LANDMARKS) {
  const lm = L[id];
  if (!lm) throw new Error(`no landmark ${id}`);
  if (lm.bone === 'pelvis') {
    const fp = F.pelvis, out = F['out' + s];
    const hip = skel.bones.find((b) => b.name === 'thigh' + s).head;
    const o = lm.at === 'hip' ? hip : fp.o;
    // a hip landmark keeps the hip's height and side, then moves along the pelvis' axis and across it
    return framePoint({ o, a: fp.a, L: fp.L, r: fp.r, post: fp.post, dors: fp.dors, out }, { t: lm.t, dors: lm.dors, out: lm.at === 'axis' ? 0 : lm.out });
  }
  return framePoint(F[lm.bone + s], lm);
}

// The muscles of a baked anuran skeleton, both sides, in the rest pose: [{ id, side, def, pts: [{ bone (index), p (cm) }], L0 (cm) }].
// `defs`: the template, or a species' copy with its overrides.
export function anuranMuscleSet(skel, defs = ANURAN_MUSCLES, L = ANURAN_LANDMARKS) {
  const F = anuranFrames(skel);
  if (!F) return null;
  const idx = Object.fromEntries(skel.bones.map((b, i) => [b.name, i]));
  const out = [];
  for (const s of ['L', 'R']) {
    for (const def of defs) {
      const pts = def.path.map((id) => {
        const lm = L[id];
        return { bone: idx[lm.bone === 'pelvis' ? 'pelvis' : lm.bone + s], p: landmarkAt(skel, F, id, s, L), id };
      });
      out.push({ id: def.id, side: s, def, pts, L0: pathLength(pts.map((q) => q.p)) });
    }
  }
  return out;
}

// A muscle's path length in a pose. `at(b, p)`: rest point p of bone b to its posed position (skeleton.js applyBone on a pose's
// packed row, or the identity for the rest pose). Segments between two bones across a wrapped joint go round its cylinder: centre the
// child's posed head, axis the hinge's (the rest axis carried by the parent), the inside of the fold the two bones' flexor sides.
// `cache` (optional, one per pose): the wraps' cylinders, made once a pose and side instead of once a muscle.
export function musclePathLength(m, skel, at, F = null, W = ANURAN_WRAPS, cache = null) {
  const pts = m.pts, B = skel.bones;
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const P = at(pts[i - 1].bone, pts[i - 1].p), Q = at(pts[i].bone, pts[i].p);
    const wr = m.def.wraps && jointBetween(skel, pts[i - 1].bone, pts[i].bone);
    if (wr && m.def.wraps[wr]) {
      const g = cache ? (cache[wr + m.side] ??= wrapGeom(skel, F ?? (m._F ??= anuranFrames(skel)), wr, m.side, at, W)) : wrapGeom(skel, F ?? (m._F ??= anuranFrames(skel)), wr, m.side, at, W);
      s += wrapLength(P, Q, g.C, g.n, g.rho, g.inside);
    } else s += len(sub(Q, P));
  }
  return s;
}
const jointOf = { thigh: 'hip', shin: 'knee', foot: 'ankle', toes: 'tarsus' };
function jointBetween(skel, b0, b1) {
  const n0 = skel.bones[b0].name.replace(/[LR]$/, ''), n1 = skel.bones[b1].name.replace(/[LR]$/, '');
  const order = ['pelvis', 'thigh', 'shin', 'foot', 'toes'], i0 = order.indexOf(n0), i1 = order.indexOf(n1);
  if (i0 < 0 || i1 < 0 || Math.abs(i1 - i0) !== 1) return null;
  return jointOf[order[Math.max(i0, i1)]];
}
// The wrap's cylinder in a pose: centre, unit axis, radius (cm) and the inside of the fold (a direction).
const WRAPIX = new WeakMap();          // per skeleton: the parent and child bone indices of each wrap and side (found once)
export function wrapGeom(skel, F, joint, s, at, W = ANURAN_WRAPS) {
  const w = W[joint], B = skel.bones;
  let M = WRAPIX.get(skel);
  if (!M) WRAPIX.set(skel, (M = {}));
  const key = joint + s, ix = (M[key] ??= [B.findIndex((b) => b.name === w.parent + s), B.findIndex((b) => b.name === w.child + s)]);
  const ip = ix[0], ic = ix[1], fp = F[w.parent + s], fc = F[w.child + s];
  const C = at(ic, B[ic].head);
  const dirAt = (b, o, d) => sub(at(b, add(o, d)), at(b, o));       // a rest direction carried by bone b's pose
  const n = norm(dirAt(ip, B[ic].head, norm(cross(fp.a, fc.a))));
  // the inside of the fold: the knee's between the thigh's back and the calf; the ankle's between the shin's front and the instep
  const sp = joint === 'knee' ? 1 : -1;
  const inside = add(mul(dirAt(ip, B[ic].head, fp.post), sp), mul(dirAt(ic, B[ic].head, fc.post), sp));
  return { C, n, rho: w.rho * fp.r, inside: len(inside) > 1e-6 ? norm(inside) : mul(dirAt(ip, B[ic].head, fp.post), sp) };
}

// A pose with one joint of side s turned by `angle` (rad) more: the bones below it rotate about it. hip: protraction (about the pelvis'
// up, + swings the knee toward the head); knee, heel: flexion (about the hinge, + folds it further). `at`: the pose to start from.
// For the tests and tools (moment arms, ranges); the game poses bones in render/creatures/skeleton.js.
export function turnJoint(skel, joint, s, angle, at = (b, p) => p, F = anuranFrames(skel)) {
  const B = skel.bones, idx = (n) => B.findIndex((b) => b.name === n + s);
  const chain = { hip: ['thigh', 'shin', 'foot', 'toes'], knee: ['shin', 'foot', 'toes'], ankle: ['foot', 'toes'] }[joint].map(idx);
  const child = chain[0], parentName = { hip: 'pelvis', knee: 'thigh', ankle: 'shin' }[joint];
  const ip = parentName === 'pelvis' ? B.findIndex((b) => b.name === 'pelvis') : idx(parentName);
  const C = at(child, B[child].head), dirAt = (b, d) => sub(at(b, add(B[child].head, d)), at(b, B[child].head));
  let n, sign = 1;
  if (joint === 'hip') {
    n = norm(dirAt(ip, F.pelvis.dors));
    const k = sub(at(child, B[child].tail), C), fwd = norm(dirAt(ip, F.pelvis.a));
    sign = dot(cross(n, k), fwd) >= 0 ? 1 : -1;            // + swings the knee toward the head
  } else {
    const fp = F[parentName + s], fc = F[B[child].name];
    n = norm(dirAt(ip, cross(fp.a, fc.a)));
    const pa = norm(dirAt(ip, fp.a)), ca = norm(dirAt(child, fc.a)), ca2 = rotv(n, 0.01, ca);
    sign = Math.acos(Math.max(-1, Math.min(1, dot(pa, ca2)))) > Math.acos(Math.max(-1, Math.min(1, dot(pa, ca)))) ? 1 : -1;
  }
  const set = new Set(chain), th = angle * sign;
  return (b, p) => { const q = at(b, p); return set.has(b) ? add(C, rotv(n, th, sub(q, C))) : q; };
}
const rotv = (n, t, v) => {
  const c = Math.cos(t), s = Math.sin(t), k = dot(n, v) * (1 - c), x = cross(n, v);
  return [v[0] * c + x[0] * s + n[0] * k, v[1] * c + x[1] * s + n[1] * k, v[2] * c + x[2] * s + n[2] * k];
};
// The femur's protraction in a pose (deg in the pelvis' horizontal plane: 0 straight back along the body, 90 straight out to the side,
// 180 straight forward), the angle Collings et al. 2022 set their femur at (10, 45, 90, 135).
export function protractionAt(skel, s, at = (b, p) => p, F = anuranFrames(skel)) {
  const B = skel.bones, i = B.findIndex((b) => b.name === 'thigh' + s), ip = B.findIndex((b) => b.name === 'pelvis');
  const k = sub(at(i, B[i].tail), at(i, B[i].head));
  const up = norm(sub(at(ip, add(F.pelvis.o, F.pelvis.dors)), at(ip, F.pelvis.o))), fwd = norm(sub(at(ip, add(F.pelvis.o, F.pelvis.a)), at(ip, F.pelvis.o)));
  const h = norm(sub(k, mul(up, dot(k, up))));
  return (Math.acos(Math.max(-1, Math.min(1, -dot(h, fwd)))) * 180) / Math.PI;
}
// A muscle's moment arm (cm) about a joint in a pose: + flexes (hip: protracts), - extends (retracts).
export function momentArmAt(m, skel, joint, at = (b, p) => p, h = 0.01) {
  const F = m._F ??= anuranFrames(skel);
  const L = (a) => musclePathLength(m, skel, turnJoint(skel, joint, m.side, a, at, F), F);
  return -(L(h) - L(-h)) / (2 * h);
}
// A joint's fold (deg between the parent bone and the child, 0 straight, 180 folded back) in a pose: knee, ankle (the crural-tarsal joint, the rig's heel).
export function foldAt(skel, joint, s, at = (b, p) => p) {
  const B = skel.bones, idx = (n) => B.findIndex((b) => b.name === n + s);
  const [pn, cn] = { knee: ['thigh', 'shin'], ankle: ['shin', 'foot'] }[joint];
  const d = (i) => norm(sub(at(i, B[i].tail), at(i, B[i].head)));
  return (Math.acos(Math.max(-1, Math.min(1, dot(d(idx(pn)), d(idx(cn)))))) * 180) / Math.PI;
}

// A muscle's mechanics in a skeleton (musculo.js fibreState): its belly at rest is `belly` of its rest path, its fibres there `fibre.lf`
// of the belly and `fibre.ln0` of their optimal length; the tendon takes the rest of the path, just slack at rest. F0 from its mass
// (g) and the specific tension (N/cm²) when given, else 1 (forces then come out in units of F0).
export function muscleUnit(mu, skel, massG = 0, sigma = ANURAN_WHOLE.sigma.value) {
  const d = mu.def, L0 = musclePathLength(mu, skel, (b, p) => p), lb = (d.belly[1] - d.belly[0]) * L0;
  const lfr = d.fibre.lf * lb, lopt = lfr / d.fibre.ln0, a0 = (d.fibre.alpha * Math.PI) / 180;
  const sinR = Math.min(0.95, (lopt * Math.sin(a0)) / lfr), lts = L0 - lfr * Math.sqrt(1 - sinR * sinR);
  const F0 = massG > 0 ? ((massG * Math.cos(a0)) / (1.06 * lopt)) * sigma : 1;
  return { lopt, lts, alpha: a0, e0: d.e0, F0, L0, lb };
}

// What the nervous system asks of a muscle (excitation 0 ... 1) in a motion: ctx { mode: 'sit' | 'walk' | 'hop' | 'swim' | 'leap',
// t: 0 ... 1 through it }. The take-off and the kick's thrust fire the 'push' muscles; the flight and the recovery fold the legs with
// the 'recover' ones; the landing braces with the push muscles; at rest a low tone. A guess in the shape of the jump EMG (extensors
// active through the push, flexors after take-off) until R2's timings land.
// The activation modes of one hind leg, from its own phase t (0 = cock, the diamond fold; ctx.amp 0 ... 1 scales the phasic part above
// tone). Windows = frame (W2 clip 3: swing 0.25 of the cycle, stretch at 0.45-0.60; W1 clip 2); every height = guess.
export function moveExcitation(def, ctx) {
  const t = (ctx.t ?? 0) - Math.floor(ctx.t ?? 0), amp = ctx.amp ?? 1, tone = MOTOR.tone;
  let push, rec;
  if (t < 0.25) { push = tone; rec = 0.5; }                                             // swing: the diamond fold (guess)
  else if (t < (ctx.mode === 'climb' ? 0.45 : 0.40)) { push = 0.2; rec = 0.2; }         // placing the pad (guess)
  else if (ctx.mode === 'climb' && t < 0.60) { push = 1; rec = tone; }                  // the stretch (guess)
  else { push = 0.35; rec = tone; }                                                      // stance, holding the load (guess)
  const a = def.id === 'IFB' ? 0.5 * (push + rec) : def.drive === 'push' ? push : rec;
  return tone + amp * (a - tone);
}
export const MOTOR = { tone: 0.05, src: 'none yet', tag: 'guess' };
export function excitation(def, ctx) {
  const push = def.drive === 'push', t = ctx.t ?? 0, tone = MOTOR.tone;
  switch (ctx.mode) {
    case 'hop': case 'leap':
      if (t < HOP.push) return push ? 1 : tone;
      if (t < HOP.fold) return push ? tone : 0.5;
      return push ? 0.5 : 0.2;
    case 'swim':
      if (t < 0.16) return push ? 1 : tone;              // the thrust (util/gait.js STROKE.thrust)
      if (t < 0.6) return tone;                          // the glide
      return push ? tone : 0.5;                          // drawing the legs up
    case 'walk': return 0.2;
    case 'step': case 'climb': case 'turn': return moveExcitation(def, ctx);
    default: return tone;
  }
}

// The joints a muscle crosses, from the bones its path runs over (hip: pelvis to thigh; knee: thigh to shin; ankle: shin to the tarsus).
export function crossedJoints(m, skel) {
  const names = m.pts.map((q) => skel.bones[q.bone].name.replace(/[LR]$/, ''));
  const order = ['pelvis', 'thigh', 'shin', 'foot', 'toes'];
  const lo = Math.min(...names.map((n) => order.indexOf(n))), hi = Math.max(...names.map((n) => order.indexOf(n)));
  const J = [];
  if (lo <= 0 && hi >= 1) J.push('hip');
  if (lo <= 1 && hi >= 2) J.push('knee');
  if (lo <= 2 && hi >= 3) J.push('ankle');
  if (lo <= 3 && hi >= 4) J.push('tarsus');
  return J;
}
