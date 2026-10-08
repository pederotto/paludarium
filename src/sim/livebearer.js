// Livebearers (the guppy): sexes, pregnancy, broods of live fry, stored sperm, and which look each fish is drawn with.
// Pure sim logic, no three.js; sim/animals.js calls `initLivebearer` when a fish appears and sim/sim.js calls `livebearerStep`
// every step. The species opts in with `livebearer: { gestDays, brood: [min, max], store, growFrom, maleK }` (sim/animals.js).
//
// Real guppies (docs/GENETICS_SPEC.md "guppy", sources there): a female carries a brood for about 4 weeks and drops 5-30 fry
// (fewer in a small, young or underfed female); she keeps a male's sperm for months and has several broods from one mating, so a
// breeder who wants a known father uses a VIRGIN female; a dealer sells "trios" (one male, two females); fry are born about 7 mm
// long, grey and see-through, and the males colour up as they mature. The game shortens the times with the rest of its clock
// (adultDays) and caps the brood with the room the tank has.
//
// State on the animal (saved): female (true/false), sizeK (its own size), gv (gravid: { t minutes left, sire }), st (stored
// sperm: { id, genes, gen, n broods left }), mated (she has met a male: no longer a virgin), sk0 (its own size factor). sire / st carry the father's genes, so a brood can be born after he has died.
import { guppyLook } from '../content/guppy.js';
import { morphOf, isMaleGenes, sexGenes, lociOf, sexedSpecies } from './genetics.js';

// A new fish: its sex and its size. Founders come as the dealer sells them (trios: a male to every two females); fry are 50:50.
// The sex of a new fish when its genes do not say it yet: fry are born half and half; founders come as trios.
export function livebearerFemale(opt, peers) {
  if (opt.female !== undefined) return !!opt.female;
  if (opt.age === 0) return Math.random() < 0.5;
  const males = peers.filter((b) => b.female === false).length, females = peers.filter((b) => b.female).length;
  return males * 2 > females;
}
export function initLivebearer(a, sp, opt, peers) {
  // a species with sex chromosomes is the sex its genes say (XX, XY); otherwise as livebearerFemale decides
  if (a.genes && sexedSpecies(a.sp) && a.genes.length === lociOf(a.sp).length) a.female = !isMaleGenes(a.sp, a.genes);
  else if (a.female === undefined) a.female = livebearerFemale(opt, peers.filter((b) => b !== a));
  a.sk0 ??= 0.9 + Math.random() * 0.2;                 // its own size, ±10 %
  refresh(a, sp);
}
const adultOf = (a, sp) => a.age >= (sp.adultDays ?? 10) * 1440;

// The look it is drawn with (content/guppy.js guppyLook) and its size factor: a young male grows toward the male body's size.
function refresh(a, sp) {
  const adult = adultOf(a, sp), L = sp.livebearer;
  // (a save from before the sex chromosomes or the later genes: made whole for the fish's sex)
  if (a.genes && sexedSpecies(a.sp) && (a.genes.length < lociOf(a.sp).length || isMaleGenes(a.sp, a.genes) === a.female)) a.genes = sexGenes(a.sp, a.genes, a.female);
  if (a.genes) a.morph = morphOf(a.sp, a.genes);
  a.look = guppyLook(a.morph, { female: a.female, adult, gravid: !!a.gv && adult });
  a.sizeK = a.sk0 * (!adult && !a.female ? (L?.maleK ?? 1) : 1);
}

// One sim step of `dMin` minutes for one fish. `fit`: fed and healthy enough to breed now; `room`: the share of the breeding room
// still free (sim.js). Pushes births ({ sp, pos, pa, pb, brood: true }: pb is the sire, possibly long dead) and returns a line for
// the journal or null.
export function livebearerStep(W, a, sp, dMin, fit, room, births) {
  const L = sp.livebearer, wasAdult = a.look && !a.look.startsWith('juv');
  let line = null;
  if (a.gv) {
    a.gv.t -= dMin;
    if (a.gv.t <= 0) {
      const [lo, hi] = L.brood, big = Math.max(0.3, Math.min(1, room * 1.5));
      const n = Math.max(1, Math.round((lo + Math.random() * (hi - lo)) * big * (a.hunger < 0.5 ? 1 : 0.6)));
      for (let k = 0; k < n; k++) births.push({ sp: a.sp, pos: a.pos.clone(), pa: a, pb: a.gv.sire, brood: true });
      line = `A ${sp.name.toLowerCase()} gave birth to ${n} fry.`;
      a.gv = null;
    }
  } else if (a.female && fit && room > 0 && adultOf(a, sp) && Math.random() < sp.breed * (dMin / 1440) * room) {
    // Conceive: with a male of the tank (her chosen mate if she has one), or from sperm she has stored.
    const mate = W.animals.mateOf?.(a);
    const fertile = (b) => b.female === false && adultOf(b, sp) && !b.dead && (L.fertile?.(b.genes) ?? true);
    const males = mate ? (fertile(mate) ? [mate] : []) : (W.animals.by[a.sp] ?? []).filter(fertile);
    const m = males.length ? males[Math.floor(Math.random() * males.length)] : null;
    let sire = null;
    if (m) { sire = { id: m.id, genes: [...m.genes], gen: m.gen ?? 0 }; a.st = { ...sire, n: L.store ?? 3 }; a.mated = true; }
    else if (a.st?.n > 0) { sire = { id: a.st.id, genes: a.st.genes, gen: a.st.gen }; a.st.n--; }
    if (sire) a.gv = { t: (L.gestDays ?? 3) * 1440 * (0.85 + Math.random() * 0.3), sire };
  }
  const before = a.look;
  refresh(a, sp);
  // A young male shows his colours: say so when the strain is worth a look.
  if (!wasAdult && a.look !== before && a.female === false && !a.look.startsWith('juv') && a.gen) line ??= `matured:${a.morph}`;
  return line;
}

// Words for the info card: "female, gravid (a brood of a #12 father due in 2 days)".
export function livebearerText(a, sp) {
  if (a.female === undefined) return null;
  if (!adultOf(a, sp)) return `young ${a.female ? 'female' : 'male'} (colours up when grown)`;
  if (!a.female) return 'male';
  if (a.gv) return `female, gravid (fry due in ${Math.max(1, Math.round(a.gv.t / 1440))} day${a.gv.t > 1440 * 1.5 ? 's' : ''})`;
  if (a.st?.n > 0) return `female, carries sperm of male #${a.st.id} for ${a.st.n} more brood${a.st.n > 1 ? 's' : ''}`;
  return a.mated ? 'female (her stored sperm is used up)' : 'female, virgin (her first brood will have a known father)';
}
