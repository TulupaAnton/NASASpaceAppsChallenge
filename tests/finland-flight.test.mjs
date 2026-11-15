import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFinlandFlight, FINLAND_FLIGHT_DURATION } from '../app/lib/earth/finlandFlight.js';
import { project } from '../public/legacy/projection.js';
import { getCloudFlightTime, CLOUD_FLIGHT_ENTRY } from '../app/lib/earth/cloudTransition.js';
import { CLOUD_DURATION } from '../app/lib/earth/cloudVolume.js';

function setup(options = {}) {
  const world = new THREE.Group(); world.rotation.z=THREE.MathUtils.degToRad(-12);
  const earth = new THREE.Object3D(); earth.rotation.y=-Math.PI*.64; world.add(earth);
  const camera = new THREE.PerspectiveCamera(42,16/9,.1,150);
  camera.position.set(0,.12,1).normalize().multiplyScalar(3.57); camera.lookAt(0,0,0);
  const sunDirection = new THREE.Vector3(-2.8,1.3,3.4).normalize();
  const sun=new THREE.DirectionalLight(),stars={material:{opacity:.52}};
  let reduced=false, completed=0;
  const flight=createFinlandFlight({camera,earth,world,sunDirection,sun,stars,reducedMotion:()=>reduced,onComplete:()=>completed++,...options});
  return {world,earth,camera,flight,sunDirection,get completed(){return completed;},reduce:()=>{reduced=true;}};
}

test('flight first orbits toward Finland, then smoothly descends outside the globe',()=>{
  const f=setup(),start=f.camera.position.clone();
  f.flight.tick(25);
  assert.ok(start.distanceTo(f.camera.position)<1e-12,'asset readiness does not jump flight time');
  const rotation=f.camera.quaternion.clone();
  f.flight.tick(FINLAND_FLIGHT_DURATION*.1);
  assert.ok(f.camera.quaternion.angleTo(rotation)>0);
  assert.ok(Math.abs(f.camera.position.length()-start.length())<1e-12,'alignment precedes descent');
  const fixedSun=f.sunDirection.clone();
  let previous=f.camera.position.length(),q=f.camera.quaternion.clone();
  for(let i=0;i<400;i++){
    f.flight.tick(1/60);
    const radius=f.camera.position.length();
    assert.ok(f.sunDirection.distanceTo(fixedSun)<1e-12,'the approach must not animate the sun');
    assert.ok(radius<=previous+1e-12);assert.ok(radius>1.29);
    assert.ok(f.camera.quaternion.angleTo(q)<.02);
    assert.ok(previous-radius<.035);
    previous=radius;q=f.camera.quaternion.clone();
  }
  assert.equal(f.completed,1);assert.equal(f.flight.isActive(),false);
  f.flight.finish();assert.equal(f.completed,1);
});

test('final camera and ellipsoid match existing Finland satellite-image coordinates',()=>{
  const f=setup();f.flight.finish();f.world.updateMatrixWorld(true);f.camera.updateMatrixWorld(true);
  for(const [lon,lat] of [[24.94,60.17],[25.465,65.013],[26,64],[27,68.9],[19.94,60.1]]){
    const lambda=THREE.MathUtils.degToRad(lon),phi=THREE.MathUtils.degToRad(lat);
    const point=new THREE.Vector3(Math.cos(phi)*Math.cos(lambda),Math.sin(phi),-Math.cos(phi)*Math.sin(lambda));
    point.applyMatrix4(f.earth.matrixWorld).project(f.camera);
    const actual=[(point.x+1)*640,(1-point.y)*360],expected=project(lon,lat);
    actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-8,`${lon},${lat}: projection seam on axis ${i}`));
  }
});

test('reduced motion completes a pending approach once without trapping the map',()=>{
  const f=setup();f.flight.tick(0);f.flight.tick(2);f.reduce();f.flight.tick(0);
  assert.equal(f.flight.isActive(),false);assert.equal(f.completed,1);
  f.flight.tick(30);assert.equal(f.completed,1);
});

test('main-site flight overlaps the approved cloud entry and still completes at the original map pose',()=>{
  let progress = 0;
  const f = setup({timeMapping:getCloudFlightTime,onProgress:p=>{progress=p;}});
  f.flight.tick(0);
  f.flight.tick(FINLAND_FLIGHT_DURATION*CLOUD_FLIGHT_ENTRY);
  assert.equal(progress,CLOUD_FLIGHT_ENTRY);
  f.flight.tick(CLOUD_DURATION/2);
  assert.ok(progress>CLOUD_FLIGHT_ENTRY && progress<1);
  assert.equal(f.completed,0);
  f.flight.tick(CLOUD_DURATION/2);
  assert.equal(progress,1);assert.equal(f.completed,1);
  const baseline=setup();baseline.flight.finish();
  assert.ok(f.camera.position.distanceTo(baseline.camera.position)<1e-12);
  assert.ok(f.camera.quaternion.angleTo(baseline.camera.quaternion)<1e-7);
});
