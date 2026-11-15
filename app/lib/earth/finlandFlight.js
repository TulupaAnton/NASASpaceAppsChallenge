import * as THREE from 'three';

export const FINLAND_FLIGHT_DURATION = 6 / 1.5;
// Exact camera/basis of the existing satellite image (projection.js), in
// SphereGeometry's x/east, y/north, -z/longitude coordinate convention.
const PHOTO_CAMERA = new THREE.Vector3(.49330378031942257, 1.1758124135301897, -.24273555263058783);
const PHOTO_UP = new THREE.Vector3(-.812794706630921, .4235671131360794, .39994457808841805);
const PHOTO_LENS = .34432761328966527;
const POLAR_SCALE = .996647189335;

export function createFinlandFlight({camera, earth, world, stars, reducedMotion, onProgress, onComplete, timeMapping}) {
  world.updateMatrixWorld(true);
  const orientation = earth.getWorldQuaternion(new THREE.Quaternion());
  const endPosition = PHOTO_CAMERA.clone().applyQuaternion(orientation);
  const endUp = PHOTO_UP.clone().applyQuaternion(orientation);
  const endRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(endPosition, new THREE.Vector3(), endUp));
  const startRotation = camera.quaternion.clone();
  const startRadius = camera.position.length(), endRadius = endPosition.length();
  const startFov = camera.fov, startPolar = world.scale.y;
  const starOpacity = stars.material.opacity;
  let elapsed = 0, active = true, firstFrame = true;

  function apply(progress) {
    const turn = THREE.MathUtils.smootherstep(progress, 0, .68);
    const descent = THREE.MathUtils.smootherstep(progress, .22, 1);
    camera.quaternion.copy(startRotation).slerp(endRotation, turn);
    camera.up.set(0,1,0).applyQuaternion(camera.quaternion);
    // Interpolate altitude logarithmically: approach the surface without a
    // sudden rush at the end. The first part is an orbital alignment.
    const radius = 1 + (startRadius-1)*Math.pow((endRadius-1)/(startRadius-1),descent);
    camera.position.set(0,0,1).applyQuaternion(camera.quaternion).multiplyScalar(radius);
    const endFov = THREE.MathUtils.radToDeg(2*Math.atan(PHOTO_LENS*Math.max(1,(16/9)/camera.aspect)));
    camera.fov = THREE.MathUtils.lerp(startFov,endFov,descent);
    camera.updateProjectionMatrix();
    world.scale.y = THREE.MathUtils.lerp(startPolar,POLAR_SCALE,descent);
    stars.material.opacity = starOpacity*(1-.8*descent);
    onProgress?.(progress);
  }
  function finish() {
    if(!active)return;
    apply(1); active=false; onComplete();
  }
  apply(0);
  if(reducedMotion())finish();
  return {
    tick(delta) {
      if(!active)return false;
      if(reducedMotion()){finish();return false;}
      if(firstFrame)firstFrame=false; else elapsed+=Math.max(0,delta);
      const progress=Math.min(1,(timeMapping ? timeMapping(elapsed) : elapsed)/FINLAND_FLIGHT_DURATION);
      if(progress===1)finish(); else apply(progress);
      return active;
    },
    finish, isActive:()=>active,
  };
}
