// View layers: how much of the tank you see.
//
//   surface  what the eye sees: nothing shows through rock, ground or plants, and no hose or pipe (they run behind the background
//            and through the cabinet, render/plumbing.js); devices in the tank (pump, filters, outlets, the tower) stay
//   xray     the same, plus the build hidden under it (hoses buried in the substrate and run behind rocks, the pump, the
//            filter, the false bottom's tower) drawn glowing through whatever covers it (render/plumbing.js `ghost`), and the
//            water below the ground as a body at its simulated level (render/soilside.js `body`, sim/plenum.js belowGround)
//   bottom   only the build: substrate, background, water and equipment; plants, animals, hardscape, litter and mist go
//
// 'bottom' uses three.js render layers: the camera (and the lamp's shadow camera, or hidden plants would still cast
// shadows) sees only layer BOTTOM, and an object is on it when it is outside the tank (glass, room, lights) or it or a
// parent carries `userData.bottom` (set by the water, the plumbing, the soil profile, the lens and here on the ground and
// background). The ground is drawn without the hardscape stamped into it (sim/terrain.js setBare), or stone spires would
// stay standing as columns of substrate. Anything added later (a new plant, an animal) is on layer 0 only, so it stays hidden without being told.
// The tags are re-applied every half second while 'bottom' is on, for waterfalls and markers that come and go.

export const BOTTOM = 1;

export const VIEW_LAYERS = {
  surface: { name: 'Surface', blurb: 'What the eye sees: rocks, ground and plants hide what is behind them, and hoses and pipes stay out of sight.' },
  xray: { name: 'X-ray', blurb: 'The tank as it is, with the hoses and pipes and the hidden build glowing through: hoses under the substrate and behind rocks, the pump, the filter and the water under the ground.' },
  bottom: { name: 'Bottom layer', blurb: 'Only the build: substrate, background, water and equipment. Plants, animals and hardscape are left out.' },
};
export const LAYER_ORDER = ['surface', 'xray', 'bottom'];
export const nextLayer = (m) => LAYER_ORDER[(LAYER_ORDER.indexOf(m) + 1) % LAYER_ORDER.length];

export class ViewLayers {
  constructor(game) {
    this.game = game;
    this.mode = 'surface';
    this.t = 0;
  }

  set(mode) {
    if (!VIEW_LAYERS[mode]) mode = 'surface';
    this.mode = mode;
    this.apply();
  }

  // Called for every new tank, and from update while 'bottom' is on.
  apply() {
    const g = this.game, W = g.world, bottom = this.mode === 'bottom';
    if (W?.plumbing) W.plumbing.layer = this.mode;
    if (W?.soilSide) W.soilSide.layer = this.mode;   // its X-ray body shows in 'xray' and 'bottom'
    W?.terrain.setBare(bottom);   // the ground drawn without the rocks stamped into it
    if (bottom) this.tag();
    const mask = bottom ? 1 << BOTTOM : 1;
    g.camera.layers.mask = mask;
    const L = g.stage?.lights;
    for (const l of [L?.led, L?.moon]) if (l?.shadow) l.shadow.camera.layers.mask = mask;
    this.t = 0.5;
  }

  tag() {
    const root = this.game.worldRoot, W = this.game.world;
    if (W) {
      const Wt = W.water;
      const mine = [W.terrain.mesh, W.wall.mesh, Wt.surface, Wt.volume, Wt.flowMesh, Wt.drops, Wt.pumpMesh, Wt.preview, ...Wt.outletMeshes, ...Wt.pitMarks,
        W.plumbing?.group, W.soilSide?.mesh, W.soilSide?.body, W.lens?.group];
      for (const r of Wt.ribbons.values()) mine.push(r.mesh, r.splash);
      for (const o of mine) if (o) o.userData.bottom = true;
    }
    const walk = (o, on) => {
      on = on || o.userData.bottom === true;
      if (on) o.layers.enable(BOTTOM); else o.layers.disable(BOTTOM);
      for (const c of o.children) walk(c, on);
    };
    for (const c of this.game.scene.children) walk(c, c !== root);
  }

  update(dt) {
    if (this.mode !== 'bottom') return;
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.5; this.tag(); }
  }
}
