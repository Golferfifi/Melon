import { Euler, MathUtils, Quaternion, Vector2, Vector3 } from 'three';

export const DEFAULT_FIRMNESS = 35;
export const DEFAULT_DAMPING = 22;
export const DEFAULT_TRANSLUCENCY = 72;
export const FLOOR_Y = -1.69;
export const CENTER_OF_MASS = new Vector3(0, -0.42, 0);
export const REST_POSE = new Vector3(0.06, 0.62, 0);
const REST_ROTATION = new Quaternion().setFromEuler(new Euler(...REST_POSE));
const UP = new Vector3(0, 1, 0);
const INVERSE_INERTIA = new Vector3(1.55, 1.7, 1.05);

// A convex contact shell around the rind and slightly domed flesh faces.
const shell: Vector3[] = [];
for (const z of [-0.59, 0.59]) {
  shell.push(new Vector3(0, 1.6, z).sub(CENTER_OF_MASS));
  for (let i = 0; i <= 24; i++) {
    const angle = -0.49 + i / 24 * 0.98;
    shell.push(new Vector3(Math.sin(angle) * 3.105, 1.55 - Math.cos(angle) * 3.105, z).sub(CENTER_OF_MASS));
  }
}
for (const z of [-1, 1]) for (const r of [0.8, 1.4, 2, 2.55]) for (const a of [-0.32, 0, 0.32]) {
  const depth = 0.615 + 0.12 * Math.sin(r / 3.04 * Math.PI) * Math.cos(a / 0.49 * Math.PI / 2);
  shell.push(new Vector3(Math.sin(a) * r, 1.55 - Math.cos(a) * r, depth * z).sub(CENTER_OF_MASS));
}

/** A grabbed rigid body with gravity/contact impulses and a coupled soft gel layer. */
export class SliceMotion {
  readonly offset = new Vector3();
  readonly velocity = new Vector3();
  readonly pull = new Vector3();
  readonly bend = new Vector2();
  readonly bendVelocity = new Vector2();
  readonly pose = REST_POSE.clone();
  readonly orientation = REST_ROTATION.clone();
  readonly body = new Vector3();
  readonly bodyVelocity = new Vector3();
  readonly angularVelocity = new Vector3();
  readonly grabTarget = new Vector3();
  firmness = DEFAULT_FIRMNESS;
  damping = DEFAULT_DAMPING;
  horizontalLimit = 1.6;
  grabbed = false;
  turning = false;
  airborne = false;
  tossCount = 0;
  landings = 0;
  private grabbedPoint = new Vector3();
  private contacts = shell.map(() => new Vector3());
  private assist = 0;
  private sleepTime = 0;
  private sleeping = false;
  private hopCooldown = 0;
  private inverse = new Quaternion();
  private euler = new Euler();
  private temp = new Vector3();
  private torque = new Vector3();
  private impulse = new Vector3();
  private pointVelocity = new Vector3();
  private rotationStep = new Quaternion();

  constructor() { this.reset(); }

  private supportY() {
    let lowest = Infinity;
    for (let i = 0; i < shell.length; i++) {
      this.contacts[i].copy(shell[i]).applyQuaternion(this.orientation);
      lowest = Math.min(lowest, this.contacts[i].y);
    }
    return lowest;
  }

  private inverseInertia(vector: Vector3, result: Vector3) {
    return result.copy(vector).applyQuaternion(this.inverse.copy(this.orientation).invert())
      .multiply(INVERSE_INERTIA).applyQuaternion(this.orientation);
  }

  private applyImpulse(impulse: Vector3, arm: Vector3) {
    this.bodyVelocity.add(impulse);
    this.torque.crossVectors(arm, impulse);
    this.angularVelocity.add(this.inverseInertia(this.torque, this.temp));
  }

