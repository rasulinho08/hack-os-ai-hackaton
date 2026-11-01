/**
 * How the 3D mark moves. Pure functions, no DOM, so they are tested on
 * their own (src/__tests__/logo3dMotion.test.ts) and shared by the live
 * scene and the brand-still export.
 *
 * Angles are radians. `rx` tips the face down (positive) or up, `ry` turns it
 * to the right (positive) or left, `rz` rolls it.
 */

export interface Pose {
  rx: number;
  ry: number;
  rz: number;
}

/** Face-on: exactly what the flat SVG shows, so the hand-over is seamless. */
export const FRONT_POSE: Pose = { rx: 0, ry: 0, rz: 0 };

/** The resting three-quarter view: used for reduced motion and the stills. */
export const STILL_POSE: Pose = { rx: 0.16, ry: -0.38, rz: -0.035 };

/** How long the mark takes to come alive from face-on. */
export const INTRO_SECONDS = 1.6;

const TAU = Math.PI * 2;

/**
 * The slow idle drift: a figure-of-eight around the resting pose, built from
 * periods that do not divide each other so it never visibly repeats.
 */
export function idlePose(t: number): Pose {
  return {
    rx: STILL_POSE.rx + 0.07 * Math.sin((TAU * t) / 9.5 + 0.8),
    ry: STILL_POSE.ry + 0.24 * Math.sin((TAU * t) / 13),
    rz: STILL_POSE.rz + 0.025 * Math.sin((TAU * t) / 11 + 1.7),
  };
}

export function easeOutCubic(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 1 - (1 - c) ** 3;
}

export function easeInOutCubic(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function mixPose(a: Pose, b: Pose, k: number): Pose {
  return { rx: a.rx + (b.rx - a.rx) * k, ry: a.ry + (b.ry - a.ry) * k, rz: a.rz + (b.rz - a.rz) * k };
}

export function addPose(a: Pose, b: Pose): Pose {
  return { rx: a.rx + b.rx, ry: a.ry + b.ry, rz: a.rz + b.rz };
}

/** Largest tilt the pointer can add, so the mark leans and never spins. */
export const POINTER_TILT = { x: 0.16, y: 0.26 };

/**
 * The tilt that turns the face toward the pointer. The pointer's offset from
 * the mark is measured against half the viewport and clamped, so the mark
 * leans the same amount wherever on the page it sits.
 */
export function pointerTilt(
  pointer: { x: number; y: number },
  center: { x: number; y: number },
  viewport: { width: number; height: number },
): Pose {
  const nx = clamp((pointer.x - center.x) / Math.max(1, viewport.width / 2), -1, 1);
  const ny = clamp((pointer.y - center.y) / Math.max(1, viewport.height / 2), -1, 1);
  return { rx: ny * POINTER_TILT.x, ry: nx * POINTER_TILT.y, rz: -nx * ny * 0.04 };
}

/**
 * Frame-rate independent exponential approach: after one second the gap has
 * shrunk to e^-rate of what it was, whether that second took 30 frames or 120.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * Math.max(0, dt));
}

export function dampPose(current: Pose, target: Pose, rate: number, dt: number): Pose {
  return {
    rx: damp(current.rx, target.rx, rate, dt),
    ry: damp(current.ry, target.ry, rate, dt),
    rz: damp(current.rz, target.rz, rate, dt),
  };
}

/** The pose at time `t` seconds after the scene started. */
export function livePose(t: number, tilt: Pose): Pose {
  const settled = addPose(idlePose(t), tilt);
  return mixPose(FRONT_POSE, settled, easeInOutCubic(t / INTRO_SECONDS));
}

/**
 * Object-to-world rotation (column-major, as WebGL wants it): roll, then
 * turn, then tip, i.e. R = Rx * Ry * Rz.
 */
export function rotationMatrix({ rx, ry, rz }: Pose): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // Row-major entries of Rx * Ry * Rz.
  const m00 = cy * cz, m01 = -cy * sz, m02 = sy;
  const m10 = sx * sy * cz + cx * sz, m11 = -sx * sy * sz + cx * cz, m12 = -sx * cy;
  const m20 = -cx * sy * cz + sx * sz, m21 = cx * sy * sz + sx * cz, m22 = cx * cy;
  return new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]);
}

/** The inverse of a rotation is its transpose. */
export function transpose3(m: Float32Array): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
