// Procedural mesh builder. Everything in the model is generated from these
// primitives: swept (lathed) profiles with real wall thickness and capped cut
// faces, annular sectors, filleted tubes, prisms and cylinders.
//
// Vertex layout: position (3), normal (3), flag (1). The flag packs two things:
// bit 0 marks a "cut" face created by the cutaway so the shader can render it
// as a section, and the rest is the id of the part the vertex belongs to
// (flag = 2 * partId + cut), which drives click-to-identify and highlighting.

import { DEG, TAU, mul, sub, cross, norm, dot, add, mulS, len } from './math.js';

/** Ear-clipping triangulation of a simple 2D polygon. Returns vertex indices. */
export function earclip(pts) {
  const n = pts.length;
  let idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();
  const out = [];
  const inTri = (p, a, b, c) => {
    const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
    const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
    return d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let clipped = false;
    const m = idx.length;
    for (let i = 0; i < m; i++) {
      const a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      const A = pts[a], B = pts[b], C = pts[c];
      const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (cr <= 1e-10) continue;
      let ok = true;
      for (const j of idx) {
        if (j === a || j === b || j === c) continue;
        if (inTri(pts[j], A, B, C)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate (collinear) remainder: drop a vertex and carry on.
      let drop = 0, best = Infinity;
      for (let i = 0; i < m; i++) {
        const A = pts[idx[(i + m - 1) % m]], B = pts[idx[i]], C = pts[idx[(i + 1) % m]];
        const cr = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]));
        if (cr < best) { best = cr; drop = i; }
      }
      idx.splice(drop, 1);
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export class Builder {
  /** ctx is shared between builders; ctx.pid is the part id stamped on new vertices. */
  constructor(ctx = { pid: 0 }) {
    this.ctx = ctx;
    this.p = [];
    this.n = [];
    this.f = [];
    this.i = [];
    this.count = 0;
    this.xf = null;
  }

  /** Runs fn with an extra local transform applied to everything it emits. */
  at(m, fn) {
    const prev = this.xf;
    this.xf = prev ? mul(prev, m) : m;
    fn(this);
    this.xf = prev;
    return this;
  }

  v(x, y, z, nx, ny, nz, fl = 0) {
    const m = this.xf;
    if (m) {
      const X = m[0] * x + m[4] * y + m[8] * z + m[12];
      const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
      const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
      const NX = m[0] * nx + m[4] * ny + m[8] * nz;
      const NY = m[1] * nx + m[5] * ny + m[9] * nz;
      const NZ = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(NX, NY, NZ) || 1;
      x = X; y = Y; z = Z; nx = NX / l; ny = NY / l; nz = NZ / l;
    }
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.f.push(fl + 2 * this.ctx.pid);
    return this.count++;
  }

  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }

  /** Planar quad with a face normal derived from its corners. */
  flatQuad(a, b, c, d, fl = 0, nOverride = null) {
    const n = nOverride || norm(cross(sub(b, a), sub(d, a)));
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], fl);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], fl);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], fl);
    const i3 = this.v(d[0], d[1], d[2], n[0], n[1], n[2], fl);
    this.quad(i0, i1, i2, i3);
  }

  box(cx, cy, cz, sx, sy, sz, fl = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.flatQuad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], fl, [1, 0, 0]);
    this.flatQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], fl, [-1, 0, 0]);
    this.flatQuad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], fl, [0, 1, 0]);
    this.flatQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], fl, [0, -1, 0]);
    this.flatQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], fl, [0, 0, 1]);
    this.flatQuad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], fl, [0, 0, -1]);
    return this;
  }

  /**
   * Solid ring segment about the Y axis between radii r0..r1, heights y0..y1
   * and angles a0..a1. End faces can be flagged as section cuts.
   */
  annularSector(r0, r1, y0, y1, a0, a1, { cut0 = false, cut1 = false, step = 2.5 * DEG } = {}) {
    const full = a1 - a0 > TAU - 1e-5;
    const n = Math.max(1, Math.ceil((a1 - a0) / step - 1e-6));
    let po = null, pi = null, pt = null, pb = null;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const s = Math.sin(a), c = Math.cos(a);
      const o = [this.v(r1 * s, y0, r1 * c, s, 0, c), this.v(r1 * s, y1, r1 * c, s, 0, c)];
      const inn = r0 > 1e-6
        ? [this.v(r0 * s, y0, r0 * c, -s, 0, -c), this.v(r0 * s, y1, r0 * c, -s, 0, -c)]
        : null;
      const t = [this.v(r0 * s, y1, r0 * c, 0, 1, 0), this.v(r1 * s, y1, r1 * c, 0, 1, 0)];
      const b = [this.v(r0 * s, y0, r0 * c, 0, -1, 0), this.v(r1 * s, y0, r1 * c, 0, -1, 0)];
      if (i > 0) {
        this.quad(po[0], o[0], o[1], po[1]);
        if (inn) this.quad(pi[0], pi[1], inn[1], inn[0]);
        this.quad(pt[0], pt[1], t[1], t[0]);
        this.quad(pb[0], b[0], b[1], pb[1]);
      }
      po = o; pi = inn; pt = t; pb = b;
    }
    if (!full) {
      for (const [a, sign, fl] of [[a0, -1, cut0 ? 1 : 0], [a1, 1, cut1 ? 1 : 0]]) {
        const s = Math.sin(a), c = Math.cos(a);
        const nn = [c * sign, 0, -s * sign];
        this.flatQuad([r0 * s, y0, r0 * c], [r1 * s, y0, r1 * c], [r1 * s, y1, r1 * c], [r0 * s, y1, r0 * c], fl, nn);
      }
    }
    return this;
  }

  /**
   * Sweeps a 2D profile ([radius, height] points) about the Y axis.
   * Closed profiles sweep a solid with real thickness; partial sweeps are
   * capped with triangulated end faces which can be flagged as section cuts.
   */
  lathe(prof, a0 = 0, a1 = TAU, { cut0 = false, cut1 = false, step = 2.5 * DEG, smooth = 40, closed = true, caps = true } = {}) {
    const full = a1 - a0 > TAU - 1e-5;
    const n = Math.max(2, Math.ceil((a1 - a0) / step - 1e-6));
    const m = prof.length;
    const segCount = closed ? m : m - 1;
    const segN = [];
    for (let s = 0; s < segCount; s++) {
      const P = prof[s], Q = prof[(s + 1) % m];
      const dr = Q[0] - P[0], dy = Q[1] - P[1];
      const L = Math.hypot(dr, dy);
      segN.push(L < 1e-7 ? null : [dy / L, -dr / L]);
    }
    const cosS = Math.cos(smooth * DEG);
    const neighbour = (s, dir) => {
      let t = s;
      for (let k = 0; k < segCount; k++) {
        t += dir;
        if (closed) t = (t + segCount) % segCount;
        else if (t < 0 || t >= segCount) return -1;
        if (t === s) return -1;
        if (segN[t]) return t;
      }
      return -1;
    };
    const blend = (N, other) => {
      if (other < 0) return N;
      const O = segN[other];
      if (N[0] * O[0] + N[1] * O[1] < cosS) return N;
      const x = N[0] + O[0], y = N[1] + O[1];
      const l = Math.hypot(x, y) || 1;
      return [x / l, y / l];
    };
    for (let s = 0; s < segCount; s++) {
      const N = segN[s];
      if (!N) continue;
      const P = prof[s], Q = prof[(s + 1) % m];
      if (P[0] < 1e-7 && Q[0] < 1e-7) continue; // lies on the axis
      const ns = blend(N, neighbour(s, -1));
      const ne = blend(N, neighbour(s, 1));
      let pa = -1, pb = -1;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        const sa = Math.sin(a), ca = Math.cos(a);
        const va = this.v(P[0] * sa, P[1], P[0] * ca, ns[0] * sa, ns[1], ns[0] * ca);
        const vb = this.v(Q[0] * sa, Q[1], Q[0] * ca, ne[0] * sa, ne[1], ne[0] * ca);
        if (i > 0) this.quad(pa, va, vb, pb);
        pa = va; pb = vb;
      }
    }
    if (closed && !full && caps) {
      const tris = earclip(prof);
      for (const [a, sign, fl] of [[a0, -1, cut0 ? 1 : 0], [a1, 1, cut1 ? 1 : 0]]) {
        const sa = Math.sin(a), ca = Math.cos(a);
        const base = this.count;
        for (const q of prof) this.v(q[0] * sa, q[1], q[0] * ca, ca * sign, 0, -sa * sign, fl);
        for (let k = 0; k < tris.length; k += 3) this.tri(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
      }
    }
    return this;
  }

  /** Cylinder / cone frustum between two arbitrary points. */
  cyl(a, b, r, { seg = 18, r1 = r, caps = true } = {}) {
    const d = norm(sub(b, a));
    const u = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const w = cross(d, u);
    const slope = (r - r1) / (len(sub(b, a)) || 1);
    const ringA = [], ringB = [];
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * TAU;
      const dir = add(mulS(u, Math.cos(ang)), mulS(w, Math.sin(ang)));
      const nn = norm(add(dir, mulS(d, slope)));
      const pa = add(a, mulS(dir, r)), pb = add(b, mulS(dir, r1));
      ringA.push(this.v(pa[0], pa[1], pa[2], nn[0], nn[1], nn[2]));
      ringB.push(this.v(pb[0], pb[1], pb[2], nn[0], nn[1], nn[2]));
      if (i > 0) this.quad(ringA[i - 1], ringA[i], ringB[i], ringB[i - 1]);
    }
    if (caps) {
      for (const [c, rr, sign] of [[a, r, -1], [b, r1, 1]]) {
        if (rr < 1e-6) continue;
        const nn = mulS(d, sign);
        const ci = this.v(c[0], c[1], c[2], nn[0], nn[1], nn[2]);
        let prev = -1;
        for (let i = 0; i <= seg; i++) {
          const ang = (i / seg) * TAU;
          const dir = add(mulS(u, Math.cos(ang)), mulS(w, Math.sin(ang)));
          const p = add(c, mulS(dir, rr));
          const vi = this.v(p[0], p[1], p[2], nn[0], nn[1], nn[2]);
          // Wound so the front face points out of the solid at both ends.
          if (i > 0) { if (sign > 0) this.tri(ci, prev, vi); else this.tri(ci, vi, prev); }
          prev = vi;
        }
      }
    }
    return this;
  }

  /** Round tube through a polyline; interior corners are filleted into bends. */
  tube(pts, r, { seg = 16, bend = 0.9, caps = true } = {}) {
    const path = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const A = pts[i - 1], Bp = pts[i], C = pts[i + 1];
      const la = len(sub(A, Bp)), lc = len(sub(C, Bp));
      const d = Math.min(bend, la * 0.45, lc * 0.45);
      const P0 = add(Bp, mulS(sub(A, Bp), d / la));
      const P2 = add(Bp, mulS(sub(C, Bp), d / lc));
      const K = 10;
      for (let k = 0; k <= K; k++) {
        const t = k / K, u = 1 - t;
        path.push([
          u * u * P0[0] + 2 * u * t * Bp[0] + t * t * P2[0],
          u * u * P0[1] + 2 * u * t * Bp[1] + t * t * P2[1],
          u * u * P0[2] + 2 * u * t * Bp[2] + t * t * P2[2],
        ]);
      }
    }
    path.push(pts[pts.length - 1]);
    const N = path.length;
    const tangent = (i) => norm(sub(path[Math.min(N - 1, i + 1)], path[Math.max(0, i - 1)]));
    let T = tangent(0);
    let nrm = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    let prevRing = null;
    for (let i = 0; i < N; i++) {
      T = tangent(i);
      nrm = norm(sub(nrm, mulS(T, dot(nrm, T))));
      const bi = cross(T, nrm);
      const ring = [];
      for (let j = 0; j <= seg; j++) {
        const ang = (j / seg) * TAU;
        const dir = add(mulS(nrm, Math.cos(ang)), mulS(bi, Math.sin(ang)));
        const p = add(path[i], mulS(dir, r));
        ring.push(this.v(p[0], p[1], p[2], dir[0], dir[1], dir[2]));
      }
      if (prevRing) for (let j = 0; j < seg; j++) this.quad(prevRing[j], prevRing[j + 1], ring[j + 1], ring[j]);
      prevRing = ring;
      if (caps && (i === 0 || i === N - 1)) {
        const nn = mulS(T, i === 0 ? -1 : 1);
        const ci = this.v(path[i][0], path[i][1], path[i][2], nn[0], nn[1], nn[2]);
        let prev = -1;
        for (let j = 0; j <= seg; j++) {
          const ang = (j / seg) * TAU;
          const dir = add(mulS(nrm, Math.cos(ang)), mulS(bi, Math.sin(ang)));
          const p = add(path[i], mulS(dir, r));
          const vi = this.v(p[0], p[1], p[2], nn[0], nn[1], nn[2]);
          if (j > 0) { if (i > 0) this.tri(ci, prev, vi); else this.tri(ci, vi, prev); }
          prev = vi;
        }
      }
    }
    return this;
  }

  /** Pipe bent into an arc about the Y axis (ring headers). */
  torusArc(R, r, y, a0, a1, { seg = 10, step = 2.5 * DEG } = {}) {
    const n = Math.max(2, Math.ceil((a1 - a0) / step - 1e-6));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const s = Math.sin(a), c = Math.cos(a);
      const ring = [];
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * TAU;
        const cr = Math.cos(ph), sr = Math.sin(ph);
        ring.push(this.v((R + r * cr) * s, y + r * sr, (R + r * cr) * c, cr * s, sr, cr * c));
      }
      if (prev) for (let j = 0; j < seg; j++) this.quad(prev[j], prev[j + 1], ring[j + 1], ring[j]);
      prev = ring;
    }
    return this;
  }

  /** Extrudes a polygon lying in the local XZ plane between heights y0..y1. */
  prismXZ(poly, y0, y1) {
    const tris = earclip(poly);
    for (const [y, ny] of [[y1, 1], [y0, -1]]) {
      const base = this.count;
      for (const q of poly) this.v(q[0], y, q[1], 0, ny, 0);
      for (let k = 0; k < tris.length; k += 3) this.tri(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
    }
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      this.flatQuad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]);
    }
    return this;
  }

  toMesh() {
    return {
      pos: new Float32Array(this.p),
      nrm: new Float32Array(this.n),
      flag: new Float32Array(this.f),
      idx: new Uint32Array(this.i),
    };
  }
}
