import * as THREE from 'three';
import { createEarthIntro } from './earthIntro.js';
import { createEarthControls } from './createEarthControls.js';
import { createCloudApproach, createCloudDeparture } from './cloudApproach.js';
import { createCloudDepth } from './cloudDepth.js';
import { atmosphereFragment, earthFragment, globeVertex } from './shaders.js';
import { getCountry } from '../countries.js';

function seededRandom(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createStars() {
  const random = seededRandom(20261114);
  const positions = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i += 1) {
    const azimuth = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const ring = Math.sqrt(1 - z * z);
    const radius = 45 + random() * 30;
    positions.set([ring * Math.cos(azimuth) * radius, z * radius,
      ring * Math.sin(azimuth) * radius], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: '#b7c8e6', size: 0.85, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

// The approved scene is isolated from Finland's map and calculation engine.
export function mountEarthOpening(container, { onComplete, onReady, onError, onDepart, onChooseReady, onLayout, onApproachExit, approachOnly = false }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false, intro, flight, lastTime, cloudDepth, approachArrived = false, approachExiting = false, introComplete = false, departureRequested = false;
  const resources = [];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 150);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { onError(); return { startFlight() {}, exitClouds() {}, dispose() {} }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'City lights emerge from darkness, followed by sunrise over Earth.');
  container.appendChild(renderer.domElement);
  const { controls, dispose: disposeControls } = createEarthControls(camera, renderer.domElement);
  controls.enabled = false;

  const world = new THREE.Group();
  world.rotation.z = THREE.MathUtils.degToRad(-12);
  world.visible = false;
  scene.add(world);
  const sunDirection = new THREE.Vector3(-2.8, 1.3, 3.4).normalize();
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const earthMaterial = new THREE.ShaderMaterial({
    vertexShader: globeVertex, fragmentShader: earthFragment, transparent: true,
    uniforms: {
      uDay: { value: null }, uNight: { value: null }, uSunDirection: { value: sunDirection },
      uOpacity: { value: 1 }, uIntroProgress: { value: 0 }, uIntroLights: { value: 0 }, uIntroSurface: { value: 0 },
      uGraphic: { value: 0 }, uLandMask: { value: null },
      uAtlasLand: { value: new THREE.Color('#8ba798') }, uAtlasOcean: { value: new THREE.Color('#182e36') },
    },
  });
  const earth = new THREE.Mesh(geometry, earthMaterial);
  earth.renderOrder = 1;
  earth.rotation.y = -Math.PI * .64;
  world.add(earth);
  const cloudMaterial = new THREE.MeshPhongMaterial({ color: '#ffffff', transparent: true, opacity: .82, depthWrite: false, shininess: 0 });
  const clouds = new THREE.Mesh(geometry, cloudMaterial);
  clouds.renderOrder = 2;
  clouds.scale.setScalar(1.006);
  clouds.rotation.y = earth.rotation.y;
  world.add(clouds);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: globeVertex, fragmentShader: atmosphereFragment,
    uniforms: { uSunDirection: { value: sunDirection }, uOpacity: { value: 1 } },
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const atmosphere = new THREE.Mesh(geometry, atmosphereMaterial);
  atmosphere.renderOrder = 4;
  atmosphere.scale.setScalar(1.045);
  world.add(atmosphere);
  const sun = new THREE.DirectionalLight('#fff5e9', 2.1);
  sun.position.copy(sunDirection.clone().multiplyScalar(6));
  scene.add(sun);
  scene.add(new THREE.AmbientLight('#9bbdff', .035));
  const stars = createStars();
  scene.add(stars);
  let departureProgress = 0, placementProgress = 0, placementElapsed = 0;
  let placementReady = false, choiceAnnounced = false;
  let departureTarget;
  function frameCountrySelection() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    const progress = THREE.MathUtils.smootherstep(placementProgress, 0, 1)
      * (1 - THREE.MathUtils.smootherstep(departureProgress, 0, .36));
    const left = width * .48 * progress;
    // The panel and the actual space viewport share one boundary and clock.
    renderer.setViewport(left, 0, width - left, height);
    renderer.setScissor(left, 0, width - left, height);
    renderer.setScissorTest(true);
    camera.clearViewOffset();
    camera.aspect = (width - left) / height;
    camera.updateProjectionMatrix();
    onLayout(progress);
  }
  function positionForCountryChoice(delta) {
    if (!introComplete || placementReady) return;
    placementElapsed += Math.max(0, delta);
    placementProgress = reducedMotion.matches ? 1 : Math.min(1, placementElapsed / 1.1);
    frameCountrySelection();
    container.dataset.countryProgress = placementProgress.toFixed(4);
    container.dataset.introStage = placementProgress === 1 ? 'ready' : 'positioning';
    if (placementProgress >= .35 && !choiceAnnounced) {
      choiceAnnounced = true;
      onChooseReady();
    }
    if (placementProgress === 1) {
      placementReady = true;
      if (departureRequested) startFlight();
    }
  }
  function startFlight(countryCode) {
    if (countryCode) departureTarget = getCountry(countryCode).flightTarget;
    departureRequested = true;
    if (disposed || !placementReady || flight) return;
    controls.enabled = false;
    onDepart();
    flight = createCloudApproach({ camera, clouds, target: departureTarget,
      reducedMotion: () => reducedMotion.matches,
      onProgress: (progress, gap) => {
        departureProgress = progress;
        frameCountrySelection();
        container.dataset.introStage = 'flying';
        container.dataset.flightProgress = progress.toFixed(4);
        atmosphereMaterial.uniforms.uOpacity.value = THREE.MathUtils.smoothstep(gap, .004, .15);
      },
      onComplete: () => { if (!disposed) { approachArrived = true; onComplete(); } },
    });
  }
  function exitClouds() {
    if (disposed || !approachArrived || approachExiting) return;
    approachExiting = true;
    // Reveal the prepared map underneath Earth while retaining the cloud layers above it.
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    stars.visible = false;
    flight = createCloudDeparture({ camera, clouds, reducedMotion: () => reducedMotion.matches,
      onProgress: progress => {
        container.dataset.introStage = 'leaving-clouds';
        container.dataset.exitProgress = progress.toFixed(4);
        earthMaterial.uniforms.uOpacity.value = 1 - THREE.MathUtils.smootherstep(progress, 0, .45);
      },
      onComplete: () => {
        if (!disposed) { world.visible = false; onApproachExit?.(); }
      },
    });
  }
  const resize = () => {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    frameCountrySelection();
    if (flight || intro?.isActive()) return;
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance = 1.28 / Math.sin(Math.min(verticalFov, horizontalFov) / 2);
    const direction = camera.position.lengthSq() ? camera.position.clone().normalize() : new THREE.Vector3(0, .12, 1).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    controls.update();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const loader = new THREE.TextureLoader();
  const texture = async (file, color) => {
    const result = await loader.loadAsync(`/earth/${file}`);
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    if (disposed) result.dispose(); else resources.push(result);
    return result;
  };
  Promise.all([texture('earth-day.jpg', true), texture('earth-clouds.jpg', false), texture('earth-night.jpg', true), texture('earth-land-mask.png', false)])
    .then(([day, cloudMap, night, landMask]) => {
      if (disposed) return;
      earthMaterial.uniforms.uDay.value = day;
      earthMaterial.uniforms.uNight.value = night;
      earthMaterial.uniforms.uLandMask.value = landMask;
      cloudMaterial.alphaMap = cloudMap;
      cloudMaterial.needsUpdate = true;
      cloudDepth = createCloudDepth(clouds);
      intro = createEarthIntro({ earth, clouds, world, camera, earthMaterial, atmosphereMaterial, sunDirection, sun, stars, scene, controls,
        reducedMotion: () => approachOnly || reducedMotion.matches,
        onProgress: progress => {
          container.dataset.introProgress = progress.toFixed(4);
          container.dataset.introStage = progress < .055 ? 'dark' : earthMaterial.uniforms.uIntroLights.value < .26 ? 'first-lights'
            : progress < .48 ? 'night-lights' : progress < 1 ? 'dawn' : 'ready';
        },
        onComplete: () => {
          if (disposed) return;
          introComplete = true;
          controls.enabled = false;
          if (approachOnly) {
            placementReady = true;
            container.dataset.introStage = 'ready';
            return;
          }
          container.dataset.introStage = 'positioning';
          if (reducedMotion.matches) positionForCountryChoice(0);
        },
      });
      world.visible = true;
      onReady();
    }).catch(() => { if (!disposed) onError(); });
  const visibilityChanged = () => { lastTime = undefined; };
  const motionChanged = () => {
    if (reducedMotion.matches) {
      if (flight) flight.finish();
      else if (intro) { intro.finish(); positionForCountryChoice(0); }
    }
  };
  const contextLost = event => { event.preventDefault(); renderer.setAnimationLoop(null); if (!disposed) onError(); };
  document.addEventListener('visibilitychange', visibilityChanged);
  reducedMotion.addEventListener('change', motionChanged);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.setAnimationLoop(time => {
    const delta = lastTime === undefined ? 0 : Math.max((time-lastTime)/1000, 0);
    lastTime = time;
    if (document.hidden) { lastTime = undefined; return; }
    const introducing = intro?.tick(delta) ?? false;
    if (!introducing) positionForCountryChoice(delta);
    const flying = !introducing && (flight?.tick(delta) ?? false);
    if (intro && !introducing && !flight && !flying && !reducedMotion.matches) {
      earth.rotation.y += Math.min(delta, .05) * .014;
      clouds.rotation.y += Math.min(delta, .05) * .014;
    }
    cloudDepth?.update(camera);
    renderer.render(scene, camera);
  });
  return { startFlight, exitClouds, dispose() {
    disposed = true;
    observer.disconnect();
    renderer.setAnimationLoop(null);
    document.removeEventListener('visibilitychange', visibilityChanged);
    reducedMotion.removeEventListener('change', motionChanged);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    disposeControls();
    cloudDepth?.dispose();
    geometry.dispose(); earthMaterial.dispose(); cloudMaterial.dispose(); atmosphereMaterial.dispose();
    stars.geometry.dispose(); stars.material.dispose();
    resources.forEach(item => item.dispose());
    renderer.dispose();
    renderer.domElement.remove();
  } };
}
