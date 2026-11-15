import { CLOUD_DURATION, CLOUD_EXIT_DURATION, getCloudFrame, getCloudExitFrame } from './cloudVolume.js';
import { FINLAND_FLIGHT_DURATION } from './finlandFlight.js';

export const CLOUD_FLIGHT_ENTRY = .6;
const entrySeconds = FINLAND_FLIGHT_DURATION * CLOUD_FLIGHT_ENTRY;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (value, start, end) => { const t = clamp((value - start) / (end - start)); return t * t * (3 - 2 * t); };

// Preserve the original orbit, then spread its close-up across cloud entry.
export function getCloudFlightTime(elapsed) {
  return elapsed <= entrySeconds ? Math.max(0, elapsed)
    : Math.min(FINLAND_FLIGHT_DURATION, entrySeconds + (elapsed - entrySeconds)
      * (FINLAND_FLIGHT_DURATION - entrySeconds) / CLOUD_DURATION);
}

export function createCloudTransition({ onCovered, onComplete, reducedMotion }) {
  let stage = 'entering', elapsed = 0, coveredNotified = false, completedNotified = false, disposed = false;
  return {
    tick(delta) {
      if (!disposed && (stage === 'entering' || stage === 'exiting')) {
        const duration = stage === 'entering' ? CLOUD_DURATION : CLOUD_EXIT_DURATION;
        elapsed = reducedMotion() ? duration : Math.min(duration, elapsed + Math.max(0, delta));
        if (elapsed === duration) stage = stage === 'entering' ? 'covered' : 'done';
      }
      if (stage === 'entering') {
        const p = elapsed / CLOUD_DURATION;
        return { stage, frame: getCloudFrame(p), strength: smooth(p, 0, .2), occlusion: smooth(p, .85, 1) };
      }
      if (stage === 'covered') return { stage, frame: getCloudFrame(1), strength: 1, occlusion: 1 };
      const p = stage === 'done' ? 1 : elapsed / CLOUD_EXIT_DURATION;
      return { stage, frame: getCloudExitFrame(p), strength: 1, occlusion: 1 - smooth(p, 0, .15) };
    },
    // Notify only after the opaque frame has actually reached the renderer.
    afterRender() {
      if (disposed) return;
      if (stage === 'covered' && !coveredNotified) { coveredNotified = true; onCovered(); }
      if (stage === 'done' && !completedNotified) { completedNotified = true; onComplete(); }
    },
    reveal() {
      if (disposed || stage !== 'covered' || !coveredNotified) return false;
      stage = 'exiting'; elapsed = 0; return true;
    },
    dispose() { disposed = true; },
  };
}
