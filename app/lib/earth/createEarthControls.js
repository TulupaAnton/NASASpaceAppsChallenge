import { TOUCH,                        } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createEarthControls(camera                   , element             ) {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.zoomToCursor = false;
  controls.zoomSpeed = 0.6;
  controls.minDistance = 1.3;
  controls.maxDistance = 12;
  controls.target.set(0, 0, 0);
  controls.touches.TWO = TOUCH.DOLLY_ROTATE;
  controls.rotateSpeed = 0.35;

  // OrbitControls skips its wheel handler during a drag. Keep browser pinch/pan
  // out of the canvas even then, without disabling browser keyboard zoom.
  const preventBrowserGesture = (event            ) => event.preventDefault();
  element.addEventListener('wheel', preventBrowserGesture, { passive: false });

  return {
    controls,
    dispose() {
      element.removeEventListener('wheel', preventBrowserGesture);
      controls.dispose();
    },
  };
}
