import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCloudApproach, createCloudDeparture, CLOUD_APPROACH_DURATION, CLOUD_APPROACH_CLEARANCE, CLOUD_APPROACH_TARGET, CLOUD_DEPARTURE_DURATION, CLOUD_DEPARTURE_RADIUS } from '../app/lib/earth/cloudApproach.js';
import { CLOUD_DEPTH_INNER, CLOUD_DEPTH_LAYERS, cloudLayerAlpha, cloudLayerVisibility, createCloudDepth } from '../app/lib/earth/cloudDepth.js';

function fixture(reduced = false) {
  const world = new THREE.Group(); world.rotation.z = -.21;
  const clouds = new THREE.Object3D(); clouds.rotation.y = -Math.PI * .64; clouds.scale.setScalar(1.006);
  clouds.material = { opacity: .82 }; world.add(clouds); world.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, .1, 150);
  camera.position.set(0, .12, 1).normalize().multiplyScalar(3.57); camera.lookAt(0, 0, 0);
  let completed = 0;
  const flight = createCloudApproach({ camera, clouds, reducedMotion: () => reduced, onComplete: () => completed++ });
  return { camera, clouds, flight, get completed() { return completed; } };
}

test('isolated approach reaches the visible cloud surface without fading or crossing it', () => {
  const f = fixture(), inverse = f.clouds.matrixWorld.clone().invert();
  let previous = f.camera.position.length(), minimum = Infinity;
  f.flight.tick(0);
  for (let i = 0; i < 500; i++) {
    f.flight.tick(1 / 60);
    const local = f.camera.position.clone().applyMatrix4(inverse);
    minimum = Math.min(minimum, local.length());
    assert.ok(local.length() > 1, 'the camera must stay outside the existing thin cloud mesh');
    assert.ok(f.camera.position.length() <= previous + 1e-12);
    assert.equal(f.clouds.material.opacity, .82, 'the cloud layer itself must not fade away');
    assert.ok(f.camera.near < (local.length() - 1) * 1.006, 'the near plane must not clip the approaching cloud surface');
    previous = f.camera.position.length();
  }
  assert.ok(minimum < 1.001, 'the approach must actually reach the existing clouds');
  assert.ok(Math.abs(minimum - 1 - CLOUD_APPROACH_CLEARANCE) < 1e-10);
  assert.equal(f.completed, 1);
});

test('approach stops over the intended existing northern Finland cloud texel and settles once', () => {
  const f = fixture(); f.flight.tick(0); f.flight.tick(CLOUD_APPROACH_DURATION);
  const p = f.camera.position.clone().applyMatrix4(f.clouds.matrixWorld.clone().invert()).normalize();
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.atan2(-p.z, p.x)) - CLOUD_APPROACH_TARGET.longitude) < 1e-9);
  assert.ok(Math.abs(THREE.MathUtils.radToDeg(Math.asin(p.y)) - CLOUD_APPROACH_TARGET.latitude) < 1e-9);
  const position = f.camera.position.clone(); f.flight.finish(); f.flight.tick(30);
  assert.equal(f.completed, 1); assert.ok(position.distanceTo(f.camera.position) < 1e-12);
});

test('reduced motion finishes the isolated approach without starting a second cloud animation', () => {
  const f = fixture(true);
  assert.equal(f.completed, 1); assert.equal(f.flight.tick(1), false);
});

test('exit starts at the approach endpoint, crosses the same cloud layer and stays above the ground', () => {
  const f = fixture(); f.flight.finish();
  const start = f.camera.position.clone(), inverse = f.clouds.matrixWorld.clone().invert();
  let completed = 0;
  const exit = createCloudDeparture({ camera:f.camera,clouds:f.clouds,reducedMotion:()=>false,onComplete:()=>completed++ });
  assert.ok(f.camera.position.distanceTo(start)<1e-12, 'exit cannot jump to another camera');
  const direction = start.clone().normalize();
  let previous = start.length();
  exit.tick(0);
  for(let i=0;i<300;i++) {
    exit.tick(1/60);
    assert.ok(f.camera.position.length()<=previous+1e-12);
    assert.ok(f.camera.position.clone().normalize().distanceTo(direction)<1e-12);
    assert.ok(f.camera.position.length()>1, 'the camera remains above the Earth surface');
    previous=f.camera.position.length();
  }
  const localRadius = f.camera.position.clone().applyMatrix4(inverse).length();
  assert.ok(Math.abs(localRadius-CLOUD_DEPARTURE_RADIUS)<1e-10);
  assert.ok(localRadius<CLOUD_DEPTH_INNER);
  for(let i=0;i<CLOUD_DEPTH_LAYERS;i++) {
    const radius = 1+(CLOUD_DEPTH_INNER-1)*i/(CLOUD_DEPTH_LAYERS-1);
    assert.equal(cloudLayerVisibility(localRadius,radius),0);
  }
  assert.equal(completed,1); exit.finish(); assert.equal(completed,1);
});

test('adding depth preserves the original total cloud opacity from above', () => {
  for(const alpha of [0,.1,.4,.65,.82,.95]) {
    const perLayer=cloudLayerAlpha(alpha);
    const combined=1-Math.pow(1-perLayer,CLOUD_DEPTH_LAYERS);
    assert.ok(Math.abs(combined-alpha)<1e-12);
  }
  assert.equal(cloudLayerVisibility(1.0006,1),1);
  assert.equal(cloudLayerVisibility(.9999,1),0);
});

test('clouds follow sunlight in orbit and regain the approved white fill only near the camera', () => {
  const world = new THREE.Group();
  const source = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshPhongMaterial({ transparent: true, opacity: .82 }));
  source.scale.setScalar(1.006);
  world.add(source);
  const depth = createCloudDepth(source);
  const layers = world.children.find(child => child !== source).children;
  const camera = new THREE.PerspectiveCamera();
  try {
    camera.position.set(0, 0, 3.57);
    depth.update(camera);
    assert.ok(layers.every(layer => layer.material.emissiveIntensity === 0), 'night-side clouds must not illuminate themselves from orbit');
    let previous = 0;
    for (let radius = 1.15; radius >= 1.0005; radius -= .0005) {
      camera.position.set(0, 0, radius * 1.006);
      depth.update(camera);
      const fill = layers[0].material.emissiveIntensity;
      assert.ok(fill >= previous && fill <= .28);
      assert.ok(fill - previous < .003, 'close-up fill must blend without a lighting pop');
      previous = fill;
    }
    camera.position.set(0, 0, (1 + CLOUD_APPROACH_CLEARANCE) * 1.006);
    depth.update(camera);
    assert.ok(layers.every(layer => layer.material.emissiveIntensity === .28));
    assert.equal(source.material.opacity, .82, 'lighting must not change cloud transmission');
    camera.position.set(0, 0, 3.57);
    depth.update(camera);
    assert.ok(layers.every(layer => layer.material.emissiveIntensity === 0), 'returning to orbit restores unfilled shading');
  } finally { depth.dispose(); source.geometry.dispose(); source.material.dispose(); }
});
