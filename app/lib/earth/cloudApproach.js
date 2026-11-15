import * as THREE from 'three';

export const CLOUD_APPROACH_DURATION = 7.5 / 1.5;
// An existing bright cloud texel above northern Finland, not a new cloud bank.
export const CLOUD_APPROACH_TARGET = { longitude: 28.212890625, latitude: 68.291015625 };
export const CLOUD_APPROACH_CLEARANCE = .0006;
export const CLOUD_DEPARTURE_DURATION = 4.5 / 1.5;
export const CLOUD_DEPARTURE_RADIUS = .9948;

export function createCloudApproach({ camera, clouds, reducedMotion, onProgress, onComplete, target: location = CLOUD_APPROACH_TARGET }) {
  clouds.updateWorldMatrix(true, false);
  const lon = THREE.MathUtils.degToRad(location.longitude);
  const lat = THREE.MathUtils.degToRad(location.latitude);
  const target = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
    .multiplyScalar(1 + CLOUD_APPROACH_CLEARANCE).applyMatrix4(clouds.matrixWorld);
  const cloudRadius = target.length() / (1 + CLOUD_APPROACH_CLEARANCE);
  const startGap = camera.position.length() - cloudRadius;
  const endGap = target.length() - cloudRadius;
  const startRotation = camera.quaternion.clone();
  const north = new THREE.Vector3(0, 1, 0).transformDirection(clouds.matrixWorld);
  const endRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(target, new THREE.Vector3(), north));
  const initialNear = camera.near;
  let elapsed = 0, active = true, firstFrame = true;

  function apply(progress) {
    const turn = THREE.MathUtils.smootherstep(progress, 0, .62);
    const descent = THREE.MathUtils.smootherstep(progress, .16, 1);
    const gap = Math.exp(THREE.MathUtils.lerp(Math.log(startGap), Math.log(endGap), descent));
    camera.quaternion.copy(startRotation).slerp(endRotation, turn);
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camera.position.set(0, 0, 1).applyQuaternion(camera.quaternion).multiplyScalar(cloudRadius + gap);
    camera.near = Math.min(initialNear, Math.max(.00002, gap * .12));
    camera.updateProjectionMatrix();
    onProgress?.(progress, gap);
  }
  function finish() {
    if (!active) return;
    apply(1); active = false; onComplete();
  }
  apply(0);
  if (reducedMotion()) finish();
  return {
    tick(delta) {
      if (!active) return false;
      if (reducedMotion()) { finish(); return false; }
      if (firstFrame) firstFrame = false; else elapsed += Math.max(0, delta);
      const progress = Math.min(1, elapsed / CLOUD_APPROACH_DURATION);
      if (progress === 1) finish(); else apply(progress);
      return active;
    },
    finish,
  };
}

export function createCloudDeparture({ camera, clouds, reducedMotion, onProgress, onComplete }) {
  clouds.updateWorldMatrix(true, false);
  const start = camera.position.clone();
  const end = start.clone().applyMatrix4(clouds.matrixWorld.clone().invert())
    .setLength(CLOUD_DEPARTURE_RADIUS).applyMatrix4(clouds.matrixWorld);
  let elapsed = 0, active = true, firstFrame = true;
  function apply(progress) {
    camera.position.lerpVectors(start, end, THREE.MathUtils.smootherstep(progress, 0, 1));
    camera.near = .00002;
    camera.updateProjectionMatrix();
    onProgress?.(progress);
  }
  function finish() {
    if (!active) return;
    apply(1); active = false; onComplete();
  }
  apply(0);
  if (reducedMotion()) finish();
  return {
    tick(delta) {
      if (!active) return false;
      if (reducedMotion()) { finish(); return false; }
      if (firstFrame) firstFrame = false; else elapsed += Math.max(0, delta);
      const progress = Math.min(1, elapsed / CLOUD_DEPARTURE_DURATION);
      if (progress === 1) finish(); else apply(progress);
      return active;
    },
    finish,
  };
}
