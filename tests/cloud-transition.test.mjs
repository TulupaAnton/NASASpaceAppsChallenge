import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudTransition, getCloudFlightTime, CLOUD_FLIGHT_ENTRY } from '../app/lib/earth/cloudTransition.js';
import { CLOUD_DURATION, CLOUD_EXIT_DURATION } from '../app/lib/earth/cloudVolume.js';
import { FINLAND_FLIGHT_DURATION } from '../app/lib/earth/finlandFlight.js';

function fixture() {
  let covered = 0, completed = 0, reduced = false;
  const transition = createCloudTransition({ onCovered: () => covered++, onComplete: () => completed++, reducedMotion: () => reduced });
  return { transition, get covered() { return covered; }, get completed() { return completed; }, reduce: () => { reduced = true; } };
}

test('cloud handoff waits for a rendered opaque frame, then stays covered until the map is ready', () => {
  const f = fixture();
  assert.equal(f.transition.reveal(), false);
  assert.equal(f.transition.tick(0).strength, 0, 'entry begins without a foreground-cloud pop');
  const opaque = f.transition.tick(CLOUD_DURATION);
  assert.equal(opaque.stage, 'covered'); assert.equal(opaque.occlusion, 1);
  assert.equal(f.covered, 0, 'preparing the map before the opaque draw could expose the scene switch');
  assert.equal(f.transition.reveal(), false);
  f.transition.afterRender(); assert.equal(f.covered, 1);
  f.transition.afterRender(); assert.equal(f.covered, 1);
  const waiting = f.transition.tick(60);
  assert.equal(waiting.stage, 'covered'); assert.equal(waiting.occlusion, 1);
  assert.equal(f.completed, 0, 'a slow map must not make the overlay clear on its own');
  assert.equal(f.transition.reveal(), true);
  const exitStart = f.transition.tick(0);
  assert.deepEqual(exitStart.frame.altitude, opaque.frame.altitude);
  assert.ok(Math.abs(exitStart.frame.travel - opaque.frame.travel) < 1e-12);
  assert.equal(exitStart.occlusion, 1);
  const clear = f.transition.tick(CLOUD_EXIT_DURATION);
  assert.equal(clear.stage, 'done'); assert.equal(clear.occlusion, 0);
  assert.equal(f.completed, 0);
  f.transition.afterRender(); assert.equal(f.completed, 1);
  f.transition.afterRender(); assert.equal(f.completed, 1);
});

test('skip/disposal suppresses pending handoff and completion callbacks', () => {
  const f = fixture(); f.transition.tick(CLOUD_DURATION); f.transition.dispose();
  f.transition.afterRender(); assert.equal(f.covered, 0);
  assert.equal(f.transition.reveal(), false);
  assert.equal(f.completed, 0);
});

test('reduced motion settles both phases while retaining the map-ready handshake', () => {
  const f = fixture(); f.reduce();
  assert.equal(f.transition.tick(0).stage, 'covered');
  f.transition.afterRender(); assert.equal(f.covered, 1);
  assert.equal(f.transition.reveal(), true);
  assert.equal(f.transition.tick(0).stage, 'done');
  f.transition.afterRender(); assert.equal(f.completed, 1);
});

test('the orbital part keeps its pace and the close-up lasts exactly as long as approved cloud entry', () => {
  const entryTime = FINLAND_FLIGHT_DURATION * CLOUD_FLIGHT_ENTRY;
  assert.equal(getCloudFlightTime(entryTime), entryTime);
  assert.equal(getCloudFlightTime(entryTime / 2), entryTime / 2);
  assert.equal(getCloudFlightTime(entryTime + CLOUD_DURATION), FINLAND_FLIGHT_DURATION);
  assert.ok(getCloudFlightTime(entryTime + CLOUD_DURATION / 2) < FINLAND_FLIGHT_DURATION);
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const current = getCloudFlightTime((entryTime + CLOUD_DURATION) * i / 1000);
    assert.ok(current >= previous); assert.ok(current - previous < .01); previous = current;
  }
});