  step(dt: number) {
    if (dt <= 0) return;
    const steps = Math.ceil(dt / (1 / 180));
    const sub = dt / steps;
    for (let step = 0; step < steps; step++) {
      this.hopCooldown = Math.max(0, this.hopCooldown - sub);
      if (this.assist > 0) {
        this.assist -= sub;
        this.orientation.slerp(REST_ROTATION, 1 - Math.exp(-12 * sub));
        this.body.x = MathUtils.damp(this.body.x, 0, 9, sub);
        this.body.z = MathUtils.damp(this.body.z, 0, 9, sub);
        this.body.y = MathUtils.damp(this.body.y, FLOOR_Y - this.supportY(), 12, sub);
        this.body.y = Math.max(this.body.y, FLOOR_Y - this.supportY());
        this.bodyVelocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        if (this.assist <= 0) {
          this.orientation.copy(REST_ROTATION);
          this.body.set(0, FLOOR_Y - this.supportY(), 0);
          this.sleeping = true;
        }
      } else if (this.turning) {
        this.body.y = FLOOR_Y - this.supportY();
      } else if (!this.sleeping || this.grabbed) {
        this.bodyVelocity.y -= 11 * sub;
        if (this.grabbed) {
          const arm = this.temp.copy(this.grabbedPoint).applyQuaternion(this.orientation).clone();
          const error = this.grabTarget.clone().sub(this.body).sub(arm);
          this.pointVelocity.crossVectors(this.angularVelocity, arm).add(this.bodyVelocity);
          const force = error.clone().multiplyScalar(95).addScaledVector(this.pointVelocity, -14).clampLength(0, 65);
          this.applyImpulse(force.multiplyScalar(sub), arm);
          this.pull.copy(error).applyQuaternion(this.inverse.copy(this.orientation).invert()).multiplyScalar(0.75).clampLength(0, 0.65);
        }
        this.bodyVelocity.multiplyScalar(Math.exp(-0.32 * sub)).clampLength(0, 5.5);
        this.angularVelocity.multiplyScalar(Math.exp(-(this.grabbed ? 2.5 : 0.65) * sub)).clampLength(0, 3.8);
        this.body.addScaledVector(this.bodyVelocity, sub);
        const speed = this.angularVelocity.length();
        if (speed > 0.00001) {
          this.rotationStep.setFromAxisAngle(this.temp.copy(this.angularVelocity).divideScalar(speed), speed * sub);
          this.orientation.premultiply(this.rotationStep).normalize();
        }
        const lowest = this.supportY();
        const penetration = FLOOR_Y - this.body.y - lowest;
        const touching = penetration > -0.006;
        if (penetration > 0) this.body.y += penetration;
        if (touching) {
          const impact = Math.max(0, -this.bodyVelocity.y);
          if (this.airborne && !this.grabbed && impact > 0.35) {
            this.landings++;
            this.velocity.y -= Math.min(impact, 4) * 0.4;
            this.bendVelocity.x += this.angularVelocity.x * 0.3;
          }
          const contactPoints = this.contacts.filter(point => point.y <= lowest + 0.025);
          for (let pass = 0; pass < 5; pass++) for (const arm of contactPoints) {
            this.pointVelocity.crossVectors(this.angularVelocity, arm).add(this.bodyVelocity);
            if (this.pointVelocity.y >= 0) continue;
            const normalSpeed = this.pointVelocity.y;
            this.torque.crossVectors(arm, UP);
            const denominator = 1 + this.temp.crossVectors(this.inverseInertia(this.torque, this.impulse), arm).y;
            const bounce = normalSpeed < -1.2 ? 0.12 : 0;
            const magnitude = -(1 + bounce) * normalSpeed / denominator;
            this.applyImpulse(this.impulse.set(0, magnitude, 0), arm);
          }
          const friction = Math.exp(-7 * sub);
          this.bodyVelocity.x *= friction;
          this.bodyVelocity.z *= friction;
          this.angularVelocity.multiplyScalar(Math.exp(-2.2 * sub));
          if (!this.grabbed && this.bodyVelocity.lengthSq() + this.angularVelocity.lengthSq() < 0.0015) {
            this.sleepTime += sub;
            if (this.sleepTime > 0.3) {
              this.sleeping = true;
              this.bodyVelocity.set(0, 0, 0);
              this.angularVelocity.set(0, 0, 0);
            }
          } else this.sleepTime = 0;
        }
        this.airborne = !touching;
        // Keep the toy on the visible part of the table, even after a fast release.
        for (const [axis, limit] of [['x', this.horizontalLimit], ['z', 0.9]] as const) {
          if (Math.abs(this.body[axis]) > limit) {
            this.body[axis] = MathUtils.clamp(this.body[axis], -limit, limit);
            this.bodyVelocity[axis] *= -0.15;
          }
        }
        if (this.body.y > 1.4) {
          this.body.y = 1.4;
          this.bodyVelocity.y = Math.min(0, this.bodyVelocity.y);
        }
      }
      this.stepGel(sub);
    }
    this.euler.setFromQuaternion(this.orientation, 'XYZ');
    this.pose.set(this.euler.x, this.euler.y, this.euler.z);
    if (this.assist > 0 || this.sleeping || this.turning) this.airborne = false;
  }

