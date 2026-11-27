// Sky Courier — every tuning number and colour in one place.
// The playfield is a fixed 1280x800 logical area; the renderer scales it to the window,
// so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 800 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Metres, knots and feet: 1 knot = 0.514444 m/s, 1 ft = 0.3048 m. */
export const KT = 0.514444;
export const FT = 0.3048;

/** The island: a square heightmap, CELL metres a cell, centred on the home runway. */
export const WORLD = {
  cells: 128,
  cell: 50,
  seaLevel: 0,
  maxHeight: 380,
};

export const PLANE = {
  /** m/s at full throttle, level flight. */
  maxSpeed: 72,
  /** Below this speed the wing stops flying: the nose drops and the stall horn sounds. */
  stallSpeed: 27,
  /** m/s^2 of acceleration toward the throttle's target speed. */
  accel: 9,
  /** deg/s of pitch the elevator gives, and the pitch limits. */
  pitchRate: 26,
  pitchUp: 28,
  pitchDown: -22,
  /** deg/s of roll the ailerons give, and the bank limit. */
  rollRate: 70,
  rollMax: 55,
  /** Flaps add lift at low speed and drag at any speed. */
  flapLift: 6,
  flapDrag: 4,
  /** Landing gear: down is required for a runway landing. */
  gearDrag: 2,
  /** Fuel: 100 units, burned by the throttle; a full tank lasts about 14 minutes at cruise. */
  fuelMax: 100,
  burnIdle: 0.045,
  burnFull: 0.16,
  /** Touchdown limits for a landing to count instead of a crash. */
  landSpeedMax: 46,
  landSinkMax: 5.5,
};

/** A ring is a glowing hoop to fly through; its radius in metres. */
export const RING = { radius: 26, points: 100 };

export const MISSIONS = [
  {
    id: 'rings',
    key: '1',
    name: 'Ring Run',
    blurb: 'Fly all 8 rings in order. 300 seconds on the clock.',
    timeLimit: 300,
    rings: 8,
  },
  {
    id: 'hop',
    key: '2',
    name: 'Island Hop',
    blurb: 'Take off, cross the island and land on the far runway. Then fly home.',
    timeLimit: 0,
    rings: 0,
  },
  {
    id: 'free',
    key: '3',
    name: 'Free Flight',
    blurb: 'No clock, no course. Rings pay 100, fuel is your only enemy.',
    timeLimit: 0,
    rings: 0,
  },
];

export const SCORE = { ring: 100, landing: 500, hopLeg: 500, timeBonusPerSecond: 5 };

export const PALETTE = {
  backdrop: '#0b1020',
  skyTop: '#274b8f',
  skyMid: '#7fb2e0',
  skyLow: '#cfe8f5',
  haze: '#d8e9f2',
  sun: '#fff3c4',
  sunGlow: 'rgba(255, 236, 170, 0.55)',
  seaDeep: '#155e8c',
  sea: '#2a7ab0',
  seaShallow: '#4fa3c8',
  sand: '#d9c48a',
  grass: '#5d8a3c',
  grassDry: '#7a9a45',
  forest: '#3d6b2f',
  rock: '#8a7f74',
  snow: '#f2f5f7',
  asphalt: '#33373d',
  asphaltLine: '#e8e8e8',
  panel: '#1c212b',
  panelEdge: '#3a4152',
  gaugeFace: '#10141d',
  gaugeLit: '#ffd27a',
  gaugeNeedle: '#ff5a4e',
  text: '#eef1f5',
  muted: '#9aa5b5',
  good: '#7ee081',
  warn: '#ffb02e',
  danger: '#ff5a4e',
  ring: '#ffb02e',
  ringNext: '#ffd76a',
  ringDone: '#7ee081',
  planeBody: '#e8e4da',
  planeTrim: '#c8372d',
  planeGlass: '#9fd4e8',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'sky-courier.best';
