// GLSL ES 3.00 sources for the forward renderer.

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// DEPTH_VS and MAIN_VS must produce bit-identical positions: the main pass
// tests against depth laid down by the depth pre-pass. `invariant` plus the
// same expression (world position first, then the view-projection) guarantees it.
export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in float aFlag;
layout(location=3) in mat4 aInst;
uniform mat4 uVP;
uniform float uHide[64]; // 1 for every part id whose layer is switched off
invariant gl_Position;
void main() {
  vec4 w = aInst * vec4(aPos, 1.0);
  gl_Position = uVP * w;
  if (uHide[int(aFlag * 0.5 + 0.25)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // hidden layer: outside the clip volume
}`;

export const DEPTH_FS = `#version 300 es
precision mediump float;
void main() {}`;

export const MAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aFlag;
layout(location=3) in mat4 aInst;
uniform mat4 uVP;
uniform float uHide[64];
invariant gl_Position;
out vec3 vW;
out vec3 vN;
out vec3 vObj;
flat out float vFlag; // 2 * part id + cut bit; constant across each triangle
void main() {
  vec4 w = aInst * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(aInst) * aNrm;
  vObj = aPos;
  vFlag = aFlag;
  gl_Position = uVP * w;
  if (uHide[int(aFlag * 0.5 + 0.25)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // hidden layer: outside the clip volume
}`;

export const MAIN_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
precision highp sampler2DArrayShadow;

in vec3 vW;
in vec3 vN;
in vec3 vObj;
flat in float vFlag;
out vec4 outColor;

uniform vec3 uCam;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform vec3 uStripDir;
uniform mat4 uKeyM;
uniform sampler2DShadow uKeyMap;
uniform float uKeyTexel;
uniform float uKeyBias;
uniform mat4 uSkyM[4];
uniform vec3 uSkyDir[4];
uniform float uSkyBias[4];
uniform sampler2DArrayShadow uSkyMap;

uniform vec3 uBase;
uniform vec3 uCut;
uniform vec3 uEmis;
uniform float uRough;
uniform float uMetal;
uniform float uCoat;
uniform int uType;
uniform float uLDR;
uniform float uExposure;
uniform float uSel; // id of the selected part, or -1

const float PI = 3.14159265;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Analytic studio environment: a dim cove, one large overhead softbox, a key
// softbox, a cool side strip and a rim light. Roughness widens the edges.
float lobe(vec3 d, vec3 dir, float cosR, float w) {
  return smoothstep(cosR - w, cosR + 0.004 + w * 0.35, dot(d, dir));
}
vec3 envMap(vec3 d, float rough) {
  float w = mix(0.012, 0.9, rough * rough);
  float e = 1.0 / (1.0 + 5.0 * w);
  vec3 c = mix(vec3(0.020, 0.021, 0.024), vec3(0.11, 0.125, 0.15), smoothstep(-0.25 - w, 0.55 + w, d.y));
  float hz = d.y / (0.12 + w);
  c += vec3(0.09, 0.10, 0.12) * exp(-hz * hz);
  float up = max(d.y, 0.02);
  vec2 q = abs(d.xz / up - vec2(0.2, 0.35)) - vec2(1.25, 0.75);
  float box = 1.0 - smoothstep(-0.02 - w * 1.5, 0.02 + w * 1.5, max(q.x, q.y));
  c += vec3(2.2, 2.25, 2.35) * box * e * step(0.0, d.y);
  c += uKeyCol * 1.5 * lobe(d, uKeyDir, 0.955, w) * e;
  c += vec3(1.2, 1.3, 1.5) * lobe(d, uStripDir, 0.972, w) * e;
  c += uRimCol * 2.0 * lobe(d, uRimDir, 0.95, w) * e;
  return c;
}
vec3 irradiance(vec3 n) {
  vec3 c = mix(vec3(0.050, 0.047, 0.044), vec3(0.30, 0.33, 0.38), n.y * 0.5 + 0.5);
  c += vec3(0.15, 0.155, 0.16) * max(dot(n, normalize(vec3(0.2, 1.0, 0.35))), 0.0);
  c += vec3(0.05, 0.055, 0.065) * max(dot(n, uStripDir), 0.0);
  return c;
}

vec3 envBRDF(vec3 F0, float r, float NoV) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1;
  float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + rr.zw;
  return F0 * AB.x + AB.y;
}
vec3 ggx(vec3 N, vec3 V, vec3 L, float r, vec3 F0) {
  float a = max(r * r, 0.002);
  vec3 H = normalize(V + L);
  float NoH = max(dot(N, H), 0.0);
  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 1e-3);
  float VoH = max(dot(V, H), 0.0);
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = a * 0.5;
  float G = 1.0 / ((NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  return D * F * G * 0.25;
}

float shadowKey(vec3 p, vec3 n) {
  vec3 q = (uKeyM * vec4(p + n * 0.05, 1.0)).xyz;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float z = q.z - uKeyBias;
  float t = uKeyTexel * 1.25;
  float s = texture(uKeyMap, vec3(q.xy, z)) * 2.0;
  s += texture(uKeyMap, vec3(q.xy + vec2(t, t * 0.4), z));
  s += texture(uKeyMap, vec3(q.xy + vec2(-t * 0.4, t), z));
  s += texture(uKeyMap, vec3(q.xy + vec2(-t, -t * 0.4), z));
  s += texture(uKeyMap, vec3(q.xy + vec2(t * 0.4, -t), z));
  return s / 6.0;
}

// Sky visibility from four shadowed directions. While the camera rests the
// directions are re-drawn each frame, so the average converges on ambient occlusion.
float skyVisibility(vec3 p, vec3 n) {
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    // A direction the surface faces away from has no weight, so its shadow
    // map is not read at all (about half of the four, on average).
    float w = smoothstep(-0.1, 0.3, dot(n, uSkyDir[i]));
    float s = 1.0;
    if (w > 0.0) {
      vec3 q = (uSkyM[i] * vec4(p + n * 0.22, 1.0)).xyz;
      if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z < 1.0) {
        s = texture(uSkyMap, vec4(q.xy, float(i), q.z - uSkyBias[i]));
      }
    }
    v += mix(1.0, s, w);
  }
  return v * 0.25;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;

  vec3 albedo = uBase;
  float rough = uRough;
  float metal = uMetal;
  vec3 emis = uEmis;
  float alpha = 1.0;
  float flag = floor(vFlag + 0.5);
  float cut = mod(flag, 2.0);
  float pid = floor(flag * 0.5);
  float coatMul = 1.0;

  if (uType == 1 || uType == 2) {
    // Cast concrete: low-frequency mottling, and formwork joints on the shield building.
    float n1 = noise(vW * 0.45) * 0.55 + noise(vW * 2.1) * 0.3 + noise(vW * 9.0) * 0.15;
    albedo *= 0.84 + 0.3 * n1;
    if (uType == 2 && cut < 0.5 && vW.y < 36.0 && vW.y > 1.4) {
      float fy = vW.y / 2.44;
      float dy = min(fract(fy), 1.0 - fract(fy));
      float fwy = fwidth(fy);
      float line = 1.0 - smoothstep(0.004 + fwy * 0.5, 0.010 + fwy * 1.5, dy);
      float fa = atan(vW.x, vW.z) / 0.1309;
      float da = min(fract(fa), 1.0 - fract(fa));
      float fwa = fwidth(fa);
      float vline = (1.0 - smoothstep(0.004 + fwa * 0.5, 0.010 + fwa * 1.5, da)) * step(fwa, 0.4);
      albedo *= 1.0 - 0.13 * max(line, vline * 0.7) * clamp(1.0 - fwy * 6.0, 0.0, 1.0);
    }
  } else if (uType == 3) {
    // Ice basket: perforated galvanised sheet over packed flake ice.
    float u = atan(vObj.x, vObj.z) / (2.0 * PI) * 22.0;
    float v = vObj.y / 0.0434;
    vec2 cell = fract(vec2(u, v + 0.5 * mod(floor(u), 2.0))) - 0.5;
    float fw = max(fwidth(u), fwidth(v));
    float hole = 1.0 - smoothstep(0.31 - fw, 0.31 + fw, length(cell));
    hole = mix(hole, 0.36, clamp(fw * 1.7, 0.0, 1.0));
    float dr = abs(fract(vObj.y / 1.825 + 0.5) - 0.5) * 1.825;
    float band = 1.0 - smoothstep(0.045, 0.06, dr);
    hole *= 1.0 - band;
    if (abs(N.y) > 0.9) hole = 1.0;
    float frost = noise(vW * 3.0);
    vec3 ice = uBase * (0.9 + 0.1 * frost);
    albedo = mix(vec3(0.55, 0.60, 0.65), ice, hole);
    metal = mix(0.8, 0.0, hole);
    rough = mix(0.4, 0.6, hole);
    emis = uEmis * hole;
  } else if (uType == 6) {
    // Steel shell: dark exterior paint, pale protective coating on the inside face.
    vec3 fromAxis = vW - vec3(0.0, min(vW.y, 35.5), 0.0);
    if (dot(normalize(vN), fromAxis) < 0.0) {
      albedo = vec3(0.62, 0.66, 0.66);
      rough = 0.62;
      coatMul = 0.0;
    }
    if (cut < 0.5 && vW.y < 35.5) {
      // Welded plate courses: a seam every 2.75 m of height, with the vertical
      // seams of alternate courses staggered.
      float cy = vW.y / 2.75;
      float dy = min(fract(cy), 1.0 - fract(cy));
      float fwy = fwidth(cy);
      float ca = atan(vW.x, vW.z) / 0.1309 + 0.5 * mod(floor(cy), 2.0);
      float da = min(fract(ca), 1.0 - fract(ca));
      float fwa = fwidth(ca);
      float seam = max(1.0 - smoothstep(0.003 + fwy * 0.5, 0.008 + fwy * 1.5, dy),
                       (1.0 - smoothstep(0.003 + fwa * 0.5, 0.008 + fwa * 1.5, da)) * step(fwa, 0.4));
      seam *= clamp(1.0 - fwy * 6.0, 0.0, 1.0);
      albedo *= 1.0 - 0.16 * seam;
      rough = mix(rough, 0.6, seam);
    }
  } else if (uType == 7) {
    // Insulated wall panels: joints between panels, about 0.6 m wide and 2.4 m tall.
    float py = vW.y / 2.44;
    float dy = min(fract(py), 1.0 - fract(py));
    float fwy = fwidth(py);
    float pa = atan(vW.x, vW.z) / 0.0436;
    float da = min(fract(pa), 1.0 - fract(pa));
    float fwa = fwidth(pa);
    float joint = max(1.0 - smoothstep(0.004 + fwy * 0.5, 0.010 + fwy * 1.5, dy),
                      (1.0 - smoothstep(0.02 + fwa * 0.5, 0.05 + fwa * 1.5, da)) * step(fwa, 0.4));
    albedo *= 1.0 - 0.2 * joint * clamp(1.0 - fwy * 6.0, 0.0, 1.0);
  } else if (uType == 5) {
    float dist = length(vW.xz);
    alpha = 1.0 - smoothstep(55.0, 135.0, dist);
    albedo *= 0.94 + 0.12 * noise(vW * 0.6);
  }

  if (cut > 0.5) {
    // Section faces: flat, pale, lightly hatched.
    float h = fract((length(vW.xz) + vW.y) / 0.45);
    float fwh = fwidth((length(vW.xz) + vW.y) / 0.45);
    float hatch = (1.0 - smoothstep(0.06, 0.06 + fwh * 1.5, min(h, 1.0 - h))) * clamp(1.0 - fwh * 3.0, 0.0, 1.0);
    albedo = uCut * (1.0 - 0.10 * hatch);
    rough = 0.85;
    metal = 0.0;
  }

  float NoV = max(dot(N, V), 1e-3);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 diffC = albedo * (1.0 - metal);
  vec3 L = uKeyDir;
  float NoL = max(dot(N, L), 0.0);
  float sh = NoL > 0.0 ? shadowKey(vW, N) : 0.0;
  float av = skyVisibility(vW, N);
  float amb = mix(0.17, 1.0, av);
  float spo = av * av;
  vec3 R = reflect(-V, N);
  // Where the studio is hidden (inside the building) reflections fall back to a
  // dim neutral "room" instead of black. This stands in for bounced light.
  vec3 room = vec3(0.085, 0.088, 0.092) * (0.6 + 0.4 * R.y);

  vec3 col = (diffC + ggx(N, V, L, rough, F0) * PI) * uKeyCol * NoL * sh;
  col += diffC * irradiance(N) * amb;
  col += mix(room, envMap(R, rough), spo) * envBRDF(F0, rough, NoV);
  col += (diffC + F0 * 0.5) * uRimCol * max(dot(N, uRimDir), 0.0) * av * av;

  float coat = uCoat * (1.0 - cut) * coatMul;
  if (coat > 0.0) {
    float Fc = (0.04 + 0.96 * pow(1.0 - NoV, 5.0)) * coat;
    vec3 coatSpec = mix(room, envMap(R, 0.07), spo) + ggx(N, V, L, 0.12, vec3(1.0)) * PI * uKeyCol * NoL * sh;
    col = col * (1.0 - Fc) + coatSpec * Fc;
  }
  col += emis;

  if (abs(pid - uSel) < 0.5) {
    // Selected part: an accent tint that brightens towards grazing angles.
    float rim = pow(1.0 - NoV, 2.0);
    col = mix(col, vec3(0.10, 0.62, 0.78) * (0.5 + 1.3 * rim), 0.4) + vec3(0.012, 0.075, 0.095);
  }

  if (uLDR > 0.5) col = pow(aces(col * uExposure), vec3(1.0 / 2.2));
  outColor = vec4(col, alpha);
}`;

export const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uAspect;
uniform float uLDR;
uniform float uExposure;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 c = mix(vec3(0.034, 0.037, 0.044), vec3(0.010, 0.011, 0.014), smoothstep(0.0, 1.0, vUv.y));
  vec2 p = (vUv - vec2(0.5, 0.40)) * vec2(uAspect, 1.0);
  c += vec3(0.040, 0.047, 0.060) * exp(-dot(p, p) * 2.4);
  if (uLDR > 0.5) c = pow(aces(c * uExposure), vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

export const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() { outColor = vec4(texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`;

