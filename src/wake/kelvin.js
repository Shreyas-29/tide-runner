import * as THREE from 'three';
import { WAKE } from '../config.js';
import { wrapA } from '../core/math.js';
import { QUAD_VS, pingPong, simTarget } from '../core/gpu.js';

/* ================================================================== *
 *  Wake: a world-anchored map around the boat (1024 m, 1 m texels),
 *  ping-ponged every frame. As the bow sweeps across the water it
 *  stamps each texel with where on the path it was passed: the boat's
 *  odometer S, the signed distance y off the track and the time T.
 *  From those the surface evaluates an analytic Kelvin wake per pixel
 *  (deep water, stationary phase, bow and stern sources), so the 19.5°
 *  V, its transverse and divergent waves travel, disperse and fade as
 *  they should and bend with a curved course. The fourth channel is
 *  churned foam: prop wash, hull spray, and whitewater wherever the sea
 *  piles up against the hull, then spread and faded over a minute.
 *  The vessel (app.vessel) drives it: heading h, forward (sin h, cos h).
 * ================================================================== */
export function createWake(app, dyn){
  const { RES, TEX, REACH } = WAKE;
  const vessel = app.vessel;
  /* float32 for the odometer's precision; read with texelFetch (filtering float32 is slow on Apple GPUs) */
  const map = pingPong(RES, RES, simTarget(THREE.FloatType));
  const mat = new THREE.ShaderMaterial({ glslVersion:THREE.GLSL3, vertexShader:QUAD_VS,
    uniforms:{ tPrev:{ value:null }, uShift:{ value:new THREE.Vector2() }, uOrigin:{ value:new THREE.Vector2() }, uDT:{ value:0 }, uReset:{ value:1 },
               uL0:{ value:new THREE.Vector4() }, uL1:{ value:new THREE.Vector4() }, uST:{ value:new THREE.Vector4() }, uReach:{ value:new THREE.Vector2() },
               uHull:{ value:new THREE.Vector4() }, uHullDim:{ value:new THREE.Vector4() }, tDyn:{ value:null }, uDynRect:dyn.rect },
    fragmentShader: /* glsl */`
      uniform sampler2D tPrev, tDyn; uniform vec2 uShift, uOrigin, uReach; uniform float uDT, uReset;
      uniform vec4 uL0, uL1, uST, uHull, uHullDim, uDynRect;   /* bow line then / now (centre, forward); S0 S1 T0 T1; hull centre, forward; length, beam, speed, active */
      out vec4 o;
      const vec4 EMPTY = vec4(0., 0., -1e6, 0.);
      vec4 prevAt(ivec2 q){ return (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(${RES}))) || uReset > .5) ? EMPTY : texelFetch(tPrev, q, 0); }
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy), q = ij + ivec2(uShift);
        vec4 c = prevAt(q);
        /* foam spreads sideways like turbulent diffusion (~0.4 m²/s) and fades */
        float nb = prevAt(q + ivec2(1, 0)).a + prevAt(q - ivec2(1, 0)).a + prevAt(q + ivec2(0, 1)).a + prevAt(q - ivec2(0, 1)).a;
        float f = (c.a + (nb*.25 - c.a)*min(uDT*1.6, .5))*exp(-uDT/26.);
        vec2 p = uOrigin + (vec2(ij) + .5)*${TEX.toFixed(1)};

        /* the bow line swept over this texel since last frame: remember where on the path it was */
        vec2 r0 = p - uL0.xy, dc = uL1.xy - uL0.xy, df = uL1.zw - uL0.zw;
        float den = dot(dc, uL0.zw) - dot(r0, df);
        if(den > 1e-7){
          float s = dot(r0, uL0.zw)/den;
          if(s >= 0. && s < 1.){
            vec2 fs = normalize(mix(uL0.zw, uL1.zw, s));
            float y = dot(p - mix(uL0.xy, uL1.xy, s), vec2(fs.y, -fs.x));
            if(y < uReach.x && y > -uReach.y) c.rgb = vec3(mix(uST.x, uST.y, s), y, mix(uST.z, uST.w, s));
          }
        }

        /* foam from the hull, in its own frame (lx forward from the centre, ly out from the keel) */
        vec2 hr = p - uHull.xy; float lx = dot(hr, uHull.zw), ly = abs(dot(hr, vec2(uHull.w, -uHull.z)));
        float L = uHullDim.x, B = uHullDim.y, st = -.5*L, sp = smoothstep(.5, 4., uHullDim.z)*min(uHullDim.z/6., 1.4)*uHullDim.w;
        /* prop wash: a churned strip from the transom aft */
        float wash = (1. - smoothstep(.2*B, .48*B, ly))*smoothstep(st - 8., st - 2., lx)*(1. - smoothstep(st + .5, st + 2., lx));
        /* spray where the bow wave breaks along the topsides and peels away aft */
        float off = ly - .5*B - .12*(.5*L - lx);
        float side = (1. - smoothstep(.2, 1.1, abs(off - .3)))*smoothstep(-.35*L, .05*L, lx)*(1. - smoothstep(.38*L, .5*L, lx));
        f = max(f, max(wash*.95, side*.16)*sp);
        /* the sea against the hull: where the dynamic waves pile water up along the waterline, it breaks white */
        float t = (lx + .5*L)/L, u = max(0., (t - .45)/.55), w = 2.3*pow(max(0., 1. - pow(u, 1.8)), .8);
        float band = smoothstep(-.4, .1, ly - w)*(1. - smoothstep(.4, 1.8, ly - w))*smoothstep(-.02, .06, t)*(1. - smoothstep(.98, 1.08, t));
        vec2 duv = (p - uDynRect.xy)*uDynRect.z; vec4 dv = texture(tDyn, duv);
        float slam = smoothstep(.07, .3, dv.r + dv.b)*band*uHullDim.w;
        f = max(f, slam*.85);
        o = vec4(c.rgb, min(f, 1.6));
      }` });

  const st = { oi:null, S:0, T:0, bow:null, f:null, hdg:0, turn:0 };
  function update(dt){
    const b = vessel, u = mat.uniforms;
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading), bx = b.x + fx*b.length*.5, bz = b.z + fz*b.length*.5;
    /* recentre on the boat in whole texels, so what is stored never gets resampled */
    const oi = [Math.floor(b.x/TEX) - RES/2, Math.floor(b.z/TEX) - RES/2];
    const reset = !st.oi;
    u.uShift.value.set(reset ? 0 : oi[0] - st.oi[0], reset ? 0 : oi[1] - st.oi[1]);
    st.oi = oi; u.uOrigin.value.set(oi[0]*TEX, oi[1]*TEX); u.uReset.value = reset ? 1 : 0;
    u.uDT.value = dt;
    /* the bow line, from where it was to where it is (no sweep on a jump or when idle) */
    const moved = st.bow ? Math.hypot(bx - st.bow[0], bz - st.bow[1]) : 0;
    const snap = Math.abs(wrapA(b.heading - st.hdg)) > .2;   /* a teleport or the opening heading: start a fresh line, don't fan a wedge */
    const sweep = b.active && st.bow && moved > 0 && moved < 30 && !snap;
    const first = !st.bow && b.active;   /* the first frame: lay the track 40 m back under the boat, so there is no edge where it began */
    const p0 = sweep ? st.bow : first ? [bx - fx*40, bz - fz*40] : [bx, bz], f0 = sweep ? st.f : [fx, fz];
    u.uL0.value.set(p0[0], p0[1], f0[0], f0[1]); u.uL1.value.set(bx, bz, fx, fz);
    u.uST.value.set(first ? st.S - 40 : st.S, st.S + (sweep ? moved : 0), st.T, st.T + dt);
    /* in a turn the lines fan through the turn's centre: keep the inner side short of it */
    const turn = dt > 0 && !snap ? wrapA(b.heading - st.hdg)/dt : 0;
    st.turn += (turn - st.turn)*Math.min(1, dt*2);
    const inner = Math.min(REACH, .7*Math.max(b.speed, .1)/Math.max(Math.abs(st.turn), 1e-4));
    u.uReach.value.set(st.turn > 0 ? inner : REACH, st.turn < 0 ? inner : REACH);
    u.uHull.value.set(b.x, b.z, fx, fz); u.uHullDim.value.set(b.length, b.beam, b.speed, b.active ? 1 : 0);
    u.tDyn.value = dyn.texture;
    u.tPrev.value = map.read.texture;
    app.runPass(mat, map.write); map.swap();
    if(sweep) st.S += moved;
    st.T += dt; st.bow = [bx, bz]; st.f = [fx, fz]; st.hdg = b.heading;
  }

  /* the surface's view of the wake */
  const uniforms = {
    tWake:{ value:null }, uWakeRect:{ value:new THREE.Vector4(0, 0, 1/(RES*TEX), TEX) }, uWakeNow:{ value:new THREE.Vector4(0, 0, WAKE.AMP, 16) },
    uWakeHull:{ value:new THREE.Vector4() }, uWakeTurn:{ value:0 },
  };
  function bind(){
    const hl = .22*vessel.length, hb = .3*vessel.beam;
    uniforms.tWake.value = map.read.texture;
    uniforms.uWakeRect.value.x = (st.oi ? st.oi[0] : 0)*TEX; uniforms.uWakeRect.value.y = (st.oi ? st.oi[1] : 0)*TEX;
    uniforms.uWakeNow.value.x = st.S; uniforms.uWakeNow.value.y = st.T; uniforms.uWakeNow.value.w = vessel.length;
    uniforms.uWakeHull.value.set(hl*hl/4, hb*hb/4, .35, 1.8);   /* a fast hull's wake is mostly the divergent V, its transverse waves are weak */
    const r = mat.uniforms.uReach.value; uniforms.uWakeTurn.value = st.turn > 0 ? r.x : -r.y;
  }
  return { update, bind, uniforms, glsl:KELVIN_GLSL };
}

