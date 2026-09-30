import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SliceMotion, REST_POSE } from '../src/motion.ts';

function advance(motion: SliceMotion, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 120) motion.step(1 / 120);
}

test('a toss rises, completes a flip, lands in reach and leaves a floppy wobble', () => {
  const motion = new SliceMotion();
  assert.equal(motion.toss(), true);
  advance(motion, 0.3);
  assert.ok(motion.height > 0.5);
  assert.ok(motion.pose.x - REST_POSE.x > Math.PI / 2);
  assert.ok(motion.bend.length() > 0.02);
  advance(motion, 0.4);
  assert.equal(motion.airborne, false);
  assert.equal(motion.landings, 1);
  assert.equal(motion.height, 0);
  assert.ok(motion.pose.distanceTo(REST_POSE) < 0.001);
  assert.ok(motion.energy > 0.01);
  advance(motion, 10);
  assert.ok(motion.energy < 0.001);
  assert.ok(motion.offset.length() < 0.01);
  assert.ok(motion.bend.length() < 0.01);
});

test('repeat presses cannot launch the slice out of reach', () => {
  const motion = new SliceMotion();
  motion.toss(999);
  for (let i = 0; i < 60; i++) {
    assert.equal(motion.toss(), false);
    motion.step(1 / 120);
    assert.ok(motion.height < 0.8);
    assert.ok(Math.abs(motion.sideways) <= 0.3);
  }
  advance(motion, 1);
  assert.equal(motion.tossCount, 1);
  assert.equal(motion.landings, 1);
  assert.equal(motion.toss(), true);
});

test('standing upright takes a short turn and preserves softness settings', () => {
  const motion = new SliceMotion();
  motion.firmness = 12;
  motion.damping = 60;
  motion.pose.set(21, -18, 8);
  motion.standUpright();
  for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(motion.pose[axis] - REST_POSE[axis]) <= Math.PI);
  advance(motion, 1.5);
  assert.ok(motion.pose.distanceTo(REST_POSE) < 0.001);
  assert.equal(motion.firmness, 12);
  assert.equal(motion.damping, 60);
});

test('upright cancels a midair flip, while a zero timestep freezes it', () => {
  const motion = new SliceMotion();
  motion.toss();
  advance(motion, 0.2);
  const before = [motion.height, ...motion.pose, ...motion.offset, motion.energy];
  motion.step(0);
  assert.deepEqual([motion.height, ...motion.pose, ...motion.offset, motion.energy], before);
  motion.standUpright();
  advance(motion, 1.5);
  assert.equal(motion.airborne, false);
  assert.equal(motion.height, 0);
  assert.ok(motion.pose.distanceTo(REST_POSE) < 0.001);
});

test('springs stay finite at both slider extremes, including long frame intervals', () => {
  for (const firmness of [0, 100]) for (const damping of [0, 100]) {
    const motion = new SliceMotion();
    motion.firmness = firmness;
    motion.damping = damping;
    motion.pull.set(1.5, 1.3, -1.5);
    for (let i = 0; i < 80; i++) motion.step(0.08);
    assert.ok([...motion.offset, ...motion.velocity, ...motion.bend].every(Number.isFinite));
    assert.ok(motion.offset.length() < 3.5);
    motion.pull.set(0, 0, 0);
    advance(motion, 20);
    assert.ok(motion.energy < 0.001);
  }
});

test('a soft slice deflects more than a firm slice under the same impulse', () => {
  const peak = (firmness: number) => {
    const motion = new SliceMotion();
    motion.firmness = firmness;
    motion.velocity.x = 5;
    let maximum = 0;
    for (let i = 0; i < 120; i++) {
      motion.step(1 / 120);
      maximum = Math.max(maximum, motion.offset.length());
    }
    return maximum;
  };
  assert.ok(peak(0) > peak(100) * 1.5);
});
