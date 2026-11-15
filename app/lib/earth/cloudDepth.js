import * as THREE from 'three';

export const CLOUD_DEPTH_LAYERS = 24;
export const CLOUD_DEPTH_INNER = .9955;

export function cloudLayerAlpha(alpha, count = CLOUD_DEPTH_LAYERS) {
  return 1 - Math.pow(1 - THREE.MathUtils.clamp(alpha, 0, .9999), 1 / count);
}

export function cloudLayerVisibility(cameraRadius, layerRadius) {
  return THREE.MathUtils.smoothstep(cameraRadius - layerRadius, .00002, .0003);
}

// Give the existing cloud texture depth without adding another cloud pattern.
// Layer transmission is normalized to retain the original view from orbit.
export function createCloudDepth(source) {
  const group = new THREE.Group(), layers = [];
  source.parent.add(group);
  source.visible = false;
  for (let i = 0; i < CLOUD_DEPTH_LAYERS; i++) {
    const radius = THREE.MathUtils.lerp(1, CLOUD_DEPTH_INNER, i / (CLOUD_DEPTH_LAYERS - 1));
    const material = source.material.clone();
    // A soft neutral fill lifts gray shadows without changing cloud transmission.
    material.emissive.set('#ffffff');
    material.emissiveIntensity = .28;
    const opacity = { value: source.material.opacity }, visibility = { value: 1 };
    material.opacity = 1;
    material.onBeforeCompile = shader => {
      shader.uniforms.uCloudOpacity = opacity; shader.uniforms.uCloudVisibility = visibility;
      shader.fragmentShader = 'uniform float uCloudOpacity;\nuniform float uCloudVisibility;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `
        #ifdef USE_ALPHAMAP
          float cloudAlpha = clamp(texture2D(alphaMap, vAlphaMapUv).g * uCloudOpacity, 0.0, 0.9999);
          diffuseColor.a *= (1.0 - pow(1.0 - cloudAlpha, 1.0 / ${CLOUD_DEPTH_LAYERS.toFixed(1)})) * uCloudVisibility;
        #endif
      `);
    };
    material.customProgramCacheKey = () => 'existing-cloud-depth-24';
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 2 + (CLOUD_DEPTH_LAYERS - 1 - i) / CLOUD_DEPTH_LAYERS;
    group.add(mesh); layers.push({ radius, material, opacity, visibility });
  }
  const inverse = new THREE.Matrix4(), eye = new THREE.Vector3();
  return {
    update(camera) {
      group.position.copy(source.position); group.quaternion.copy(source.quaternion); group.scale.copy(source.scale);
      group.updateWorldMatrix(true, true);
      inverse.copy(group.matrixWorld).invert();
      camera.getWorldPosition(eye); eye.applyMatrix4(inverse);
      for (const layer of layers) {
        layer.opacity.value = source.material.opacity;
        layer.visibility.value = cloudLayerVisibility(eye.length(), layer.radius);
      }
    },
    dispose() { group.removeFromParent(); for (const layer of layers) layer.material.dispose(); },
  };
}
