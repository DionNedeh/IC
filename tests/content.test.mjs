// Checks that the tour copy, the page and the code agree with one another.
// Run with: node --test "tests/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARTS } from '../src/plant.js';
import { STOPS, ANCHORS, PART_INFO, LAYERS, STEP_STARTS, STEP_SEEK, SEQUENCE_LENGTH, NOTE, ADVISORY, SOURCES } from '../src/content.js';
import * as shaders from '../src/shaders.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('tour stops are complete', () => {
  const ids = new Set();
  for (const stop of STOPS) {
    assert.ok(stop.id && !ids.has(stop.id), `duplicate or missing stop id "${stop.id}"`);
    ids.add(stop.id);
    assert.ok(stop.title.length > 0, `${stop.id} has a title`);
    assert.ok(stop.body.length > 0 && stop.body.every((p) => p.length > 20), `${stop.id} has body text`);
    const v = stop.view;
    assert.ok(Number.isFinite(v.az) && Number.isFinite(v.el), `${stop.id} view angles`);
    assert.ok(v.el > -6 && v.el < 86, `${stop.id} elevation is within the orbit limits`);
    assert.ok(v.dist === 'fit' || (v.dist >= 9 && v.dist <= 330), `${stop.id} distance is within the zoom limits`);
    assert.ok(v.target.length === 3 && v.target.every(Number.isFinite), `${stop.id} target`);
    for (const [anchor, label] of stop.callouts || []) {
      assert.ok(ANCHORS[anchor], `${stop.id} callout uses unknown anchor "${anchor}"`);
      assert.ok(label.length > 0, `${stop.id} callout label`);
    }
    for (const [value, label] of stop.figures || []) assert.ok(value && label, `${stop.id} figure`);
  }
  assert.ok(NOTE.length > 0);
});

test('sources are complete, every stop cites some, and the README lists them all', () => {
  const readme = read('../README.md');
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(s.id && !ids.has(s.id), `duplicate or missing source id "${s.id}"`);
    ids.add(s.id);
    assert.ok(s.short && s.title && s.publisher && s.note, `source "${s.id}" is complete`);
    assert.match(s.url, /^https:\/\/\S+$/, `source "${s.id}" has an https link`);
    assert.ok(readme.includes(`(${s.url})`), `README.md does not link source "${s.id}"`);
  }
  const cited = new Set();
  for (const stop of STOPS) {
    assert.ok(stop.sources?.length > 0, `${stop.id} cites no sources`);
    for (const id of stop.sources) {
      assert.ok(ids.has(id), `${stop.id} cites unknown source "${id}"`);
      cited.add(id);
    }
  }
  // The advisory must say what the page is not, in the page and in the README.
  for (const text of [ADVISORY, NOTE, readme]) assert.match(text, /education/i);
  assert.match(ADVISORY, /not an established or authoritative information source/);
  assert.ok(readme.includes('https://dionnedeh.github.io/IC/'), 'README.md links the live page');
  // The advisory card must come back on every visit, so nothing may store its dismissal.
  const main = read('../src/main.js');
  assert.match(main, /\$\('advisory'\)\.hidden = false;/, 'main.js shows the advisory card on load');
  assert.doesNotMatch(main, /(local|session)Storage[^\n]*advisory/i, 'the advisory dismissal must not be remembered');
});

test('exactly one stop carries the sequence, with a matching timeline', () => {
  const seq = STOPS.filter((s) => s.sequence);
  assert.equal(seq.length, 1);
  assert.equal(seq[0].steps.length, STEP_STARTS.length);
  assert.equal(STEP_SEEK.length, STEP_STARTS.length);
  for (let i = 0; i < STEP_STARTS.length; i++) {
    if (i > 0) assert.ok(STEP_STARTS[i] > STEP_STARTS[i - 1], 'step starts ascend');
    assert.ok(STEP_SEEK[i] >= STEP_STARTS[i], `seeking to step ${i} lands inside it`);
    if (i + 1 < STEP_STARTS.length) assert.ok(STEP_SEEK[i] < STEP_STARTS[i + 1], `seeking to step ${i} does not overshoot it`);
    assert.ok(STEP_SEEK[i] <= SEQUENCE_LENGTH, `step ${i} is reachable on the slider`);
  }
});

test('every identifiable part has a description, and no description is orphaned', () => {
  const keys = PARTS.slice(1).map(([key]) => key);
  for (const [key, name] of PARTS.slice(1)) {
    assert.ok(name.length > 0, `part "${key}" has a name`);
    assert.ok(typeof PART_INFO[key] === 'string' && PART_INFO[key].length > 30, `part "${key}" has no description`);
  }
  for (const key of Object.keys(PART_INFO)) assert.ok(keys.includes(key), `description for unknown part "${key}"`);
  assert.equal(PARTS[0][0], 'none', 'id 0 is reserved for "nothing"');
});

test('layers name real parts, and no part is in two layers', () => {
  const keys = new Set(PARTS.map(([key]) => key));
  const seen = new Map();
  const ids = new Set();
  for (const layer of LAYERS) {
    assert.ok(layer.id && !ids.has(layer.id), `duplicate or missing layer id "${layer.id}"`);
    ids.add(layer.id);
    assert.ok(layer.label.length > 0 && layer.parts.length > 0, `layer "${layer.id}" is complete`);
    for (const key of layer.parts) {
      assert.ok(keys.has(key) && key !== 'none', `layer "${layer.id}" lists unknown part "${key}"`);
      assert.ok(!seen.has(key), `part "${key}" is in both "${seen.get(key)}" and "${layer.id}"`);
      seen.set(key, layer.id);
    }
  }
});

test('element ids used by the script exist', () => {
  const html = read('../index.html'), main = read('../src/main.js');
  const inPage = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const created = new Set([...main.matchAll(/\.id = '([^']+)'/g)].map((m) => m[1]));
  for (const [, id] of main.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(inPage.has(id) || created.has(id), `main.js looks up #${id}, which is not in index.html`);
  }
});

test('every uniform the renderer sets is declared in a shader', () => {
  const sources = Object.values(shaders).join('\n');
  const renderer = read('../src/renderer.js');
  const names = new Set([...renderer.matchAll(/\.u\('([A-Za-z0-9_]+)(?:\[0\])?'\)/g)].map((m) => m[1]));
  assert.ok(names.size > 20, 'found the renderer uniform lookups');
  for (const name of names) {
    assert.match(sources, new RegExp(`uniform\\s+[^;]*\\b${name}\\b`), `uniform ${name} is set but never declared`);
  }
});

test('shader sources look like GLSL ES 3.00', () => {
  for (const [name, src] of Object.entries(shaders)) {
    assert.ok(src.startsWith('#version 300 es'), `${name} must start with the version directive`);
    assert.match(src, /void main\(\)/, `${name} has a main`);
  }
  // The depth pre-pass relies on both vertex shaders producing identical positions.
  for (const name of ['DEPTH_VS', 'MAIN_VS']) assert.match(shaders[name], /invariant gl_Position;/, `${name} must be invariant`);
});
