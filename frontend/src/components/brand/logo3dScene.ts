/**
 * The 3D HackOS mark, drawn by one fragment shader.
 *
 * No 3D library: the mark is four rounded rectangles on a rounded square, so
 * it is described exactly as a signed distance field and ray-marched — the
 * tile extruded with a rounded bevel, the H raised from its face with a small
 * fillet, a soft studio environment for the gloss, a little light scattered
 * through the thin edges of the red so it reads as translucent, and a soft
 * shadow on the page behind it. The whole module is a few kilobytes and is
 * only fetched, with a dynamic import, once the page is idle and a mark is on
 * screen (see Logo3D.tsx).
 *
 * The geometry matches public/logo.svg unit for unit: on a 64-unit grid the
 * tile is 64 with radius 14, the stems 10 wide, the crossbar 6 high and the
 * cursor block 8 high. Here the tile spans -1..1, so one SVG unit is 1/32.
 */

import {
  FRONT_POSE,
  STILL_POSE,
  dampPose,
  livePose,
  pointerTilt,
  rotationMatrix,
  transpose3,
  type Pose,
} from "./logo3dMotion";

/** Canvas half-size over the tile's half-size: room for the turn and the shadow. */
export const LOGO_FRAME = 1.7;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform mat3 uR;
uniform mat3 uRt;
uniform float uFrame;
uniform float uDark;
uniform float uShadow;
uniform float uGlow;

const float H = 0.17;
const float RB = 0.085;
const float CR = 0.4375;
const float GZ = 0.012;
const float GH = 0.05;
const float DOME = 0.045;
const float FOCAL = 4.6;
const float BOUND = 1.3;
const vec3 RED = vec3(0.753, 0.0, 0.045);
const vec3 KEY = vec3(-0.4211, 0.7488, 0.5117);
const vec3 SHL = vec3(-0.0778, 0.3110, 0.9472);
const float PLANE = -1.05;

float sdRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float slab(float d2, float z, float h, float r) {
  vec2 w = vec2(d2 + r, abs(z) - h + r);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r;
}

float glyph2(vec2 p) {
  float d = sdRR(p - vec2(-0.375, 0.0), vec2(0.15625, 0.53125), 0.0625);
  d = min(d, sdRR(p - vec2(0.0, 0.0), vec2(0.29, 0.09375), 0.0));
  d = min(d, sdRR(p - vec2(0.375, 0.21875), vec2(0.15625, 0.3125), 0.0625));
  return d;
}

float cursor2(vec2 p) {
  return sdRR(p - vec2(0.375, -0.40625), vec2(0.15625, 0.125), 0.0625);
}

float dome(vec2 p) {
  return DOME * max(0.0, 1.0 - 0.45 * dot(p, p));
}

float map(vec3 p, out float m) {
  float b = dome(p.xy);
  float dt = slab(sdRR(p.xy, vec2(1.0), CR), p.z > 0.0 ? max(p.z - b, 0.0) : p.z, H, RB);
  float g = min(glyph2(p.xy), cursor2(p.xy));
  float dg = slab(g, p.z - (H + GZ + b), GH, 0.028);
  float k = 0.022;
  float h = clamp(0.5 + 0.5 * (dg - dt) / k, 0.0, 1.0);
  m = h;
  return mix(dg, dt, h) - k * h * (1.0 - h);
}

float mapD(vec3 p) { float m; return map(p, m); }

bool sphere(vec3 ro, vec3 rd, float r, out vec2 t) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return false;
  h = sqrt(h);
  t = vec2(-b - h, -b + h);
  return true;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(1.0, -1.0) * 0.0006;
  return normalize(e.xyy * mapD(p + e.xyy) + e.yyx * mapD(p + e.yyx) +
                   e.yxy * mapD(p + e.yxy) + e.xxx * mapD(p + e.xxx));
}

