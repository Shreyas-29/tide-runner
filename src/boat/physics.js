import * as THREE from 'three';
import { QUAD_VS } from '../core/gpu.js';
import { smooth, clamp } from '../core/math.js';

/* ================================================================== *
 *  The boat on the sea. A tiny GPU pass reads the wave height under
 *  twelve points of the hull (undoing the choppy displacement), the
 *  result comes back asynchronously, and a plane fitted through them
 *  gives the water's level and slopes under the boat.
 *  A 16 m steel boat is heavy: its length averages out the chop and it
 *  answers the swell slowly, so the sea it feels is low-passed and its
 *  slopes softened; slow, well-damped springs then carry heave, pitch
 *  and roll. Planing lifts and trims it with speed, it squats under
 *  acceleration and banks into turns.
 *  State: heading h (forward is (sin h, 0, cos h)), speed u, yaw rate r,
 *  heave y, pitch (bow up), roll (port up).
 * ================================================================== */
const PROBES = [[-1.6, -6.5], [1.6, -6.5], [-1.9, -3.5], [1.9, -3.5], [-1.9, -.5], [1.9, -.5], [-1.8, 2.5], [1.8, 2.5], [-1.1, 5.2], [1.1, 5.2], [0, 7.2], [0, -7.6]];

export function createBoatPhysics(app, ocean){
  const { renderer } = app;
  const Ls = ocean.cascades.map((c)=>c.L.toFixed(1));
  const S = { x:0, z:0, h:0, u:0, r:0, rud:0, y:0, vy:0, pitch:0, vp:0, roll:0, vr:0, au:0, wl:0, lev:0, sz:0, sx:0, thr:0, thrIn:0 };   /* wl: the mean water level under the hull */

  const probeRT = new THREE.WebGLRenderTarget(16, 1, { type:THREE.FloatType, minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter, depthBuffer:false, stencilBuffer:false, generateMipmaps:false });
  const probeMat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3, vertexShader:QUAD_VS,
    uniforms:{ tD0:{ value:null }, tD1:{ value:null }, uP:{ value:Array.from({ length:16 }, ()=>new THREE.Vector2()) } },
    fragmentShader:`uniform sampler2D tD0, tD1; uniform vec2 uP[16]; out vec4 o;
      /* the hull is too big to feel the shortest waves: sample the two long cascades, a little blurred */
      vec3 D(vec2 g){ return textureLod(tD0, g/${Ls[0]}, 0.).xyz + textureLod(tD1, g/${Ls[1]}, 2.).xyz; }
      void main(){
        vec2 p = uP[int(gl_FragCoord.x)], x = p;
        for(int k=0;k<4;k++) x = p - D(x).xz;                  /* which point of the undisplaced sea lands here */
        o = vec4(D(x).y, 0., 0., 1.);
      }` });
  const buf = new Float32Array(64), heights = new Float32Array(PROBES.length);
  let pending = false, ready = false;
  function probe(){
    const c = Math.cos(S.h), sn = Math.sin(S.h);
    PROBES.forEach(([x, z], i)=>probeMat.uniforms.uP.value[i].set(S.x + x*c + z*sn, S.z - x*sn + z*c));
    probeMat.uniforms.tD0.value = ocean.disp(0); probeMat.uniforms.tD1.value = ocean.disp(1);
    app.runPass(probeMat, probeRT);
    if(pending) return;
    pending = true;
    renderer.readRenderTargetPixelsAsync(probeRT, 0, 0, 16, 1, buf)
      .then(()=>{ for(let i=0;i<PROBES.length;i++) heights[i] = buf[i*4]; ready = true; })
      .finally(()=>{ pending = false; });
  }

  /* c: { fwd, back, left, right, boost, stick:{ on, x, y } } */
  function step(dt, c){
    /* thrust against water drag: about 23 knots flat out, 29 with boost */
    let thrust = c.fwd ? (c.boost ? 5.2 : 3.2) : c.back ? (S.u > .5 ? -4 : -1.4) : 0;
    if(c.stick.on){   /* the touch stick: up is throttle (to the rim boosts), down is astern */
      if(c.stick.y > .12) thrust = c.stick.y > .92 ? 5.2 : 3.2*Math.min(1, c.stick.y/.85);
      else if(c.stick.y < -.12) thrust = S.u > .5 ? -4*Math.min(1, -c.stick.y) : -1.4;
    }
    S.thrIn = thrust;
    const acc = thrust - .012*S.u*Math.abs(S.u) - .12*S.u;
    S.thr += (Math.abs(thrust)/5.2 + .25*Math.min(1, Math.abs(S.u)/8) - S.thr)*Math.min(1, dt*3);
    S.u += acc*dt; S.au += (acc - S.au)*Math.min(1, dt*2);
    const steer = (c.left ? 1 : 0) - (c.right ? 1 : 0) - (c.stick.on ? c.stick.x : 0);
    S.rud += (clamp(steer, -1, 1) - S.rud)*Math.min(1, dt*3);
    const rT = S.rud*.3*Math.min(1, Math.abs(S.u)/3)*Math.sign(S.u);
    S.r += (rT - S.r)*Math.min(1, dt*1.6);
    S.h += S.r*dt;
    S.x += Math.sin(S.h)*S.u*dt; S.z += Math.cos(S.h)*S.u*dt;

    /* fit a plane through the probe heights: mean height, slope along and across the hull */
    let hm = 0, xm = 0, zm = 0, sxz = 0, szz = 0, sxh = 0, sxx = 0;
    if(ready){
      const n = PROBES.length;
      PROBES.forEach(([x, z], i)=>{ hm += heights[i]; xm += x; zm += z; }); hm /= n; xm /= n; zm /= n;
      PROBES.forEach(([x, z], i)=>{ const dh = heights[i] - hm; sxz += (z - zm)*dh; szz += (z - zm)**2; sxh += (x - xm)*dh; sxx += (x - xm)**2; });
    }
    const slopeZ = szz ? sxz/szz : 0, slopeX = sxx ? sxh/sxx : 0;
    const pl = smooth(4, 12, S.u), hump = Math.exp(-(((S.u - 7)/3)**2));
    S.wl += (hm - slopeZ*zm - S.wl)*Math.min(1, dt*4);
    const lp = Math.min(1, dt*1.4);
    S.lev += (hm - slopeZ*zm - S.lev)*Math.min(1, dt*3); S.sz += (slopeZ*.55 - S.sz)*lp; S.sx += (slopeX*.45 - S.sx)*lp;
    const yT = S.lev + .08 + .22*pl;   /* rides with the red boot stripe on the water */
    const pT = Math.atan(S.sz) + .045*pl + .035*hump + .012*S.au;
    const rlT = Math.atan(S.sx) - .045*S.u*S.r;
    S.vy += (8*(yT - S.y) - 4.8*S.vy)*dt; S.y += S.vy*dt;
    if(S.y > yT + .1){ S.y = yT + .1; S.vy = Math.min(S.vy, 0); }   /* never hangs above a trough: lifted out, the water lets go */
    S.vp += (3.6*(pT - S.pitch) - 3.4*S.vp)*dt; S.pitch += S.vp*dt;
    S.vr += (2.6*(rlT - S.roll) - 2.6*S.vr)*dt; S.roll += S.vr*dt;
  }
  return { state:S, probe, step };
}
