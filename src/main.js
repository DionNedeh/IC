// Application shell: loading, camera, tour UI, part picking, callouts and the
// frame loop.

import { Renderer, UserError } from './renderer.js';
import { createPlant, MATERIALS, PARTS, PART_ID, DIM, BASKET_LOD_PIXELS } from './plant.js';
import { createFlow, createCooling } from './flow.js';
import { STOPS, NOTE, ADVISORY, SOURCES, ANCHORS, PART_INFO, LAYERS, STEP_STARTS, STEP_SEEK, SEQUENCE_LENGTH } from './content.js';
import { DEG, perspective, lookAt, mul, xfPoint4, clamp, smoothstep } from './math.js';

const $ = (id) => document.getElementById(id);
const FOV = 30 * DEG;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- performance budget -----------------------------------------------------
// The picture only needs full resolution when it is standing still, and no
// display needs it redrawn faster than the eye can use. These are the knobs.
const MIN_FRAME_MS = 1000 / 105; // never draw faster than this: up to 100 Hz every refresh is drawn; 120 Hz gets 60 fps, 144 Hz gets 72
const MOTION_PIXELS = 1.15e6; // pixels drawn per frame while the camera moves (about 1430 x 800)
const SEQUENCE_PIXELS = 1.7e6; // ... while only the pipe-break sequence is animating
const REST_PIXELS = 3.7e6; // ceiling for the full-resolution picture (2560 x 1440)
const STILL_PIXELS = 8.3e6; // ... with Still switched on (3840 x 2160)
const GPU_BUDGET_MS = 6; // GPU time a moving frame may cost, where the browser can measure it
const MIN_SCALE = 0.5;
const SETTLE_MS = 120; // how long the camera must rest before refinement starts
const REFINE_FRAME_MS = 1000 / 34; // refinement samples redraw five shadow maps each, so they are spread out: about 30 a second

const showError = (message, hint) => window.__showError(message, hint);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function setProgress(fraction, label) {
  $('bar-fill').style.width = `${Math.round(fraction * 100)}%`;
  $('loader-label').textContent = `${label} · ${Math.round(fraction * 100)}%`;
}

