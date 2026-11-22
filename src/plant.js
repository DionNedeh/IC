// The model. This file is the editable source for every surface in the scene:
// a representative Westinghouse-style ice condenser containment, built as a
// layered cutaway (shield building > steel containment vessel > ice bed >
// crane wall) so the ice condenser reads from the hero angle.
//
// Units are metres. Angle 0 faces the default camera (+Z); positive angles
// turn towards +X. Dimensions are approximate and several thin parts (the
// steel shell, door panels, lattice straps) are thickened so they survive
// normal viewing distance. This is an illustration, not an engineering model.

import { Builder } from './geometry.js';
import { DEG, TAU, mul, chain, translate, rotY, rotX, rotZ, scale, polar, polarFrame, lerp } from './math.js';

const PI = Math.PI;

export const DIM = {
  bay: 12.5 * DEG,
  bayCount: 24,
  iceA0: -150 * DEG,
  cutIce: 25 * DEG, // crane wall + ice bed removed for |angle| < 25 deg (4 bays)
  cutVessel: 62.5 * DEG, // steel vessel removed for |angle| < 62.5 deg (3 more bays exposed each side)
  cutShield: 75 * DEG,
  rShieldIn: 19.2, rShieldOut: 20.1, yShieldSpring: 37,
  rVessel: 17.5, tVessel: 0.12, yVesselSpring: 35.5,
  rCraneIn: 12.0, rCraneOut: 12.8, yCraneTop: 34.5,
  yIceFloor: 10.5, yDoor0: 11.0, yDoor1: 13.9,
  yDeck0: 14.2, yDeck1: 15.0,
  yBasket0: 15.0, basketH: 14.6, basketR: 0.152,
  basketR0: 13.7, basketPitch: 0.381,
  yMidDeck: 30.2, yTopDeck: 34.42,
  doorHalf: 4.6 * DEG,
};

const D = DIM;
/**
 * Basket levels of detail, finest first: sides per basket, and whether the top
 * collar is modelled. BASKET_LOD_PIXELS[i] is the on-screen basket width, in
 * pixels, above which level i is used.
 */
export const BASKET_LODS = [{ seg: 14, rim: true }, { seg: 8, rim: false }, { seg: 5, rim: false }];
export const BASKET_LOD_PIXELS = [9, 3.5, 0];

/** Bays that are present in the model (bays 10-13 are removed by the front cut). */
export const BAYS = [];
for (let k = 0; k < D.bayCount; k++) if (k < 10 || k > 13) BAYS.push(k);
export const bayA0 = (k) => D.iceA0 + k * D.bay;
export const bayMid = (k) => bayA0(k) + D.bay / 2;
const isExposed = (k) => (k >= 7 && k <= 9) || (k >= 14 && k <= 16);

/** Physically-based material table. Colours are sRGB hex; `cut` is the section-face colour. */
export const MATERIALS = {
  ground: { base: '#3b3f45', rough: 0.62, type: 5, shadow: false },
  shield: { base: '#8f8b83', cut: '#d6d0c3', rough: 0.9, type: 2 },
  concrete: { base: '#86837d', cut: '#d6d0c3', rough: 0.88, type: 1 },
  vessel: { base: '#2c3a47', cut: '#9fb4c4', rough: 0.42, coat: 0.55, type: 6 },
  hatch: { base: '#2c3a47', rough: 0.42, coat: 0.55 },
  stainless: { base: '#c9cdd1', rough: 0.3, metal: 1 },
  pipe: { base: '#d3d6d8', rough: 0.22, metal: 1 },
  sg: { base: '#b9bfc5', rough: 0.4, metal: 1 },
  motor: { base: '#23282e', rough: 0.45, coat: 0.5 },
  tank: { base: '#c6cacd', rough: 0.4, coat: 0.6 },
  struct: { base: '#7d858c', rough: 0.52, metal: 0.85 },
  lattice: { base: '#99a2a9', rough: 0.48, metal: 0.9 },
  vane: { base: '#a9b3bb', rough: 0.55, metal: 0.25 },
  frame: { base: '#30363c', rough: 0.5, metal: 0.6 },
  panel: { base: '#c9d1d8', rough: 0.7, type: 7 },
  door: { base: '#dfe4e8', rough: 0.5, coat: 0.25 },
  deckDoor: { base: '#bcc6cf', rough: 0.72 },
  blanket: { base: '#a9b5bf', rough: 0.85 },
  basket: { base: '#cfe4f5', rough: 0.5, type: 3, emis: [0.012, 0.034, 0.06] },
  ahu: { base: '#9fabb5', rough: 0.42, metal: 0.7 },
  glycol: { base: '#17a398', rough: 0.35, coat: 0.6 },
  crane: { base: '#c79a1e', rough: 0.45, coat: 0.5 },
  dark: { base: '#15181b', rough: 0.75 },
  lagging: { base: '#c4c0b6', rough: 0.5, metal: 0.5 },
  person: { base: '#e56a1f', rough: 0.8 },
  helmet: { base: '#f2f2ee', rough: 0.4, coat: 0.4 },
  glow: { base: '#3a2a1a', rough: 0.5, emis: [1.5, 0.5, 0.1] },
  water: { base: '#2f6f9c', rough: 0.06, coat: 0.9, shadow: false },
};

/**
 * Identifiable parts, in id order. Every vertex carries the id of its part, so
 * a click can be resolved to one of these. Descriptions live in content.js.
 */
export const PARTS = [
  ['none', ''],
  ['basemat', 'Basemat'],
  ['shield', 'Shield building'],
  ['vessel', 'Steel containment vessel'],
  ['spray', 'Containment spray headers'],
  ['craneWall', 'Crane wall'],
  ['divider', 'Divider deck'],
  ['cavity', 'Reactor cavity wall'],
  ['iceFloor', 'Ice condenser floor'],
  ['reactor', 'Reactor vessel'],
  ['crdm', 'Control rod drives'],
  ['steamGen', 'Steam generator'],
  ['enclosure', 'Steam generator and pressurizer enclosures'],
  ['rcp', 'Reactor coolant pump'],
  ['rcsPipe', 'Reactor coolant piping'],
  ['pressurizer', 'Pressurizer'],
  ['accumulator', 'Cold-leg accumulator'],
  ['prt', 'Pressurizer relief tank'],
  ['airFan', 'Air return fan'],
  ['lowerSupport', 'Lower support structure'],
  ['latticeFrame', 'Lattice frames'],
  ['wallPanel', 'Insulated wall panels'],
  ['vane', 'Turning vanes'],
  ['ahu', 'Air handling unit'],
  ['glycol', 'Glycol headers'],
  ['drain', 'Floor drain'],
  ['basket', 'Ice baskets'],
  ['lowerDoor', 'Lower inlet doors'],
  ['midDeck', 'Intermediate deck doors'],
  ['topDeck', 'Top deck'],
  ['bridgeCrane', 'Ice condenser bridge crane'],
  ['polarCrane', 'Polar crane'],
  ['hatch', 'Equipment hatch'],
  ['airlock', 'Personnel airlock'],
  ['stack', 'Vent stack'],
  ['steamLine', 'Main steam line'],
  ['igniter', 'Hydrogen igniter'],
  ['sump', 'Containment sump'],
  ['refuel', 'Refuelling machine'],
  ['cableTray', 'Cable trays'],
  ['person', 'Scale figure'],
  ['rwst', 'Refuelling water storage tank'],
  ['chiller', 'Glycol chillers'],
  ['recombiner', 'Hydrogen recombiner'],
  ['meltwater', 'Meltwater'],
  ['valveRoom', 'Main steam valve room'],
];
export const PART_ID = Object.fromEntries(PARTS.map(([key], i) => [key, i]));

