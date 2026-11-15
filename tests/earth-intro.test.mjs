import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEarthIntro, getEarthIntroFrame, EARTH_INTRO_DURATION } from '../app/lib/earth/earthIntro.js';
import { createCloudApproach, createCloudDeparture, CLOUD_APPROACH_DURATION, CLOUD_DEPARTURE_DURATION } from '../app/lib/earth/cloudApproach.js';
import { createCloudDepth } from '../app/lib/earth/cloudDepth.js';

function setup(initialReducedMotion=false) {
  const scene=new THREE.Scene();
  const world=new THREE.Group();world.rotation.z=THREE.MathUtils.degToRad(-12);scene.add(world);
  const camera=new THREE.PerspectiveCamera(42,16/9,.1,150);
  camera.position.set(0,.12,1).normalize().multiplyScalar(3.57);camera.lookAt(0,0,0);
  const finalCamera=camera.position.clone(),finalView=camera.quaternion.clone(),finalWorld=world.quaternion.clone();
  const geometry=new THREE.SphereGeometry();
  const earthMaterial=new THREE.ShaderMaterial({uniforms:{uIntroProgress:{value:0},uIntroLights:{value:0},uIntroSurface:{value:0}}});
  const atmosphereMaterial=new THREE.ShaderMaterial({uniforms:{uOpacity:{value:1}}});
  const cloudMaterial=new THREE.MeshPhongMaterial({opacity:.82});
  const earth=new THREE.Mesh(geometry,earthMaterial);
  earth.rotation.y=-Math.PI*.64;
  const clouds=new THREE.Mesh(geometry,cloudMaterial);
  clouds.quaternion.copy(earth.quaternion);world.add(earth,clouds);
  const sunDirection=new THREE.Vector3(-2.8,1.3,3.4).normalize();
  const sun=new THREE.DirectionalLight();
  const starMaterial=new THREE.PointsMaterial({opacity:0});
  const stars=new THREE.Points(new THREE.BufferGeometry(),starMaterial);
  const controls={enabled:true};
  const finalEarth=earth.quaternion.clone(), finalSun=sunDirection.clone();
  let reducedMotion=initialReducedMotion, completed=0;
  const intro=createEarthIntro({earth,clouds,world,camera,earthMaterial,atmosphereMaterial,sunDirection,sun,stars,scene,controls,
    reducedMotion:()=>reducedMotion,onComplete:()=>completed++});
  return {intro,scene,earth,clouds,world,camera,finalCamera,finalView,finalWorld,earthMaterial,atmosphereMaterial,sunDirection,sun,stars,controls,finalEarth,finalSun,
    get completed(){return completed;},reduceMotion(){reducedMotion=true;},
    dispose(){geometry.dispose();earthMaterial.dispose();atmosphereMaterial.dispose();cloudMaterial.dispose();
      stars.geometry.dispose();starMaterial.dispose();}};
}

test('the opening is completely dark and keeps the planet hidden during its first city lights',()=>{
  const f=setup();
  try {
    assert.equal(f.scene.background.getHexString(),'000000');
    assert.equal(f.earthMaterial.uniforms.uIntroProgress.value,0);
    assert.equal(f.earthMaterial.uniforms.uIntroSurface.value,0);
    assert.equal(f.atmosphereMaterial.uniforms.uOpacity.value,0);
    assert.equal(f.clouds.material.opacity,0);
    assert.equal(f.stars.material.opacity,0);
    assert.equal(f.controls.enabled,false);
    const night=f.earth.quaternion.clone(), nightSun=f.sunDirection.clone(), nightCamera=f.camera.position.clone();
    f.intro.tick(30);
    assert.equal(f.earthMaterial.uniforms.uIntroProgress.value,0,'a frame predating asset readiness cannot skip the introduction');
    f.intro.tick(EARTH_INTRO_DURATION*.20);
    assert.ok(f.earthMaterial.uniforms.uIntroProgress.value>.19);
    assert.equal(f.earthMaterial.uniforms.uIntroSurface.value,0,'lights precede any terrain');
    assert.equal(f.atmosphereMaterial.uniforms.uOpacity.value,0,'no outline gives away the sphere');
    assert.equal(f.stars.material.opacity,0,'city lights are the only early lights');
    assert.ok(f.earth.quaternion.angleTo(night)<1e-7,'the first isolated lights stay still');
    assert.ok(f.camera.position.distanceTo(nightCamera)<1e-12,'the first isolated lights have no camera drift');
    assert.ok(f.sunDirection.distanceTo(nightSun)<1e-12,'the light is fixed while the early lights rotate');
  } finally {f.dispose();}
});

