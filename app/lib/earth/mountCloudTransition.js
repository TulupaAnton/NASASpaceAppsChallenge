import { createCloudRenderer } from './createCloudRenderer.js';
import { createCloudTransition } from './cloudTransition.js';

export function mountCloudTransition(host, { onCovered, onComplete, onError }) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const transition = createCloudTransition({ onCovered, onComplete, reducedMotion: () => motion.matches });
  let ready = false, lastTime, windTime = 0;
  const renderer = createCloudRenderer(host, { onReady: () => { ready = true; }, onError });
  const visibilityChanged = () => { lastTime = undefined; };
  document.addEventListener('visibilitychange', visibilityChanged);
  renderer.setAnimationLoop(time => {
    const delta = lastTime === undefined ? 0 : Math.max(0, (time - lastTime) / 1000); lastTime = time;
    if (!ready || document.hidden) { lastTime = undefined; return; }
    if (!motion.matches) windTime += Math.min(delta, .05);
    const state = transition.tick(delta);
    host.dataset.cloudStage = state.stage;
    host.dataset.cloudProgress = state.frame.progress.toFixed(4);
    if (renderer.render(state.frame, windTime, state)) transition.afterRender();
    if (state.stage === 'done') renderer.setAnimationLoop(null);
  });
  return {
    reveal: () => transition.reveal(),
    dispose() {
      transition.dispose(); renderer.dispose();
      document.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
