import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudNoise, getCloudFrame, getCloudExitFrame, cloudVisibility, cloudVisibilityAtFrame, CLOUD_BOTTOM, CLOUD_TOP } from '../app/lib/earth/cloudVolume.js';

const volume = createCloudNoise();

test('cloud flight starts above the bank, descends without jumps and stops inside it', () => {
  const first = getCloudFrame(0), last = getCloudFrame(1);
  assert.ok(first.altitude > CLOUD_TOP);
  assert.ok(last.altitude > CLOUD_BOTTOM && last.altitude < CLOUD_TOP);
  let previous = first;
  for (let i = 1; i <= 1000; i++) {
    const frame = getCloudFrame(i / 1000);
    assert.ok(frame.altitude <= previous.altitude);
    assert.ok(frame.travel >= previous.travel);
    assert.ok(previous.altitude - frame.altitude < .01);
    assert.ok(frame.travel - previous.travel < .01);
    previous = frame;
  }
  assert.ok(first.altitude - getCloudFrame(.001).altitude < 1e-6, 'the camera accelerates from rest');
  assert.ok(getCloudFrame(.999).altitude - last.altitude < 1e-6, 'the camera settles without a hard stop');
});

test('the initial cloud field has gaps but the immersed frame hides the ground across laptop aspect ratios', () => {
  let initialMaximum = 0;
  for (const aspect of [1.5, 16 / 9, 2.1]) {
    for (const x of [-1, -.5, 0, .5, 1]) {
      for (const y of [-1, -.5, 0, .5, 1]) {
        initialMaximum = Math.max(initialMaximum, cloudVisibility(volume, 0, x, y, aspect));
        const finalVisibility = cloudVisibility(volume, 1, x, y, aspect);
        assert.ok(finalVisibility < .001, `ground visible at ${aspect}, ${x}, ${y}: ${finalVisibility}`);
      }
    }
  }
  assert.ok(initialMaximum > .5, 'the scene starts with a visible ground reference through gaps');
});

test('replays share identical density noise and clamped camera endpoints', () => {
  assert.deepEqual(createCloudNoise(8), createCloudNoise(8));
  assert.deepEqual(getCloudFrame(-1), getCloudFrame(0));
  assert.deepEqual(getCloudFrame(2), getCloudFrame(1));
});

test('exit continues from the immersion endpoint and descends smoothly below the cloud bank', () => {
  const entryEnd = getCloudFrame(1), exitStart = getCloudExitFrame(0), exitEnd = getCloudExitFrame(1);
  assert.equal(exitStart.altitude, entryEnd.altitude);
  assert.ok(Math.abs(exitStart.travel - entryEnd.travel) < 1e-12);
  assert.ok(exitEnd.altitude < CLOUD_BOTTOM);
  let previous = exitStart;
  for (let i = 1; i <= 1000; i++) {
    const frame = getCloudExitFrame(i / 1000);
    assert.ok(frame.altitude <= previous.altitude);
    assert.ok(previous.altitude - frame.altitude < .006);
    assert.ok(frame.travel >= previous.travel);
    previous = frame;
  }
});

test('exit progressively restores visibility and leaves the entire sampled frame clear', () => {
  const middle = cloudVisibilityAtFrame(volume, getCloudExitFrame(.5), 0, 0);
  assert.ok(middle > .01 && middle < .99, 'the ground emerges through partial cloud cover');
  for (const aspect of [1.5, 16 / 9, 2.1]) {
    for (const x of [-1, -.5, 0, .5, 1]) {
      for (const y of [-1, -.5, 0, .5, 1]) {
        assert.equal(cloudVisibilityAtFrame(volume, getCloudExitFrame(1), x, y, aspect), 1);
      }
    }
  }
});
