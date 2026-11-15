import * as THREE from 'three';
import { createCloudNoise } from './cloudVolume.js';
import { cloudVolumeVertex, cloudVolumeFragment, cloudCompositeVertex, cloudCompositeFragment, cloudOverlayFragment } from './cloudShaders.js';

// Shared by the approved isolated lab and the transparent main-site overlay.
export function createCloudRenderer(host, { groundPhoto = false, onReady, onError }) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: !groundPhoto, premultipliedAlpha: true, powerPreference: 'high-performance' }); }
  catch { onError(); return { render: () => false, setAnimationLoop() {}, dispose() {} }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor('#000000', groundPhoto ? 1 : 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'An aerial view descending through a three-dimensional cloud bank.');
  host.appendChild(renderer.domElement);
  const volume = createCloudNoise();
  const noise = new THREE.Data3DTexture(volume.data, volume.size, volume.size, volume.size);
  noise.format = THREE.RedFormat; noise.type = THREE.UnsignedByteType;
  noise.minFilter = noise.magFilter = THREE.LinearFilter;
  noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping;
  noise.unpackAlignment = 1; noise.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
  const uniforms = {
    uAltitude: { value: 8 }, uTravel: { value: -2.8 }, uTime: { value: 0 }, uAspect: { value: 16 / 9 },
    uResolution: { value: new THREE.Vector2(1, 1) }, uNoise: { value: noise }, uNoiseSize: { value: volume.size },
    uGround: { value: null }, uClouds: { value: target.texture }, uExitView: { value: 0 },
    uStrength: { value: 1 }, uOcclusion: { value: 0 },
  };
  const volumeMaterial = new THREE.ShaderMaterial({ uniforms, glslVersion: THREE.GLSL3,
    vertexShader: cloudVolumeVertex, fragmentShader: cloudVolumeFragment, depthWrite: false, depthTest: false });
  const compositeMaterial = new THREE.ShaderMaterial({ uniforms, premultipliedAlpha: !groundPhoto,
    vertexShader: cloudCompositeVertex, fragmentShader: groundPhoto ? cloudCompositeFragment : cloudOverlayFragment,
    depthWrite: false, depthTest: false });
  const geometry = new THREE.PlaneGeometry(2, 2), camera = new THREE.Camera();
  const volumeScene = new THREE.Scene(), compositeScene = new THREE.Scene();
  volumeScene.add(new THREE.Mesh(geometry, volumeMaterial));
  compositeScene.add(new THREE.Mesh(geometry, compositeMaterial));
  let disposed = false, ready = false, texture;
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    const scale = Math.min(.65, 800 / width);
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    target.setSize(w, h); uniforms.uResolution.value.set(w, h); uniforms.uAspect.value = width / height;
  }
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  function loaded() { if (!disposed) { ready = true; onReady(); } }
  if (groundPhoto) {
    new THREE.TextureLoader().load('/legacy/assets/finland-satellite.webp', image => {
      if (disposed) { image.dispose(); return; }
      texture = image; texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      uniforms.uGround.value = texture; loaded();
    }, undefined, () => { if (!disposed) onError(); });
  } else queueMicrotask(loaded);
  const contextLost = event => { event.preventDefault(); renderer.setAnimationLoop(null); if (!disposed) onError(); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  return {
    setAnimationLoop(callback) { renderer.setAnimationLoop(callback); },
    render(frame, time, { exitView = false, strength = 1, occlusion = 0 } = {}) {
      if (!ready || disposed) return false;
      uniforms.uAltitude.value = frame.altitude; uniforms.uTravel.value = frame.travel;
      uniforms.uTime.value = time; uniforms.uExitView.value = exitView ? 1 : 0;
      uniforms.uStrength.value = strength; uniforms.uOcclusion.value = occlusion;
      renderer.setRenderTarget(target); renderer.render(volumeScene, camera);
      renderer.setRenderTarget(null); renderer.render(compositeScene, camera);
      return true;
    },
    dispose() {
      disposed = true; observer.disconnect(); renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      noise.dispose(); texture?.dispose(); target.dispose(); geometry.dispose();
      volumeMaterial.dispose(); compositeMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
