import * as THREE from 'three';
import { TAU } from '../config.js';
import { NOISE_GLSL } from '../core/gpu.js';
import { surfaceVertex, surfaceFragment } from './surface.glsl.js';

/* ================================================================== *
 *  The sea's surface: a radial grid around the camera (fine near,
 *  coarse far, out to 30 km) displaced by the three FFT cascades plus
 *  the boat's Kelvin wake and dynamic waves. Shading: Fresnel sky
 *  reflection from last frame's sky, the boat's planar reflection, a
 *  GGX sun glint, subsurface glow on crests, Jacobian whitecaps and the
 *  wake's foam, and at night the boat's lamp on the water.
 * ================================================================== */
function radialGrid(){
  const SEG = 320, radii = [];
  let r = .35; while(r < 30000){ radii.push(r); r *= 1.02; }
  const pos = [0, 0, 0], idx = [];
  for(const R of radii) for(let j=0;j<SEG;j++){ const a = j/SEG*TAU; pos.push(Math.cos(a)*R, 0, Math.sin(a)*R); }
  for(let j=0;j<SEG;j++) idx.push(0, 1 + (j + 1) % SEG, 1 + j);
  for(let i=0;i<radii.length - 1;i++){
    const a0 = 1 + i*SEG, a1 = 1 + (i + 1)*SEG;
    for(let j=0;j<SEG;j++){ const j1 = (j + 1) % SEG; idx.push(a0 + j, a0 + j1, a1 + j, a1 + j, a0 + j1, a1 + j1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createSurface(app, { ocean, sky, wake, dyn }){
  const U = sky.U;
  const uniforms = {
    uSunDir:U.sunDir, uSunCol:U.sunCol, uZen:U.zen, uHor:U.hor, uScatter:U.scatter, uSSS:U.sss, uTime:U.time, uCover:U.cover,
    tSS:U.tSS, uVPRot:U.vpRot, uSSOK:U.ssOK, uSpecK:U.specK, uDbg:{ value:0 }, uCenter:{ value:new THREE.Vector2() }, uHs:{ value:1 },
    uBoatInv:{ value:new THREE.Matrix4() }, uReflMat:{ value:new THREE.Matrix4() }, uReflY:{ value:0 }, uBoatOn:{ value:0 }, tRefl:{ value:null },
    uLampPos:{ value:new THREE.Vector3() }, uLampCol:{ value:new THREE.Color(0, 0, 0) },
    ...wake.uniforms, ...dyn.uniforms,
  };
  ocean.cascades.forEach((_, i)=>{ uniforms['tD' + i] = { value:null }; uniforms['tN' + i] = { value:null }; uniforms['tF' + i] = { value:null }; });
  const Ls = ocean.cascades.map((c)=>c.L.toFixed(1));
  const chunks = wake.glsl + dyn.glsl;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:surfaceVertex({ N:ocean.N, Ls, chunks }),
    fragmentShader:surfaceFragment({ N:ocean.N, Ls, chunks:NOISE_GLSL + chunks }),
  });
  const mesh = new THREE.Mesh(radialGrid(), material);
  mesh.frustumCulled = false;
  app.scene.add(mesh);

  /* once a frame: this frame's ocean textures and the camera-centred grid */
  function update(){
    uniforms.uHs.value = ocean.hs;
    ocean.cascades.forEach((_, i)=>{ const t = ocean.textures(i); uniforms['tD' + i].value = t[0]; uniforms['tN' + i].value = t[1]; uniforms['tF' + i].value = t[2]; });
    uniforms.uCenter.value.set(app.camera.position.x, app.camera.position.z);
    wake.bind();
  }
  return { mesh, uniforms, update };
}