/** Named points used for callouts and camera targets. */
export const ANCHORS = {
  centre: [0, 26, 0],
  iceBed: polar(16.9, 43.75 * DEG, 22.5),
  lowerDoor: polar(12.95, 46 * DEG, 13.3),
  vane: polar(14.2, 43.75 * DEG, 11.75),
  lowerPlenum: polar(15.4, 34 * DEG, 12.6),
  latticeFrame: polar(17.0, 56 * DEG, 18.66),
  midDeck: polar(16.8, 43.75 * DEG, 30.3),
  ahu: polar(16.3, 31.25 * DEG, 32.9),
  glycol: polar(16.7, 52 * DEG, 34.0),
  topDeck: polar(16.9, 34 * DEG, 34.5),
  craneWall: polar(12.4, -25 * DEG, 24),
  vessel: polar(17.5, 68 * DEG, 27),
  shield: polar(20.1, 84 * DEG, 20),
  reactor: [0, 11.5, 2.2],
  steamGen: polar(7.5, 135 * DEG, 25),
  upper: [0, 30, 6],
  lower: polar(9.5, 8 * DEG, 6),
  deck: polar(8, -25 * DEG, 15),
  accumulator: polar(15.6, 38 * DEG, 8.3),
  crane: [4, 36.6, 1.7],
  rcp: polar(8.6, 80 * DEG, 11.2),
  pressurizer: polar(8.8, 180 * DEG, 18.5),
  hotLeg: polar(4.6, 36 * DEG, 6.6),
  crdm: [0, 13.9, 0.6],
  sgEnclosure: polar(7.5, -45 * DEG, 26.6),
  dome: [0, 42, 0],
  spray: polar(13.8, 180 * DEG, 46.2),
  igniter: polar(11.9, -40 * DEG, 28),
  sump: polar(9.6, 13 * DEG, 0.9),
  airFan: polar(10.3, 163 * DEG, 17.2),
  bridgeCrane: polar(15.2, 43.75 * DEG, 31.5),
  refuel: [-3.4, 17.7, -0.5],
  person: polar(24.3, 84 * DEG, 0.25),
  rwst: polar(29.5, 100 * DEG, 5.5),
  chiller: polar(29, 120 * DEG, 1.4),
  recombiner: polar(9.9, -90 * DEG, 17.3),
  glycolRiser: polar(20.75, 119 * DEG, 22),
  valveRoom: polar(24.2, 137.5 * DEG, 11.2),
  hatchPlatform: polar(25.5, 176 * DEG, 16.2),
};