/* the surface's side: Kelvin waves from the stored path coordinates */
const KELVIN_GLSL = /* glsl */`
  uniform sampler2D tWake; uniform vec4 uWakeRect, uWakeNow, uWakeHull; uniform float uWakeTurn;   /* origin xz, 1/size, texel; S, T, amplitude, length; hull filter; signed reach inside a turn */
  /* bilinear by hand from four texels, which also gives the gradients along x and z */
  vec4 wakeTap(vec2 p, out vec4 gx, out vec4 gz){
    vec2 t = (p - uWakeRect.xy)/uWakeRect.w - .5, fl = floor(t), f = t - fl;
    ivec2 i = clamp(ivec2(fl), ivec2(0), ivec2(${WAKE.RES - 2}));
    vec4 a = texelFetch(tWake, i, 0), b = texelFetch(tWake, i + ivec2(1, 0), 0), c = texelFetch(tWake, i + ivec2(0, 1), 0), d = texelFetch(tWake, i + ivec2(1, 1), 0);
    gx = mix(b - a, d - c, f.y)/uWakeRect.w; gz = mix(c - a, d - b, f.x)/uWakeRect.w;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec4 wakeTap(vec2 p){ vec4 gx, gz; return wakeTap(p, gx, gz); }
  float wakeIn(vec2 p){ vec2 uv = (p - uWakeRect.xy)*uWakeRect.z, e = min(uv, 1. - uv); return smoothstep(0., .04, min(e.x, e.y)); }
  /* one stationary-phase wave train, t = tan of its angle to the track: height and its x, y derivatives */
  vec3 kBranch(float t, float kx, float k0, float sy, float fp, float ph0){
    float t2 = t*t, c2 = 1. + t2, sec = sqrt(c2), psi = kx*sec*c2/(1. + 2.*t2), pp = psi*(1. - 2.*t2);
    float k = k0*c2, kc = k/sec, ks = kc*t;
    float H = (.3 + .7*smoothstep(.1, .3, k))*exp(-kc*kc*uWakeHull.x - ks*ks*uWakeHull.y)*(1. - smoothstep(.05, .18, fp*k*.159));   /* the hull is too big to make short waves; fade what the pixel can't resolve */
    float a = c2*H*sqrt(6.2832/(sqrt(pp*pp + 2.*pow(kx, 1.333)) + 3.));                        /* the Airy limit caps the cusp lines */
    float ph = psi + ph0;
    return a*vec3(cos(ph), -sin(ph)*kc, sin(ph)*ks*sy);
  }
  /* Kelvin's ship waves at x metres behind a point source, y off its track: transverse plus divergent, 19.47° cusps */
  vec3 kelvin(float x, float y, float k0, float fp){
    if(x < .3) return vec3(0.);
    float a = abs(y)/x, q = 1. - 8.*a*a, sq = sqrt(max(q, 0.)), kx = k0*x, sy = y < 0. ? -1. : 1.;
    if(q < -2.) return vec3(0.);
    vec3 h = uWakeHull.z*kBranch(2.*a/(1. + sq), kx, k0, sy, fp, .785) + uWakeHull.w*kBranch(min((1. + sq)/(4.*a + 1e-4), 5.), kx, k0, sy, fp, -.785);
    return h*exp(-pow(max(-q, 0.), 1.5)*kx*.5)*smoothstep(.3, 7., kx);   /* the far-field form only holds a wavelength or so behind the source */
  }
  /* the wake's waves from a map sample: height and its derivatives along (D, metres behind the bow) and across (y) the track */
  vec3 wakeWaves(vec4 w, float fp){
    float D = uWakeNow.x - w.r, age = uWakeNow.y - w.b;
    if(age > 240. || D < .3 || D > 240.) return vec3(0.);
    float U = D/max(age, .05);
    if(U < .4) return vec3(0.);
    float k0 = 9.81/(U*U), L = uWakeNow.w;
    vec3 h = kelvin(D - .08*L, w.g, k0, fp) - .5*kelvin(D - .9*L, w.g, k0, fp);
    float r = abs(uWakeTurn) > 1. && w.g*uWakeTurn > 0. ? abs(uWakeTurn) : ${WAKE.REACH}.;   /* fade out before the stamped lines end */
    h *= 1. - smoothstep(.6*r, .95*r, abs(w.g));
    return h*uWakeNow.z*min(U*U/36., 2.5)*exp(-age/45.)*(1. - smoothstep(110., 240., D))*smoothstep(0., 25., w.r);   /* no hard edge where the track began */
  }`;
