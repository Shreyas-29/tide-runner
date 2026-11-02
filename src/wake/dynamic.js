import * as THREE from 'three';
import { DYN } from '../config.js';
import { QUAD_VS, pingPong, simTarget } from '../core/gpu.js';

/* ================================================================== *
 *  Dynamic waves near the boat (the Crest approach): a wave-equation
 *  height field on a 128 m grid that rides with the boat, added on top
 *  of the FFT sea. Two wave speeds run side by side as a crude
 *  dispersion, so a disturbance spreads as nested lines of ripples.
 *
 *  The forcing is the water the hull displaces. For every cell under
 *  the hull we measure how deep the hull bottom sits below the FFT sea
 *  right there (the hull's pose: heave, pitch, roll; the sea: this
 *  frame's waves). When that depth changes, the water is pushed up or
 *  let down. So:
 *   - underway, the bow throws a crest that peels away in a V and the
 *     transom leaves a trough;
 *   - at rest, every passing crest that rises against the side is
 *     shoved back out: the hull repels the sea and rings spread from
 *     it, on whichever side the waves arrive;
 *   - heave and pitch slap out rings of their own.
 *  The propellers add churned boils behind the transom. The edges are a
 *  sponge, so nothing reflects back into the grid.
 * ================================================================== */
export function createDynamicWaves(app, ocean){
  const { RES, DX, C, PUSH } = DYN;
  const vessel = app.vessel;
  const grid = pingPong(RES, RES, simTarget(THREE.HalfFloatType, THREE.LinearFilter));
  const rect = { value:new THREE.Vector4(0, 0, 1/(RES*DX), DX) };   /* origin xz, 1/size, cell: shared with the surface and the wake */
  const Ls = ocean.cascades.map((c)=>c.L.toFixed(1));

  const tex = (n)=>Object.fromEntries([0, 1, 2].map((i)=>[`t${n}${i}`, { value:null }]));
  const mat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3, vertexShader:QUAD_VS,
    uniforms:{ tPrev:{ value:null }, uShift:{ value:new THREE.Vector2() }, uOrigin:{ value:new THREE.Vector2() }, uDT:{ value:0 }, uReset:{ value:1 },
               uP0:{ value:new THREE.Vector4() }, uP1:{ value:new THREE.Vector4() }, uQ0:{ value:new THREE.Vector4() }, uQ1:{ value:new THREE.Vector4() }, uSeaK:{ value:DYN.SEA },
               uFrac:{ value:new THREE.Vector2() }, uPush:{ value:PUSH }, uThrust:{ value:0 }, uTime:{ value:0 }, ...tex('A'), ...tex('B') },
    fragmentShader: /* glsl */`
      uniform sampler2D tPrev, tA0, tA1, tA2, tB0, tB1, tB2;   /* the sea last frame (A) and this frame (B) */
      uniform vec2 uShift, uOrigin, uFrac; uniform float uDT, uReset, uPush, uThrust, uTime, uSeaK;
      uniform vec4 uP0, uP1;   /* hull pose at the substep's start and end: x, z, forward x, forward z */
      uniform vec4 uQ0, uQ1;   /* and its heave y, sin(pitch, bow up), sin(roll, port up), the mean water level it floats on */
      out vec4 o;
      vec4 at(ivec2 q){ return (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(${RES}))) || uReset > .5) ? vec4(0.) : texelFetch(tPrev, q, 0); }
      /* the FFT sea's height here (the short cascade blurred a little: it is the hull, not a pixel, that feels it) */
      float seaA(vec2 p){ return textureLod(tA0, p/${Ls[0]}, 0.).y + textureLod(tA1, p/${Ls[1]}, 0.).y + .7*textureLod(tA2, p/${Ls[2]}, 1.).y; }
      float seaB(vec2 p){ return textureLod(tB0, p/${Ls[0]}, 0.).y + textureLod(tB1, p/${Ls[1]}, 0.).y + .7*textureLod(tB2, p/${Ls[2]}, 1.).y; }
      /* how deep the hull bottom sits under the water surface h at p: boat.js's waterplane, a keel that rises
         toward the bow, deadrise up to the chines, then the hull's heave, pitch and roll */
      float immersion(vec2 p, vec4 P, vec4 Q, float h){
        vec2 r = p - P.xy; float lx = dot(r, P.zw), lys = dot(r, vec2(P.w, -P.z)), ly = abs(lys);
        float t = (lx + 8.)/16.;
        float u = max(0., (t - .45)/.55), w = 2.3*pow(max(0., 1. - pow(u, 1.8)), .8);
        float across = 1. - smoothstep(w - .4, w + .25, ly);
        float along = smoothstep(-.03, .08, t)*(1. - smoothstep(.9, 1.02, t));
        float keel = -.85 + 1.4*pow(smoothstep(.45, 1., t), 2.1) + .3*clamp(ly/max(w, .3), 0., 1.);
        float bottom = Q.x + lx*Q.y + lys*Q.z + keel;
        return across*along*clamp(h - bottom, 0., 1.6);
      }
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy), q = ij + ivec2(uShift);
        vec4 c = at(q);
        vec4 n4 = at(q + ivec2(1, 0)) + at(q - ivec2(1, 0)) + at(q + ivec2(0, 1)) + at(q - ivec2(0, 1));
        vec2 lap = (n4.rb - 4.*c.rb)/${(DX*DX).toFixed(4)};
        /* a sponge round the edge so waves leave the grid instead of bouncing */
        float e = float(min(min(ij.x, ij.y), min(${RES - 1} - ij.x, ${RES - 1} - ij.y)));
        float damp = .3 + 5.*pow(1. - smoothstep(0., 48., e), 2.);
        vec2 v = (c.ga + vec2(${(C[0]**2).toFixed(3)}, ${(C[1]**2).toFixed(3)})*lap*uDT)*exp(-damp*uDT);
        vec2 h = c.rb + v*uDT;
        h = mix(h, n4.rb*.25, .015);   /* a touch of smoothing keeps grid-scale noise out */
        vec2 p = uOrigin + (vec2(ij) + .5)*${DX.toFixed(2)};
        /* the displaced water: pushed up where the hull goes deeper (it arrives, or a crest climbs its side), let down where it lifts out */
        /* the water against the hull: its mean level plus a share of the local wave relief. The hull rides the
           long swell, so only the waves it can't follow are thrown back, and only as much as a real hull reflects */
        float a = seaA(p), b = seaB(p);
        float w0 = uQ0.w + uSeaK*(mix(a, b, uFrac.x) - uQ0.w), w1 = uQ1.w + uSeaK*(mix(a, b, uFrac.y) - uQ1.w);
        float push = uPush*(immersion(p, uP1, uQ1, w1) - immersion(p, uP0, uQ0, w0));
        h += push*vec2(.7, .4);
        /* the propellers churn the water behind the transom: lumpy boils that ripple outward, even at low speed */
        vec2 rr = p - uP1.xy; float lx = dot(rr, uP1.zw), ly = dot(rr, vec2(uP1.w, -uP1.z));
        float pw = exp(-ly*ly/1.4)*smoothstep(-15., -9.5, lx)*(1. - smoothstep(-8.6, -7.8, lx));
        vec2 q2 = p*1.1;
        float turb = sin(q2.x*1.3 + uTime*4.1)*sin(q2.y*1.1 - uTime*3.3) + .7*sin(q2.x*2.3 - q2.y*1.9 + uTime*6.2) + .5*sin(q2.y*3.1 + q2.x*.7 - uTime*7.7);
        h.x += .45*uThrust*pw*turb*uDT;
        o = vec4(clamp(h.x, -1.2, 1.2), clamp(v.x, -5., 5.), clamp(h.y, -1.2, 1.2), clamp(v.y, -5., 5.));
      }` });

  const st = { oi:null, P:null, Q:null, warm:0 };
  const lerp = (A, B, t)=>A.map((v, k)=>v + (B[k] - v)*t);
  function update(dt){
    const b = vessel, u = mat.uniforms;
    for(let i=0;i<3;i++){ u[`tA${i}`].value = ocean.dispPrev(i); u[`tB${i}`].value = ocean.disp(i); }
    const n = Math.max(1, Math.ceil(dt*60 - .01)), h = dt/n;
    const P1 = [b.x, b.z, Math.sin(b.heading), Math.cos(b.heading)], Q1 = [b.y, Math.sin(b.pitch), Math.sin(b.roll), b.lev];
    const P0 = st.P || P1, Q0 = st.Q || Q1;
    const jump = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) > 20;
    /* the first frames have no previous sea to compare against: settle before pushing */
    u.uPush.value = b.active && st.warm > 3 ? PUSH : 0; st.warm++;
    for(let i=0;i<n;i++){
      const a0 = i/n, a = (i + 1)/n, pb = lerp(P0, P1, a);
      const oi = [Math.floor(pb[0]/DX) - RES/2, Math.floor(pb[1]/DX) - RES/2];
      const reset = !st.oi || jump;
      u.uShift.value.set(reset ? 0 : oi[0] - st.oi[0], reset ? 0 : oi[1] - st.oi[1]);
      st.oi = oi; u.uOrigin.value.set(oi[0]*DX, oi[1]*DX); u.uReset.value = reset ? 1 : 0;
      u.uDT.value = h; u.uFrac.value.set(a0, a);
      u.uP0.value.set(...lerp(P0, P1, a0)); u.uP1.value.set(...pb);
      u.uQ0.value.set(...lerp(Q0, Q1, a0)); u.uQ1.value.set(...lerp(Q0, Q1, a));
      u.uThrust.value = b.active ? b.thr : 0; u.uTime.value += h;
      u.tPrev.value = grid.read.texture;
      app.runPass(mat, grid.write); grid.swap();
    }
    st.P = P1; st.Q = Q1;
    rect.value.set(st.oi[0]*DX, st.oi[1]*DX, 1/(RES*DX), DX);
  }

  return { update, rect, grid, get texture(){ return grid.read.texture; }, uniforms:{ tDyn:{ get value(){ return grid.read.texture; } }, uDynRect:rect }, glsl:DYN_GLSL };
}

/* the surface's side: the dynamic waves' height, faded out at the grid's edge */
const DYN_GLSL = /* glsl */`
  uniform sampler2D tDyn; uniform vec4 uDynRect;
  float dynH(vec2 p){ vec2 uv = (p - uDynRect.xy)*uDynRect.z, e = min(uv, 1. - uv); vec4 t = texture(tDyn, uv); return (t.r + t.b)*smoothstep(.05, .2, min(e.x, e.y)); }`;
