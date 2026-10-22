import Phaser from 'phaser';
import tuning from '../data/tuning.json';
import type { Vec } from '../world/islandGen';
import type { WalkGrid } from '../world/walkGrid';
import { headingOf, idleFacing, nearestPose, poseFrame, turnToward, walkFacing } from './facing';

const P = tuning.player;
const W = tuning.player.walk;
/** Height of the front pose in image 03; every pose shares this scale. */
const SOURCE_HEIGHT = 310;

/**
 * The castaway. Taps give him a path to follow; WASD or the arrow keys steer
 * him directly. He turns smoothly through image 03's fifteen poses.
 *
 * Each pose is drawn as a body and two legs (split by tools/build_assets.py)
 * so he can step: the legs lift in turn, swing forward and back when he walks
 * sideways, and the body rises a little on each step. Real walk-cycle frames
 * will replace this when the art exists (docs/ASSETS-NEEDED.md).
 */
export class Player {
  /** The castaway as drawn; the camera follows this. */
  readonly view: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Image;
  private legL: Phaser.GameObjects.Image;
  private legR: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image;
  private path: Vec[] = [];
  private facing = 0;
  private targetFacing = 0;
  private idleFor = 0;
  private stepPhase = 0;
  x: number;
  y: number;

  constructor(
    scene: Phaser.Scene,
    start: Vec,
    private walk: WalkGrid,
  ) {
    this.x = start.x;
    this.y = start.y;
    const scale = P.displayHeight / SOURCE_HEIGHT;
    this.shadow = scene.add.image(start.x, start.y, 'soft_shadow').setDisplaySize(96, 30).setAlpha(0.45);
    const part = (): Phaser.GameObjects.Image => scene.add.image(0, 0, 'character', `${poseFrame(0)}_body`).setOrigin(0.5, 0.985);
    this.legR = part();
    this.legL = part();
    this.body = part();
    this.view = scene.add.container(start.x, start.y, [this.legR, this.legL, this.body]).setScale(scale);
    this.facing = this.targetFacing = P.idlePoseRight;
    this.applyPose();
  }

  /** The way he faces, in degrees: 0 toward the camera, 90 right, 180 away. */
  get heading(): number {
    return this.facing;
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  walkTo(target: Vec): void {
    this.path = this.walk.findPath({ x: this.x, y: this.y }, target) ?? [];
  }

  stop(): void {
    this.path = [];
  }

  /** dir: keyboard direction, (0,0) when no key is held. */
  update(dt: number, dir: Vec): void {
    let vx = 0;
    let vy = 0;
    if (dir.x || dir.y) {
      this.path = [];
      const len = Math.hypot(dir.x, dir.y);
      vx = (dir.x / len) * P.walkSpeed;
      vy = (dir.y / len) * P.walkSpeed;
    } else if (this.path.length) {
      const next = this.path[0];
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= P.arriveDistance) {
        this.path.shift();
      } else {
        const step = Math.min(dist, P.walkSpeed * dt) / dt;
        vx = (dx / dist) * step;
        vy = (dy / dist) * step;
      }
    }

    let moved = false;
    if (vx || vy) {
      moved = this.tryMove(vx * dt, vy * dt);
      if (!moved && this.path.length) this.path = [];
    }

    if (moved) {
      this.idleFor = 0;
      this.targetFacing = walkFacing(headingOf(vx, vy));
      this.stepPhase += dt * P.stepsPerSecond * Math.PI;
    } else {
      this.idleFor += dt;
      if (this.idleFor >= P.idleTurnDelay && this.idleFor - dt < P.idleTurnDelay) this.targetFacing = idleFacing(this.facing);
      // Finish the step so both feet come down.
      const s = Math.sin(this.stepPhase);
      if (Math.abs(s) > 0.02) this.stepPhase += dt * P.stepsPerSecond * Math.PI * (s > 0 ? 1 : -1) * 0.5;
      else this.stepPhase = 0;
    }

    this.facing = turnToward(this.facing, this.targetFacing, P.turnSpeedDegPerSec * dt);
    this.applyPose();
  }

  /** Move with sliding along walls: try the full step, then each axis. */
  private tryMove(dx: number, dy: number): boolean {
    const w = this.walk;
    if (w.walkable(this.x + dx, this.y + dy)) {
      this.x += dx;
      this.y += dy;
      return true;
    }
    if (dx && w.walkable(this.x + dx, this.y)) {
      this.x += dx;
      return true;
    }
    if (dy && w.walkable(this.x, this.y + dy)) {
      this.y += dy;
      return true;
    }
    return false;
  }

  private applyPose(): void {
    const frame = poseFrame(nearestPose(this.facing));
    this.body.setFrame(`${frame}_body`);
    this.legL.setFrame(`${frame}_legl`);
    this.legR.setFrame(`${frame}_legr`);

    // One full cycle is two steps: the left leg lifts on the first half, the
    // right on the second. Walking sideways the legs also swing, forward
    // being the way he faces. Units are image-03 pixels (the view is scaled).
    const s = Math.sin(this.stepPhase);
    const c = Math.cos(this.stepPhase);
    const side = Math.sin(Phaser.Math.DegToRad(this.facing));
    this.legL.setPosition(c * W.legSwing * side, -Math.max(0, s) * W.legLift);
    this.legR.setPosition(-c * W.legSwing * side, -Math.max(0, -s) * W.legLift);
    this.body.setY(-Math.abs(s) * W.bodyRise);

    this.view.setPosition(this.x, this.y).setDepth(this.y);
    this.shadow.setPosition(this.x, this.y - 2).setDepth(this.y - 0.5);
  }
}
