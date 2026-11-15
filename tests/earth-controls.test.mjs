import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createEarthControls } from '../app/lib/earth/createEarthControls.js';

// OrbitControls uses the actual EventTarget API; no renderer or test framework is needed.
class CanvasTarget extends EventTarget {
  style = {};
  ownerDocument = new EventTarget();
  clientWidth = 1200;
  clientHeight = 800;
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function setup() {
  const camera = new PerspectiveCamera(42, 1.5, 0.1, 150);
  camera.position.set(0, 0, 3.7);
  const canvas = new CanvasTarget();
  return { camera, canvas, ...createEarthControls(camera, canvas) };
}

function wheel(canvas, deltaY, ctrlKey = true) {
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(event, { deltaY, deltaX: 24, deltaMode: 0, ctrlKey, clientX: 1050, clientY: 170 });
  canvas.dispatchEvent(event);
  return event;
}

function pointer(target, type, properties) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'mouse', pointerId: 1, button: 0,
    clientX: 700, clientY: 300, pageX: 700, pageY: 300,
    ctrlKey: false, metaKey: false, shiftKey: false, ...properties });
  target.dispatchEvent(event);
}

test('off-center trackpad pinch is consumed and zooms the Earth without moving its center', () => {
  const { camera, canvas, controls, dispose } = setup();
  try {
    const before = camera.position.length();
    const event = wheel(canvas, -5);
    assert.equal(event.defaultPrevented, true, 'pinch must not reach browser viewport zoom');
    assert.ok(camera.position.length() < before, 'pinch should zoom the 3D camera');
    assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
    camera.updateMatrixWorld();
    const center = new Vector3(0, 0, 0).project(camera);
    assert.ok(Math.abs(center.x) < 1e-10 && Math.abs(center.y) < 1e-10, 'Earth must stay at screen center');
  } finally {
    dispose();
  }
});

test('a pinch during an active drag is still blocked from browser zoom', () => {
  const { canvas, dispose } = setup();
  try {
    pointer(canvas, 'pointerdown');
    assert.equal(wheel(canvas, -5).defaultPrevented, true);
    pointer(canvas.ownerDocument, 'pointerup');
  } finally {
    dispose();
  }
});

test('repeated zoom and two-finger movement keep the target fixed and the camera outside Earth', () => {
  const { camera, canvas, controls, dispose } = setup();
  try {
    for (let i = 0; i < 200; i += 1) wheel(canvas, -100);
    assert.ok(camera.position.length() > 1.145, 'camera and near plane must remain outside the atmosphere');
    pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 11, pageX: 500, pageY: 300 });
    pointer(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 12, pageX: 650, pageY: 300 });
    pointer(canvas.ownerDocument, 'pointermove', { pointerType: 'touch', pointerId: 11, pageX: 600, pageY: 450 });
    pointer(canvas.ownerDocument, 'pointermove', { pointerType: 'touch', pointerId: 12, pageX: 800, pageY: 450 });
    for (let i = 0; i < 30; i += 1) controls.update();
    assert.deepEqual(controls.target.toArray(), [0, 0, 0]);
    camera.updateMatrixWorld();
    const center = new Vector3().project(camera);
    assert.ok(Math.abs(center.x) < 1e-10 && Math.abs(center.y) < 1e-10);
    pointer(canvas.ownerDocument, 'pointerup', { pointerType: 'touch', pointerId: 11 });
    pointer(canvas.ownerDocument, 'pointerup', { pointerType: 'touch', pointerId: 12 });
    for (let i = 0; i < 200; i += 1) wheel(canvas, 100, false);
    assert.ok(camera.position.length() <= 12.001, 'zoom-out must stay bounded');
  } finally {
    dispose();
  }
});

test('disposing the scene removes its wheel interception', () => {
  const { canvas, dispose } = setup();
  dispose();
  assert.equal(wheel(canvas, -5).defaultPrevented, false);
});
