import tuning from '../data/tuning.json';

/**
 * Facing angles, in degrees, as image 03 labels them once its four
 * wrong-way poses are mirrored: 0 faces the camera (down the screen),
 * 90 faces right, 180 faces away (up the screen), 270 faces left.
 */
export const POSES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 225, 240, 270, 300, 315, 330] as const;

const P = tuning.player;

export function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Signed shortest turn from a to b, -180..180. */
export function angleDelta(a: number, b: number): number {
  return wrap360(b - a + 180) - 180;
}

/** Facing angle for a movement vector in screen space (y down). */
export function headingOf(dx: number, dy: number): number {
  return wrap360((Math.atan2(dx, dy) * 180) / Math.PI);
}

/**
 * The angle he should face while walking on a heading. Walking sideways uses
 * the front three-quarter poses so his face shows; only a heading clearly
 * up the screen uses the back poses.
 */
export function walkFacing(heading: number): number {
  const h = wrap360(heading);
  if (Math.abs(angleDelta(h, 180)) <= P.backConeDeg) return h;
  if (h > 0 && h < 180) return Math.min(h, P.sidewaysFrontPoseRight);
  if (h > 180) return Math.max(h, P.sidewaysFrontPoseLeft);
  return h;
}

/** Standing still: turn three-quarters toward the camera on his current side. */
export function idleFacing(current: number): number {
  const a = wrap360(current);
  if (a === 0 || a === 180) return P.idlePoseRight;
  return a < 180 ? P.idlePoseRight : P.idlePoseLeft;
}

/** Turn current toward target by at most maxStep degrees, the short way round. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return wrap360(target);
  return wrap360(current + Math.sign(d) * maxStep);
}

/** The drawn pose nearest to an angle. */
export function nearestPose(angle: number): number {
  let best: number = POSES[0];
  let bestD = Infinity;
  for (const p of POSES) {
    const d = Math.abs(angleDelta(angle, p));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function poseFrame(pose: number): string {
  return `castaway_${String(pose).padStart(3, '0')}`;
}
