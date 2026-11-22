// Small purpose-built WebGL2 forward renderer.
//
// What it does (and does not) do:
//  - GGX specular + Lambert diffuse with a clearcoat lobe, lit by one shadowed
//    key light, an unshadowed rim light and an analytic studio environment.
//  - Shadow maps: one high-resolution key map and four "sky" maps used for
//    ambient visibility.
//  - Progressive accumulation while the camera rests: sub-pixel jitter
//    (anti-aliasing), a jittered key light (soft penumbra) and re-drawn sky
//    directions (ambient occlusion converges). This is a rasterised
//    approximation, not a path tracer: there is no bounced light.
//  - Linear HDR colour (RGBA16F) with ACES-fitted tone mapping and sRGB output.
//  - A depth pre-pass, so the costly main shader runs once per visible pixel
//    rather than once per surface stacked behind it.
//  - A render scale applied through the viewport, so resolution can change
//    from one frame to the next without reallocating any buffer.
//  - Part picking (one pixel, on demand) and a highlight for the selected part.

import { MAIN_VS, MAIN_FS, DEPTH_VS, DEPTH_FS, FULLSCREEN_VS, BG_FS, COPY_FS, FINAL_FS, POINT_VS, POINT_FS, PICK_VS, PICK_FS, GHOST_VS, FLAT_FS } from './shaders.js';
import { DEG, m4, mul, chain, translate, scale, lookAt, ortho, norm, cross, mulS, add, halton } from './math.js';

export class UserError extends Error {}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}
const dirFrom = (azDeg, elDeg) => {
  const a = azDeg * DEG, e = elDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
};

