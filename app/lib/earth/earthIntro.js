import * as THREE from 'three';

export const EARTH_INTRO_DURATION = 11.5 / 1.5;
const phase = (t, a, b) => THREE.MathUtils.smoothstep(t, a, b);

export function getEarthIntroFrame(progress) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const gentle = phase(p, .22, .50);
  const reveal = THREE.MathUtils.smootherstep(p, .50, 1);
  return {
    // Restore the approved seed/city-network timing in the shader.
    lights: p,
    turn: .04 * gentle + .96 * reveal,
    surface: phase(p, .45, .90),
    atmosphere: phase(p, .56, .94),
    clouds: phase(p, .55, .94),
    stars: phase(p, .70, 1),
    background: phase(p, .70, 1),
  };
}

export function createEarthIntro(options) {
  const { earth, clouds, world, camera, earthMaterial, atmosphereMaterial, sunDirection, sun, stars, scene, controls } = options;
  const finalEarth = earth.quaternion.clone();
  const finalClouds = clouds.quaternion.clone();
  const finalSun = sunDirection.clone();
  const cloudOpacity = clouds.material.opacity;
  const finalWorld = world.quaternion.clone();
  const finalCamera = camera.position.clone();
  const finalView = camera.quaternion.clone();
  const finalUp = camera.up.clone();
  const finalStars = stars.quaternion.clone();
  const north = new THREE.Vector3(0, 1, 0);
  // The night-side view is opposite the fixed sun. One shared orbit opens the
  // day side; the sun never sweeps independently across the rotating globe.
  const nightAngle = THREE.MathUtils.euclideanModulo(
    Math.atan2(-finalSun.x, -finalSun.z) - Math.atan2(finalCamera.x, finalCamera.z) + Math.PI,
    Math.PI * 2) - Math.PI;
  const orbit = new THREE.Quaternion();
  const nightRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-165));
  const background = new THREE.Color('#000000');
  const finalBackground = new THREE.Color('#020307');
  scene.background = background;
  let elapsed = 0;
  let active = true;
  let firstFrame = true;
  controls.enabled = false;

  function apply(progress) {
    const frame = getEarthIntroFrame(progress);
    orbit.setFromAxisAngle(north, nightAngle * (1 - frame.turn));
    camera.position.copy(finalCamera).applyQuaternion(orbit);
    camera.quaternion.copy(orbit).multiply(finalView);
    camera.up.copy(finalUp).applyQuaternion(orbit);
    world.quaternion.copy(orbit).multiply(finalWorld);
    stars.quaternion.copy(orbit).multiply(finalStars);
    earth.quaternion.copy(nightRotation).slerp(finalEarth, frame.turn);
    clouds.quaternion.copy(nightRotation).slerp(finalClouds, frame.turn);
    // Hold the light in world space: only the surface rotates under its shadow.
    sunDirection.copy(finalSun);
    sun.position.copy(sunDirection).multiplyScalar(6);
    earthMaterial.uniforms.uIntroProgress.value = progress;
    earthMaterial.uniforms.uIntroLights.value = frame.lights;
    earthMaterial.uniforms.uIntroSurface.value = frame.surface;
    atmosphereMaterial.uniforms.uOpacity.value = frame.atmosphere;
    clouds.material.opacity = cloudOpacity * frame.clouds;
    stars.material.opacity = .52 * frame.stars;
    background.set('#000000').lerp(finalBackground, frame.background);
    options.onProgress?.(progress);
  }

  function finish() {
    if (!active) return;
    apply(1);
    // Preserve the exact approved endpoint for the Finland approach.
    world.quaternion.copy(finalWorld);
    camera.position.copy(finalCamera);
    camera.quaternion.copy(finalView);
    camera.up.copy(finalUp);
    stars.quaternion.copy(finalStars);
    earth.quaternion.copy(finalEarth);
    clouds.quaternion.copy(finalClouds);
    sunDirection.copy(finalSun);
    sun.position.copy(finalSun).multiplyScalar(6);
    controls.enabled = true;
    active = false;
    options.onComplete();
  }

  apply(0);
  if (options.reducedMotion()) finish();
  return {
    tick(delta) {
      if (!active) return false;
      if (options.reducedMotion()) { finish(); return false; }
      if (firstFrame) firstFrame = false;
      else elapsed += Math.max(0, delta);
      const progress = Math.min(1, elapsed / EARTH_INTRO_DURATION);
      if (progress === 1) finish();
      else apply(progress);
      return active;
    },
    finish,
    isActive: () => active,
  };
}
