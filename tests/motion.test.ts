import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { SliceMotion, CENTER_OF_MASS, REST_POSE } from '../src/motion.ts';

function advance(motion: SliceMotion, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 180) motion.step(1 / 180);
}
function grabFront(motion: SliceMotion) {
  const local = new Vector3(0, 0.15, 0.64);
  const world = local.clone().sub(CENTER_OF_MASS).applyQuaternion(motion.orientation).add(motion.body);
  motion.beginGrab(local, world);
}

test('small pulls visibly stretch the gel while keeping the rind planted', () => {
  const motion = new SliceMotion();
  const body = motion.body.clone();
  const orientation = motion.orientation.clone();
  grabFront(motion);
  motion.grabTarget.x += 0.3;
  advance(motion, 0.6);
  assert.ok(motion.gripOffset.length() > 0.2);
  assert.ok(motion.stretch > 0.3);
  assert.ok(motion.body.distanceTo(body) < 0.005);
  assert.ok(motion.orientation.angleTo(orientation) < 0.005);
  assert.ok(motion.height < 0.01);
  motion.releaseGrab();
  advance(motion, 0.25);
  assert.ok(motion.energy > 0.001, 'The released gel should keep wobbling');
  advance(motion, 10);
  assert.ok(motion.energy < 0.001);
  assert.ok(motion.stretch < 0.01);
});

test('quick alternating pulls jiggle on the table without accidentally lifting or flipping', () => {
  const motion = new SliceMotion();
  grabFront(motion);
  const origin = motion.grabTarget.clone();
  let maximumStretch = 0;
  let maximumBend = 0;
  for (let shake = 0; shake < 8; shake++) {
    motion.grabTarget.copy(origin).add(new Vector3(shake % 2 ? -0.28 : 0.28, 0, 0));
    advance(motion, 0.12);
    maximumStretch = Math.max(maximumStretch, motion.stretch);
    maximumBend = Math.max(maximumBend, motion.bend.length());
    assert.ok(motion.height < 0.01);
  }
  assert.ok(maximumStretch > 0.15);
  assert.ok(maximumBend > 0.02);
  assert.equal(motion.tossCount, 0);
  motion.releaseGrab();
  advance(motion, 0.2);
  assert.ok(motion.stretch > 0.01);
});

test('firmness controls how much of a pull stretches the flesh before moving the body', () => {
  const motions = [0, 100].map(firmness => {
    const motion = new SliceMotion();
    motion.firmness = firmness;
    grabFront(motion);
    motion.grabTarget.x += 0.5;
    advance(motion, 1);
    return motion;
  });
  assert.ok(motions[0].gripOffset.length() > motions[1].gripOffset.length() + 0.1);
  assert.ok(motions[1].body.x > motions[0].body.x + 0.1);
});

test('grabbing lifts the actual body, releasing drops it onto the surface', () => {
  const motion = new SliceMotion();
  const startY = motion.body.y;
  grabFront(motion);
  motion.grabTarget.y += 1.4;
  motion.grabTarget.x += 0.4;
  advance(motion, 1.5);
  assert.ok(motion.body.y > startY + 0.5);
  assert.ok(motion.height > 0.2);
  assert.ok(motion.body.x > 0.1);
  motion.releaseGrab();
  advance(motion, 8);
  assert.equal(motion.grabbed, false);
  assert.ok(motion.landings >= 1);
  assert.ok(motion.height < 0.01);
  assert.ok(motion.energy < 0.01);
});

test('either face can settle flat and stays flat instead of returning upright', () => {
  for (const pitch of [1.3, -1.3]) {
    const motion = new SliceMotion();
    motion.beginTurn();
    motion.turnTo(pitch, 0.5);
    motion.endTurn();
    motion.body.y += 0.7;
    advance(motion, 6);
    assert.ok(motion.faceUpness > 0.97);
    assert.ok(motion.height < 0.01);
    const resting = motion.orientation.clone();
    advance(motion, 5);
    assert.ok(resting.angleTo(motion.orientation) < 0.01);
  }
});

test('the little hop has a small tumble rather than a programmed full flip', () => {
  const motion = new SliceMotion();
  assert.equal(motion.toss(), true);
  let rotationTravel = 0;
  let maximumHeight = 0;
  let previous = motion.orientation.clone();
  for (let i = 0; i < 6 * 180; i++) {
    motion.step(1 / 180);
    rotationTravel += previous.angleTo(motion.orientation);
    previous.copy(motion.orientation);
    maximumHeight = Math.max(maximumHeight, motion.height);
  }
  assert.ok(maximumHeight > 0.2 && maximumHeight < 0.6);
  assert.ok(rotationTravel > 0.05 && rotationTravel < Math.PI);
  assert.ok(motion.landings >= 1);
  assert.ok(motion.height < 0.01);
});

test('upright recovery cancels a grab and preserves softness settings', () => {
  const motion = new SliceMotion();
  motion.firmness = 12;
  motion.damping = 60;
  motion.beginTurn();
  motion.turnTo(-1.55, 2.5);
  motion.endTurn();
  advance(motion, 3);
  grabFront(motion);
  motion.standUpright();
  advance(motion, 1.5);
  assert.equal(motion.grabbed, false);
  assert.ok(motion.pose.distanceTo(REST_POSE) < 0.001);
  assert.ok(motion.body.x ** 2 + motion.body.z ** 2 < 0.001);
  assert.ok(motion.height < 0.01);
  assert.equal(motion.firmness, 12);
  assert.equal(motion.damping, 60);
});

test('zero time freezes a falling body and repeated hops cannot stack', () => {
  const motion = new SliceMotion();
  motion.toss();
  advance(motion, 0.2);
  const before = [...motion.body, ...motion.pose, motion.energy];
  motion.step(0);
  assert.deepEqual([...motion.body, ...motion.pose, motion.energy], before);
  assert.equal(motion.toss(), false);
  assert.equal(motion.tossCount, 1);
});

test('fast grabs stay within reach and release does not generate a scripted flip', () => {
  const motion = new SliceMotion();
  grabFront(motion);
  motion.grabTarget.set(99, 99, 99);
  advance(motion, 2);
  assert.ok(Math.abs(motion.body.x) <= 1.6);
  assert.ok(Math.abs(motion.body.z) <= 0.9);
  assert.ok(motion.body.y <= 1.4);
  motion.releaseGrab(true);
  advance(motion, 10);
  assert.ok(motion.height < 0.01);
  assert.equal(motion.tossCount, 0);
  assert.ok(motion.energy < 0.01);
});

test('gel springs remain finite and settle at both slider extremes', () => {
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