  private stepGel(dt: number) {
    const stiffness = 12 + this.firmness * 0.55;
    const damping = 1.1 + this.damping * 0.11;
    this.velocity.x += (this.pull.x - this.offset.x) * stiffness * dt;
    this.velocity.y += (this.pull.y - this.offset.y) * stiffness * dt;
    this.velocity.z += (this.pull.z - this.offset.z) * stiffness * dt;
    this.velocity.multiplyScalar(Math.exp(-damping * dt));
    this.offset.addScaledVector(this.velocity, dt);
    this.bendVelocity.x += (-this.bend.x * 20 - this.bendVelocity.x * (2 + damping * 0.5) + this.velocity.z * 1.2 - this.angularVelocity.x * 2.5) * dt;
    this.bendVelocity.y += (-this.bend.y * 24 - this.bendVelocity.y * (2 + damping * 0.5) - this.velocity.x * 1.1 + this.angularVelocity.z * 2) * dt;
    this.bend.addScaledVector(this.bendVelocity, dt).clampScalar(-0.6, 0.6);
  }

  beginGrab(localPoint: Vector3, worldPoint: Vector3) {
    this.wake();
    this.grabbed = true;
    this.grabbedPoint.copy(localPoint).sub(CENTER_OF_MASS);
    this.grabTarget.copy(worldPoint);
  }
  releaseGrab(cancelled = false) {
    this.grabbed = false;
    this.pull.set(0, 0, 0);
    if (cancelled) {
      this.bodyVelocity.multiplyScalar(0.2);
      this.angularVelocity.multiplyScalar(0.2);
    }
  }
  beginTurn() { this.wake(); this.turning = true; }
  turnTo(pitch: number, yaw: number) {
    this.orientation.setFromEuler(this.euler.set(pitch, yaw, 0, 'XYZ'));
    this.pose.set(pitch, yaw, 0);
    this.body.y = FLOOR_Y - this.supportY();
    this.bodyVelocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
  }
  endTurn() { this.turning = false; }
  nudge(strength = 1) {
    this.velocity.add(new Vector3(2.5 * strength, 1.5 * strength, 2 * strength));
    this.bendVelocity.x += 1.1 * strength;
  }
  toss(horizontal = 0, direction = 1) {
    if (this.airborne || this.grabbed || this.turning || this.hopCooldown > 0) return false;
    this.wake();
    this.bodyVelocity.set(MathUtils.clamp(horizontal, -0.8, 0.8), 3.1, 0);
    this.angularVelocity.set(0.65 * direction, 0.1, 0);
    this.airborne = true;
    this.hopCooldown = 0.8;
    this.tossCount++;
    return true;
  }
  standUpright() {
    this.releaseGrab(true);
    this.turning = false;
    this.wake();
    this.assist = 0.85;
    this.velocity.multiplyScalar(0.2);
    this.bendVelocity.multiplyScalar(0.2);
  }
  private wake() { this.assist = 0; this.sleeping = false; this.sleepTime = 0; }
  reset() {
    this.orientation.copy(REST_ROTATION);
    this.pose.copy(REST_POSE);
    this.body.set(0, FLOOR_Y - this.supportY(), 0);
    for (const vector of [this.offset, this.velocity, this.pull, this.bodyVelocity, this.angularVelocity]) vector.set(0, 0, 0);
    this.bend.set(0, 0);
    this.bendVelocity.set(0, 0);
    this.airborne = this.grabbed = this.turning = false;
    this.tossCount = this.landings = this.assist = this.hopCooldown = 0;
    this.sleeping = true;
  }
  get height() { return Math.max(0, this.body.y + this.supportY() - FLOOR_Y); }
  get sideways() { return this.body.x; }
  get faceUpness() { return Math.abs(this.temp.set(0, 0, 1).applyQuaternion(this.orientation).y); }
  get energy() { return (this.bodyVelocity.lengthSq() + this.angularVelocity.lengthSq() * 0.5 + this.velocity.lengthSq() + this.bendVelocity.lengthSq() * 0.1) * 0.028; }
}
