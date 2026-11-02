import * as THREE from 'three';
import { CASCADES, FFT, SEA, TAU, G } from '../config.js';
import { rng, gauss } from '../core/math.js';
import { QUAD_VS, CMUL } from '../core/gpu.js';
import { seaSpectrum } from './spectrum.js';

/* ================================================================== *
 *  A Tessendorf FFT sea, simulated on the GPU every frame. Three
 *  cascades of 256² (640 m, 96 m and 16 m patches) sum a JONSWAP wind
 *  sea with Donelan-Banner spreading plus a long swell. Each cascade
 *  gives heights, choppy horizontal displacement and the exact slope
 *  and Jacobian fields, so normals, foam and lighting come from the
 *  same physics that moves the vertices.
 *  Per cascade, textures[0] = Dx Dy Dz Dxz, [1] = Dyx Dyz Dxx Dzz, [2] = foam, Jacobian.
 * ================================================================== */
export function createOcean(app){
  const { N, LOG2N } = FFT;
  const sea = { ...SEA };
  const cascades = CASCADES.map((c)=>({ ...c }));
  const state = { hs:0 };

  /* the random field is drawn once, so changing the weather rescales the same sea instead of replacing it */
  const noise = cascades.map((_, c)=>{ const r = rng(1337 + c*7919), a = new Float32Array(N*N*2); for(let i=0;i<a.length;i++) a[i] = gauss(r); return a; });

  /* h0(k) and its conjugate mirror for every cascade, from the spectrum; returns the significant wave height */
  function rebuild(){
    const S = seaSpectrum(sea);
    let m0 = 0;
    cascades.forEach((c, ci)=>{
      const dk = TAU/c.L, h = new Float32Array(N*N*2), xi = noise[ci];
      for(let m=0;m<N;m++) for(let n=0;n<N;n++){
        const kx = dk*(n < N/2 ? n : n - N), kz = dk*(m < N/2 ? m : m - N), k = Math.hypot(kx, kz), i = m*N + n;
        if(k < 1e-5 || k < c.kMin || k >= c.kMax) continue;
        const w = Math.sqrt(G*k + 7.4e-5*k*k*k), dw = (G + 3*7.4e-5*k*k)/(2*w);
        const s = Math.max(S(w, Math.atan2(kz, kx))*dw/k*Math.exp(-k*k*sea.cutoff*sea.cutoff), 0);
        m0 += s*dk*dk;
        const amp = .5*dk*Math.sqrt(s);
        h[2*i] = xi[2*i]*amp; h[2*i + 1] = xi[2*i + 1]*amp;
      }
      const data = c.h0 ? c.h0.image.data : new Float32Array(N*N*4);
      for(let m=0;m<N;m++) for(let n=0;n<N;n++){
        const i = m*N + n, j = ((N - m) % N)*N + ((N - n) % N);
        data[4*i] = h[2*i]; data[4*i + 1] = h[2*i + 1]; data[4*i + 2] = h[2*j]; data[4*i + 3] = -h[2*j + 1];
      }
      if(!c.h0){ c.h0 = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType); c.h0.minFilter = c.h0.magFilter = THREE.NearestFilter; }
      c.h0.needsUpdate = true;
    });
    state.hs = 4*Math.sqrt(m0);
  }

  const fftOpts = { type:THREE.FloatType, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:false, stencilBuffer:false, generateMipmaps:false, count:2 };
  const specRT = new THREE.WebGLRenderTarget(N, N, fftOpts), pingRT = new THREE.WebGLRenderTarget(N, N, fftOpts), pongRT = new THREE.WebGLRenderTarget(N, N, fftOpts);

  /* h̃(k,t) and seven more fields packed two per complex number: (Dx + iDy, Dz + iDxz) and (Dyx + iDyz, Dxx + iDzz) */
  const specMat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3, uniforms:{ tH0:{ value:null }, uL:{ value:1 }, uT:{ value:0 } }, vertexShader:QUAD_VS,
    fragmentShader: CMUL + /* glsl */`
      uniform sampler2D tH0; uniform float uL, uT;
      layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
      vec2 pk(vec2 a, vec2 b){ return vec2(a.x - b.y, a.y + b.x); }
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy);
        vec4 h = texelFetch(tH0, ij, 0);
        vec2 nm = vec2(ij); nm -= ${N}.*step(${N/2}., nm);
        vec2 k = 6.28318530718/uL*nm;
        float kl = length(k);
        if(kl < 1e-5){ o0 = vec4(0.); o1 = vec4(0.); return; }
        float w = sqrt(9.81*kl + 7.4e-5*kl*kl*kl);
        float ph = w*uT; vec2 e = vec2(cos(ph), sin(ph));
        vec2 ht = cmul(h.xy, vec2(e.x, -e.y)) + cmul(h.zw, e);
        vec2 ih = vec2(-ht.y, ht.x), kn = k/kl;
        vec2 Dx = ih*kn.x, Dz = ih*kn.y;                       /* choppy displacement pulls points toward crests */
        vec2 Dyx = ih*k.x, Dyz = ih*k.y;
        vec2 Dxx = -ht*(k.x*kn.x), Dzz = -ht*(k.y*kn.y), Dxz = -ht*(k.x*kn.y);
        o0 = vec4(pk(Dx, ht), pk(Dz, Dxz));
        o1 = vec4(pk(Dyx, Dyz), pk(Dxx, Dzz));
      }` });

  /* one radix-2 Stockham stage of the inverse FFT, along rows or columns, on both packed textures at once */
  const bfMat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3, uniforms:{ tIn0:{ value:null }, tIn1:{ value:null }, uSub:{ value:2 }, uHoriz:{ value:1 } }, vertexShader:QUAD_VS,
    fragmentShader: CMUL + /* glsl */`
      uniform sampler2D tIn0, tIn1; uniform float uSub, uHoriz;
      layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
      void main(){
        ivec2 p = ivec2(gl_FragCoord.xy);
        float index = uHoriz > .5 ? float(p.x) : float(p.y);
        float hs = uSub*.5;
        int ev = int(floor(index/uSub)*hs + mod(index, hs)), od = ev + ${N/2};
        ivec2 pe = uHoriz > .5 ? ivec2(ev, p.y) : ivec2(p.x, ev);
        ivec2 po = uHoriz > .5 ? ivec2(od, p.y) : ivec2(p.x, od);
        float a = 6.28318530718*index/uSub;
        vec2 w = vec2(cos(a), sin(a));
        vec4 e0 = texelFetch(tIn0, pe, 0), q0 = texelFetch(tIn0, po, 0);
        vec4 e1 = texelFetch(tIn1, pe, 0), q1 = texelFetch(tIn1, po, 0);
        o0 = vec4(e0.xy + cmul(w, q0.xy), e0.zw + cmul(w, q0.zw));
        o1 = vec4(e1.xy + cmul(w, q1.xy), e1.zw + cmul(w, q1.zw));
      }` });

  /* unpack into the textures the surface samples (mipmapped, tiling), and grow or fade the foam */
  const asmMat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3,
    uniforms:{ tA:{ value:null }, tB:{ value:null }, tFoam:{ value:null }, uChop:{ value:1 }, uDT:{ value:0 }, uDecay:{ value:.45 }, uThresh:{ value:.6 }, uGain:{ value:1.4 } }, vertexShader:QUAD_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB, tFoam; uniform float uChop, uDT, uDecay, uThresh, uGain;
      layout(location = 0) out vec4 oDisp; layout(location = 1) out vec4 oDeriv; layout(location = 2) out vec4 oFoam;
      void main(){
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec4 a = texelFetch(tA, p, 0), b = texelFetch(tB, p, 0);   /* a = Dx Dy Dz Dxz, b = Dyx Dyz Dxx Dzz */
        float dxx = b.z*uChop, dzz = b.w*uChop, dxz = a.w*uChop;
        oDisp = vec4(a.x*uChop, a.y, a.z*uChop, dxz);
        oDeriv = vec4(b.x, b.y, dxx, dzz);
        float J = (1. + dxx)*(1. + dzz) - dxz*dxz;
        ivec2 M = ivec2(${N - 1});
        float prev = (texelFetch(tFoam, p, 0).r*4. + texelFetch(tFoam, (p + ivec2(1, 0)) & M, 0).r + texelFetch(tFoam, (p - ivec2(1, 0)) & M, 0).r
                    + texelFetch(tFoam, (p + ivec2(0, 1)) & M, 0).r + texelFetch(tFoam, (p - ivec2(0, 1)) & M, 0).r)/8.;
        float inject = clamp((uThresh - J)*uGain, 0., 1.);
        float f = max(prev*exp(-uDT*uDecay), inject);
        f = min(f + inject*uDT*.8, 1.4);
        oFoam = vec4(f, J, 0., 1.);
      }` });

  const mapOpts = { type:THREE.HalfFloatType, minFilter:THREE.LinearMipmapLinearFilter, magFilter:THREE.LinearFilter, wrapS:THREE.RepeatWrapping, wrapT:THREE.RepeatWrapping,
                    generateMipmaps:true, depthBuffer:false, stencilBuffer:false, count:3, anisotropy:8 };
  for(const c of cascades){
    c.rt = [new THREE.WebGLRenderTarget(N, N, mapOpts), new THREE.WebGLRenderTarget(N, N, mapOpts)];
    for(const rt of c.rt) for(const t of rt.textures){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
    c.cur = 0;
  }
  rebuild();

  function simulate(T, dt){
    asmMat.uniforms.uChop.value = sea.chop; asmMat.uniforms.uDT.value = dt;
    for(const c of cascades){
      specMat.uniforms.tH0.value = c.h0; specMat.uniforms.uL.value = c.L; specMat.uniforms.uT.value = T;
      app.runPass(specMat, specRT);
      let src = specRT, dst = pingRT;
      for(let p=0;p<2*LOG2N;p++){
        const horiz = p < LOG2N;
        bfMat.uniforms.tIn0.value = src.textures[0]; bfMat.uniforms.tIn1.value = src.textures[1];
        bfMat.uniforms.uSub.value = 2 << (horiz ? p : p - LOG2N); bfMat.uniforms.uHoriz.value = horiz ? 1 : 0;
        app.runPass(bfMat, dst);
        src = dst; dst = dst === pingRT ? pongRT : pingRT;
      }
      const prev = c.rt[c.cur], out = c.rt[c.cur ^ 1];
      asmMat.uniforms.uThresh.value = c.foam;
      asmMat.uniforms.tA.value = src.textures[0]; asmMat.uniforms.tB.value = src.textures[1]; asmMat.uniforms.tFoam.value = prev.textures[2];
      app.runPass(asmMat, out);
      c.cur ^= 1;
    }
  }

  return {
    sea, cascades, N, rebuild, simulate,
    get hs(){ return state.hs; },
    /* this frame's and last frame's displacement (Dx Dy Dz Dxz) for cascade i */
    disp:(i)=>cascades[i].rt[cascades[i].cur].textures[0],
    dispPrev:(i)=>cascades[i].rt[cascades[i].cur ^ 1].textures[0],
    textures:(i)=>cascades[i].rt[cascades[i].cur].textures,
    setWeather(m){ sea.wind = m.wind; sea.chop = m.chop; rebuild(); },
    nudgeWind(d){ sea.wind = Math.min(30, Math.max(1, sea.wind + d)); rebuild(); },
  };
}
