import * as THREE from 'three';

/* full-screen GPU passes (FFT stages, simulations, probes) */
export const QUAD_VS = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0., 1.); }`;
export const CMUL = /* glsl */`vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }`;

/* value noise shared by the sea's shaders */
export const NOISE_GLSL = /* glsl */`
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }`;

export function createPassRunner(renderer){
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; scene.add(quad);
  return (material, target)=>{ quad.material = material; renderer.setRenderTarget(target); renderer.render(scene, camera); };
}

/* a ping-pong pair of render targets */
export function pingPong(w, h, opts){
  const rt = [new THREE.WebGLRenderTarget(w, h, opts), new THREE.WebGLRenderTarget(w, h, opts)];
  return { rt, cur:0, get read(){ return this.rt[this.cur]; }, get write(){ return this.rt[this.cur ^ 1]; }, swap(){ this.cur ^= 1; } };
}

/* a simulation-grid target: no depth, no mips */
export const simTarget = (type, filter = THREE.NearestFilter)=>({ type, minFilter:filter, magFilter:filter, depthBuffer:false, stencilBuffer:false, generateMipmaps:false });
