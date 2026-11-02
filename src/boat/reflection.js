import * as THREE from 'three';
import { REFLECT_LAYER } from '../sky/passes.js';

/* the sea's mirror: the boat alone, from the camera reflected in the water level under the hull, above-water parts only.
   Rendered at a third of the resolution: the waves blur it anyway */
export function createReflection(app, surfaceUniforms){
  const { renderer, scene, camera } = app;
  const rt = new THREE.WebGLRenderTarget(2, 2, { type:THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera(); cam.layers.set(REFLECT_LAYER);
  const plane = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
  const BIAS = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
  const _f = new THREE.Vector3(), _up = new THREE.Vector3(), _c = new THREE.Color();
  let enabled = true;

  function render(waterLevel){
    if(!enabled) return;
    const cp = camera.position;
    _f.set(0, 0, -1).applyQuaternion(camera.quaternion).add(cp); _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const w2 = 2*waterLevel; plane[0].constant = -waterLevel;
    cam.position.set(cp.x, w2 - cp.y, cp.z); cam.up.set(_up.x, -_up.y, _up.z); cam.lookAt(_f.x, w2 - _f.y, _f.z);
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = 2000; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    surfaceUniforms.uReflY.value = waterLevel;
    surfaceUniforms.uReflMat.value.copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const a = renderer.getClearAlpha(); renderer.getClearColor(_c);
    renderer.clippingPlanes = plane; renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    renderer.clippingPlanes = []; renderer.setClearColor(_c, a); renderer.setRenderTarget(null);
    surfaceUniforms.tRefl.value = rt.texture;
  }
  function clear(){
    const a = renderer.getClearAlpha(); renderer.getClearColor(_c);
    renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rt); renderer.clear(); renderer.setRenderTarget(null); renderer.setClearColor(_c, a);
    surfaceUniforms.tRefl.value = rt.texture;
  }
  return {
    render,
    setSize(w, h){ rt.setSize(Math.max(2, Math.ceil(w/3)), Math.max(2, Math.ceil(h/3))); },
    set enabled(v){ enabled = v; if(!v) clear(); }, get enabled(){ return enabled; },
  };
}
