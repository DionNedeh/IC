// Checks on the model itself. Run with: node --test "tests/*.test.mjs"
// No dependencies: the model, content and flow modules are plain ES modules
// that do not touch the DOM, so they can be built and inspected under Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlant, MATERIALS, PARTS, PART_ID, ANCHORS, BASKET_LODS, BASKET_LOD_PIXELS, BAYS } from '../src/plant.js';
import { createFlow, createCooling, PERIOD } from '../src/flow.js';

function build() {
  const plant = createPlant();
  for (const [, fn] of plant.steps) fn();
  return plant.finish();
}
const built = build();
const meshesOf = (part) => part.lods || [part.mesh];
const instancesOf = (part) => (part.matrices ? part.matrices.length / 16 : 1);

test('every mesh is well formed', () => {
  for (const part of built.parts) {
    for (const mesh of meshesOf(part)) {
      const verts = mesh.pos.length / 3;
      assert.ok(verts > 0, `${part.name} has vertices`);
      assert.equal(mesh.nrm.length, mesh.pos.length, `${part.name} normals match positions`);
      assert.equal(mesh.flag.length, verts, `${part.name} has one flag per vertex`);
      assert.equal(mesh.idx.length % 3, 0, `${part.name} index count is a multiple of 3`);
      for (const v of mesh.pos) assert.ok(Number.isFinite(v), `${part.name} has a non-finite position`);
      let maxIndex = 0;
      for (const i of mesh.idx) if (i > maxIndex) maxIndex = i;
      assert.ok(maxIndex < verts, `${part.name} indexes past its vertices`);
      for (let i = 0; i < verts; i++) {
        const l = Math.hypot(mesh.nrm[i * 3], mesh.nrm[i * 3 + 1], mesh.nrm[i * 3 + 2]);
        assert.ok(Math.abs(l - 1) < 1e-3, `${part.name} vertex ${i} normal has length ${l}`);
      }
    }
    if (part.matrices) for (const v of part.matrices) assert.ok(Number.isFinite(v), `${part.name} has a non-finite instance matrix`);
    assert.ok(MATERIALS[part.material], `${part.name} uses unknown material "${part.material}"`);
  }
});

test('every vertex belongs to a known part, and every part is used', () => {
  const used = new Set();
  for (const part of built.parts) {
    for (const mesh of meshesOf(part)) {
      for (const f of mesh.flag) {
        assert.ok(Number.isInteger(f) && f >= 0, `${part.name} has flag ${f}`);
        const id = Math.floor(f / 2);
        assert.ok(id < PARTS.length, `${part.name} carries part id ${id}`);
        used.add(id);
      }
    }
  }
  for (let id = 0; id < PARTS.length; id++) assert.ok(used.has(id), `part "${PARTS[id][0]}" has no geometry`);
  assert.ok(PARTS.length <= 64, 'part ids index a 64-entry uniform array in the shaders (and one byte when picking)');
  assert.equal(Object.keys(PART_ID).length, PARTS.length, 'part keys are unique');
});

test('triangles of a part do not mix part ids or cut flags', () => {
  // The shader reads the flag without interpolation, so it must be constant per triangle.
  for (const part of built.parts) {
    for (const mesh of meshesOf(part)) {
      for (let t = 0; t < mesh.idx.length; t += 3) {
        const a = mesh.flag[mesh.idx[t]], b = mesh.flag[mesh.idx[t + 1]], c = mesh.flag[mesh.idx[t + 2]];
        assert.ok(a === b && b === c, `${part.name} triangle ${t / 3} mixes flags ${a}, ${b}, ${c}`);
      }
    }
  }
});