export const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uExposure;
uniform float uLDR;
uniform vec2 uUvScale; // rendered fraction of the target (render scale)
uniform vec2 uUvMax;   // last texel centre inside that fraction
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture(uTex, min(vUv * uUvScale, uUvMax)).rgb;
  if (uLDR < 0.5) {
    vec2 p = vUv - 0.5;
    c *= uExposure * (1.0 - 0.42 * dot(p, p));
    c = pow(aces(c), vec3(1.0 / 2.2));
  }
  c += (hash2(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}`;

export const POINT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in float aSize;
uniform mat4 uVP;
uniform float uPx;
out vec4 vCol;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = clamp(aSize * uPx / max(gl_Position.w, 0.1), 1.0, 96.0);
  vCol = aCol;
}`;

export const POINT_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 outColor;
uniform float uLDR;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.75, 1.0, d));
  vec3 c = vCol.rgb * vCol.a * a;
  if (uLDR > 0.5) c *= 0.6;
  outColor = vec4(c, 1.0);
}`;


// Picking: draws part ids for the single pixel under the pointer.
export const PICK_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in float aFlag;
layout(location=3) in mat4 aInst;
uniform mat4 uVP;
uniform float uHide[64];
flat out float vId;
void main() {
  vec4 w = aInst * vec4(aPos, 1.0);
  vId = floor(aFlag * 0.5 + 0.25);
  gl_Position = uVP * w;
  if (uHide[int(aFlag * 0.5 + 0.25)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // hidden layer: outside the clip volume
}`;

export const PICK_FS = `#version 300 es
precision highp float;
flat in float vId;
out vec4 outColor;
void main() { outColor = vec4(vId / 255.0, 0.0, 0.0, 1.0); }`;

// See-through highlight: marks, in the alpha channel, the pixels where the
// selected part lies behind something else, then tints them.
export const GHOST_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in float aFlag;
layout(location=3) in mat4 aInst;
uniform mat4 uVP;
uniform float uHide[64];
uniform float uSel;
void main() {
  vec4 w = aInst * vec4(aPos, 1.0);
  gl_Position = uVP * w;
  float id = floor(aFlag * 0.5 + 0.25);
  // Anything that is not the selected part, or is hidden, is thrown away here.
  if (abs(id - uSel) > 0.5 || uHide[int(id)] > 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

export const FLAT_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;