test('Earth rotates continuously under a fixed sun and keeps its Finland handoff pose',()=>{
  const f=setup();
  try {
    f.intro.tick(0);
    let rotation=f.earth.quaternion.clone(), direction=f.sunDirection.clone();
    let surface=0, atmosphere=0, clouds=0, stars=0;
    for(let i=0;i<720;i++) {
      f.intro.tick(1/60);
      assert.ok(f.earth.quaternion.angleTo(rotation)<.01,'planet must not jump');
      assert.ok(f.sunDirection.distanceTo(direction)<1e-12,'the world-space sun must not move');
      assert.ok(f.sun.position.distanceTo(f.finalSun.clone().multiplyScalar(6))<1e-12,'the light position is fixed');
      assert.ok(f.clouds.quaternion.angleTo(f.earth.quaternion)<1e-7,'clouds turn with Earth, without independent drift');
      assert.ok(Math.abs(f.sunDirection.length()-1)<1e-10);
      assert.ok(f.earthMaterial.uniforms.uIntroSurface.value>=surface);
      assert.ok(f.atmosphereMaterial.uniforms.uOpacity.value>=atmosphere);
      assert.ok(f.clouds.material.opacity>=clouds);
      assert.ok(f.stars.material.opacity>=stars);
      rotation=f.earth.quaternion.clone();direction=f.sunDirection.clone();
      surface=f.earthMaterial.uniforms.uIntroSurface.value;
      atmosphere=f.atmosphereMaterial.uniforms.uOpacity.value;
      clouds=f.clouds.material.opacity;stars=f.stars.material.opacity;
    }
    assert.equal(f.intro.isActive(),false);
    assert.equal(f.controls.enabled,true);
    assert.equal(f.completed,1);
    assert.equal(surface,1);assert.equal(atmosphere,1);
    assert.equal(clouds,.82);assert.equal(stars,.52);
    assert.equal(f.scene.background.getHexString(),'020307');
    assert.ok(f.earth.quaternion.angleTo(f.finalEarth)<1e-7);
    assert.ok(f.clouds.quaternion.angleTo(f.finalEarth)<1e-7,'clouds retain the Finland handoff pose');
    assert.ok(f.camera.position.distanceTo(f.finalCamera)<1e-12);
    assert.ok(f.camera.quaternion.angleTo(f.finalView)<1e-7);
    assert.ok(f.world.quaternion.angleTo(f.finalWorld)<1e-7);
    assert.ok(f.sunDirection.distanceTo(f.finalSun)<1e-12);
    assert.ok(f.sun.position.distanceTo(f.finalSun.clone().multiplyScalar(6))<1e-12);
    f.intro.finish();f.intro.tick(30);
    assert.equal(f.completed,1,'completion is idempotent');
  } finally {f.dispose();}
});

test('reduced motion bypasses the opening without trapping input in darkness',()=>{
  for(const initiallyReduced of [true,false]) {
    const f=setup(initiallyReduced);
    try {
      if(!initiallyReduced){f.intro.tick(0);f.intro.tick(2);f.reduceMotion();f.intro.tick(0);}
      assert.equal(f.intro.isActive(),false);
      assert.equal(f.earthMaterial.uniforms.uIntroSurface.value,1);
      assert.equal(f.earthMaterial.uniforms.uIntroProgress.value,1);
      assert.equal(f.controls.enabled,true);
      assert.equal(f.completed,1);
    } finally {f.dispose();}
  }
});


test('surprise reveal holds the first lights, drifts gently with the network, then turns to daylight',()=>{
  assert.equal(getEarthIntroFrame(.20).turn,0);
  assert.equal(getEarthIntroFrame(.20).surface,0);
  assert.ok(getEarthIntroFrame(.36).turn>0);
  assert.ok(getEarthIntroFrame(.50).turn<=.041,'network reveal has only a very small turn');
  const gentle=getEarthIntroFrame(.40).turn-getEarthIntroFrame(.30).turn;
  const main=getEarthIntroFrame(.80).turn-getEarthIntroFrame(.70).turn;
  assert.ok(main>gentle*8,'main turn has a distinct increase in pace');
  let previous=getEarthIntroFrame(0);
  for(let i=1;i<=1000;i++){
    const frame=getEarthIntroFrame(i/1000);
    assert.equal(frame.lights,i/1000,'approved city reveal clock is unchanged');
    assert.ok(frame.turn>=previous.turn);assert.ok(frame.surface>=previous.surface);
    previous=frame;
  }
  assert.equal(previous.turn,1);assert.equal(previous.lights,1);
});

test('night-side opening is physically dark under the same fixed sun used at handoff',()=>{
  const f=setup();
  try {
    assert.ok(f.camera.position.clone().normalize().dot(f.sunDirection)<-.85,'start on the night side');
    f.intro.finish();
    assert.ok(f.camera.position.clone().normalize().dot(f.sunDirection)>.6,'end at the approved daylight view');
  }finally{f.dispose();}
});

test('approved opening connects to the eight-second cloud crossing without resetting Earth or lighting', () => {
  const f = setup();
  f.clouds.scale.setScalar(1.006);
  const depth = createCloudDepth(f.clouds);
  try {
    depth.update(f.camera);
    f.intro.finish();
    const position = f.camera.position.clone(), rotation = f.camera.quaternion.clone();
    const earthRotation = f.earth.quaternion.clone(), sunlight = f.sunDirection.clone();
    let entered = 0, exited = 0;
    const approach = createCloudApproach({
      camera: f.camera, clouds: f.clouds, reducedMotion: () => false, onComplete: () => entered++,
    });
    assert.ok(f.camera.position.distanceTo(position) < 1e-12, 'choosing Finland must retain the opening camera');
    assert.ok(f.camera.quaternion.angleTo(rotation) < 1e-7);
    approach.tick(0); approach.tick(CLOUD_APPROACH_DURATION);
    depth.update(f.camera);
    const seam = f.camera.position.clone();
    const exit = createCloudDeparture({
      camera: f.camera, clouds: f.clouds, reducedMotion: () => false, onComplete: () => exited++,
    });
    assert.ok(f.camera.position.distanceTo(seam) < 1e-12, 'exit must begin exactly where entry ends');
    exit.tick(0); exit.tick(CLOUD_DEPARTURE_DURATION);
    depth.update(f.camera);
    assert.equal(CLOUD_APPROACH_DURATION + CLOUD_DEPARTURE_DURATION, 8);
    assert.equal(entered, 1); assert.equal(exited, 1);
    assert.equal(f.clouds.material.opacity, .82);
    assert.ok(f.earth.quaternion.angleTo(earthRotation) < 1e-7);
    assert.ok(f.sunDirection.distanceTo(sunlight) < 1e-12);
  } finally { depth.dispose(); f.dispose(); }
});