boot().catch((err) => {
  console.error(err);
  if (err instanceof UserError) {
    showError(err.message, 'Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
  } else {
    showError('Something went wrong while building the model.', String(err && err.message ? err.message : err));
  }
});

async function boot() {
  if (location.protocol === 'file:') return; // message already shown by index.html
  const canvas = $('view');
  const renderer = new Renderer(canvas);
  renderer.setMaterials(MATERIALS);

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    showError('The graphics context was lost.', 'This can happen when the GPU is reset or the tab is suspended. Reload to rebuild the scene.');
  });

  // ---- build the model in steps so progress is real ------------------------
  const plant = createPlant();
  const total = plant.steps.length + 2;
  for (let i = 0; i < plant.steps.length; i++) {
    setProgress(i / total, `Modelling: ${plant.steps[i][0]}`);
    await nextFrame();
    plant.steps[i][1]();
  }
  setProgress(plant.steps.length / total, 'Uploading geometry');
  await nextFrame();
  const built = plant.finish();
  const handles = {};
  for (const part of built.parts) handles[part.name] = renderer.addMesh(part);
  built.parts.length = 0; // the geometry now lives on the GPU; let the CPU copies go
  setProgress((plant.steps.length + 1) / total, 'Lighting');
  await nextFrame();

  const flow = createFlow();
  const coolingFlow = createCooling();

  // ---- frame scheduling -----------------------------------------------------
  // Nothing is drawn, and no frame callback runs, unless something asked for it.
  let dirty = true;
  let rafId = 0;
  function kick() {
    if (!rafId && !lost) rafId = requestAnimationFrame(frame);
  }
  function invalidate() {
    dirty = true;
    kick();
  }

  // ---- camera ---------------------------------------------------------------
  const view = { w: 1, h: 1, dpr: 1, offX: 0, offY: 0, narrow: false };
  const cam = { az: 0, el: 0, dist: 100, tx: 0, ty: 27, tz: 0 };
  const goal = { ...cam };
  let stiffness = 12;
  let userMoved = false;

  function fitDistance() {
    const aspect = view.w / view.h;
    const t = Math.tan(FOV / 2);
    const dv = 34.5 / t / (1 - Math.abs(view.offY));
    const dh = 25.5 / (t * aspect * (1 - Math.abs(view.offX)));
    return Math.max(dv, dh) * 1.02;
  }
  function stopView(stop) {
    const v = stop.view;
    const aspect = view.w / view.h;
    const dist = v.dist === 'fit' ? fitDistance() : v.dist * clamp(1.15 / aspect, 1, 2.3);
    return { az: v.az * DEG, el: v.el * DEG, dist, tx: v.target[0], ty: v.target[1], tz: v.target[2] };
  }
  function flyTo(v, instant = false) {
    // Take the short way round in azimuth.
    let az = v.az;
    while (az - cam.az > Math.PI) az -= Math.PI * 2;
    while (az - cam.az < -Math.PI) az += Math.PI * 2;
    Object.assign(goal, v, { az });
    stiffness = 3.2;
    if (instant || reducedMotion) Object.assign(cam, goal);
    userMoved = false;
    hideTip(); // whatever was under the pointer is about to move
    invalidate();
  }
  function matrices() {
    const ce = Math.cos(cam.el);
    const eye = [cam.tx + cam.dist * ce * Math.sin(cam.az), cam.ty + cam.dist * Math.sin(cam.el), cam.tz + cam.dist * ce * Math.cos(cam.az)];
    const viewM = lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
    const proj = perspective(FOV, view.w / view.h, clamp(cam.dist * 0.012, 0.15, 2.5), cam.dist + 420);
    proj[8] = -view.offX;
    proj[9] = -view.offY;
    return { view: viewM, proj, pos: eye };
  }

  // ---- quality / sizing -----------------------------------------------------
  let still = false;
  const gov = { scale: 1, perMP: 0, frameEma: 16, hold: 0 };

  function applySize() {
    view.w = Math.max(1, window.innerWidth);
    view.h = Math.max(1, window.innerHeight);
    const ceiling = Math.sqrt((still ? STILL_PIXELS : REST_PIXELS) / (view.w * view.h));
    view.dpr = Math.min(window.devicePixelRatio || 1, still ? 2 : 1.5, ceiling);
    view.narrow = view.w < 761;
    view.offX = view.narrow ? 0 : clamp((410 / view.w) * 0.55, 0, 0.2);
    view.offY = view.narrow ? 0.3 : 0;
    const cw = Math.max(2, Math.round(view.w * view.dpr)), ch = Math.max(2, Math.round(view.h * view.dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    renderer.resize(cw, ch);
    invalidate();
  }
  const maxSamples = () => (still ? 160 : 40);

  /** Render scale that keeps a frame to a given number of pixels. */
  const budgetScale = (pixels) => clamp(Math.sqrt(pixels / (renderer.width * renderer.height)), MIN_SCALE, 1);

  /**
   * Holds the cost of moving frames down. Where the browser reports real GPU
   * time, the scale is solved from the measured cost per megapixel; otherwise
   * it steps down when frames arrive late and cautiously back up.
   */
  function govern(interval, now) {
    const g = renderer.gpuLight;
    if (g && g.pixels > 0) {
      const perMP = g.ms / (g.pixels / 1e6);
      gov.perMP = gov.perMP ? gov.perMP + (perMP - gov.perMP) * 0.15 : perMP;
      const fullMP = (renderer.width * renderer.height) / 1e6;
      const want = clamp(Math.sqrt(GPU_BUDGET_MS / (gov.perMP * fullMP)), MIN_SCALE, 1);
      if (Math.abs(want - gov.scale) > 0.06) gov.scale = Math.round(want * 20) / 20;
      return;
    }
    gov.frameEma += (Math.min(interval, 250) - gov.frameEma) * 0.15;
    if (gov.frameEma > 30 && gov.scale > MIN_SCALE) {
      gov.scale = Math.max(MIN_SCALE, gov.scale * 0.85);
      gov.frameEma = 22;
      gov.hold = now + 3000;
    } else if (gov.frameEma < 19 && gov.scale < 1 && now > gov.hold) {
      gov.scale = Math.min(1, gov.scale / 0.85);
      gov.frameEma = 22;
      gov.hold = now + 3000;
    }
  }

  /** Picks the basket level of detail from how wide a basket is on screen. */
  function chooseBasketLod(m) {
    const pxPerMetre = (m.proj[5] * renderer.height) / 2; // at a distance of one metre
    const rAxis = Math.hypot(m.pos[0], m.pos[2]);
    const dRadial = Math.max(0, Math.abs(rAxis - 15.4) - 1.9);
    const dVertical = Math.max(0, m.pos[1] - (DIM.yBasket0 + DIM.basketH), DIM.yBasket0 - m.pos[1]);
    const width = (2 * DIM.basketR * pxPerMetre) / Math.max(1, Math.hypot(dRadial, dVertical));
    let lod = handles.baskets.lod;
    // 10% of hysteresis either way so the level does not flicker at a boundary.
    while (lod > 0 && width >= BASKET_LOD_PIXELS[lod - 1] * 1.1) lod--;
    while (lod < BASKET_LOD_PIXELS.length - 1 && width < BASKET_LOD_PIXELS[lod] * 0.9) lod++;
    renderer.setLod(handles.baskets, lod);
  }

  // ---- part selection -------------------------------------------------------
  let selected = 0;
  function select(id) {
    if (!PARTS[id] || !PART_INFO[PARTS[id][0]]) id = 0;
    if (id === selected) return;
    selected = id;
    renderer.selected = id || -1;
    const panel = $('inspect');
    if (id) {
      $('inspect-name').textContent = PARTS[id][1];
      $('inspect-text').textContent = PART_INFO[PARTS[id][0]];
    }
    panel.hidden = !id;
    for (const b of $('part-list').children) b.setAttribute('aria-current', String(Number(b.dataset.part) === id));
    // The tour callouts step aside while a part is being inspected; the panel sits over them.
    $('callouts').classList.toggle('muted', !!id);
    invalidate();
  }
  const pickAt = (x, y) => (lost ? 0 : renderer.pick(matrices(), x, y, view.w, view.h));

  const tip = $('tip');
  let hoverTimer = 0;
  function hideTip() {
    clearTimeout(hoverTimer);
    if (!tip.hidden) tip.hidden = true;
    canvas.classList.remove('pickable');
  }
  function hover(x, y, waited = 0) {
    clearTimeout(hoverTimer);
    // Wait for the pointer to pause: one pick per pause, never one per pixel moved.
    hoverTimer = setTimeout(() => {
      // A pick reads a pixel back, which waits for the GPU to finish what it
      // has queued. While frames are still being drawn, hold off (for up to a
      // second and a half) rather than stall behind them.
      if (rafId && waited < 1500) { hover(x, y, waited + 150); return; }
      const id = pickAt(x, y);
      const known = id && PART_INFO[PARTS[id]?.[0]];
      canvas.classList.toggle('pickable', !!known);
      tip.hidden = !known;
      if (known) {
        tip.textContent = PARTS[id][1];
        // Percentages in a translate refer to the label itself, which flips it to the pointer's left near the edge.
        tip.style.transform = x > view.w - 240 ? `translate(calc(${x - 14}px - 100%), ${y + 16}px)` : `translate(${x + 14}px, ${y + 16}px)`;
      }
    }, waited ? 150 : 70);
  }

  // ---- layers and the parts list --------------------------------------------
  const hiddenLayers = new Set();
  const layerOf = {}; // part id -> the layer that hides it
  for (const layer of LAYERS) for (const key of layer.parts) layerOf[PART_ID[key]] = layer.id;

  function applyLayers() {
    const ids = [];
    for (const layer of LAYERS) if (hiddenLayers.has(layer.id)) for (const key of layer.parts) ids.push(PART_ID[key]);
    renderer.setHidden(ids);
    if (selected && hiddenLayers.has(layerOf[selected])) select(0);
    for (const box of $('layer-list').querySelectorAll('input')) box.checked = !hiddenLayers.has(box.value);
    hideTip();
    invalidate();
  }
  function setLayer(id, visible) {
    if (visible) hiddenLayers.delete(id);
    else hiddenLayers.add(id);
    applyLayers();
  }
  for (const layer of LAYERS) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = layer.id;
    box.checked = true;
    box.addEventListener('change', () => setLayer(layer.id, box.checked));
    const text = document.createElement('span');
    text.textContent = layer.label;
    label.append(box, text);
    $('layer-list').appendChild(label);
  }
  PARTS.map(([key, name], id) => ({ key, name, id }))
    .filter((p) => p.id > 0 && PART_INFO[p.key])
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      b.dataset.part = String(p.id);
      b.setAttribute('aria-current', 'false');
      b.addEventListener('click', () => {
        // Choosing a part whose layer is off turns that layer back on.
        if (hiddenLayers.has(layerOf[p.id])) setLayer(layerOf[p.id], true);
        select(p.id);
        if (view.narrow) toggleModelPanel(false); // on a phone the panel covers the model
      });
      $('part-list').appendChild(b);
    });
  function toggleModelPanel(force) {
    const panel = $('model-panel');
    const show = force ?? panel.hidden;
    if (show) { toggleHelp(false); toggleSources(false); }
    panel.hidden = !show;
    $('btn-layers').setAttribute('aria-expanded', String(show));
  }

  // ---- sources and the advisory ---------------------------------------------
  const sourceById = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
  function sourceLink(source, text) {
    const a = document.createElement('a');
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = text;
    return a;
  }
  $('sources-advisory').textContent = ADVISORY;

  // The advisory card is shown on every visit. Nothing remembers that it was
  // dismissed, so it cannot be skipped by having seen it before.
  $('advisory-text').textContent = ADVISORY;
  $('advisory').hidden = false;
  function dismissAdvisory(thenSources) {
    $('advisory').hidden = true;
    if (thenSources) {
      toggleSources(true);
      $('btn-sources').focus();
    } else canvas.focus();
  }
  $('btn-advisory-ok').addEventListener('click', () => dismissAdvisory(false));
  $('btn-advisory-sources').addEventListener('click', () => dismissAdvisory(true));
  for (const source of SOURCES) {
    const li = document.createElement('li');
    const meta = document.createElement('span');
    meta.textContent = source.publisher;
    li.append(sourceLink(source, source.title), meta);
    if (source.note) {
      const note = document.createElement('small');
      note.textContent = source.note;
      li.appendChild(note);
    }
    $('source-list').appendChild(li);
  }
  function toggleSources(force) {
    const panel = $('sources');
    const show = force ?? panel.hidden;
    if (show) { toggleHelp(false); toggleModelPanel(false); }
    panel.hidden = !show;
    $('btn-sources').setAttribute('aria-expanded', String(show));
  }

  // ---- which GPU ------------------------------------------------------------
  // A page cannot choose the graphics card: on Windows the browser runs on
  // whichever one the system assigns it, whatever the page asks for. All the
  // page can do is notice that it landed on integrated graphics and say how
  // to change that.
  const gpuShortName = renderer.gpuName.replace(/^ANGLE \([^,]*,\s*/, '').replace(/\s*(\(0x[0-9A-Fa-f]+\)|Direct3D|OpenGL|Vulkan|Metal|vs_|,).*$/, '') || renderer.gpuName;
  const GPU_NOTE_KEY = 'ice-condenser.gpu-note-dismissed';
  const stored = (fn) => { try { return fn(); } catch (err) { return null; } }; // storage can be blocked
  if (renderer.integrated && /Windows/.test(navigator.userAgent) && !stored(() => localStorage.getItem(GPU_NOTE_KEY))) {
    $('gpu-note-name').textContent = gpuShortName;
    $('gpu-note').hidden = false;
  }
  $('btn-gpu-how').addEventListener('click', () => {
    const open = $('gpu-note-steps').hidden;
    $('gpu-note-steps').hidden = !open;
    $('gpu-note-alt').hidden = !open;
    $('btn-gpu-how').setAttribute('aria-expanded', String(open));
  });
  $('btn-gpu-dismiss').addEventListener('click', () => {
    $('gpu-note').hidden = true;
    stored(() => localStorage.setItem(GPU_NOTE_KEY, '1'));
  });

  // ---- tour UI --------------------------------------------------------------
  let stopIndex = 0;
  const seq = { playing: false, paused: false, t: 0, fade: 0, doorsOpen: false, nudged: false };
  const doorPose = [0, 0, 0]; // openings last written to the door instance buffers
  let poolDepth = 0; // meltwater depth last written, in metres
  const cooling = { on: false, t: 0, fade: 0 }; // sprays and air return on the long-term cooling stop
  let litStep = -2; // step last highlighted in the list; -2 forces a refresh
  let scrubShown = -1; // slider value last written to the DOM
  const dots = $('dots');
  STOPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Stop ${i + 1}: ${s.title}`);
    b.addEventListener('click', () => goStop(i));
    dots.appendChild(b);
  });
  const calloutLayer = $('callouts');
  let callouts = [];

  const playLabel = () => (!seq.playing ? 'Play sequence' : seq.paused ? 'Resume' : 'Pause');
  const coolingLabel = () => (cooling.on ? 'Hide sprays and air return' : 'Show sprays and air return');

  function renderCard() {
    const stop = STOPS[stopIndex];
    $('card-index').textContent = `${String(stopIndex + 1).padStart(2, '0')} / ${String(STOPS.length).padStart(2, '0')}`;
    $('card-title').textContent = stop.title;
    const body = $('card-body');
    body.textContent = '';
    for (const text of stop.body) {
      const p = document.createElement('p');
      p.textContent = text;
      body.appendChild(p);
    }
    if (stop.steps) {
      const bar = document.createElement('div');
      bar.className = 'transport';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play';
      play.id = 'btn-play';
      play.textContent = playLabel();
      play.addEventListener('click', () => playPause());
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'ghost';
      reset.id = 'btn-seq-reset';
      reset.textContent = 'Reset';
      reset.addEventListener('click', () => toggleSequence(false));
      bar.append(play, reset);
      body.appendChild(bar);

      const scrub = document.createElement('input');
      scrub.type = 'range';
      scrub.id = 'seq-scrub';
      scrub.className = 'scrub';
      scrub.min = '0';
      scrub.max = String(SEQUENCE_LENGTH);
      scrub.step = '0.05';
      scrub.value = String(Math.min(SEQUENCE_LENGTH, seq.t));
      scrub.setAttribute('aria-label', 'Position in the sequence');
      scrub.addEventListener('input', () => seekSequence(Number(scrub.value), { fromSlider: true }));
      // Once the handle is let go, rebuild the shadow maps for the doors as they now stand.
      scrub.addEventListener('change', () => { if (seq.paused) { renderer.invalidateShadows(); invalidate(); } });
      body.appendChild(scrub);
      scrubShown = -1;

      const ol = document.createElement('ol');
      ol.className = 'steps';
      ol.id = 'steps';
      stop.steps.forEach((text, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.addEventListener('click', () => seekSequence(STEP_SEEK[i]));
        li.appendChild(b);
        ol.appendChild(li);
      });
      body.appendChild(ol);
      litStep = -2;
    }
    if (stop.cooling) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'play';
      btn.id = 'btn-cooling';
      btn.textContent = coolingLabel();
      btn.setAttribute('aria-pressed', String(cooling.on));
      btn.addEventListener('click', () => toggleCooling());
      const bar = document.createElement('div');
      bar.className = 'transport';
      bar.appendChild(btn);
      body.appendChild(bar);
    }
    if (stop.figures) {
      const f = document.createElement('div');
      f.className = 'figures';
      for (const [value, label] of stop.figures) {
        const d = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = value;
        const s = document.createElement('span');
        s.textContent = label;
        d.append(b, s);
        f.appendChild(d);
      }
      body.appendChild(f);
    }
    if (stop.sources) {
      const refs = document.createElement('p');
      refs.className = 'note refs';
      refs.append('Sources: ');
      stop.sources.forEach((id, i) => {
        if (i) refs.append(' · ');
        refs.appendChild(sourceLink(sourceById[id], sourceById[id].short));
      });
      body.appendChild(refs);
    }
    if (stopIndex === 0 || stop.sequence) {
      const n = document.createElement('p');
      n.className = 'note';
      n.append(NOTE + ' ');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ghost inline';
      more.textContent = 'Sources and accuracy';
      more.addEventListener('click', () => toggleSources(true));
      n.appendChild(more);
      body.appendChild(n);
    }
    body.scrollTop = 0;
    [...dots.children].forEach((d, i) => d.setAttribute('aria-current', i === stopIndex ? 'true' : 'false'));
    $('btn-prev').disabled = stopIndex === 0;
    $('btn-next').disabled = stopIndex === STOPS.length - 1;

    calloutLayer.textContent = '';
    callouts = (stop.callouts || []).map(([key, label]) => {
      const el = document.createElement('div');
      el.className = 'callout';
      el.innerHTML = '<i></i><em></em><span></span>';
      el.querySelector('span').textContent = label;
      calloutLayer.appendChild(el);
      return { el, p: ANCHORS[key] };
    });
  }

  function goStop(i, instant = false) {
    i = clamp(i, 0, STOPS.length - 1);
    if (i !== stopIndex && seq.playing) toggleSequence(false);
    if (i !== stopIndex && cooling.on) toggleCooling(false);
    stopIndex = i;
    renderCard();
    flyTo(stopView(STOPS[i]), instant);
  }

  // ---- pipe-break sequence --------------------------------------------------
  function syncPlayButton() {
    const btn = $('btn-play');
    if (btn) btn.textContent = playLabel();
  }
  /** Starts the sequence from the beginning, or stops it and closes the doors. */
  function toggleSequence(on = !seq.playing) {
    seq.playing = on;
    seq.paused = false;
    if (on) { seq.t = 0; seq.doorsOpen = true; }
    syncPlayButton();
    invalidate();
  }
  function pauseSequence(paused = true) {
    if (!seq.playing || seq.paused === paused) return;
    seq.paused = paused;
    // A paused frame is refined like any still, so its shadows should match the doors.
    if (paused) renderer.invalidateShadows();
    syncPlayButton();
    invalidate();
  }
  function playPause() {
    if (!seq.playing) toggleSequence(true);
    else pauseSequence(!seq.paused);
  }
  /** Moves the playhead. Dragging the slider on a stopped sequence opens it paused. */
  function seekSequence(t, { fromSlider = false } = {}) {
    if (!seq.playing) {
      seq.playing = true;
      seq.paused = fromSlider;
      seq.doorsOpen = true;
    }
    seq.t = Math.max(0, t);
    seq.nudged = true; // draw the move at sequence resolution, like any other sequence frame
    if (!fromSlider && seq.paused) renderer.invalidateShadows();
    syncPlayButton();
    invalidate();
  }

  // ---- long-term cooling view ------------------------------------------------
  function toggleCooling(on = !cooling.on) {
    cooling.on = on;
    const btn = $('btn-cooling');
    if (btn) {
      btn.textContent = coolingLabel();
      btn.setAttribute('aria-pressed', String(on));
    }
    invalidate();
  }
  /** Advances the sprays and air return; true while they still need frames. */
  function updateCooling(dt) {
    if (!cooling.on && cooling.fade <= 0) return false;
    cooling.fade = cooling.on ? Math.min(1, cooling.fade + dt * 1.5) : Math.max(0, cooling.fade - dt * 2);
    cooling.t += dt;
    renderer.setPoints(coolingFlow.data, cooling.fade > 0 ? coolingFlow.update(cooling.t, cooling.fade) : 0);
    return true;
  }

  /** Advances the sequence and returns true while it still needs frames. */
  function updateSequence(dt) {
    if (!seq.playing && seq.fade <= 0 && !seq.doorsOpen) return false;
    const fadeBefore = seq.fade;
    if (seq.playing) {
      if (!seq.paused) seq.t += dt;
      seq.fade = Math.min(1, seq.fade + dt * 2);
    } else {
      seq.fade = Math.max(0, seq.fade - dt * 1.5);
    }
    const T = seq.t;
    const k = seq.playing ? 1 : seq.fade;
    // The sequence loops with the doors held open, so only rebuild and upload
    // the 100 door matrices on frames where a door has actually moved.
    const lo = smoothstep(1.2, 2.4, T) * k, mi = smoothstep(4.6, 6.2, T) * k, to = smoothstep(5.6, 7.4, T) * k;
    if (lo !== doorPose[0] || mi !== doorPose[1] || to !== doorPose[2]) {
      doorPose[0] = lo; doorPose[1] = mi; doorPose[2] = to;
      built.setDoors(lo, mi, to);
      renderer.updateInstances(handles.lowerDoors, built.doors.lower.matrices);
      renderer.updateInstances(handles.midDeckDoors, built.doors.mid.matrices);
      renderer.updateInstances(handles.topDeckDoors, built.doors.top.matrices);
    }
    // Meltwater gathers on the lower compartment floor as the ice does its work.
    const pool = Math.round(smoothstep(4.5, SEQUENCE_LENGTH, T) * 0.7 * k * 200) / 200;
    if (pool !== poolDepth) {
      poolDepth = pool;
      built.setWater(pool);
      renderer.updateInstances(handles.meltwater, built.water.matrices);
    }
    if (seq.fade > 0) {
      const count = flow.update(T, seq.fade);
      renderer.setPoints(flow.data, count);
    } else {
      renderer.setPoints(flow.data, 0);
      seq.doorsOpen = false;
      seq.t = 0;
      renderer.invalidateShadows();
    }
    let active = -1;
    if (seq.playing) for (let i = 0; i < STEP_STARTS.length; i++) if (T >= STEP_STARTS[i]) active = i;
    if (active !== litStep) {
      litStep = active;
      const list = $('steps');
      const last = STEP_STARTS.length - 1;
      if (list) [...list.children].forEach((li, i) => li.classList.toggle('on', i === active || (active === last && i >= 2)));
    }
    const shown = Math.min(SEQUENCE_LENGTH, seq.t);
    if (Math.abs(shown - scrubShown) > 0.02) {
      const scrub = $('seq-scrub');
      if (scrub) scrub.value = String(shown);
      scrubShown = shown;
    }
    // While paused nothing moves, so the loop is free to stop and refine the frame.
    const nudged = seq.nudged;
    seq.nudged = false;
    return (seq.playing && !seq.paused) || seq.fade !== fadeBefore || (!seq.playing && seq.doorsOpen) || nudged;
  }

  // ---- input ----------------------------------------------------------------
  const pointers = new Map();
  let pinch = 0;
  let multiTouch = false; // a second finger joined this gesture, so it is not a tap
  const touchUser = () => { userMoved = true; stiffness = 12; hideTip(); invalidate(); };
  function orbit(dx, dy) {
    goal.az -= dx * 0.0052;
    goal.el = clamp(goal.el + dy * 0.0045, -6 * DEG, 86 * DEG);
    touchUser();
  }
  function pan(dx, dy) {
    const s = (goal.dist * Math.tan(FOV / 2) * 2) / view.h;
    const ca = Math.cos(goal.az), sa = Math.sin(goal.az);
    goal.tx = clamp(goal.tx - dx * s * ca, -30, 30);
    goal.tz = clamp(goal.tz + dx * s * sa, -30, 30);
    goal.ty = clamp(goal.ty + dy * s, 0, 58);
    touchUser();
  }
  function zoom(factor) {
    goal.dist = clamp(goal.dist * factor, 9, 330);
    touchUser();
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    // A press that travels less than `slop` pixels is a click on a part, not a drag. Fingers wander more than mice.
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, travel: 0, slop: e.pointerType === 'mouse' ? 4 : 12 });
    canvas.classList.add('dragging');
    hideTip();
    if (pointers.size === 1) multiTouch = false;
    if (pointers.size === 2) {
      multiTouch = true;
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && pointers.size === 0) hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      const before = p.travel;
      p.travel += Math.abs(dx) + Math.abs(dy);
      if (p.travel < p.slop) return;
      const jump = before < p.slop ? 0 : 1; // drop the pent-up movement so the view does not lurch
      if (p.button === 2 || p.button === 1 || p.shift) pan(dx * jump, dy * jump);
      else orbit(dx * jump, dy * jump);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom(pinch / d);
      pinch = d;
      pan(dx / 2, dy / 2);
    }
  });
  const release = (e) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
    pinch = 0;
    if (p && e.type === 'pointerup' && p.button === 0 && !p.shift && p.travel < p.slop && !multiTouch) select(pickAt(e.clientX, e.clientY));
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', hideTip);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    hideTip();
    const unit = e.deltaMode === 1 ? 32 : 1;
    zoom(Math.exp(clamp(e.deltaY * unit, -400, 400) * 0.0011));
  }, { passive: false });

  function resetView() { flyTo(stopView(STOPS[stopIndex])); }
  function toggleHelp(force) {
    const help = $('help');
    const show = force ?? help.hidden;
    if (show) { toggleModelPanel(false); toggleSources(false); }
    help.hidden = !show;
    $('btn-help').setAttribute('aria-expanded', String(show));
  }
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    // While the advisory card is up it takes the keyboard: Escape closes it,
    // its own buttons work as usual, and no shortcut reaches the model.
    if (!$('advisory').hidden) {
      if (e.key === 'Escape') { dismissAdvisory(false); e.preventDefault(); }
      return;
    }
    // Leave a focused control its own keys: buttons activate, the slider scrubs.
    if (t instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (t instanceof HTMLInputElement && (e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page'))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowLeft') orbit(40, 0);
    else if (k === 'ArrowRight') orbit(-40, 0);
    else if (k === 'ArrowUp') orbit(0, 30);
    else if (k === 'ArrowDown') orbit(0, -30);
    else if (k === '+' || k === '=') zoom(0.88);
    else if (k === '-' || k === '_') zoom(1.14);
    else if (k === 'r' || k === 'R' || k === 'Home') resetView();
    else if (k === 'h' || k === 'H' || k === '?') toggleHelp();
    else if (k === 'g' || k === 'G') toggleStats();
    else if (k === 'l' || k === 'L') toggleModelPanel();
    else if (k === 's' || k === 'S') toggleSources();
    else if (k === ' ' && STOPS[stopIndex].sequence) playPause();
    else if (k === ' ' && STOPS[stopIndex].cooling) toggleCooling();
    else if (k === 'Escape') { if (!$('help').hidden) toggleHelp(false); else if (!$('sources').hidden) toggleSources(false); else if (!$('model-panel').hidden) toggleModelPanel(false); else select(0); }
    else if (k === ']') goStop(stopIndex + 1);
    else if (k === '[') goStop(stopIndex - 1);
    else return;
    e.preventDefault();
  });

  $('btn-reset').addEventListener('click', resetView);
  $('btn-help').addEventListener('click', () => toggleHelp());
  $('btn-layers').addEventListener('click', () => toggleModelPanel());
  $('btn-sources').addEventListener('click', () => toggleSources());
  $('btn-prev').addEventListener('click', () => goStop(stopIndex - 1));
  $('btn-next').addEventListener('click', () => goStop(stopIndex + 1));
  $('btn-inspect-close').addEventListener('click', () => select(0));
  $('btn-collapse').addEventListener('click', () => {
    const collapsed = $('card').classList.toggle('collapsed');
    $('btn-collapse').textContent = collapsed ? 'Show' : 'Hide';
    $('btn-collapse').setAttribute('aria-expanded', String(!collapsed));
    $('btn-collapse').setAttribute('aria-label', collapsed ? 'Expand the description' : 'Collapse the description');
  });
  $('btn-still').addEventListener('click', () => {
    still = !still;
    $('btn-still').setAttribute('aria-pressed', String(still));
    applySize();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!$('help').hidden && !e.target.closest('#help') && !e.target.closest('#btn-help')) toggleHelp(false);
  });

  // Coming back to the tab: draw a fresh frame rather than trust what the browser kept.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applySize();
      if (!userMoved) flyTo(stopView(STOPS[stopIndex]), true);
    }, 80);
  });

  // ---- callouts -------------------------------------------------------------
  function updateCallouts(vp) {
    const stop = STOPS[stopIndex];
    const sv = stopView(stop);
    let dAz = Math.abs(cam.az - sv.az) % (Math.PI * 2);
    if (dAz > Math.PI) dAz = Math.PI * 2 - dAz;
    const near = dAz < 0.5 && Math.abs(cam.el - sv.el) < 0.4 && cam.dist / sv.dist > 0.55 && cam.dist / sv.dist < 1.7;
    for (const c of callouts) {
      const q = xfPoint4(vp, c.p);
      const x = (q[0] / q[3] * 0.5 + 0.5) * view.w;
      const y = (1 - (q[1] / q[3] * 0.5 + 0.5)) * view.h;
      const on = near && q[3] > 0 && x > 8 && x < view.w - 8 && y > 40 && y < view.h - 8;
      c.el.classList.toggle('show', on);
      c.el.classList.toggle('left', x > view.w - 190);
      c.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // ---- performance readout --------------------------------------------------
  const statsEl = $('stats');
  const perf = { on: false, frames: 0, since: 0, fps: 0, idle: true };
  function toggleStats() {
    perf.on = !perf.on;
    statsEl.hidden = !perf.on;
    if (perf.on) { writeStats(); kick(); }
  }
  function writeStats() {
    const r = renderer;
    const scale = Math.round((r.viewW / r.width) * 100);
    const gpu = r.timerExt ? (r.gpuMs == null ? 'measuring…' : `${r.gpuMs.toFixed(2)} ms per frame`) : 'not reported by this browser';
    statsEl.textContent = [
      perf.idle ? 'Idle: nothing is being drawn' : `${perf.fps.toFixed(0)} frames/s drawn`,
      `GPU time    ${gpu}`,
      `Resolution  ${r.viewW} × ${r.viewH} (${scale}%), ${r.maxSamples}× MSAA`,
      `Samples     ${r.sample} / ${maxSamples()}`,
      `Triangles   ${Math.round(r.stats.triangles / 1000)}k in ${r.stats.draws} draws, last frame`,
      `Baskets     detail level ${handles.baskets.lod + 1} of ${handles.baskets.levels.length}`,
      `GPU memory  ≈ ${Math.round(r.memoryEstimate() / 1048576)} MB`,
      `${r.gpuName} (${r.tier} graphics)`,
    ].join('\n');
  }
  function tickStats(now, drew, again) {
    if (drew) perf.frames++;
    const idle = !again;
    if (now - perf.since >= 500 || idle !== perf.idle) {
      perf.fps = perf.since ? (perf.frames * 1000) / Math.max(1, now - perf.since) : 0;
      perf.frames = 0;
      perf.since = now;
      perf.idle = idle;
      if (perf.on) writeStats();
    }
  }

  // ---- frame loop -----------------------------------------------------------
  const status = $('status');
  let lastTick = -1e9;
  let lastRefine = -1e9;
  let settleTimer = 0;
  let asleep = true; // the loop is stopped; the next frame must not treat the gap as elapsed time

  function frame(now) {
    rafId = 0;
    if (lost) return;
    const since = now - lastTick;
    if (since < MIN_FRAME_MS - 0.5) { kick(); return; } // the display refreshes faster than we need: sit this one out
    lastTick = now;
    const resumed = asleep;
    asleep = false;
    const dt = resumed ? 1 / 60 : Math.min(0.1, since / 1000);

    const k = 1 - Math.exp(-dt * stiffness);
    let moving = false;
    for (const key of ['az', 'el', 'dist', 'tx', 'ty', 'tz']) {
      const d = goal[key] - cam[key];
      const eps = key === 'az' || key === 'el' ? 1.5e-4 : 1.5e-3 * Math.max(1, cam.dist * 0.05);
      if (Math.abs(d) > eps) {
        cam[key] += d * k;
        moving = true;
      } else {
        cam[key] = goal[key];
      }
    }
    const sequenceBusy = updateSequence(dt), coolingBusy = updateCooling(dt); // both must run every frame
    const animating = sequenceBusy || coolingBusy;
    const active = moving || animating || dirty;
    let drew = false, again = true;

    if (active) {
      if ((moving || animating) && !resumed) govern(since, now);
      // One-off redraws (a selection, a resize) go straight to full resolution.
      const scale = moving ? Math.min(budgetScale(MOTION_PIXELS), gov.scale)
        : animating ? Math.min(budgetScale(SEQUENCE_PIXELS), gov.scale) : 1;
      const m = matrices();
      chooseBasketLod(m);
      renderer.render(m, { reset: true, scale });
      updateCallouts(mul(m.proj, m.view));
      dirty = false;
      drew = true;
      settleTimer = now;
      status.classList.remove('show');
    } else if (now - settleTimer > SETTLE_MS) {
      if (renderer.viewW !== renderer.width || renderer.viewH !== renderer.height) {
        renderer.render(matrices(), { reset: true }); // back to full resolution
        drew = true;
      } else if (renderer.sample < maxSamples() && now - lastRefine >= REFINE_FRAME_MS - 0.5) {
        renderer.render(matrices());
        lastRefine = now;
        drew = true;
        status.textContent = `${still ? 'Still' : 'Refining'} · ${renderer.sample}/${maxSamples()}`;
        status.classList.add('show');
        if (renderer.sample >= maxSamples()) setTimeout(() => status.classList.remove('show'), 900);
      }
      again = renderer.sample < maxSamples();
    }
    tickStats(now, drew, again);
    if (again) kick();
    else asleep = true;
  }

  // ---- go -------------------------------------------------------------------
  applySize();
  renderCard();
  flyTo(stopView(STOPS[0]), true);
  {
    const m = matrices();
    chooseBasketLod(m);
    renderer.render(m, { reset: true });
  }
  setProgress(1, 'Ready');
  await nextFrame();
  $('loader').classList.add('done');
  if (!$('advisory').hidden) $('btn-advisory-ok').focus();
  setTimeout(() => { $('loader').hidden = true; }, 700);
  kick();

  // Hooks for automated checks and for measuring (no effect on normal use).
  window.__ice = {
    renderer, cam, goal, view, stops: STOPS, parts: PARTS, triangles: built.triangles,
    setView(v) { Object.assign(goal, v); Object.assign(cam, goal); userMoved = true; invalidate(); },
    goStop, toggleSequence, pauseSequence, seekSequence, toggleCooling, select, pickAt, toggleStats, setLayer, toggleModelPanel,
    state: () => ({
      sample: renderer.sample, max: maxSamples(), scale: renderer.viewW / renderer.width, governor: gov.scale,
      still, hdr: renderer.hdr, gpu: renderer.gpuName, gpuMs: renderer.gpuMs, basketLod: handles.baskets.lod,
      selected, looping: rafId !== 0, triangles: renderer.stats.triangles, seq: { ...seq },
      tier: renderer.tier, hiddenLayers: [...hiddenLayers], poolDepth, cooling: { ...cooling },
    }),
    setSequenceTime(t) { seq.t = t; invalidate(); },
    /**
     * Times the current view with and without the depth pre-pass and returns
     * milliseconds per frame for each. Run `__ice.bench()` in the console. The
     * page freezes while it runs; each timing ends with a one-pixel read-back
     * so the GPU has really finished the work being measured.
     */
    bench(frames = 30) {
      const gl = renderer.gl, m = matrices(), px = new Uint8Array(4);
      const setting = renderer.depthPrepass;
      const time = (prepass) => {
        renderer.depthPrepass = prepass;
        const run = (n) => {
          for (let i = 0; i < n; i++) renderer.render(m, { reset: true });
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        run(1); // warm-up
        const t0 = performance.now();
        run(frames);
        return +((performance.now() - t0) / frames).toFixed(2);
      };
      const withoutPrepass = time(false), withPrepass = time(true);
      renderer.depthPrepass = setting;
      invalidate();
      return { gpu: renderer.gpuName, width: renderer.width, height: renderer.height, frames, prepassInUse: setting, msPerFrame: { withoutPrepass, withPrepass } };
    },
  };
}