const KEY_DIR = dirFrom(52, 40);
const RIM_DIR = dirFrom(-140, 26);
const STRIP_DIR = dirFrom(-48, 18);
const STATIC_SKY = [dirFrom(15, 52), dirFrom(140, 42), dirFrom(-105, 46), dirFrom(-25, 78)];

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new UserError('This experience needs WebGL 2, which this browser or device did not provide.');
    this.gl = gl;
    this.canvas = canvas;
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(this.gpuName);
    // Graphics built into the processor (or a phone chip), as opposed to a
    // dedicated card. These get smaller shadow maps and 2x MSAA: the picture at
    // rest is the same after refinement, and each frame costs noticeably less.
    this.integrated = !this.software && !/\bArc\b|Apple M\d/i.test(this.gpuName)
      && /Intel.*(HD Graphics|UHD|Iris|Xe Graphics)|Radeon(\(TM\))? (Graphics|Vega|R\d Graphics)|\bMali\b|Adreno|PowerVR|Apple A\d/i.test(this.gpuName);
    this.tier = this.software ? 'software' : this.integrated ? 'integrated' : 'dedicated';
    const light = this.software || this.integrated;
    this.maxSamples = Math.min(this.integrated ? 2 : 4, gl.getParameter(gl.MAX_SAMPLES));
    this.keySize = Math.min(maxTex, light ? 2048 : 4096);
    this.skySize = light ? 512 : 1024;

    this.progs = {
      main: this._program(MAIN_VS, MAIN_FS, 'main'),
      depth: this._program(DEPTH_VS, DEPTH_FS, 'depth'),
      bg: this._program(FULLSCREEN_VS, BG_FS, 'background'),
      copy: this._program(FULLSCREEN_VS, COPY_FS, 'copy'),
      final: this._program(FULLSCREEN_VS, FINAL_FS, 'final'),
      point: this._program(POINT_VS, POINT_FS, 'points'),
      pick: this._program(PICK_VS, PICK_FS, 'pick'),
      ghost: this._program(GHOST_VS, FLAT_FS, 'see-through highlight'),
      flat: this._program(FULLSCREEN_VS, FLAT_FS, 'flat'),
    };
    this.emptyVao = gl.createVertexArray();
    this.meshes = [];
    this.materials = {};
    this.sample = 0;
    this.exposure = 0.92;
    this.width = 0;
    this.height = 0;
    this.targets = null;
    this.mapsState = 'none';
    this.points = null;
    this.pointCount = 0;
    // Exposed so the two paths can be compared (see __ice.bench in main.js).
    // Left off for software rasterizers: the one measured (SwiftShader) shades
    // hidden fragments either way, so there the extra pass only adds 3-6%.
    this.depthPrepass = !this.software;
    this.scale = 1; // fraction of the target's width and height drawn last frame
    this.viewW = 0;
    this.viewH = 0;
    this._skyM = new Float32Array(64);
    this._skyD = new Float32Array(12);
    this._skyB = new Float32Array(4);
    this.selected = -1; // part id to highlight, or -1
    this.ghost = true; // also tint the selected part where it is behind something
    this.hidden = new Float32Array(64); // 1 for each part id whose layer is switched off
    this.geometryBytes = 0;
    this.stats = { triangles: 0, draws: 0 }; // work submitted by the last frame

    // GPU timing. TIME_ELAPSED queries give the real GPU cost of a frame where
    // the browser exposes them (Chrome and Edge on desktop); elsewhere gpuMs
    // stays null and callers fall back to frame intervals.
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._timerActive = null;
    this._timerPending = [];
    this.gpuMs = null; // most recent frame of any kind, in milliseconds
    this.gpuLight = null; // { ms, pixels } of the most recent frame that did not also redraw shadow maps

    this._initShadowMaps();
    this._initPick();
  }

  // ---- GPU timer --------------------------------------------------------------
  _timerBegin() {
    const ext = this.timerExt;
    if (!ext) return;
    const gl = this.gl;
    try {
      // Collect finished queries, oldest first.
      while (this._timerPending.length) {
        const head = this._timerPending[0];
        if (!gl.getQueryParameter(head.q, gl.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ms = Number(gl.getQueryParameter(head.q, gl.QUERY_RESULT)) / 1e6;
        gl.deleteQuery(head.q);
        this._timerPending.shift();
        if (!disjoint && Number.isFinite(ms) && ms >= 0 && ms < 5000) {
          this.gpuMs = ms;
          if (head.light) this.gpuLight = { ms, pixels: head.pixels };
        }
      }
      if (this._timerPending.length >= 4) return; // results are lagging; skip this frame
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      this._timerActive = { q, light: true, pixels: this.viewW * this.viewH };
    } catch (err) {
      this.timerExt = null; // never let instrumentation break rendering
      this._timerActive = null;
    }
  }

  _timerEnd() {
    if (!this._timerActive) return;
    try {
      this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      this._timerPending.push(this._timerActive);
    } catch (err) {
      this.timerExt = null;
    }
    this._timerActive = null;
  }

  // ---- programs -------------------------------------------------------------
  _program(vsSrc, fsSrc, label) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        console.error(`Shader compile failed (${label})`, log);
        throw new UserError(`The graphics driver could not compile the "${label}" shader. ${String(log).split('\n')[0]}`);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      console.error(`Program link failed (${label})`, log);
      throw new UserError(`The graphics driver could not link the "${label}" shader. ${String(log).split('\n')[0]}`);
    }
    const cache = new Map();
    return { p, u: (name) => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name)); return cache.get(name); } };
  }

  // ---- geometry -------------------------------------------------------------
  setMaterials(table) {
    this.materials = {};
    for (const [name, m] of Object.entries(table)) {
      const base = hexToLinear(m.base);
      this.materials[name] = {
        base,
        cut: m.cut ? hexToLinear(m.cut) : base,
        rough: m.rough ?? 0.5,
        metal: m.metal ?? 0,
        coat: m.coat ?? 0,
        emis: m.emis ?? [0, 0, 0],
        type: m.type ?? 0,
        shadow: m.shadow !== false,
      };
    }
  }

  /**
   * Uploads a part. `lods` is an optional list of meshes, finest first, that
   * share one set of instance matrices; `cull` enables back-face culling and is
   * only safe for closed solids whose faces all wind outwards.
   */
  addMesh({ name, material, mesh, lods, matrices, cull = false }) {
    const gl = this.gl;
    const inst = matrices || m4();
    const ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst, matrices ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.geometryBytes += inst.byteLength;

    const levels = (lods || [mesh]).map((lod) => {
      const count = lod.pos.length / 3;
      const inter = new Float32Array(count * 7);
      for (let i = 0; i < count; i++) {
        inter[i * 7] = lod.pos[i * 3];
        inter[i * 7 + 1] = lod.pos[i * 3 + 1];
        inter[i * 7 + 2] = lod.pos[i * 3 + 2];
        inter[i * 7 + 3] = lod.nrm[i * 3];
        inter[i * 7 + 4] = lod.nrm[i * 3 + 1];
        inter[i * 7 + 5] = lod.nrm[i * 3 + 2];
        inter[i * 7 + 6] = lod.flag[i];
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lod.idx, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
      for (let c = 0; c < 4; c++) {
        gl.enableVertexAttribArray(3 + c);
        gl.vertexAttribPointer(3 + c, 4, gl.FLOAT, false, 64, c * 16);
        gl.vertexAttribDivisor(3 + c, 1);
      }
      gl.bindVertexArray(null);
      this.geometryBytes += inter.byteLength + lod.idx.byteLength;
      return { vao, indexCount: lod.idx.length };
    });
    const parts = new Set();
    for (const f of (lods || [mesh])[0].flag) parts.add(Math.floor(f / 2));
    const entry = { name, material, levels, lod: 0, cull, ibuf, instances: inst.length / 16, parts };
    this.meshes.push(entry);
    this.mapsState = 'none';
    return entry;
  }

  /** Hides the given part ids (an iterable) everywhere: picture, shadows and picking. */
  setHidden(ids) {
    this.hidden.fill(0);
    for (const id of ids) if (id > 0 && id < this.hidden.length) this.hidden[id] = 1;
    this.mapsState = 'none';
  }

  /** Chooses which level of detail a part is drawn with. Shadow maps follow. */
  setLod(entry, lod) {
    lod = Math.max(0, Math.min(entry.levels.length - 1, lod));
    if (entry.lod === lod) return false;
    entry.lod = lod;
    this.mapsState = 'none';
    return true;
  }

  /** Issues the draw call for a part at its current level of detail. */
  _draw(m) {
    const gl = this.gl;
    const level = m.levels[m.lod];
    if (m.cull) gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(level.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, level.indexCount, gl.UNSIGNED_INT, 0, m.instances);
    if (m.cull) gl.disable(gl.CULL_FACE);
    this.stats.triangles += (level.indexCount / 3) * m.instances;
    this.stats.draws++;
  }

  updateInstances(entry, matrices) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.ibuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, matrices);
  }

  /** Marks cached shadow maps as stale (call after moving shadow casters). */
  invalidateShadows() { this.mapsState = 'none'; }

  setPoints(data, count) {
    const gl = this.gl;
    if (!this.points) {
      this.points = { vao: gl.createVertexArray(), buf: gl.createBuffer(), cap: 0 };
      gl.bindVertexArray(this.points.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.points.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.points.buf);
    if (data.length > this.points.cap) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.points.cap = data.length;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8);
    }
    this.pointCount = count;
  }

  // ---- render targets -------------------------------------------------------
  _initShadowMaps() {
    const gl = this.gl;
    const depthParams = (target) => {
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(target, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    };
    this.keyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.keyTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.keySize, this.keySize);
    depthParams(gl.TEXTURE_2D);
    this.keyFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.keyFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.keyTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    this.skyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skyTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, this.skySize, this.skySize, 4);
    depthParams(gl.TEXTURE_2D_ARRAY);
    this.skyFbos = [];
    for (let i = 0; i < 4; i++) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.skyTex, 0, i);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.skyFbos.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.keyLight = null;
    this.skyLights = [null, null, null, null];
  }

  _initPick() {
    const gl = this.gl;
    this.pickTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    this.pickDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, 1, 1);
    this.pickFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._pickPixel = new Uint8Array(4);
  }

  /**
   * Returns the id of the part under a point, or 0 for none. (x, y) are in
   * the same units as (width, height), measured from the top left. The scene
   * is drawn into a single pixel: the projection is zoomed onto that pixel so
   * everything else is clipped away, which keeps the cost to vertex work.
   */
  pick(cam, x, y, width, height) {
    const gl = this.gl;
    const cx = ((x + 0.5) / width) * 2 - 1, cy = 1 - ((y + 0.5) / height) * 2;
    const proj = new Float32Array(cam.proj);
    for (let c = 0; c < 4; c++) {
      proj[c * 4] = width * (cam.proj[c * 4] - cx * cam.proj[c * 4 + 3]);
      proj[c * 4 + 1] = height * (cam.proj[c * 4 + 1] - cy * cam.proj[c * 4 + 3]);
    }
    const vp = mul(proj, cam.view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pr = this.progs.pick;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u('uVP'), false, vp);
    gl.uniform1fv(pr.u('uHide[0]'), this.hidden);
    const kept = this.stats;
    this.stats = { triangles: 0, draws: 0 };
    for (const m of this.meshes) if (this.materials[m.material]) this._draw(m);
    this.stats = kept;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._pickPixel);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this._pickPixel[0];
  }

  /** Rough GPU memory held by this renderer, in bytes. */
  memoryEstimate() {
    const px = this.width * this.height, colour = this.hdr ? 8 : 4, n = Math.max(1, this.maxSamples);
    const targets = px * n * (colour + 4) + px * colour * 2;
    const shadows = (this.keySize * this.keySize + 4 * this.skySize * this.skySize) * 4;
    return targets + shadows + this.geometryBytes;
  }

  resize(width, height) {
    width = Math.max(2, Math.floor(width));
    height = Math.max(2, Math.floor(height));
    if (width === this.width && height === this.height && this.targets) return;
    const gl = this.gl;
    if (this.targets) {
      const t = this.targets;
      gl.deleteFramebuffer(t.ms); gl.deleteRenderbuffer(t.msColor); gl.deleteRenderbuffer(t.msDepth);
      gl.deleteFramebuffer(t.res); gl.deleteTexture(t.resTex);
      gl.deleteFramebuffer(t.acc); gl.deleteTexture(t.accTex);
    }
    this.width = width;
    this.height = height;
    const build = () => {
      const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
      const t = {};
      t.ms = gl.createFramebuffer();
      t.msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.maxSamples, fmt, width, height);
      t.msDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.maxSamples, gl.DEPTH_COMPONENT24, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.msDepth);
      let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      const tex = () => {
        const x = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, x);
        gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, width, height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, x, 0);
        ok = ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        return [f, x];
      };
      [t.res, t.resTex] = tex();
      [t.acc, t.accTex] = tex();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return ok ? t : null;
    };
    let t = build();
    if (!t && this.hdr) {
      this.hdr = false; // fall back to 8-bit targets with in-shader tone mapping
      t = build();
    }
    if (!t) throw new UserError('The graphics driver could not create the render targets for this view.');
    this.targets = t;
    this.sample = 0;
  }

  // ---- shadows --------------------------------------------------------------
  _fitLight(dir) {
    const up = Math.abs(dir[1]) > 0.97 ? [0, 0, 1] : [0, 1, 0];
    const view = lookAt(mulS(dir, 220), [0, 0, 0], up);
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    const acc = (p) => {
      for (let k = 0; k < 3; k++) {
        const v = view[k] * p[0] + view[4 + k] * p[1] + view[8 + k] * p[2] + view[12 + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    };
    // The building, plus the outdoor tank and chillers that stand to its +X side.
    for (const x of [-23, 34]) for (const z of [-27, 23]) for (const y of [-1.6, 62]) {
      const p = [x, y, z];
      acc(p);
      // Include the patch of ground this corner shadows (bounded for low sun angles).
      const t = (y + 1.5) / Math.max(dir[1], 0.05);
      let sx = -dir[0] * t, sz = -dir[2] * t;
      const sl = Math.hypot(sx, sz);
      if (sl > 75) { sx *= 75 / sl; sz *= 75 / sl; }
      acc([x + sx, -1.5, z + sz]);
    }
    const near = -max[2] - 4, far = -min[2] + 4;
    const proj = ortho(min[0] - 1, max[0] + 1, min[1] - 1, max[1] + 1, near, far);
    const vp = mul(proj, view);
    const biasM = chain(translate(0.5, 0.5, 0.5), scale(0.5, 0.5, 0.5), vp);
    return { dir, vp, biasM, range: far - near };
  }

  _renderDepth(fbo, size, light) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size, size);
    gl.depthMask(true);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 2.0);
    const pr = this.progs.depth;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u('uVP'), false, light.vp);
    gl.uniform1fv(pr.u('uHide[0]'), this.hidden);
    for (const m of this.meshes) {
      const mat = this.materials[m.material];
      if (!mat || !mat.shadow) continue;
      this._draw(m);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (this._timerActive) this._timerActive.light = false;
  }

  _updateShadows(n) {
    if (n === 0) {
      if (this.mapsState === 'static') return;
      this.keyLight = this._fitLight(KEY_DIR);
      this._renderDepth(this.keyFbo, this.keySize, this.keyLight);
      for (let i = 0; i < 4; i++) {
        this.skyLights[i] = this._fitLight(STATIC_SKY[i]);
        this._renderDepth(this.skyFbos[i], this.skySize, this.skyLights[i]);
      }
      this.mapsState = 'static';
      return;
    }
    // Accumulating: area-light jitter for the key, fresh sky directions each frame.
    const u = norm(cross(KEY_DIR, [0, 1, 0])), v = cross(KEY_DIR, u);
    const r = 0.03 * Math.sqrt(halton(n, 5)), th = halton(n, 7) * Math.PI * 2;
    const kd = norm(add(KEY_DIR, add(mulS(u, r * Math.cos(th)), mulS(v, r * Math.sin(th)))));
    this.keyLight = this._fitLight(kd);
    this._renderDepth(this.keyFbo, this.keySize, this.keyLight);
    const h2 = halton(n, 2), h3 = halton(n, 3);
    for (let i = 0; i < 4; i++) {
      const az = ((i + h2) / 4) * Math.PI * 2;
      const sinEl = 0.1 + 0.9 * ((i * 0.25 + h3 + ((n * 0.618034) % 1) * 0.25) % 1);
      const cosEl = Math.sqrt(1 - sinEl * sinEl);
      this.skyLights[i] = this._fitLight([cosEl * Math.sin(az), sinEl, cosEl * Math.cos(az)]);
      this._renderDepth(this.skyFbos[i], this.skySize, this.skyLights[i]);
    }
    this.mapsState = 'jittered';
  }

  /**
   * Tints the selected part where it is hidden behind other geometry, so it can
   * be found from any angle. The alpha channel stands in for a stencil buffer:
   * it is set to 1 everywhere, cleared to 0 wherever the part fails the depth
   * test (lies behind the nearest surface), and the tint is then added in
   * proportion to (1 - alpha). Every pixel gets the same tint however many
   * layers of the part are stacked behind it.
   */
  _drawGhost(vp) {
    const gl = this.gl;
    const flat = this.progs.flat, ghost = this.progs.ghost;
    gl.disable(gl.BLEND);
    gl.depthMask(false);

    gl.disable(gl.DEPTH_TEST);
    gl.colorMask(false, false, false, true);
    gl.useProgram(flat.p);
    gl.uniform4f(flat.u('uColor'), 0, 0, 0, 1);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.GREATER);
    gl.useProgram(ghost.p);
    gl.uniformMatrix4fv(ghost.u('uVP'), false, vp);
    gl.uniform1fv(ghost.u('uHide[0]'), this.hidden);
    gl.uniform1f(ghost.u('uSel'), this.selected);
    gl.uniform4f(ghost.u('uColor'), 0, 0, 0, 0);
    for (const m of this.meshes) if (m.parts.has(this.selected) && this.materials[m.material]) this._draw(m);

    gl.disable(gl.DEPTH_TEST);
    gl.colorMask(true, true, true, false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
    gl.useProgram(flat.p);
    const k = this.hdr ? 1 : 0.6;
    gl.uniform4f(flat.u('uColor'), 0.03 * k, 0.2 * k, 0.26 * k, 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  }

  // ---- frame ----------------------------------------------------------------
  /**
   * cam: { view, proj, pos }. opts.reset restarts accumulation; otherwise the
   * frame is blended into the running average. opts.scale (0..1] draws into
   * that fraction of the targets and stretches the result to the canvas, which
   * is how resolution is lowered while the camera moves.
   */
  render(cam, { reset = false, scale = 1 } = {}) {
    const gl = this.gl;
    const t = this.targets;
    if (!t) return;
    const vw = Math.max(2, Math.min(this.width, Math.round(this.width * scale)));
    const vh = Math.max(2, Math.min(this.height, Math.round(this.height * scale)));
    if (vw !== this.viewW || vh !== this.viewH) reset = true; // samples at another size cannot be averaged in
    this.viewW = vw;
    this.viewH = vh;
    this.scale = scale;
    if (reset) this.sample = 0;
    const n = this.sample;
    this.stats.triangles = 0;
    this.stats.draws = 0;
    this._timerBegin();
    this._updateShadows(n);

    const proj = new Float32Array(cam.proj);
    if (n > 0) {
      proj[8] += ((halton(n, 2) - 0.5) * 2) / vw;
      proj[9] += ((halton(n, 3) - 0.5) * 2) / vh;
    }
    const vp = mul(proj, cam.view);
    const ldr = this.hdr ? 0 : 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.ms);
    gl.viewport(0, 0, vw, vh);
    gl.enable(gl.SCISSOR_TEST); // keeps clears and the resolve to the part being drawn
    gl.scissor(0, 0, vw, vh);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // Backdrop.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progs.bg.p);
    gl.uniform1f(this.progs.bg.u('uAspect'), this.width / this.height);
    gl.uniform1f(this.progs.bg.u('uLDR'), ldr);
    gl.uniform1f(this.progs.bg.u('uExposure'), this.exposure);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Depth pre-pass. The main fragment shader is expensive (nine shadow taps,
    // noise, two environment lobes) and the cutaway stacks shells, structure
    // and 1,620 baskets behind one another, so without this each visible pixel
    // is shaded three to five times. Laying depth down first with a trivial
    // shader means the main pass shades only the surface that ends up visible.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const isFloor = (m) => this.materials[m.material]?.type === 5;
    if (this.depthPrepass) {
      const dp = this.progs.depth;
      gl.useProgram(dp.p);
      gl.uniformMatrix4fv(dp.u('uVP'), false, vp);
      gl.uniform1fv(dp.u('uHide[0]'), this.hidden);
      gl.colorMask(false, false, false, false);
      for (const m of this.meshes) if (this.materials[m.material] && !isFloor(m)) this._draw(m);
      gl.colorMask(true, true, true, true);
    }

    // Scene.
    const pr = this.progs.main;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u('uVP'), false, vp);
    gl.uniform3fv(pr.u('uCam'), cam.pos);
    gl.uniform3fv(pr.u('uKeyDir'), this.keyLight.dir);
    gl.uniform3f(pr.u('uKeyCol'), 2.45, 2.34, 2.18);
    gl.uniform3fv(pr.u('uRimDir'), RIM_DIR);
    gl.uniform3f(pr.u('uRimCol'), 0.55, 0.68, 0.9);
    gl.uniform3fv(pr.u('uStripDir'), STRIP_DIR);
    gl.uniformMatrix4fv(pr.u('uKeyM'), false, this.keyLight.biasM);
    gl.uniform1f(pr.u('uKeyTexel'), 1 / this.keySize);
    gl.uniform1f(pr.u('uKeyBias'), 0.035 / this.keyLight.range);
    const sm = this._skyM, sd = this._skyD, sb = this._skyB;
    for (let i = 0; i < 4; i++) {
      sm.set(this.skyLights[i].biasM, i * 16);
      sd.set(this.skyLights[i].dir, i * 3);
      sb[i] = 0.12 / this.skyLights[i].range;
    }
    gl.uniformMatrix4fv(pr.u('uSkyM[0]'), false, sm);
    gl.uniform3fv(pr.u('uSkyDir[0]'), sd);
    gl.uniform1fv(pr.u('uSkyBias[0]'), sb);
    gl.uniform1f(pr.u('uLDR'), ldr);
    gl.uniform1f(pr.u('uExposure'), this.exposure);
    gl.uniform1f(pr.u('uSel'), this.selected > 0 ? this.selected : -1);
    gl.uniform1fv(pr.u('uHide[0]'), this.hidden);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.keyTex);
    gl.uniform1i(pr.u('uKeyMap'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.skyTex);
    gl.uniform1i(pr.u('uSkyMap'), 1);

    const drawMesh = (m) => {
      const mat = this.materials[m.material];
      if (!mat) return;
      gl.uniform3fv(pr.u('uBase'), mat.base);
      gl.uniform3fv(pr.u('uCut'), mat.cut);
      gl.uniform3fv(pr.u('uEmis'), mat.emis);
      gl.uniform1f(pr.u('uRough'), mat.rough);
      gl.uniform1f(pr.u('uMetal'), mat.metal);
      gl.uniform1f(pr.u('uCoat'), mat.coat);
      gl.uniform1i(pr.u('uType'), mat.type);
      this._draw(m);
    };
    // The floor fades into the backdrop, so it is blended first.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const m of this.meshes) if (isFloor(m)) drawMesh(m);
    gl.disable(gl.BLEND);
    // Opaque depth is already final after the pre-pass, so it is only tested here.
    gl.depthMask(!this.depthPrepass);
    for (const m of this.meshes) if (!isFloor(m)) drawMesh(m);
    gl.depthMask(true);

    if (this.ghost && this.selected > 0) this._drawGhost(vp);

    // Flow particles (additive).
    if (this.points && this.pointCount > 0) {
      const pp = this.progs.point;
      gl.useProgram(pp.p);
      gl.uniformMatrix4fv(pp.u('uVP'), false, vp);
      gl.uniform1f(pp.u('uPx'), (proj[5] * vh) / 2);
      gl.uniform1f(pp.u('uLDR'), ldr);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.bindVertexArray(this.points.vao);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Resolve MSAA, then blend into the running average. Only the region that
    // was drawn is resolved; the blit's own rectangle bounds it.
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.ms);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.res);
    gl.blitFramebuffer(0, 0, vw, vh, 0, 0, vw, vh, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.acc);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progs.copy.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.resTex);
    gl.uniform1i(this.progs.copy.u('uTex'), 0);
    gl.bindVertexArray(this.emptyVao);
    if (n > 0) {
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, 1 / (n + 1));
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);

    // Tone map to the canvas, stretching the rendered region to fill it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.progs.final.p);
    gl.bindTexture(gl.TEXTURE_2D, t.accTex);
    gl.uniform1i(this.progs.final.u('uTex'), 0);
    gl.uniform1f(this.progs.final.u('uExposure'), this.exposure);
    gl.uniform1f(this.progs.final.u('uLDR'), ldr);
    gl.uniform2f(this.progs.final.u('uUvScale'), vw / this.width, vh / this.height);
    gl.uniform2f(this.progs.final.u('uUvMax'), (vw - 0.5) / this.width, (vh - 0.5) / this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    this._timerEnd();
    this.sample = n + 1;
  }
}
