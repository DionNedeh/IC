// Schematic flow particles for the pipe-break sequence. Purely illustrative:
// particles follow an authored path (break -> lower inlet doors -> ice bed ->
// deck doors -> upper compartment); nothing here is simulated.

import { DEG, lerp, smoothstep, clamp } from './math.js';
import { BAYS, bayMid, DIM } from './plant.js';

const STEAM = 2400;
const MELT = 360;
export const PERIOD = 8; // seconds for one particle to travel the whole path
const BREAK = { r: 6.4, a: 40 * DEG, y: 6.4 };

// Deterministic pseudo-random numbers so every run looks the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFlow() {
  const rand = rng(20261120);
  const steam = [];
  for (let i = 0; i < STEAM; i++) {
    const bay = BAYS[Math.floor(rand() * BAYS.length)];
    const side = rand() < 0.5 ? -1 : 1;
    // In the two bays beside the front cut, half the particles hug the open face.
    let a = bayMid(bay) + (rand() - 0.5) * 11 * DEG;
    if (bay === 9 && rand() < 0.5) a = -DIM.cutIce + 0.004;
    if (bay === 14 && rand() < 0.5) a = DIM.cutIce - 0.004;
    steam.push({
      door: bayMid(bay) + side * (0.6 + rand() * 3.4) * DEG,
      a,
      u: rand(), v: rand(), w: rand(),
      off: rand(), spd: 0.85 + rand() * 0.3,
      ph: rand() * 6.283,
    });
  }
  const melt = [];
  for (let i = 0; i < MELT; i++) {
    const bay = BAYS[Math.floor(rand() * BAYS.length)];
    melt.push({ a: bayMid(bay) + (rand() - 0.5) * 11.5 * DEG, r: 13.5 + rand() * 3.4, y0: 15.5 + rand() * 13, off: rand(), spd: 0.6 + rand() * 0.6 });
  }
  const data = new Float32Array((STEAM + MELT) * 8);

  /** Fills the vertex buffer for time T (seconds since the break). Returns the particle count. */
  function update(T, fade = 1) {
    let o = 0;
    const put = (r, a, y, cr, cg, cb, alpha, size) => {
      data[o++] = r * Math.sin(a); data[o++] = y; data[o++] = r * Math.cos(a);
      data[o++] = cr; data[o++] = cg; data[o++] = cb; data[o++] = alpha * fade;
      data[o++] = size;
    };
    for (const p of steam) {
      const age = T - p.off * PERIOD;
      if (age < 0) { put(0, 0, -50, 0, 0, 0, 0, 0); continue; }
      const s = ((age / PERIOD) * p.spd) % 1;
      const wob = Math.sin(T * 1.7 + p.ph), wob2 = Math.cos(T * 1.3 + p.ph * 1.7);
      // A share of the particles rise in the gap outside the last basket row,
      // where they stay visible from outside the bed.
      const rBed = p.v > 0.55 ? 17.0 + 0.3 * p.u : 13.45 + 3.5 * p.u;
      let r, a, y, cr, cg, cb, alpha, size;
      if (s < 0.18) {
        // Expanding from the break through the lower compartment to a door.
        const t = s / 0.18, e = t * t * (3 - 2 * t);
        r = lerp(BREAK.r + (p.u - 0.5) * 1.5, 12.3, Math.pow(t, 0.8));
        a = lerp(BREAK.a + (p.v - 0.5) * 0.5, p.door, Math.pow(e, 0.7));
        const lift = Math.sin(t * Math.PI) * (2.5 + p.w * 4.5);
        y = lerp(BREAK.y + (p.w - 0.5) * 1.5, 12.45 + (p.w - 0.5) * 2.2, e) + lift * (1 - e) * 0.6 + wob * 0.25;
        cr = 1.0; cg = 0.63; cb = 0.32;
        alpha = smoothstep(0, 0.12, t) * 0.3;
        size = 2.3;
      } else if (s < 0.27) {
        // Through the door, turned upward by the vanes.
        const t = (s - 0.18) / 0.09, e = t * t * (3 - 2 * t);
        r = lerp(12.3, rBed, e);
        a = lerp(p.door, p.a, e);
        y = lerp(12.45 + (p.w - 0.5) * 2.2, 15.0, e * e);
        cr = lerp(1.0, 0.95, t); cg = lerp(0.63, 0.82, t); cb = lerp(0.32, 0.72, t);
        alpha = 0.9;
        size = 0.9;
      } else if (s < 0.74) {
        // Rising through the bed, cooling and condensing.
        const t = (s - 0.27) / 0.47;
        r = rBed + wob * 0.05;
        a = p.a + wob2 * 0.002;
        y = lerp(15.0, 30.1, t);
        cr = lerp(0.95, 0.42, t); cg = lerp(0.82, 0.72, t); cb = lerp(0.72, 1.0, t);
        alpha = lerp(1.0, 0.3, Math.pow(t, 0.7));
        size = lerp(0.85, 0.5, t);
      } else if (s < 0.83) {
        const t = (s - 0.74) / 0.09;
        r = rBed + (15.2 - rBed) * t * 0.3;
        a = p.a;
        y = lerp(30.1, 34.9, t);
        cr = 0.45; cg = 0.74; cb = 1.0;
        alpha = 0.3;
        size = 0.6;
      } else {
        // Spilling over the crane wall into the upper compartment.
        const t = (s - 0.83) / 0.17, e = t * t * (3 - 2 * t);
        const r0 = rBed + (15.2 - rBed) * 0.3;
        r = lerp(r0, 3 + 8 * p.v, e);
        a = p.a + (p.w - 0.5) * 0.3 * e;
        y = 34.9 + Math.sin(t * Math.PI * 0.6) * (2.5 + 4 * p.w);
        cr = 0.5; cg = 0.76; cb = 1.0;
        alpha = 0.3 * (1 - e);
        size = lerp(0.6, 1.4, t);
      }
      put(r, a, y, cr, cg, cb, alpha * 0.55, size);
    }
    // Meltwater falling through the bed to the floor drains.
    const meltOn = smoothstep(3.0, 6.0, T);
    for (const p of melt) {
      const cyc = ((T * 0.22 * p.spd + p.off) % 1);
      const y = lerp(p.y0, DIM.yIceFloor + 0.15, cyc * cyc);
      put(p.r, p.a, y, 0.25, 0.6, 1.0, meltOn * 0.75 * clamp(1 - cyc * 0.3, 0, 1), 0.2);
    }
    return o / 8;
  }

  return { data, update };
}

