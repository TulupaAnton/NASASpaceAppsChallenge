import { CLOUD_DURATION, CLOUD_EXIT_DURATION, getCloudFrame, getCloudExitFrame } from './cloudVolume.js';
import { createCloudRenderer } from './createCloudRenderer.js';

export function mountCloudImmersion(host, { onReady, onStage, onError }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let ready = false, active = false, elapsed = 0, lastTime, windTime = 0, exiting = false;
  const renderer = createCloudRenderer(host, { groundPhoto: true, onError,
    onReady: () => { ready = true; onReady(); onStage('ready'); },
  });
  function start() {
    if (!ready || active) return;
    exiting = false; elapsed = 0; lastTime = undefined; active = true;
    host.dataset.cloudStage = 'entering'; onStage('entering');
  }
  function exit() {
    if (!ready || active || exiting || elapsed < CLOUD_DURATION) return;
    exiting = true; elapsed = 0; lastTime = undefined; active = true;
    host.dataset.cloudStage = 'exiting'; onStage('exiting');
  }
  const visibilityChanged = () => { lastTime = undefined; };
  document.addEventListener('visibilitychange', visibilityChanged);
  renderer.setAnimationLoop(time => {
    const delta = lastTime === undefined ? 0 : Math.max(0, (time - lastTime) / 1000); lastTime = time;
    if (!ready || document.hidden) { lastTime = undefined; return; }
    if (!motion.matches) windTime += Math.min(delta, .05);
    if (active) {
      const duration = exiting ? CLOUD_EXIT_DURATION : CLOUD_DURATION;
      elapsed = motion.matches ? duration : Math.min(duration, elapsed + delta);
      if (elapsed === duration) {
        active = false;
        const stage = exiting ? 'outside' : 'inside';
        host.dataset.cloudStage = stage; onStage(stage);
      }
    }
    const frame = exiting ? getCloudExitFrame(elapsed / CLOUD_EXIT_DURATION) : getCloudFrame(elapsed / CLOUD_DURATION);
    host.dataset.cloudProgress = frame.progress.toFixed(4);
    renderer.render(frame, windTime, { exitView: exiting });
  });
  return { start, exit, dispose() {
    ready = false; renderer.dispose();
    document.removeEventListener('visibilitychange', visibilityChanged);
  } };
}