export function createPlant() {
  const builders = new Map();
  const ctx = { pid: 0 }; // shared by every builder: the part being modelled right now
  const part = (key) => {
    if (!(key in PART_ID)) throw new Error(`Unknown part "${key}"`);
    ctx.pid = PART_ID[key];
  };
  const g = (mat) => {
    if (!builders.has(mat)) builders.set(mat, new Builder(ctx));
    return builders.get(mat);
  };
  const instanced = [];
  const CI = D.cutIce, CV = D.cutVessel, CS = D.cutShield;

  // ---- 1. Site, basemat and shield building ---------------------------------
  function site() {
    part('none');
    g('ground').lathe([[0, -1.5], [170, -1.5]], 0, TAU, { closed: false, step: 6 * DEG });
    part('basemat');
    g('concrete').lathe([[0, -1.5], [22.6, -1.5], [22.6, -0.35], [22.25, 0], [0, 0]], 0, TAU, { step: 3 * DEG });

    part('shield');
    const ys = D.yShieldSpring;
    const sp = [[D.rShieldOut, 0], [D.rShieldOut, ys]];
    for (let t = 3; t <= 90; t += 3) sp.push([D.rShieldOut * Math.cos(t * DEG), ys + 18.3 * Math.sin(t * DEG)]);
    for (let t = 90; t >= 3; t -= 3) sp.push([D.rShieldIn * Math.cos(t * DEG), ys + 17.5 * Math.sin(t * DEG)]);
    sp.push([D.rShieldIn, ys], [D.rShieldIn, 0]);
    g('shield').lathe(sp, CS, TAU - CS, { cut0: true, cut1: true });
    // Ring beam at the spring line and a thickened base course.
    g('shield').annularSector(D.rShieldOut, D.rShieldOut + 0.32, ys - 1.0, ys - 0.1, CS, TAU - CS, { cut0: true, cut1: true });
    g('shield').annularSector(D.rShieldOut, D.rShieldOut + 0.4, 0, 1.3, CS, TAU - CS, { cut0: true, cut1: true });
    // Access ladder up the wall to the spring line, and an air terminal on the dome.
    g('struct').at(polarFrame(D.rShieldOut + 0.55, 98 * DEG, 0), (b) => {
      for (const x of [-0.25, 0.25]) b.box(x, 18.6, 0, 0.05, 36.0, 0.05);
      for (let y = 1.0; y < 36.4; y += 0.75) b.box(0, y, 0, 0.5, 0.03, 0.03);
      for (let y = 3; y < 36; y += 6) for (const x of [-0.25, 0.25]) b.box(x, y, -0.28, 0.04, 0.04, 0.56);
      b.box(0, 36.95, 0.05, 1.3, 0.08, 1.0);
      for (const x of [-0.62, 0.62]) for (const z of [-0.4, 0.5]) b.cyl([x, 36.99, z], [x, 38.0, z], 0.022, { seg: 6 });
      b.cyl([-0.62, 38.0, 0.5], [0.62, 38.0, 0.5], 0.022, { seg: 6 });
      for (const x of [-0.62, 0.62]) b.cyl([x, 38.0, -0.4], [x, 38.0, 0.5], 0.022, { seg: 6 });
    });
    g('struct').cyl([0, ys + 18.25, 0], [0, ys + 20.4, 0], 0.045, { seg: 6 });
  }

  // ---- 2. Free-standing steel containment vessel ----------------------------
  function vessel() {
    part('vessel');
    const R = D.rVessel, Ri = R - D.tVessel, ys = D.yVesselSpring;
    const vp = [[R, 0], [R, ys]];
    for (let t = 3; t <= 90; t += 3) vp.push([R * Math.cos(t * DEG), ys + R * Math.sin(t * DEG)]);
    for (let t = 90; t >= 3; t -= 3) vp.push([Ri * Math.cos(t * DEG), ys + Ri * Math.sin(t * DEG)]);
    vp.push([Ri, ys], [Ri, 0]);
    g('vessel').lathe(vp, CV, TAU - CV, { cut0: true, cut1: true });
    // External ring stiffeners.
    for (const y of [5.5, 11, 16.5, 22, 27.5, 33]) {
      g('vessel').annularSector(R, R + 0.22, y, y + 0.14, CV, TAU - CV, { cut0: true, cut1: true });
    }
    // Vertical stiffeners between the rings on the visible strip.
    for (let a = -180; a < 180; a += 7.5) {
      const ar = a * DEG;
      if (Math.abs(ar) < CV + 0.02) continue;
      g('vessel').at(polarFrame(R + 0.07, ar, 0), (b) => b.box(0, 17.75, 0, 0.05, 35.5, 0.14));
    }
    // Containment spray ring headers under the dome.
    part('spray');
    for (const ph of [30, 48, 66]) {
      const rr = (Ri - 0.45) * Math.cos(ph * DEG), yy = ys + (Ri - 0.45) * Math.sin(ph * DEG);
      g('pipe').torusArc(rr, 0.09, yy, CV + 2 * DEG, TAU - CV - 2 * DEG, { seg: 8 });
      for (let a = 70; a <= 290; a += 10) {
        const p = polar(rr, a * DEG, yy);
        g('struct').cyl(p, polar(rr + 0.42 * Math.cos(ph * DEG), a * DEG, yy + 0.42 * Math.sin(ph * DEG)), 0.025, { seg: 6 });
      }
    }
  }

  // ---- 3. Interior concrete: crane wall, divider deck, cavity ----------------
  function concrete() {
    const c = g('concrete');
    const cuts = { cut0: true, cut1: true };
    part('craneWall');
    c.annularSector(D.rCraneIn, D.rCraneOut, 0, D.yDoor0, CI, TAU - CI, cuts);
    c.annularSector(D.rCraneIn, D.rCraneOut, D.yDoor1, D.yCraneTop, CI, TAU - CI, cuts);
    // Band containing the lower inlet door openings: one pier between each pair of doors.
    for (const k of BAYS) {
      const a0 = bayA0(k), a1 = a0 + D.bay, mid = bayMid(k);
      c.annularSector(D.rCraneIn, D.rCraneOut, D.yDoor0, D.yDoor1, a0, mid - D.doorHalf, { cut0: k === 14 });
      c.annularSector(D.rCraneIn, D.rCraneOut, D.yDoor0, D.yDoor1, mid + D.doorHalf, a1, { cut1: k === 9 });
    }
    c.annularSector(D.rCraneIn, D.rCraneOut, D.yDoor0, D.yDoor1, 150 * DEG, 210 * DEG);

    // Divider (operating) deck and the refuelling cavity / primary shield wall.
    part('divider');
    c.annularSector(4.3, D.rCraneIn, D.yDeck0, D.yDeck1, CI, TAU - CI, cuts);
    // Handrail round the cavity opening.
    for (let a = 44; a <= 316; a += 8) g('struct').cyl(polar(4.55, a * DEG, D.yDeck1), polar(4.55, a * DEG, D.yDeck1 + 1.05), 0.025, { seg: 6 });
    for (const y of [0.55, 1.05]) g('struct').torusArc(4.55, 0.022, D.yDeck1 + y, 42 * DEG, 318 * DEG, { seg: 6, step: 4 * DEG });
    part('cavity');
    c.annularSector(3.4, 4.3, 0, D.yDeck1, 40 * DEG, 320 * DEG, cuts);
    part('cableTray');
    for (const y of [20.0, 22.4]) {
      g('struct').annularSector(11.72, 12.0, y, y + 0.08, CI + 1 * DEG, TAU - CI - 1 * DEG);
      g('struct').annularSector(11.72, 11.75, y + 0.08, y + 0.22, CI + 1 * DEG, TAU - CI - 1 * DEG);
    }
    part('iceFloor');

    // Ice condenser floor slab, end walls and the support walls beneath it.
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 9.9, D.yIceFloor, -150 * DEG, -CI, { cut1: true });
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 9.9, D.yIceFloor, CI, 150 * DEG, { cut0: true });
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, D.yCraneTop, 150 * DEG, 151.3 * DEG);
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, D.yCraneTop, -151.3 * DEG, -150 * DEG);
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, 9.9, CI, CI + 1.4 * DEG, { cut0: true });
    c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, 9.9, -CI - 1.4 * DEG, -CI, { cut1: true });
    for (const a of [75, 112.5]) {
      c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, 9.9, a * DEG, (a + 1.4) * DEG);
      c.annularSector(D.rCraneOut, D.rVessel - D.tVessel, 0, 9.9, -(a + 1.4) * DEG, -a * DEG);
    }
  }

  // ---- 4. Reactor coolant system --------------------------------------------
  const LOOPS = [
    { sg: 45, rcp: 80, hot: 36, cold: 66 },
    { sg: -45, rcp: -80, hot: -36, cold: -66 },
    { sg: 135, rcp: 100, hot: 144, cold: 114 },
    { sg: -135, rcp: -100, hot: -144, cold: -114 },
  ];
  const Y_NOZ = 6.4;

  function reactor() {
    part('reactor');
    const rv = [[0, 1.5]];
    for (let t = -84; t <= 0; t += 6) rv.push([2.2 * Math.cos(t * DEG), 3.7 + 2.2 * Math.sin(t * DEG)]);
    rv.push([2.2, 10.1], [2.62, 10.2], [2.62, 10.95], [2.25, 11.0]);
    for (let t = 6; t <= 84; t += 6) rv.push([2.25 * Math.cos(t * DEG), 11.0 + 1.5 * Math.sin(t * DEG)]);
    rv.push([0, 12.5]);
    g('stainless').lathe(rv, 0, TAU, { step: 5 * DEG });
    // Closure studs around the flange.
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      g('frame').cyl(polar(2.43, a, 10.95), polar(2.43, a, 11.28), 0.07, { seg: 8 });
    }
    // Control rod drive housings on the closure head.
    part('crdm');
    const crd = [[0, 1]];
    for (const [rad, cnt] of [[0.55, 6], [1.1, 12], [1.62, 16]]) crd.push([rad, cnt]);
    for (const [rad, cnt] of crd) {
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * TAU + rad;
        const y0 = 11.0 + 1.5 * Math.sqrt(Math.max(0, 1 - (rad / 2.25) ** 2)) - 0.05;
        g('struct').cyl(polar(rad, a, y0), polar(rad, a, 14.0), 0.055, { seg: 8 });
        g('frame').cyl(polar(rad, a, 13.2), polar(rad, a, 13.75), 0.085, { seg: 8 });
      }
    }
    // Nozzle bosses.
    part('reactor');
    for (const L of LOOPS) {
      for (const a of [L.hot, L.cold]) {
        g('stainless').cyl(polar(2.05, a * DEG, Y_NOZ), polar(2.75, a * DEG, Y_NOZ), 0.66, { seg: 20, r1: 0.56 });
      }
    }
    // Vessel support ring on the cavity wall.
    g('frame').annularSector(2.62, 3.4, 9.6, 10.0, 40 * DEG, 320 * DEG);
  }

  function steamGenerator(aDeg) {
    part('steamGen');
    const base = translate(...polar(7.5, aDeg * DEG, 0));
    const p = [[0, 5.6]];
    for (let t = -84; t <= 0; t += 6) p.push([1.7 * Math.cos(t * DEG), 7.3 + 1.7 * Math.sin(t * DEG)]);
    p.push([1.8, 7.35], [1.8, 7.95], [1.7, 8.0], [1.7, 15.4], [2.2, 17.1], [2.2, 23.5]);
    for (let t = 6; t <= 78; t += 6) p.push([2.2 * Math.cos(t * DEG), 23.5 + 1.3 * Math.sin(t * DEG)]);
    p.push([0.42, 24.8], [0.42, 25.7], [0, 25.7]);
    g('sg').at(base, (b) => b.lathe(p, 0, TAU, { step: 6 * DEG }));
    g('frame').at(base, (b) => {
      b.annularSector(1.7, 1.92, 11.6, 11.85, 0, TAU, { step: 6 * DEG });
      b.annularSector(2.2, 2.4, 20.2, 20.45, 0, TAU, { step: 6 * DEG });
      for (const [x, z] of [[1.15, 1.15], [-1.15, 1.15], [1.15, -1.15], [-1.15, -1.15]]) {
        b.cyl([x, 0, z], [x, 6.6, z], 0.17, { seg: 10 });
      }
    });
    // Feedwater nozzle and manway.
    g('sg').at(base, (b) => {
      b.cyl([0, 18.6, 2.1], [0, 18.6, 2.75], 0.3, { seg: 14 });
      b.cyl([1.55, 9.4, 0], [1.95, 9.4, 0], 0.32, { seg: 14 });
    });
    // Concrete enclosure above the deck, opened towards the viewer.
    part('enclosure');
    g('concrete').at(base, (b) => {
      b.annularSector(2.75, 3.15, D.yDeck1, 26.5, 70 * DEG, 290 * DEG, { cut0: true, cut1: true, step: 5 * DEG });
      b.annularSector(0, 3.15, 26.5, 27.0, 70 * DEG, 290 * DEG, { cut0: true, cut1: true, step: 5 * DEG });
    });
  }

  function pump(aDeg) {
    part('rcp');
    const base = translate(...polar(8.6, aDeg * DEG, 0));
    g('stainless').at(base, (b) =>
      b.lathe([[0, 4.4], [0.7, 4.4], [1.1, 4.7], [1.3, 5.2], [1.3, 5.8], [1.1, 6.4], [0.78, 6.7], [0.78, 8.0], [0, 8.0]], 0, TAU, { step: 7.5 * DEG, smooth: 50 }));
    g('motor').at(base, (b) =>
      b.lathe([[0, 8.0], [1.12, 8.0], [1.12, 8.3], [0.95, 8.42], [0.95, 11.6], [1.06, 11.7], [1.06, 12.15], [0.6, 12.45], [0, 12.45]], 0, TAU, { step: 7.5 * DEG, smooth: 30 }));
    g('frame').at(base, (b) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5;
        b.cyl(polar(1.25, a, 0), polar(1.05, a, 5.0), 0.14, { seg: 10 });
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        b.box(0.97 * Math.sin(a), 10.0, 0.97 * Math.cos(a), 0.05, 2.9, 0.05); // motor cooling fins (approximate)
      }
    });
  }

  function coolantLoops() {
    for (const L of LOOPS) {
      steamGenerator(L.sg);
      pump(L.rcp);
      const d = Math.sign(L.rcp - L.sg);
      part('rcsPipe');
      const pipe = g('pipe');
      pipe.tube([polar(2.6, L.hot * DEG, Y_NOZ), polar(6.5, (L.sg + (L.hot - L.sg) * 0.12) * DEG, Y_NOZ)], 0.47, { seg: 20 });
      pipe.tube([
        polar(7.5, (L.sg + d * 7) * DEG, 6.3),
        polar(7.6, (L.sg + d * 8) * DEG, 3.0),
        polar(8.6, L.rcp * DEG, 3.0),
        polar(8.6, L.rcp * DEG, 4.6),
      ], 0.5, { seg: 20, bend: 1.1 });
      pipe.tube([
        polar(7.5, L.rcp * DEG, 5.7),
        polar(5.6, lerp(L.rcp, L.cold, 0.6) * DEG, Y_NOZ),
        polar(2.6, L.cold * DEG, Y_NOZ),
      ], 0.44, { seg: 20, bend: 1.2 });
    }
    // Pressurizer with its enclosure and surge line.
    part('pressurizer');
    const pz = translate(...polar(8.8, 180 * DEG, 0));
    const pp = [[0, 6.0]];
    for (let t = -84; t <= 0; t += 6) pp.push([1.15 * Math.cos(t * DEG), 7.15 + 1.15 * Math.sin(t * DEG)]);
    pp.push([1.15, 18.5]);
    for (let t = 6; t <= 84; t += 6) pp.push([1.15 * Math.cos(t * DEG), 18.5 + 1.15 * Math.sin(t * DEG)]);
    pp.push([0, 19.65]);
    g('sg').at(pz, (b) => b.lathe(pp, 0, TAU, { step: 7.5 * DEG }));
    g('frame').at(pz, (b) => b.annularSector(0.95, 1.08, 0, 6.6, 0, TAU, { step: 10 * DEG }));
    part('enclosure');
    g('concrete').at(pz, (b) => {
      b.annularSector(1.7, 2.05, D.yDeck1, 21.3, 70 * DEG, 290 * DEG, { cut0: true, cut1: true, step: 6 * DEG });
      b.annularSector(0, 2.05, 21.3, 21.75, 70 * DEG, 290 * DEG, { cut0: true, cut1: true, step: 6 * DEG });
    });
    part('pressurizer');
    g('pipe').tube([polar(8.8, 180 * DEG, 6.2), polar(8.8, 180 * DEG, 4.9), polar(6.2, 152 * DEG, 4.9), polar(5.4, 146 * DEG, 6.2)], 0.18, { seg: 12, bend: 0.6 });

    // Pressurizer relief tank on the lower compartment floor.
    part('prt');
    g('tank').at(polarFrame(10.2, 160 * DEG, 0), (b) => {
      b.cyl([-2.2, 1.75, 0], [2.2, 1.75, 0], 1.2, { seg: 22 });
      b.cyl([2.2, 1.75, 0], [2.65, 1.75, 0], 1.2, { seg: 22, r1: 0.62 });
      b.cyl([-2.2, 1.75, 0], [-2.65, 1.75, 0], 1.2, { seg: 22, r1: 0.62 });
    });
    g('frame').at(polarFrame(10.2, 160 * DEG, 0), (b) => {
      for (const x of [-1.4, 1.4]) b.box(x, 0.45, 0, 0.3, 0.9, 1.9);
    });
    g('pipe').tube([polar(10.2, 160 * DEG, 2.9), polar(10.2, 160 * DEG, 5.2), polar(9.4, 174 * DEG, 5.2)], 0.12, { seg: 10, bend: 0.5 });

    // Cold-leg accumulators, one per loop, in the rooms beneath the ice condenser floor.
    part('accumulator');
    for (const a of [38, -38, 62, -62]) {
      const base = translate(...polar(15.1, a * DEG, 0));
      const ap = [[0, 1.15]];
      for (let t = -84; t <= 0; t += 6) ap.push([1.45 * Math.cos(t * DEG), 2.6 + 1.45 * Math.sin(t * DEG)]);
      ap.push([1.45, 7.0]);
      for (let t = 6; t <= 84; t += 6) ap.push([1.45 * Math.cos(t * DEG), 7.0 + 1.45 * Math.sin(t * DEG)]);
      ap.push([0, 8.45]);
      g('tank').at(base, (b) => b.lathe(ap, 0, TAU, { step: 7.5 * DEG }));
      g('frame').at(base, (b) => {
        b.annularSector(1.2, 1.3, 0, 1.9, 0, TAU, { step: 10 * DEG });
        b.cyl([0, 8.4, 0], [0, 9.0, 0], 0.12, { seg: 10 });
      });
    }

    // Air return fans on the deck (upper to lower compartment).
    part('airFan');
    for (const a of [163, -163]) {
      g('ahu').at(polarFrame(10.3, a * DEG, D.yDeck1), (b) => {
        b.cyl([0, 0, 0], [0, 1.9, 0], 0.72, { seg: 24 });
        b.cyl([0, 1.9, 0], [0, 2.25, 0], 0.72, { seg: 24, r1: 0.98 });
        b.box(0, 0.7, -1.05, 0.9, 0.9, 0.7);
      });
      g('dark').at(polarFrame(10.3, a * DEG, D.yDeck1), (b) => b.cyl([0, 2.2, 0], [0, 2.27, 0], 0.9, { seg: 24 }));
    }
  }

  /** Glow-plug hydrogen igniter. The frame's +Z axis points into the wall it is mounted on. */
  function igniter(frame) {
    part('igniter');
    g('frame').at(frame, (b) => {
      b.box(0, 0, -0.11, 0.26, 0.36, 0.22);
      b.box(0, 0.2, -0.3, 0.05, 0.05, 0.6);
    });
    g('glow').at(frame, (b) => b.cyl([0, -0.08, -0.22], [0, -0.08, -0.36], 0.06, { seg: 10 }));
  }

  // ---- 5. Ice condenser: fixed structure ------------------------------------
  function iceStructure() {
    const st = g('struct'), lat = g('lattice'), pan = g('panel');
    const rIn = D.rCraneOut, rOut = D.rVessel - D.tVessel;
    const gap = 0.3 * DEG;
    const boundary = (a) => {
      // Lower support structure columns and radial beam.
      part('lowerSupport');
      for (const r of [13.6, 15.2, 16.8]) st.at(polarFrame(r, a, 0), (b) => b.box(0, 12.61, 0, 0.15, 4.22, 0.15));
      st.at(rotY(a), (b) => b.box(0, 14.85, 15.2, 0.14, 0.26, 3.7));
      // Lattice frame support columns (crane wall side and containment side).
      part('latticeFrame');
      for (const r of [13.28, 17.02]) lat.at(polarFrame(r, a, 0), (b) => b.box(0, 22.55, 0, 0.1, 15.1, 0.1));
      for (let l = 1; l <= 7; l++) lat.at(rotY(a), (b) => b.box(0, 15 + 1.83 * l, 15.15, 0.06, 0.1, 3.7));
      // Intermediate deck and top deck radial beams.
      part('midDeck');
      st.at(rotY(a), (b) => b.box(0, 30.07, 15.08, 0.18, 0.26, 4.0));
      part('topDeck');
      st.at(rotY(a), (b) => b.box(0, 34.33, 15.1, 0.2, 0.3, 4.4));
    };
    for (const k of BAYS) {
      const a0 = bayA0(k), a1 = a0 + D.bay, mid = bayMid(k);
      boundary(a0);
      if (k === 9 || k === 23) boundary(a1);

      // Insulated wall panels (crane wall side always; containment side only where the shell remains).
      part('wallPanel');
      pan.annularSector(rIn, rIn + 0.2, D.yBasket0, D.yMidDeck - 0.1, a0 + gap, a1 - gap);
      pan.annularSector(rIn, rIn + 0.2, D.yMidDeck + 0.15, D.yTopDeck - 0.25, a0 + gap, a1 - gap);
      if (!isExposed(k)) pan.annularSector(rOut - 0.28, rOut, D.yIceFloor, D.yTopDeck - 0.2, a0 + gap, a1 - gap);
      // Wear slab on the floor.
      part('iceFloor');
      pan.annularSector(rIn, rOut, D.yIceFloor, D.yIceFloor + 0.05, a0 + gap, a1 - gap);

      // Lower support structure: circumferential beams under the baskets.
      part('lowerSupport');
      for (const r of [13.6, 15.2, 16.8]) st.annularSector(r - 0.07, r + 0.07, 14.72, 14.98, a0, a1);

      // Turning vanes just inside the lower inlet doors.
      part('vane');
      for (const [rc, yc, rad] of [[13.3, 12.15, 1.0]]) {
        const prof = [];
        for (let t = -90; t <= 0; t += 7.5) prof.push([rc + rad * Math.cos(t * DEG), yc + rad * Math.sin(t * DEG)]);
        for (let t = 0; t >= -90; t -= 7.5) prof.push([rc + (rad - 0.05) * Math.cos(t * DEG), yc + (rad - 0.05) * Math.sin(t * DEG)]);
        g('vane').lathe(prof, a0 + 1.3 * DEG, a1 - 1.3 * DEG, { smooth: 30 });
      }

      // Lattice frames: horizontal grids that hold the basket columns every ~1.8 m.
      part('latticeFrame');
      for (let l = 1; l <= 7; l++) {
        const y = 15 + 1.83 * l;
        for (const r of [13.42, 14.65, 15.8, 17.0]) lat.annularSector(r - 0.03, r + 0.03, y - 0.05, y + 0.05, a0, a1);
        // Radial straps in the gaps after every third column of baskets.
        for (const j of [3, 6]) lat.at(rotY(a0 + D.bay * (0.02 + (0.96 * j) / 9)), (b) => b.box(0, y, 15.2, 0.036, 0.08, 3.6));
      }

      // Intermediate deck and top deck edge beams.
      part('midDeck');
      for (const r of [13.06, 17.12]) st.annularSector(r - 0.06, r + 0.06, 29.94, 30.2, a0, a1);
      part('topDeck');
      for (const r of [13.0, 17.2]) st.annularSector(r - 0.08, r + 0.08, 34.18, 34.48, a0, a1);

      // Rails for the ice condenser bridge crane, which travels round the plenum.
      part('bridgeCrane');
      st.annularSector(13.02, 13.12, 31.42, 31.52, a0, a1);
      st.annularSector(17.05, 17.13, 31.42, 31.52, a0, a1);
      if (k === 15) {
        g('crane').at(rotY(mid), (b) => {
          b.box(0, 31.5, 15.08, 0.3, 0.22, 4.0);
          for (const r of [13.1, 17.07]) b.box(0, 31.47, r, 0.7, 0.16, 0.14);
        });
        g('motor').at(rotY(mid), (b) => b.box(0, 31.27, 15.7, 0.5, 0.26, 0.6));
        g('dark').at(rotY(mid), (b) => b.cyl([0, 30.75, 15.7], [0, 31.15, 15.7], 0.025, { seg: 6 }));
      }

      // Hydrogen igniter on the crane wall side of the plenum, every other bay,
      // high enough to clear the intermediate deck doors as they swing up.
      if (k % 2 === 1) igniter(chain(polarFrame(13.02, mid + 3.6 * DEG, 32.0), rotY(PI)));

      // Air handling unit hung in the upper plenum, with glycol supply branches.
      part('ahu');
      g('ahu').at(polarFrame(15.0, mid, 0), (b) => {
        b.box(0, 32.9, 0, 1.75, 0.95, 2.3);
        b.box(0, 32.2, -0.55, 1.1, 0.5, 0.7);
        b.cyl([0, 32.9, 1.15], [0, 32.9, 1.32], 0.36, { seg: 20 });
      });
      g('dark').at(polarFrame(15.0, mid, 0), (b) => {
        b.box(0.885, 32.9, 0, 0.02, 0.7, 1.9);
        b.box(-0.885, 32.9, 0, 0.02, 0.7, 1.9);
        b.box(0, 31.94, -0.55, 0.95, 0.02, 0.55);
      });
      st.at(polarFrame(15.0, mid, 0), (b) => {
        for (const [x, z] of [[0.75, 1.0], [-0.75, 1.0], [0.75, -1.0], [-0.75, -1.0]]) b.cyl([x, 33.37, z], [x, 34.2, z], 0.03, { seg: 6 });
      });
      part('glycol');
      const gl = g('glycol');
      gl.torusArc(16.72, 0.075, 34.0, a0, a1, { seg: 10 });
      gl.torusArc(16.46, 0.075, 34.0, a0, a1, { seg: 10 });
      gl.tube([polar(16.72, mid + 2.5 * DEG, 34.0), polar(16.72, mid + 2.5 * DEG, 33.15), polar(16.15, mid + 2.5 * DEG, 33.15)], 0.045, { seg: 8, bend: 0.2 });
      gl.tube([polar(16.46, mid - 2.5 * DEG, 34.0), polar(16.46, mid - 2.5 * DEG, 32.7), polar(16.15, mid - 2.5 * DEG, 32.7)], 0.045, { seg: 8, bend: 0.15 });
      // Louvre slats over the side intakes and a flanged fan ring on the outboard face.
      part('ahu');
      g('ahu').at(polarFrame(15.0, mid, 0), (b) => {
        for (let s = 0; s < 6; s++) {
          const y = 32.62 + s * 0.112;
          b.box(0.9, y, 0, 0.035, 0.03, 1.86);
          b.box(-0.9, y, 0, 0.035, 0.03, 1.86);
        }
        b.cyl([0, 32.9, 1.15], [0, 32.9, 1.2], 0.46, { seg: 24 });
        b.box(0, 33.4, 0, 1.83, 0.05, 2.38);
        b.box(0, 32.4, 0, 1.83, 0.05, 2.38);
      });
      g('dark').at(polarFrame(15.0, mid, 0), (b) => b.cyl([0, 32.9, 1.3], [0, 32.9, 1.335], 0.29, { seg: 20 }));

      // Lower inlet door frame set into the crane wall opening.
      part('lowerDoor');
      const fr = g('frame');
      fr.annularSector(11.95, D.rCraneOut, D.yDoor0, D.yDoor1, mid - D.doorHalf, mid - D.doorHalf + 0.4 * DEG);
      fr.annularSector(11.95, D.rCraneOut, D.yDoor0, D.yDoor1, mid + D.doorHalf - 0.4 * DEG, mid + D.doorHalf);
      fr.annularSector(11.95, D.rCraneOut, D.yDoor1 - 0.12, D.yDoor1, mid - D.doorHalf, mid + D.doorHalf);
      fr.annularSector(11.95, D.rCraneOut, D.yDoor0, D.yDoor0 + 0.1, mid - D.doorHalf, mid + D.doorHalf);
      fr.annularSector(12.3, 12.42, D.yDoor0, D.yDoor1, mid - 0.25 * DEG, mid + 0.25 * DEG); // centre mullion

      // Floor drain line down to the lower compartment.
      part('drain');
      if (k % 2 === 0) g('struct').cyl(polar(13.15, mid, 0.05), polar(13.15, mid, 9.95), 0.09, { seg: 10 });
    }
  }

  // ---- 6. Ice baskets (instanced) and the three sets of doors ---------------
  function baskets() {
    part('basket');
    // Three levels of detail. Far away a basket is two or three pixels wide, and
    // fourteen sub-pixel slivers per basket cost far more to rasterise than
    // they show; the coarser prisms are widened slightly to keep the same
    // apparent girth. The perforations are drawn in the shader, so they survive.
    const lods = BASKET_LODS.map(({ seg, rim }) => {
      const b = new Builder(ctx);
      const grow = 1 / Math.sqrt(Math.cos(PI / seg));
      b.cyl([0, 0, 0], [0, D.basketH, 0], D.basketR * grow, { seg });
      if (rim) b.cyl([0, D.basketH - 0.12, 0], [0, D.basketH + 0.03, 0], D.basketR + 0.014, { seg });
      return b;
    });
    const mats = [];
    for (const k of BAYS) {
      for (let j = 0; j < 9; j++) {
        const a = bayA0(k) + D.bay * (0.02 + (0.96 * (j + 0.5)) / 9);
        for (let i = 0; i < 9; i++) {
          const r = D.basketR0 + D.basketPitch * i;
          mats.push(mul(translate(r * Math.sin(a), D.yBasket0, r * Math.cos(a)), rotY(a + i * 1.3 + j * 0.7)));
        }
      }
    }
    const arr = new Float32Array(mats.length * 16);
    mats.forEach((m, i) => arr.set(m, i * 16));
    instanced.push({ name: 'baskets', material: 'basket', builders: lods, matrices: arr, cull: true });
  }

  const LEAF_W = 1.02;
  const tanHalf = Math.tan(D.bay / 2);
  const doors = { lower: null, mid: null, top: null };

  function doorParts() {
    // Lower inlet door leaf, modelled in its hinge frame (hinge on the local Y axis).
    part('lowerDoor');
    const lo = new Builder(ctx);
    lo.box(LEAF_W / 2 + 0.005, 1.43, 0.08, LEAF_W - 0.02, 2.82, 0.15);
    for (const y of [0.45, 1.43, 2.4]) lo.box(LEAF_W / 2, y, 0.17, LEAF_W - 0.14, 0.07, 0.04);
    lo.box(LEAF_W - 0.1, 1.43, 0.17, 0.05, 2.5, 0.04);
    lo.cyl([0.02, 0.1, 0.04], [0.02, 2.75, 0.04], 0.035, { seg: 8 });
    for (const y of [0.4, 1.43, 2.46]) lo.cyl([0.02, y - 0.13, 0.04], [0.02, y + 0.13, 0.04], 0.06, { seg: 8 }); // hinge knuckles
    lo.box(LEAF_W - 0.04, 1.43, -0.01, 0.07, 0.34, 0.04); // latch plate
    doors.lower = { name: 'lowerDoors', material: 'door', builders: [lo], matrices: new Float32Array(BAYS.length * 2 * 16) };

    // Intermediate deck door leaf, hinged on a radial beam (local Z axis).
    part('midDeck');
    const mi = new Builder(ctx);
    const r0 = 13.14, r1 = 17.04;
    mi.prismXZ([[0.11, r0], [r0 * tanHalf - 0.025, r0], [r1 * tanHalf - 0.025, r1], [0.11, r1]], 0, 0.1);
    for (const r of [14.1, 15.1, 16.1]) mi.box((r * tanHalf) / 2 + 0.04, 0.115, r, r * tanHalf - 0.2, 0.03, 0.06);
    doors.mid = { name: 'midDeckDoors', material: 'deckDoor', builders: [mi], matrices: new Float32Array(BAYS.length * 2 * 16) };

    // Top deck blanket panel, hinged along the crane wall side (local X axis).
    part('topDeck');
    const to = new Builder(ctx);
    const w = (z) => (13.1 + z) * tanHalf * 0.975 - 0.1;
    to.prismXZ([[-w(0), 0], [w(0), 0], [w(4.18), 4.18], [-w(4.18), 4.18]], 0, 0.08);
    for (const z of [1.05, 2.1, 3.15]) to.box(0, 0.09, z, 2 * w(z) - 0.1, 0.025, 0.05);
    doors.top = { name: 'topDeckDoors', material: 'blanket', builders: [to], matrices: new Float32Array(BAYS.length * 16) };

    setDoors(0, 0, 0);
    instanced.push(doors.lower, doors.mid, doors.top);
  }

  // Meltwater pooling on the lower compartment floor during the sequence. The
  // mesh is a slab one metre deep; its single instance matrix sets the depth.
  const water = { name: 'meltwater', material: 'water', builders: null, matrices: new Float32Array(16) };
  function waterPart() {
    part('meltwater');
    const b = new Builder(ctx);
    b.annularSector(4.32, 11.97, 0, 1, 0, TAU, { step: 5 * DEG });
    water.builders = [b];
    setWater(0);
    instanced.push(water);
  }
  /** Sets the pool depth in metres. Zero tucks it out of sight inside the basemat. */
  function setWater(depth) {
    water.matrices.set(depth > 0 ? scale(1, depth, 1) : chain(translate(0, -0.6, 0), scale(1, 0.05, 1)));
  }

  /** Writes door instance matrices. Arguments are 0 (closed) .. 1 (fully open). */
  function setDoors(lower, mid, top) {
    const aLo = lower * 62 * DEG, aMid = mid * 68 * DEG, aTop = top * 34 * DEG;
    BAYS.forEach((k, n) => {
      const c = bayMid(k), a0 = bayA0(k), a1 = a0 + D.bay;
      const hl = c - D.doorHalf, hr = c + D.doorHalf;
      doors.lower.matrices.set(mul(translate(...polar(12.82, hl, D.yDoor0 + 0.02)), rotY(hl - aLo)), n * 32);
      doors.lower.matrices.set(chain(translate(...polar(12.82, hr, D.yDoor0 + 0.02)), rotY(hr + aLo), scale(-1, 1, 1)), n * 32 + 16);
      doors.mid.matrices.set(chain(rotY(a0), translate(0, D.yMidDeck, 0), rotZ(aMid)), n * 32);
      doors.mid.matrices.set(chain(rotY(a1), translate(0, D.yMidDeck, 0), rotZ(-aMid), scale(-1, 1, 1)), n * 32 + 16);
      doors.top.matrices.set(chain(rotY(c), translate(0, D.yTopDeck, 13.1), rotX(-aTop)), n * 16);
    });
  }

  // ---- 7. Polar crane and exterior details ----------------------------------
  function craneAndExterior() {
    const cr = g('crane'), st = g('struct');
    part('polarCrane');
    st.annularSector(12.22, 12.58, D.yCraneTop, D.yCraneTop + 0.22, CI, TAU - CI);
    for (const z of [1.75, -1.75]) {
      cr.box(0, 35.85, z, 24.0, 1.5, 0.75);
      st.box(0, 36.64, z, 23.6, 0.08, 0.16); // trolley rail
    }
    for (const x of [12.1, -12.1]) {
      cr.box(x, 35.05, 0, 0.9, 0.56, 5.2);
      for (const z of [2.0, -2.0]) g('dark').cyl([x - 0.2, 34.98, z], [x + 0.2, 34.98, z], 0.26, { seg: 16 });
    }
    cr.box(4.0, 37.0, 0, 3.2, 0.62, 3.9);
    st.cyl([2.9, 37.72, 0], [5.1, 37.72, 0], 0.42, { seg: 20 });
    g('motor').box(4.0, 37.6, 1.3, 1.5, 0.6, 0.7);
    for (const z of [0.22, -0.22]) g('dark').cyl([4.0, 31.6, z], [4.0, 37.5, z], 0.03, { seg: 6 });
    cr.box(4.0, 31.2, 0, 0.7, 0.85, 0.75);
    st.cyl([4.0, 30.35, 0], [4.0, 30.8, 0], 0.09, { seg: 8 });
    // Walkway handrail along one girder.
    for (let x = -11; x <= 11; x += 2) st.cyl([x, 36.6, 2.2], [x, 37.6, 2.2], 0.025, { seg: 6 });
    st.cyl([-11, 37.6, 2.2], [11, 37.6, 2.2], 0.025, { seg: 6 });
    st.cyl([-11, 37.1, 2.2], [11, 37.1, 2.2], 0.02, { seg: 6 });

    // Equipment hatch and personnel airlock through both shells (rear side).
    part('hatch');
    g('hatch').at(chain(rotY(180 * DEG), translate(0, 19.0, 0)), (b) => {
      b.cyl([0, 0, 17.2], [0, 0, 21.3], 3.0, { seg: 40 });
      b.cyl([0, 0, 21.3], [0, 0, 21.55], 3.3, { seg: 40 });
    });
    g('stainless').at(chain(rotY(180 * DEG), translate(0, 19.0, 0)), (b) => {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        b.cyl([3.12 * Math.cos(a), 3.12 * Math.sin(a), 21.5], [3.12 * Math.cos(a), 3.12 * Math.sin(a), 21.62], 0.07, { seg: 8 });
      }
    });
    part('airlock');
    g('hatch').at(chain(rotY(162 * DEG), translate(0, 17.2, 0)), (b) => {
      b.cyl([0, 0, 17.2], [0, 0, 21.9], 1.5, { seg: 28 });
      b.cyl([0, 0, 21.9], [0, 0, 22.05], 1.65, { seg: 28 });
    });
    // Unit vent stack on the outside of the shield building.
    part('stack');
    st.cyl(polar(21.05, 208 * DEG, 0), polar(21.05, 208 * DEG, 57.5), 0.6, { seg: 24 });
    for (const y of [9, 21, 33]) g('frame').at(polarFrame(20.6, 208 * DEG, y), (b) => b.box(0, 0, 0, 0.5, 0.2, 1.1));
    g('frame').at(polarFrame(19.6, 208 * DEG, 41.5), (b) => b.box(0, 0, 0, 0.4, 0.2, 2.4));
  }

  // ---- 8. Balance of plant detail and scale cues ------------------------------
  function person(frame) {
    part('person');
    g('person').at(frame, (b) => {
      for (const x of [-0.09, 0.09]) b.cyl([x, 0, 0], [x, 0.88, 0], 0.075, { seg: 8 });
      b.box(0, 1.16, 0, 0.42, 0.6, 0.22);
      for (const x of [-0.26, 0.26]) b.cyl([x, 1.42, 0], [x * 1.1, 0.84, 0.03], 0.05, { seg: 6 });
      b.cyl([0, 1.44, 0], [0, 1.55, 0], 0.05, { seg: 6 });
      const head = [[0, 1.52]];
      for (let t = -75; t <= 75; t += 25) head.push([0.105 * Math.cos(t * DEG), 1.63 + 0.105 * Math.sin(t * DEG)]);
      head.push([0, 1.735]);
      b.lathe(head, 0, TAU, { step: 36 * DEG });
    });
    g('helmet').at(frame, (b) => {
      b.lathe([[0, 1.66], [0.135, 1.66], [0.13, 1.7], [0.1, 1.76], [0.05, 1.79], [0, 1.795]], 0, TAU, { step: 36 * DEG });
    });
  }

  function details() {
    // Main steam lines: off the top of each steam generator, across to the
    // crane wall, down through the divider deck and out below the ice condenser
    // floor. Routing is simplified. The two front lines stop at the cut.
    part('steamLine');
    for (const L of LOOPS) {
      const s = Math.sign(L.sg), front = Math.abs(L.sg) < 90;
      const drop = s * (front ? 50 : 137.5) * DEG;
      g('lagging').tube([
        polar(7.5, L.sg * DEG, 25.35),
        polar(7.5, L.sg * DEG, 26.05),
        polar(11.3, drop, 26.05),
        polar(11.3, drop, 8.2),
        polar(front ? 17.38 : 21.9, drop, 8.2),
      ], 0.36, { seg: 14, bend: 0.85 });
      // Pipe supports on the crane wall, and the penetration sleeve at the rear.
      for (const y of [12.6, 18, 23.5]) g('frame').at(polarFrame(11.66, drop, y), (b) => b.box(0, 0, 0.02, 0.9, 0.14, 0.7));
      if (!front) g('hatch').cyl(polar(D.rShieldOut - 0.05, drop, 8.2), polar(D.rShieldOut + 0.35, drop, 8.2), 0.62, { seg: 20 });
    }

    // Risers feeding the containment spray headers, in the gap behind the ice condenser.
    part('spray');
    const Rs = D.rVessel - D.tVessel - 0.45;
    for (const a of [154, -154]) {
      g('pipe').tube([
        polar(16.9, a * DEG, D.yDeck1 + 0.2),
        polar(16.9, a * DEG, D.yVesselSpring - 0.4),
        polar(Rs * Math.cos(15 * DEG), a * DEG, D.yVesselSpring + Rs * Math.sin(15 * DEG)),
        polar(Rs * Math.cos(30 * DEG), a * DEG, D.yVesselSpring + Rs * Math.sin(30 * DEG)),
      ], 0.09, { seg: 8, bend: 1.5 });
    }

    // Main steam valve rooms where the two rear steam lines leave the building.
    part('valveRoom');
    for (const s of [-1, 1]) {
      const room = polarFrame(24.2, s * 137.5 * DEG, -1.5);
      g('concrete').at(room, (b) => {
        b.box(0, 6.25, 0, 6.5, 12.5, 6.4);
        b.box(0, 12.7, 0, 6.9, 0.4, 6.8);
      });
      g('dark').at(room, (b) => b.box(1.6, 2.55, 3.21, 1.1, 2.1, 0.04));
      g('struct').at(room, (b) => {
        for (const x of [-1.6, 0, 1.6]) b.cyl([x, 12.9, 0.8], [x, 15.6, 0.8], 0.24, { seg: 12 });
      });
    }

    // Platform outside the equipment hatch and the personnel airlock.
    part('hatch');
    g('struct').at(polarFrame(24.4, 176 * DEG, 0), (b) => {
      b.box(0, 15.72, 0, 13.5, 0.26, 4.6);
      for (const x of [-6.2, -2.1, 2.1, 6.2]) for (const z of [-1.9, 1.9]) b.box(x, 7.05, z, 0.34, 17.1, 0.34);
      for (const x of [-6.2, -2.1, 2.1, 6.2]) b.box(x, 8.0, 0, 0.12, 0.12, 3.8);
      for (let x = -6.6; x <= 6.61; x += 1.65) b.cyl([x, 15.85, 2.2], [x, 16.95, 2.2], 0.025, { seg: 6 });
      for (const y of [16.4, 16.95]) b.cyl([-6.6, y, 2.2], [6.6, y, 2.2], 0.025, { seg: 6 });
      for (const x of [-6.6, 6.6]) for (const y of [16.4, 16.95]) b.cyl([x, y, -2.1], [x, y, 2.2], 0.025, { seg: 6 });
    });

    // Operator's cab slung under the polar crane.
    part('polarCrane');
    g('crane').box(-8.5, 34.15, 2.95, 2.0, 1.7, 1.6);
    g('dark').box(-8.5, 34.4, 3.76, 1.7, 0.7, 0.02);

    // Hydrogen igniters on the crane wall, in the upper and lower compartments.
    for (const a of [40, 70, 100, 130, 160]) for (const s of [-1, 1]) igniter(polarFrame(11.99, s * a * DEG, 28));
    for (const a of [35, 75, 110, 150]) for (const s of [-1, 1]) igniter(polarFrame(11.99, s * a * DEG, 9.2));

    // Containment sump: a screened pit in the lower compartment floor.
    part('sump');
    g('dark').at(polarFrame(9.6, 13 * DEG, 0), (b) => b.box(0, 0.42, 0, 2.5, 0.8, 1.4));
    g('struct').at(polarFrame(9.6, 13 * DEG, 0), (b) => {
      for (const x of [-1.3, -0.43, 0.43, 1.3]) for (const z of [-0.75, 0.75]) b.box(x, 0.46, z, 0.09, 0.92, 0.09);
      for (const z of [-0.75, 0.75]) b.box(0, 0.9, z, 2.7, 0.09, 0.09);
      for (const x of [-1.3, 1.3]) b.box(x, 0.9, 0, 0.09, 0.09, 1.5);
      for (let i = 1; i < 6; i++) b.box(0, 0.15 * i, 0.76, 2.55, 0.02, 0.02);
    });

    // Refuelling machine: a bridge over the cavity that carries the fuel mast.
    part('refuel');
    const cr = g('crane');
    for (const x of [-4.7, 4.7]) {
      cr.box(x, 16.15, -0.5, 0.3, 2.3, 0.9);
      g('struct').box(x, D.yDeck1 + 0.04, -0.5, 0.12, 0.08, 3.0);
    }
    cr.box(0, 17.45, -0.5, 9.9, 0.4, 0.8);
    g('motor').box(1.0, 17.87, -0.5, 1.1, 0.44, 0.9);
    g('struct').cyl([1.0, 17.3, -0.5], [1.0, 14.5, -0.5], 0.14, { seg: 12 });
    g('frame').cyl([1.0, 14.5, -0.5], [1.0, 14.2, -0.5], 0.2, { seg: 12 });
    for (const x of [-4.2, -2.1, 0, 2.1, 4.2]) g('struct').cyl([x, 17.65, -0.1], [x, 18.6, -0.1], 0.022, { seg: 6 });
    g('struct').cyl([-4.2, 18.6, -0.1], [4.2, 18.6, -0.1], 0.022, { seg: 6 });

    // Hydrogen recombiners on the operating deck.
    part('recombiner');
    for (const a of [90, -90]) {
      g('ahu').at(polarFrame(9.9, a * DEG, D.yDeck1), (b) => {
        b.box(0, 1.1, 0, 1.5, 2.2, 1.2);
        b.box(0, 2.45, 0, 0.9, 0.5, 0.8);
      });
      g('dark').at(polarFrame(9.9, a * DEG, D.yDeck1), (b) => {
        b.box(0, 0.5, -0.61, 1.2, 0.6, 0.02);
        b.box(0, 2.71, 0, 0.7, 0.02, 0.6);
      });
    }

    // Refuelling water storage tank, outdoors, with its supply line into the building.
    part('rwst');
    const tank = translate(...polar(29.5, 100 * DEG, 0));
    g('concrete').at(tank, (b) => b.lathe([[0, -1.5], [5.3, -1.5], [5.3, -1.25], [0, -1.25]], 0, TAU, { step: 9 * DEG }));
    g('tank').at(tank, (b) => b.lathe([[0, -1.25], [4.5, -1.25], [4.5, 11.0], [0, 12.2]], 0, TAU, { step: 6 * DEG }));
    g('struct').at(tank, (b) => {
      for (const y of [2.8, 6.9]) b.annularSector(4.5, 4.56, y, y + 0.12, 0, TAU, { step: 6 * DEG });
      b.annularSector(4.42, 4.6, 10.9, 11.05, 0, TAU, { step: 6 * DEG });
    });
    g('pipe').tube([polar(25.1, 100 * DEG, 0.45), polar(20.2, 100 * DEG, 0.45)], 0.22, { seg: 12 });
    g('frame').at(polarFrame(23.6, 100 * DEG, -1.5), (b) => b.box(0, 0.86, 0, 0.5, 1.72, 0.3));

    // Glycol chiller packages, outdoors, and the supply and return lines that
    // climb the shield building to the ice condenser plenum.
    part('chiller');
    const pad = polarFrame(29, 120 * DEG, -1.5);
    g('concrete').at(pad, (b) => b.box(0, 0.12, 0, 7.4, 0.24, 4.2));
    for (const x of [-1.8, 1.8]) {
      g('ahu').at(pad, (b) => b.box(x, 1.24, 0, 2.9, 2.0, 2.4));
      g('dark').at(pad, (b) => {
        for (const z of [-0.6, 0.6]) b.cyl([x - 0.65, 2.24, z], [x - 0.65, 2.3, z], 0.5, { seg: 16 });
        for (const z of [-0.6, 0.6]) b.cyl([x + 0.65, 2.24, z], [x + 0.65, 2.3, z], 0.5, { seg: 16 });
        b.box(x, 1.2, 1.21, 2.5, 1.3, 0.02);
      });
    }
    for (const a of [119, 121]) {
      g('glycol').tube([
        polar(27.6, a * DEG, 0.6),
        polar(20.75, a * DEG, 0.6),
        polar(20.75, a * DEG, 33.9),
        polar(17.3, a * DEG, 33.9),
      ], 0.12, { seg: 10, bend: 0.5 });
      for (const y of [8, 16, 24, 31]) g('frame').at(polarFrame(20.5, a * DEG, y), (b) => b.box(0, 0, 0, 0.36, 0.1, 0.5));
    }

    // People, 1.8 m tall, for scale only.
    person(chain(translate(...polar(24.3, 84 * DEG, -1.5)), rotY(84 * DEG)));
    person(chain(translate(...polar(15.9, 41 * DEG, D.yIceFloor + 0.05)), rotY(221 * DEG)));
    person(chain(translate(...polar(7.2, -27 * DEG, D.yDeck1)), rotY(63 * DEG)));
    person(translate(-6.0, 36.6, 2.0));
    person(chain(translate(...polar(24.6, 106 * DEG, -1.5)), rotY(60 * DEG)));
  }

  const steps = [
    ['Shield building', site],
    ['Steel containment vessel', vessel],
    ['Crane wall and divider deck', concrete],
    ['Reactor vessel', reactor],
    ['Coolant loops', coolantLoops],
    ['Ice condenser structure', iceStructure],
    ['Ice baskets', baskets],
    ['Doors', () => { doorParts(); waterPart(); }],
    ['Polar crane', craneAndExterior],
    ['Steam lines, outdoor plant and scale figures', details],
  ];

  function finish() {
    const parts = [];
    let triangles = 0;
    for (const [mat, b] of builders) {
      const mesh = b.toMesh();
      triangles += mesh.idx.length / 3;
      parts.push({ name: mat, material: mat, mesh, matrices: null });
    }
    for (const p of instanced) {
      const lods = p.builders.map((b) => b.toMesh());
      triangles += (lods[0].idx.length / 3) * (p.matrices.length / 16);
      parts.push({ name: p.name, material: p.material, mesh: lods[0], lods, matrices: p.matrices, cull: !!p.cull });
      p.builders = null;
    }
    // setDoors keeps this scope alive for the life of the page, so drop the
    // builders' scratch vertex lists (about 13 MB of plain JS arrays) now that
    // they have been packed into typed arrays.
    builders.clear();
    return { parts, triangles, doors, setDoors, water, setWater };
  }

  return { steps, finish };
}