// ---- Long-term cooling ---------------------------------------------------------
// Containment spray falling from the ring headers under the dome, and the air
// return path: upper compartment -> fans -> lower compartment -> lower inlet
// doors -> ice bed -> back to the upper compartment. Authored, like the
// pipe-break flow above; nothing is simulated.

const SPRAY = 1100;
const AIR = 800;
const AIR_PERIOD = 11; // seconds for one lap of the air return path
const FAN = { r: 10.3, a: 163 * DEG, y: 17.4 };

export function createCooling() {
  const rand = rng(20261121);
  const R = DIM.rVessel - DIM.tVessel - 0.45;
  const rings = [30, 48, 66].map((ph) => [R * Math.cos(ph * DEG), DIM.yVesselSpring + R * Math.sin(ph * DEG)]);
  const spray = [];
  for (let i = 0; i < SPRAY; i++) {
    const [r, y] = rings[i % 3];
    spray.push({
      r, y,
      a: (64.5 + rand() * 231) * DEG, // the headers run round the back, clear of the cutaway
      drift: (rand() - 0.35) * 2.2,
      off: rand(), spd: 0.8 + rand() * 0.5, ph: rand() * 6.283,
    });
  }
  const air = [];
  for (let i = 0; i < AIR; i++) {
    const bay = BAYS[Math.floor(rand() * BAYS.length)];
    air.push({
      side: rand() < 0.5 ? -1 : 1,
      door: bayMid(bay) + (rand() - 0.5) * 7 * DEG,
      bed: bayMid(bay) + (rand() - 0.5) * 11 * DEG,
      u: rand(), v: rand(), w: rand(),
      off: rand(), spd: 0.85 + rand() * 0.3, ph: rand() * 6.283,
    });
  }
  const data = new Float32Array((SPRAY + AIR) * 8);

  /** Fills the vertex buffer for time T (seconds). Returns the particle count. */
  function update(T, fade = 1) {
    let o = 0;
    const put = (r, a, y, cr, cg, cb, alpha, size) => {
      data[o++] = r * Math.sin(a); data[o++] = y; data[o++] = r * Math.cos(a);
      data[o++] = cr; data[o++] = cg; data[o++] = cb; data[o++] = alpha * fade;
      data[o++] = size;
    };
    // Spray droplets: fall, speeding up, to the top deck or the operating deck.
    for (const p of spray) {
      const t = (T * 0.33 * p.spd + p.off) % 1;
      const r = Math.max(0.5, p.r - p.drift * t);
      const floor = r > DIM.rCraneOut ? DIM.yTopDeck + 0.1 : r > DIM.rCraneIn ? DIM.yCraneTop : DIM.yDeck1 + 0.1;
      const y = lerp(p.y - 0.2, floor, t * t);
      const a = p.a + Math.sin(T * 0.9 + p.ph) * 0.004;
      put(r, a, y, 0.5, 0.74, 1.0, 0.42 * smoothstep(0, 0.06, t) * (1 - smoothstep(0.93, 1, t)), 0.3);
    }
    // Air return: one lap of the building.
    for (const p of air) {
      const s = ((T / AIR_PERIOD) * p.spd + p.off) % 1;
      const fanA = p.side * FAN.a;
      const rBed = 13.45 + 3.5 * p.u;
      const wob = Math.sin(T * 1.1 + p.ph);
      // Where this particle idles in the upper compartment before being drawn to a fan.
      const r0 = 2 + 8.5 * p.v, a0 = p.bed * 0.9, y0 = 19 + 14 * p.w;
      let r, a, y, alpha = 0.3, size = 0.75;
      if (s < 0.26) {
        // Drawn across the upper compartment to the fan.
        const t = s / 0.26, e = t * t * (3 - 2 * t);
        r = lerp(r0, FAN.r, e);
        a = lerp(a0, fanA, e);
        y = lerp(y0, FAN.y + 1.2, e) + wob * 0.3 * (1 - e);
        alpha *= smoothstep(0, 0.2, t);
      } else if (s < 0.36) {
        // Down through the fan and the divider deck.
        const t = (s - 0.26) / 0.1;
        r = lerp(FAN.r, 9.6, t);
        a = fanA;
        y = lerp(FAN.y + 1.2, 9.0, t);
        size = 0.6;
        alpha = 0.5;
      } else if (s < 0.56) {
        // Round the lower compartment to a lower inlet door.
        const t = (s - 0.36) / 0.2, e = t * t * (3 - 2 * t);
        r = lerp(9.6, 12.3, Math.pow(t, 1.6));
        a = lerp(fanA, p.door, e);
        y = lerp(9.0, 12.45 + (p.w - 0.5) * 2.0, e) + wob * 0.25;
      } else if (s < 0.63) {
        // Through the door, turned upward.
        const t = (s - 0.56) / 0.07, e = t * t * (3 - 2 * t);
        r = lerp(12.3, rBed, e);
        a = lerp(p.door, p.bed, e);
        y = lerp(12.45 + (p.w - 0.5) * 2.0, 15.0, e * e);
        size = 0.6;
        alpha = 0.5;
      } else if (s < 0.88) {
        // Up through what is left of the ice bed and out of the top deck.
        const t = (s - 0.63) / 0.25;
        r = rBed + wob * 0.05;
        a = p.bed;
        y = lerp(15.0, DIM.yTopDeck + 0.5, t);
        size = 0.55;
        alpha = 0.45;
      } else {
        // Spilling back into the upper compartment.
        const t = (s - 0.88) / 0.12, e = t * t * (3 - 2 * t);
        r = lerp(rBed, r0, e);
        a = lerp(p.bed, a0, e);
        y = lerp(DIM.yTopDeck + 0.5, y0, e) + Math.sin(t * Math.PI) * 2.5;
        alpha *= 1 - smoothstep(0.75, 1, t);
      }
      put(r, a, y, 0.82, 0.9, 1.0, alpha * 0.5, size);
    }
    return o / 8;
  }

  return { data, update };
}
