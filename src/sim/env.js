// The tank's settings and its tank-wide state: the clock, temperature,
// humidity, water chemistry, and what the equipment is doing. Local
// variation around these averages lives in climate.js.

import { clamp } from '../util/math.js';
import { TANK } from './tank.js';

export class Env {
  constructor() {
    this.reset();
  }

  reset() {
    this.minute = 9 * 60;       // game clock, minutes since day 0 00:00
    this.temp = 23;             // °C (air and water, kept as one for simplicity)
    this.humidity = 70;         // %RH
    this.ammonia = 0.0;         // ppm
    this.nitrite = 0.0;
    this.nitrate = 5;
    this.oxygen = 7.5;          // mg/L
    this.cycle = 0.15;          // nitrifying bacteria, 0 (new tank) … 1 (mature)
    this.detritus = 3;          // grams of decaying matter
    this.biofilm = 0.4;         // 0 … 1, algae/biofilm on surfaces
    this.film = 0;              // 0 … 1, protein skin on the water's surface (sim.js)
    this.mist = 0;              // recent misting, decays
    this.lightAvg = 0.5;        // 24 h average light
    // Settings.
    this.lights = 'auto';       // auto | on | off
    this.lightsOn = 8 * 60;
    this.lightsOff = 20 * 60;
    this.heater = true;
    this.setpoint = 24;
    this.room = 21;
    this.roomHumidity = 50;
    this.lid = true;
    this.filter = true;
    this.autoFeed = true;
    this.lastFed = -1;
    this.culture = true;   // a fruit fly culture that releases flies every other day
    this.lastCulture = -2;
    this.algae = 0.05;          // 0 … 1, green water and film
    this.diatoms = 0;           // 0 … 1, brown film of a new tank
    this.rockMoss = 0.9;        // moss grown over the hardscape
    this.tankDays = 60;         // days since the tank was set up
    // Equipment (see content/equipment.js). Everything defaults to off; owning
    // and placing the gear is handled by world.equipment.
    this.lampPower = 1;         // LED brightness, 0.2 … 1.4
    this.lampWarmth = 0.35;     // 0 cool white … 1 warm white
    this.moonlight = true;
    this.fan = 0;               // 0 … 1 airflow
    this.fogger = 0;            // 0 … 1
    this.basking = 0;           // 0 … 1, basking lamp power
    this.chill = 0;             // 1 while the cooling unit is on
    this.coolSet = 20;          // °C the cooling unit holds
    this.rain = 0;              // 0 … 1, rain falling right now
    this.rainUntil = -1;        // minute the current shower ends
    this.rainProgram = [];      // [{ at, len }]: minute of day and minutes long
    this.drainage = 0;          // 0 none · 0.6 drainage layer · 1 false bottom
    this.plenumH = 0;           // the false bottom's mesh over the glass floor, cm (0: set to just over the water when first fitted)
    this.plenumLevel = undefined; // its water over the glass floor, cm (sim/plenum.js; undefined without a false bottom)
    this.plenumSoak = 0;        // litres of rain and mist on their way down through the soil into it
    this.substrate = 'soil';    // content/equipment.js SUBSTRATES
    this.backdrop = 'natural';  // the background's finish: 'natural' (painted relief) or 'foam' (black expanding foam with coir)
    this.drainEff = null;       // drainage as it works right now (0 when the false bottom is flooded); set by the sim
    this.mediaBio = 0.4;        // filter biomedia, 0 … 1: more surface, more bacteria
    this.filterKind = 'sponge'; // sponge | matten | canister (content/equipment.js FILTERS)
    this.prefilter = false;     // a sponge over the canister intake (shrimp- and fry-safe)
    this.filterDirt = 0;        // dirt the filter has caught (detritus units): it clogs it until rinsed (sim.js)
    this.filterLph = 0;         // water its pump is moving now (L/h)
    this.waterSource = 'tap';   // content/equipment.js WATER_SOURCES: what the tank is filled and changed with
    this.ph = 7.4; this.gh = 9; // volume-weighted means of the water bodies (sim/waterbodies.js)
    this.flow = 0.1;            // current in the main pool, 0 still … 1 strong
    this.uvb = 0;               // 0 … 1, the UVB tube (1 = UV index about 4 under it)
    this.soil = 0.5;            // mean soil moisture 0 … 1 (from the climate map)
    this.mold = 0;              // 0 … 1
    this.condense = 0;          // 0 … 1, dew on the glass
    this.wipe = 0;              // 0 … 1, glass recently wiped
    this.season = 'wet';        // 'wet' | 'dry' (biotopes with a dry season)
    this.log = [];              // recent climate readings for the lab chart
  }