float softShadow(vec3 ro, vec3 rd, float k, float pad) {
  vec2 tb;
  if (!sphere(ro, rd, BOUND + pad, tb) || tb.y < 0.0) return 1.0;
  float res = 1.0;
  float t = max(tb.x, 0.02);
  for (int i = 0; i < 40; i++) {
    float h = mapD(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.008, 0.2);
    if (res < 0.002 || t > tb.y) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float ambientOcc(vec3 p, vec3 n) {
  float o = 0.0;
  float s = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.01 + 0.045 * float(i);
    o += (h - mapD(p + n * h)) * s;
    s *= 0.72;
  }
  return clamp(1.0 - 2.4 * o, 0.0, 1.0);
}

float panel(vec3 d, vec3 f, vec2 size, float soft) {
  float z = dot(d, f);
  if (z <= 0.0) return 0.0;
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  if (abs(f.y) > 0.98) r = vec3(1.0, 0.0, 0.0);
  vec3 u = cross(f, r);
  vec2 q = abs(vec2(dot(d, r), dot(d, u)) / z);
  vec2 e = smoothstep(size + soft, size - soft, q);
  return e.x * e.y;
}

vec3 env(vec3 d, float rough) {
  vec3 c = mix(vec3(0.025, 0.026, 0.032), vec3(0.34, 0.35, 0.38), smoothstep(-0.45, 0.85, d.y));
  c += vec3(4.2) * panel(d, normalize(vec3(-0.45, 0.72, 0.53)), vec2(0.42, 0.26), 0.03 + rough);
  vec3 f2 = normalize(vec3(0.0, 0.42, 0.91));
  float g2 = smoothstep(-0.25, 0.35, dot(d, vec3(0.0, 0.91, -0.42)));
  c += vec3(2.6) * g2 * panel(d, f2, vec2(1.2, 0.24), 0.22 + rough);
  c += vec3(1.9, 1.85, 1.8) * panel(d, normalize(vec3(0.95, 0.2, -0.25)), vec2(0.07, 0.9), 0.02 + rough);
  c += vec3(0.5, 0.06, 0.1) * smoothstep(0.1, -0.6, d.y) * 0.35;
  return c;
}

vec3 tonemap(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = 0.72;
  float lt = l < k ? l : k + (1.0 - k) * (1.0 - exp(-(l - k) / (1.0 - k)));
  c *= l > 0.0 ? lt / l : 0.0;
  c = c / max(1.0, max(c.r, max(c.g, c.b)));
  return pow(c, vec3(1.0 / 2.2));
}

vec4 shade(vec3 p, vec3 rdw) {
  float m;
  map(p, m);
  vec3 no = calcNormal(p);
  vec3 n = uR * no;
  vec3 v = -rdw;
  vec3 lo = uRt * KEY;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float sh = softShadow(p + no * 0.012, lo, 12.0, 0.1);
  float occ = ambientOcc(p, no);
  vec3 refl = reflect(rdw, n);
  vec3 hv = normalize(KEY + v);
  float ndh = clamp(dot(n, hv), 0.0, 1.0);

  // The tile: deep, glossy, a little translucent.
  float fT = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  float wrapT = clamp((dot(n, KEY) + 0.35) / 1.35, 0.0, 1.0);
  vec3 pw = uR * p;
  float grad = 1.0 + 0.2 * dot(pw.xy, vec2(-0.49, 0.87)) - 0.06 * length(pw.xy);
  vec3 tile = RED * (1.12 * wrapT * mix(0.45, 1.0, sh) * grad + occ * (0.22 + 0.14 * n.y));
  float inner = mapD(p - no * 0.16);
  float thin = 1.0 - clamp(-inner / 0.16, 0.0, 1.0);
  tile += vec3(1.0, 0.13, 0.24) * thin * thin * (0.3 + 0.7 * wrapT) * 0.7;
  tile += vec3(0.9, 0.05, 0.14) * pow(1.0 - ndv, 2.0) * 0.18;
  tile = mix(tile, env(refl, 0.0), fT * occ);
  tile += vec3(1.0) * pow(ndh, 140.0) * 2.4 * sh;

  // The glyph: satin white porcelain with a red bounce near the face.
  float fG = 0.035 + 0.965 * pow(1.0 - ndv, 5.0);
  float wrapG = clamp((dot(n, KEY) + 0.25) / 1.25, 0.0, 1.0);
  vec3 white = vec3(0.94, 0.935, 0.94);
  vec3 glyph = white * (1.08 * wrapG * mix(0.55, 1.0, sh) * grad + occ * (0.5 + 0.2 * n.y));
  float base = 1.0 - smoothstep(0.0, 0.06, p.z - H - dome(p.xy));
  glyph += RED * 0.42 * base * (1.0 - abs(no.z));
  float isCursor = step(cursor2(p.xy), glyph2(p.xy));
  glyph += vec3(1.0, 0.9, 0.92) * isCursor * uGlow * 0.32;
  glyph = mix(glyph, env(refl, 0.12), fG * 0.6 * occ);
  glyph += vec3(1.0) * pow(ndh, 60.0) * 0.55 * sh;

  vec3 col = mix(glyph, tile, smoothstep(0.25, 0.75, m));
  return vec4(tonemap(col), 1.0);
}

vec4 ground(vec3 row, vec3 rdw, vec2 ndc) {
  if (uShadow < 0.5 || rdw.z >= 0.0) return vec4(0.0);
  float t = (PLANE - row.z) / rdw.z;
  vec3 pw = row + rdw * t;
  float vis = softShadow(uRt * pw, uRt * SHL, 2.2, 0.75);
  float occl = 1.0 - vis;
  float edge = 1.0 - smoothstep(0.78, 0.98, max(abs(ndc.x), abs(ndc.y)));
  occl *= edge;
  float aL = occl * 0.2;
  vec4 lightCol = vec4(vec3(0.12, 0.02, 0.04) * aL, aL);
  float aD = occl * 0.16;
  vec4 darkCol = vec4(vec3(0.85, 0.0, 0.16) * occl * 0.32, aD);
  return mix(lightCol, darkCol, uDark);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float d = H + uFrame * FOCAL;
  vec3 row = vec3(0.0, 0.0, d);
  vec3 rdw = normalize(vec3(ndc / FOCAL, -1.0));
  vec3 ro = uRt * row;
  vec3 rd = uRt * rdw;
  vec2 tb;
  if (sphere(ro, rd, BOUND, tb)) {
    float t = tb.x;
    for (int i = 0; i < 110; i++) {
      vec3 p = ro + rd * t;
      float h = mapD(p);
      if (h < 0.00025 * t) {
        gl_FragColor = shade(p, rdw);
        return;
      }
      t += h;
      if (t > tb.y) break;
    }
  }
  gl_FragColor = ground(row, rdw, ndc);
}
`;

interface Renderer {
  draw(pose: Pose, glow: number): void;
  resize(width: number, height: number): void;
  setDark(dark: boolean): void;
  readonly gl: WebGLRenderingContext;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== "production") console.warn(gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { preserve?: boolean; frame?: number; shadow?: boolean; dark?: boolean },
): Renderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: Boolean(opts.preserve),
    }) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl!.getUniformLocation(prog, name);
  const uRes = u("uRes"), uR = u("uR"), uRt = u("uRt"), uGlow = u("uGlow"), uDark = u("uDark");
  gl.uniform1f(u("uFrame"), opts.frame ?? LOGO_FRAME);
  gl.uniform1f(u("uShadow"), opts.shadow === false ? 0 : 1);
  gl.uniform1f(uDark, opts.dark ? 1 : 0);
  gl.clearColor(0, 0, 0, 0);

  return {
    gl,
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl!.viewport(0, 0, width, height);
      gl!.uniform2f(uRes, width, height);
    },
    setDark(dark) {
      gl!.uniform1f(uDark, dark ? 1 : 0);
    },
    draw(pose, glow) {
      const r = rotationMatrix(pose);
      gl!.uniformMatrix3fv(uR, false, r);
      gl!.uniformMatrix3fv(uRt, false, transpose3(r));
      gl!.uniform1f(uGlow, glow);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    },
    dispose() {
      gl!.deleteProgram(prog);
      gl!.deleteShader(vs);
      gl!.deleteShader(fs);
      gl!.deleteBuffer(buf);
    },
  };
}

export interface LogoSceneOptions {
  reducedMotion: boolean;
  dark: boolean;
  /** Lean toward the pointer (fine pointers only). */
  interactive?: boolean;
  /** Called once the first frame is on the canvas. */
  onReady?: () => void;
  /** Called if the GPU drops the context; the caller shows the flat mark again. */
  onLost?: () => void;
}

export interface LogoScene {
  setDark(dark: boolean): void;
  setReducedMotion(reduced: boolean): void;
  destroy(): void;
}

/** The cursor block breathes, slowly, like a caret waiting for the next key. */
function cursorGlow(t: number) {
  const s = 0.5 + 0.5 * Math.sin((t / 3.6) * Math.PI * 2 - Math.PI / 2);
  return s * s;
}

export function createLogoScene(canvas: HTMLCanvasElement, opts: LogoSceneOptions): LogoScene | null {
  const renderer = createRenderer(canvas, { dark: opts.dark });
  if (!renderer) return null;

  let reduced = opts.reducedMotion;
  let visible = false;
  let raf = 0;
  let last = 0;
  let time = 0;
  let ready = false;
  let destroyed = false;
  let slowFrames = 0;
  let parked = false;
  let lastPose: Pose = { ...FRONT_POSE };
  let sampled = 0;
  let tilt: Pose = { ...FRONT_POSE };
  let target: Pose = { ...FRONT_POSE };
  const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
  const interactive = opts.interactive !== false && finePointer;

  const size = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Below 1.5x the canvas is drawn at twice its size and scaled down, which
    // smooths the edges for free at these small sizes.
    const scale = dpr < 1.5 ? 2 : Math.min(dpr, 2);
    const px = Math.max(16, Math.min(720, Math.round(rect.width * scale)));
    if (canvas.width !== px) renderer.resize(px, px);
  };

  const frame = (now: number) => {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    let pose: Pose;
    let glow = 0;
    if (reduced) {
      pose = STILL_POSE;
    } else if (parked) {
      pose = lastPose;
    } else {
      time += dt;
      tilt = dampPose(tilt, target, 3.2, dt);
      pose = livePose(time, tilt);
      glow = cursorGlow(time);
    }
    renderer.draw(pose, glow);
    lastPose = pose;
    if (!ready) {
      ready = true;
      opts.onReady?.();
    }
    // A GPU that cannot keep up gets one still frame instead of a stutter:
    // a crisp still reads as deliberate, a jerky turn does not.
    if (!reduced && !parked && sampled < 90) {
      sampled++;
      if (sampled > 10 && dt > 0.05) slowFrames++;
      if (sampled === 90 && slowFrames > 48) parked = true;
    }
    if (!reduced && !parked && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (!raf && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  const onPointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    target = pointerTilt(
      { x: e.clientX, y: e.clientY },
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { width: window.innerWidth, height: window.innerHeight },
    );
  };
  const onLeave = () => {
    target = { ...FRONT_POSE };
  };
  const onVisibility = () => {
    if (!document.hidden && visible) kick();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    destroyed = true;
    opts.onLost?.();
  };

  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) kick();
  });
  io.observe(canvas);
  const ro = new ResizeObserver(() => {
    size();
    kick();
  });
  ro.observe(canvas);
  size();
  if (interactive) {
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
  }
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    setDark(dark) {
      renderer.setDark(dark);
      kick();
    },
    setReducedMotion(r) {
      reduced = r;
      kick();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
    },
  };
}

/**
 * One still frame into `canvas` at `size` pixels, kept in the drawing buffer
 * so it can be read back. Used to export the brand stills.
 */
export function renderLogoStill(
  canvas: HTMLCanvasElement,
  { size, pose = STILL_POSE, frame = 1.18, shadow = false, dark = false }: {
    size: number;
    pose?: Pose;
    frame?: number;
    shadow?: boolean;
    dark?: boolean;
  },
): boolean {
  const renderer = createRenderer(canvas, { preserve: true, frame, shadow, dark });
  if (!renderer) return false;
  renderer.resize(size, size);
  renderer.draw(pose, 0);
  renderer.gl.finish();
  return true;
}