test('back-face-culled parts are wound outwards', () => {
  // Culling is only correct if every triangle's front face agrees with its normals.
  let checked = 0;
  for (const part of built.parts) {
    if (!part.cull) continue;
    for (const mesh of meshesOf(part)) {
      for (let t = 0; t < mesh.idx.length; t += 3) {
        const [a, b, c] = [mesh.idx[t], mesh.idx[t + 1], mesh.idx[t + 2]];
        const P = (i) => [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
        const A = P(a), B = P(b), C = P(c);
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const d = n[0] * mesh.nrm[a * 3] + n[1] * mesh.nrm[a * 3 + 1] + n[2] * mesh.nrm[a * 3 + 2];
        assert.ok(d > 0, `${part.name} triangle ${t / 3} faces inwards`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'at least one part is culled');
});

test('basket levels of detail get cheaper and share their instances', () => {
  const baskets = built.parts.find((p) => p.name === 'baskets');
  assert.equal(baskets.lods.length, BASKET_LODS.length);
  assert.equal(BASKET_LOD_PIXELS.length, BASKET_LODS.length);
  assert.equal(instancesOf(baskets), BAYS.length * 81, '81 baskets in each modelled bay');
  for (let i = 1; i < baskets.lods.length; i++) {
    assert.ok(baskets.lods[i].idx.length < baskets.lods[i - 1].idx.length, `level ${i} is not cheaper than level ${i - 1}`);
    assert.ok(BASKET_LOD_PIXELS[i] < BASKET_LOD_PIXELS[i - 1], 'pixel thresholds descend');
  }
  assert.equal(BASKET_LOD_PIXELS.at(-1), 0, 'the coarsest level has no lower limit');
});

test('triangle budget', () => {
  // A guard on GPU load: adding detail must not quietly inflate what is drawn.
  const count = (level) => built.parts.reduce((sum, part) => {
    const meshes = meshesOf(part);
    return sum + (meshes[Math.min(level, meshes.length - 1)].idx.length / 3) * instancesOf(part);
  }, 0);
  const finest = count(0), coarsest = count(BASKET_LODS.length - 1);
  assert.equal(finest, built.triangles, 'reported triangle count matches the finest level');
  assert.ok(finest < 420000, `finest level draws ${finest} triangles`);
  assert.ok(coarsest < 260000, `overview level draws ${coarsest} triangles`);
});

test('meltwater pool is hidden at zero depth and sits on the floor otherwise', () => {
  built.setWater(0);
  assert.ok(built.water.matrices[13] < 0, 'tucked below the basemat surface when empty');
  built.setWater(0.5);
  assert.equal(built.water.matrices[5], 0.5, 'the slab is scaled to the requested depth');
  assert.equal(built.water.matrices[13], 0, 'and rests on the floor');
  built.setWater(0);
});

test('door animation writes finite matrices at every opening', () => {
  for (const open of [0, 0.37, 1]) {
    built.setDoors(open, open, open);
    for (const key of ['lower', 'mid', 'top']) {
      for (const v of built.doors[key].matrices) assert.ok(Number.isFinite(v), `${key} doors at ${open}`);
    }
  }
  built.setDoors(0, 0, 0);
});

test('materials are valid', () => {
  for (const [name, m] of Object.entries(MATERIALS)) {
    assert.match(m.base, /^#[0-9a-f]{6}$/i, `${name}.base`);
    if (m.cut) assert.match(m.cut, /^#[0-9a-f]{6}$/i, `${name}.cut`);
    for (const key of ['rough', 'metal', 'coat']) if (key in m) assert.ok(m[key] >= 0 && m[key] <= 1, `${name}.${key}`);
  }
});

test('anchors are finite points', () => {
  for (const [key, p] of Object.entries(ANCHORS)) {
    assert.equal(p.length, 3, key);
    for (const v of p) assert.ok(Number.isFinite(v), key);
  }
});

test('long-term cooling particles stay finite and inside the building', () => {
  const cooling = createCooling();
  for (const T of [0, 1.3, 7, 40, 333.3]) {
    const count = cooling.update(T, 1);
    assert.equal(count * 8, cooling.data.length, 'every particle is written');
    for (let i = 0; i < cooling.data.length; i += 8) {
      const [x, y, z] = [cooling.data[i], cooling.data[i + 1], cooling.data[i + 2]];
      assert.ok(Number.isFinite(x + y + z + cooling.data[i + 6] + cooling.data[i + 7]), `non-finite particle at T=${T}`);
      assert.ok(Math.hypot(x, z) < 17.6 && y > 0 && y < 53.5, `particle outside the containment at T=${T}: r=${Math.hypot(x, z).toFixed(1)}, y=${y.toFixed(1)}`);
    }
  }
});

test('flow particles stay finite through the sequence', () => {
  const flow = createFlow();
  for (const T of [0, 0.5, 2, PERIOD / 2, PERIOD, PERIOD * 3.7]) {
    const count = flow.update(T, 1);
    assert.equal(count * 8, flow.data.length, 'every particle is written');
    for (const v of flow.data) assert.ok(Number.isFinite(v), `non-finite particle data at T=${T}`);
  }
});