  // A tank that has just been set up: raw water, no bacteria, nothing grown.
  newTank() {
    this.reset();
    Object.assign(this, { cycle: 0, biofilm: 0, algae: 0, diatoms: 0, rockMoss: 0, tankDays: 0, nitrate: 0, detritus: 1.5, humidity: 60 });
  }

  // The starter tank has been running for a couple of months.
  matureTank() {
    Object.assign(this, { cycle: 0.9, nitrate: 8, humidity: 85, biofilm: 0.4, algae: 0.05, diatoms: 0, rockMoss: 0.9, tankDays: 60, drainage: 0.6, mediaBio: 0.55, setpoint: 23, soil: 0.7 });
  }

  static KEYS = ['minute', 'temp', 'humidity', 'ammonia', 'nitrite', 'nitrate', 'oxygen', 'cycle', 'detritus', 'biofilm', 'lights', 'heater',
    'setpoint', 'lid', 'filter', 'room', 'roomHumidity', 'autoFeed', 'lastFed', 'culture', 'lastCulture', 'algae', 'diatoms', 'rockMoss', 'tankDays',
    'lampPower', 'lampWarmth', 'moonlight', 'fan', 'fogger', 'basking', 'rainProgram', 'drainage', 'mediaBio', 'soil', 'mold', 'season',
    'lightsOn', 'lightsOff', 'chill', 'coolSet', 'filterKind', 'prefilter', 'filterDirt', 'waterSource', 'ph', 'gh', 'uvb', 'film', 'plenumH', 'substrate', 'backdrop',
    'plenumLevel', 'plenumSoak'];

  serialize() { return Object.fromEntries(Env.KEYS.map((k) => [k, this[k]])); }
  load(o = {}) {
    this.reset();
    for (const k of Env.KEYS) if (o[k] !== undefined) this[k] = o[k];
    if (o.filterKind === undefined && (o.mediaBio ?? 0) > 0.6) this.filterKind = 'canister';   // saves from before filter kinds: more media than a sponge holds meant a canister
  }

  get day() { return Math.floor(this.minute / 1440); }
  get clock() {
    const m = this.minute % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  }

  // Light schedule level 0 … 1 with a dawn and dusk ramp (30 minutes).
  light() {
    if (this.lights === 'on') return 1;
    if (this.lights === 'off') return 0.03;
    const m = this.minute % 1440;
    const up = clamp((m - this.lightsOn) / 30, 0, 1);
    const down = clamp((this.lightsOff - m) / 30, 0, 1);
    return Math.max(0.03, Math.min(up, down));
  }

  // What the plants get: the schedule times the lamp's brightness.
  bright() { return this.light() * this.lampPower; }

  // Hours of light per day (for teaching: the photoperiod).
  get photoperiod() { return this.lights === 'on' ? 24 : this.lights === 'off' ? 0 : ((this.lightsOff - this.lightsOn) / 60 + 24) % 24; }

  // Dew point in °C for air at temp t and relative humidity rh (Magnus formula).
  static dewPoint(t, rh) {
    const a = 17.62, b = 243.12;
    const g = Math.log(Math.max(1, rh) / 100) + (a * t) / (b + t);
    return (b * g) / (a - g);
  }

  // How much the glass fogs up: the glass sits close to room temperature, so
  // whenever the air's dew point is above it, water condenses. A sealed jar
  // at 95% humidity in a 21 °C room fogs badly; a ventilated tank barely does.
  updateGlass(dtMin) {
    const glassT = this.room + (this.temp - this.room) * 0.22;
    const rh = this.humidity + (this.lid || TANK.closed ? 4 : -6);
    const dew = Env.dewPoint(this.temp, clamp(rh, 10, 100));
    const raw = clamp((dew - glassT) / 4.2, 0, 1) * (this.lid || TANK.closed ? 1 : 0.45) * (1 - this.fan * 0.6);
    this.wipe = Math.max(0, this.wipe - dtMin / 40);
    const target = raw * (1 - this.wipe);
    this.condense += (target - this.condense) * clamp(dtMin / 25, 0, 1);
  }
}
