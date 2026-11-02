import * as THREE from 'three';
import { Pass, Effect } from 'postprocessing';

export const REFLECT_LAYER = 1, BOAT_LAYER = 2;   /* what the sea's mirror sees; what the boat pass draws */
const FS_VS = 'varying vec2 vUv; void main(){ vUv = position.xy*.5 + .5; gl_Position = vec4(position.xy, 0., 1.); }';

/* a half-resolution copy of the finished HDR sky (before tone mapping), for the sea to reflect next frame.
   Anything nearer than 150 m is cut out, premultiplied, so the mips fill the hole from the sky around it */
export class SaveSkyPass extends Pass {
  constructor(near, far){
    super('SaveSkyPass'); this.needsSwap = false; this.needsDepthTexture = true;
    this.fullscreenMaterial = new THREE.ShaderMaterial({ uniforms:{ inputBuffer:{ value:null }, depthBuffer:{ value:null }, uNF:{ value:new THREE.Vector2(near, far) } },
      vertexShader:FS_VS,
      fragmentShader:`uniform sampler2D inputBuffer, depthBuffer; uniform vec2 uNF; varying vec2 vUv;
        void main(){ vec3 c = texture2D(inputBuffer, vUv).rgb; float d = texture2D(depthBuffer, vUv).r;
          float z = uNF.x*uNF.y/(uNF.y - d*(uNF.y - uNF.x)); float m = step(150., z); gl_FragColor = vec4(c*m, m); }`, depthWrite:false, depthTest:false });
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type:THREE.HalfFloatType, depthBuffer:false, minFilter:THREE.LinearMipmapLinearFilter, magFilter:THREE.LinearFilter, generateMipmaps:true });
  }
  setDepthTexture(t){ this.fullscreenMaterial.uniforms.depthBuffer.value = t; }
  render(r, inputBuffer){ this.fullscreenMaterial.uniforms.inputBuffer.value = inputBuffer.texture; r.setRenderTarget(this.rt); r.render(this.scene, this.camera); }
  setSize(w, h){ this.rt.setSize(Math.max(2, Math.ceil(w/2)), Math.max(2, Math.ceil(h/2))); }
}

/* the boat goes on after the clouds: their temporal upscaling reprojects a 1/16 image, which frays thin moving
   silhouettes (mast, radar) into pixels. So the boat renders on its own layer and is laid over the finished
   sky and sea with a depth test against the scene; the clouds never see it */
export class BoatPass extends Pass {
  constructor(scene, camera){
    super('BoatPass'); this.needsSwap = false; this.needsDepthTexture = true;
    this.boatScene = scene; this.boatCamera = camera; this._c = new THREE.Color();
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type:THREE.HalfFloatType, depthTexture:new THREE.DepthTexture(2, 2) });
    this.fullscreenMaterial = new THREE.ShaderMaterial({ uniforms:{ tBoat:{ value:this.rt.texture }, tBD:{ value:this.rt.depthTexture }, tSD:{ value:null } },
      vertexShader:FS_VS,
      fragmentShader:`uniform sampler2D tBoat, tBD, tSD; varying vec2 vUv;
        void main(){ vec4 b = texture2D(tBoat, vUv); if(b.a < .002 || texture2D(tBD, vUv).r >= texture2D(tSD, vUv).r) discard; gl_FragColor = vec4(b.rgb, 1.); }`,
      depthWrite:false, depthTest:false });
  }
  setDepthTexture(t){ this.fullscreenMaterial.uniforms.tSD.value = t; }
  render(r, inputBuffer){
    const cam = this.boatCamera, mask = cam.layers.mask, a = r.getClearAlpha(); r.getClearColor(this._c);
    cam.layers.set(BOAT_LAYER); r.setClearColor(0x000000, 0); r.setRenderTarget(this.rt); r.clear(); r.render(this.boatScene, cam);
    cam.layers.mask = mask; r.setClearColor(this._c, a);
    r.setRenderTarget(inputBuffer); r.render(this.scene, this.camera);
  }
  setSize(w, h){ this.rt.setSize(w, h); }
}

/* night is graded the way film shoots day-for-night: rods see little colour and lean blue, so the frame is
   desaturated toward a cool tint, while bright things (the moon, its glitter path, the boat's lamps) keep theirs */
export class NightGradeEffect extends Effect {
  constructor(){
    super('NightGradeEffect', /* glsl */`
      uniform float uAmount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(.2126, .7152, .0722));
        vec3 rods = mix(vec3(l), c, .22)*vec3(.6, .76, 1.14);
        float keep = smoothstep(.8, 5., l);
        outputColor = vec4(mix(c, mix(rods, c, keep), uAmount), inputColor.a);
      }`, { uniforms:new Map([['uAmount', new THREE.Uniform(0)]]) });
  }
  set amount(v){ this.uniforms.get('uAmount').value = v; }
}
