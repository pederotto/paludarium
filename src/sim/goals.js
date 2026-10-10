// The goal contract every animal keeps (R8). Pure: no imports, no game state.
//
// animal.abortGoal(reason, cooldownMs) is installed on every animal (Animals.add). It drops the engine's walk target and, through the
// animal's mind (a.mind, registered when the mind is made: Animals.adopt), whatever the mind had chosen: each mind implements its own
// abort(reason) and knows its own fields, so the engine never reaches into a mind. With a cooldown, the spot where it failed is banned:
// no goal within BAN_R of it is valid (Animals.isValidGoal) until the cooldown has run out on CLOCK, the animals' clock.
export const BAN_R = 3;                       // cm
export const CLOCK = { t: 0 };                // s, set by Animals.move

export function abortGoal(reason, cooldownMs = 0) {
  this.target = null;
  this.mind?.abort(reason);
  if (cooldownMs > 0) { this.banX = this.pos.x; this.banZ = this.pos.z; this.banT = CLOCK.t + cooldownMs / 1000; }
  this.abortWhy = reason; this.abortT = CLOCK.t;
}

// Is (x, z) inside this animal's banned spot?
export function banned(a, x, z) {
  return a.banT > CLOCK.t && Math.hypot(x - a.banX, z - a.banZ) < BAN_R;
}

// For a mind's own pickers: a goal it made up is committed only when the animal's validator (sense.valid) accepts it.
export const validGoal = (s, x, z) => !s.valid || s.valid(x, z);
