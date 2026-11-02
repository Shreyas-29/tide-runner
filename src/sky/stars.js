import * as THREE from 'three';
import { rng } from '../core/math.js';

/* ================================================================== *
 *  Stars for the night: points on a sphere 40 km out that travels with
 *  the camera. They are scene geometry, so the clouds cover them and
 *  the atmosphere hazes them toward the horizon like the real thing.
 *  Brightness follows a steep power law (a few bright, many faint),
 *  colour runs from blue-white to warm, and they twinkle.
 * ================================================================== */
export function createStars(count = 2600){
  const r = rng(4242), pos = new Float32Array(count*3), col = new Float32Array(count*3), size = new Float32Array(count), seed = new Float32Array(count);
  const tints = [[.78, .86, 1], [1, 1, 1], [1, .93, .8], [1, .82, .66]];
  for(let i=0;i<count;i++){
    const y = -.06 + 1.06*Math.pow(r(), .8), a = r()*Math.PI*2, s = Math.sqrt(1 - y*y);
    pos.set([Math.cos(a)*s, y, Math.sin(a)*s], i*3);
    const b = Math.pow(r(), 6), t = tints[Math.floor(r()*tints.length)];
    col.set(t.map((v)=>v*(.12 + 2.4*b)), i*3);
    size[i] = 1 + 2.2*b; seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const material = new THREE.ShaderMaterial({
    uniforms:{ uGain:{ value:6 }, uTime:{ value:0 }, uPx:{ value:1 } },
    vertexShader:/* glsl */`
      attribute vec3 aCol; attribute float aSize, aSeed; uniform float uGain, uTime, uPx; varying vec3 vC;
      void main(){
        gl_Position = projectionMatrix*viewMatrix*vec4(cameraPosition + position*40000., 1.);
        float tw = .7 + .3*sin(uTime*(1.3 + aSeed*3.1) + aSeed*47.);
        vC = aCol*uGain*tw; gl_PointSize = aSize*uPx;
      }`,
    fragmentShader:/* glsl */`
      varying vec3 vC;
      void main(){ float a = smoothstep(.5, .08, length(gl_PointCoord - .5)); if(a < .03) discard; gl_FragColor = vec4(vC*a, 1.); }`,
  });
  const points = new THREE.Points(g, material);
  points.frustumCulled = false; points.visible = false; points.renderOrder = -1;
  return {
    object:points,
    set gain(v){ material.uniforms.uGain.value = v; },
    update(t, pixelRatio){ material.uniforms.uTime.value = t; material.uniforms.uPx.value = pixelRatio; },
  };
}
