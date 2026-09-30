import { MathUtils, Vector2, Vector3 } from 'three';

export const DEFAULT_FIRMNESS = 35;
export const DEFAULT_DAMPING = 22;
export const REST_POSE = new Vector3(0.1, 0.62, 0.12);

/** Springs for the gel, plus a bounded ballistic toss that always lands in reach. */
export class SliceMotion {
  readonly offset = new Vector3();
  readonly velocity = new Vector3();
  readonly pull = new Vector3();
  readonly bend = new Vector2();
  readonly bendVelocity = new Vector2();
  readonly pose = REST_POSE.clone();
  readonly poseTarget = REST_POSE.clone();
  firmness = DEFAULT_FIRMNESS;
  damping = DEFAULT_DAMPING;
  height = 0;
  sideways = 0;
  airborne = false;
  tossCount = 0;
  landings = 0;
  private elapsed = 0;
  private duration = 0;
  private launchSpeed = 0;
  private turnDirection = 1;
  private lateralSpeed = 0;
  private launchPose = REST_POSE.clone();

  step(dt: number) {
    if (dt <= 0) return;
    // Small integration steps remain stable at either slider extreme and low frame rates.
    const steps = Math.ceil(dt / (1 / 120));
    const sub = dt / steps;
    for (let step = 0; step < steps; step++) {
      const stiffness = 12 + this.firmness * 0.55;
      const damping = 1.1 + this.damping * 0.11;
      this.velocity.x += (this.pull.x - this.offset.x) * stiffness * sub;
      this.velocity.y += (this.pull.y - this.offset.y) * stiffness * sub;
      this.velocity.z += (this.pull.z - this.offset.z) * stiffness * sub;
      this.velocity.multiplyScalar(Math.exp(-damping * sub));
      this.offset.addScaledVector(this.velocity, sub);

      const softness = 1 - this.firmness / 140;
      const flipFlex = this.airborne ? Math.sin(this.elapsed / this.duration * Math.PI * 2) * 12 * softness : 0;
      this.bendVelocity.x += (-this.bend.x * 20 - this.bendVelocity.x * (2 + damping * 0.5) + this.velocity.z * 1.4 + flipFlex) * sub;
      this.bendVelocity.y += (-this.bend.y * 24 - this.bendVelocity.y * (2 + damping * 0.5) - this.velocity.x * 1.2) * sub;
      this.bend.addScaledVector(this.bendVelocity, sub);
      this.bend.clampScalar(-0.85, 0.85);

      if (this.airborne) {
        this.elapsed = Math.min(this.elapsed + sub, this.duration);
        const progress = this.elapsed / this.duration;
        this.height = Math.max(0, this.launchSpeed * this.elapsed - 6 * this.elapsed * this.elapsed);
        this.sideways = Math.sin(progress * Math.PI) * this.lateralSpeed;
        this.pose.copy(this.launchPose);
        this.pose.x += this.turnDirection * Math.PI * 2 * progress;
        this.pose.z += Math.sin(progress * Math.PI) * this.lateralSpeed * 0.5;
        if (progress >= 1) {
          this.airborne = false;
          this.height = this.sideways = 0;
          // A full flip returns to the same pose without unwinding in reverse.
          this.pose.copy(this.launchPose);
          this.poseTarget.copy(this.launchPose);
          this.velocity.y -= this.launchSpeed * 0.7;
          this.bendVelocity.x += this.turnDirection * this.launchSpeed * 0.8;
          this.landings++;
        }
      } else {
        this.pose.x = MathUtils.damp(this.pose.x, this.poseTarget.x, 10, sub);
        this.pose.y = MathUtils.damp(this.pose.y, this.poseTarget.y, 10, sub);
        this.pose.z = MathUtils.damp(this.pose.z, this.poseTarget.z, 10, sub);
      }
    }
  }

  nudge(strength = 1) {
    this.velocity.add(new Vector3((Math.random() > 0.5 ? 1 : -1) * 5 * strength, 2.5 * strength, 3.5 * strength));
    this.bendVelocity.x += 1.8 * strength;
  }

  toss(horizontal = 0, direction = 1) {
    if (this.airborne) return false;
    this.pull.set(0, 0, 0);
    this.launchPose.copy(this.pose);
    this.elapsed = 0;
    this.launchSpeed = 4.1;
    this.duration = this.launchSpeed / 6;
    this.turnDirection = direction;
    this.lateralSpeed = MathUtils.clamp(horizontal, -0.3, 0.3);
    this.airborne = true;
    this.tossCount++;
    this.velocity.z -= 2;
    this.bendVelocity.x -= direction * 2.4;
    return true;
  }

  standUpright() {
    this.airborne = false;
    this.height = this.sideways = 0;
    this.pull.set(0, 0, 0);
    this.velocity.multiplyScalar(0.25);
    this.bendVelocity.multiplyScalar(0.25);
    // Choose the nearest equivalent angles, even after multiple turns.
    for (const axis of ['x', 'y', 'z'] as const) {
      this.pose[axis] = REST_POSE[axis] + MathUtils.euclideanModulo(this.pose[axis] - REST_POSE[axis] + Math.PI, Math.PI * 2) - Math.PI;
    }
    this.poseTarget.copy(REST_POSE);
  }

  reset() {
    this.offset.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.pull.set(0, 0, 0);
    this.bend.set(0, 0);
    this.bendVelocity.set(0, 0);
    this.pose.copy(REST_POSE);
    this.poseTarget.copy(REST_POSE);
    this.height = this.sideways = 0;
    this.airborne = false;
    this.tossCount = this.landings = 0;
  }

  get energy() {
    const flight = this.airborne ? (this.launchSpeed - 12 * this.elapsed) ** 2 : 0;
    return (this.velocity.lengthSq() + this.bendVelocity.lengthSq() * 0.1 + flight) * 0.028;
  }
}
