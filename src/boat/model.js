import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ================================================================== *
 *  Tiderunner: a 16 m pilot boat, built entirely from code. Boat space
 *  is metres, +z is the bow, +x is port, y is up, the waterline is
 *  y = 0. buildBoat() returns the group plus its parts, a spin() for
 *  the props and radar, and setLights() for the lamps and the cabin
 *  windows (bright at night, off by day).
 * ================================================================== */

/* ---------------- helpers ---------------- */
const sm = (a, b, x)=>{ x = Math.min(1, Math.max(0, (x - a)/(b - a))); return x*x*(3 - 2*x); };
const lerp = (a, b, t)=>a + (b - a)*t;
const V3 = THREE.Vector3;
function gridGeo(rows, cols, fn){
  const pos = [], idx = [];
  for(let i=0;i<=rows;i++) for(let j=0;j<=cols;j++) pos.push(...fn(i/rows, j/cols, i, j));
  for(let i=0;i<rows;i++) for(let j=0;j<cols;j++){ const a = i*(cols + 1) + j, b = a + cols + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
/* make every face point away from a reference point */
function orient(g, outward){
  const p = g.attributes.position, n = g.attributes.normal; let s = 0;
  for(let i=0;i<p.count;i+=3){ const o = outward(p.getX(i), p.getY(i), p.getZ(i)); s += n.getX(i)*o[0] + n.getY(i)*o[1] + n.getZ(i)*o[2]; }
  if(s < 0){ const ix = g.index.array; for(let i=0;i<ix.length;i+=3){ const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; g.computeVertexNormals(); }
  return g;
}
const mirrorX = (g)=>{ const m = g.clone(); m.scale(-1, 1, 1); if(m.index){ const ix = m.index.array; for(let i=0;i<ix.length;i+=3){ const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } } m.computeVertexNormals(); return m; };
function mesh(g, mat, parent, shadow = true){ const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; }
function tube(points, r, seg = 64, rs = 10){ return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), seg, r, rs, false); }
const rbox = (w, h, d, r, x, y, z)=>new RoundedBoxGeometry(w, h, d, 3, r).translate(x, y, z);
/* a straight strut between two points with an elliptical (foil-like) section */
function strut(a, b, chord, thick){
  const d = new V3().subVectors(b, a), g = new THREE.CylinderGeometry(.5, .5, d.length(), 16, 1);
  g.scale(thick, 1, chord);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x)/2, (a.y + b.y)/2, (a.z + b.z)/2);
}

/* ---------------- hull lines (t: 0 = transom, 1 = stem) ---------------- */
const Z = (t)=>-8 + 16*t;
const plan = (t)=>{ const u = Math.max(0, (t - .6)/.4); return Math.pow(Math.max(0, 1 - Math.pow(u, 1.6)), .7); };   /* traced from the top view */
const sheerY = (t)=>1.55 + 0.75*Math.pow(t, 1.8);
const sheerX = (t)=>2.5*plan(t);
const chineX = (t)=>t < .35 ? 2.2 : 2.2*Math.pow(Math.max(0, 1 - Math.pow((t - .35)/.65, 1.9)), .75);
const chineY = (t)=>-0.2 + 0.85*Math.pow(sm(.3, 1, t), 1.5);
const keelY = (t)=>-0.85 + 1.4*Math.pow(sm(.45, 1, t), 2.1);
const rake = (t, y)=>(y - keelY(t))*.42*sm(.8, 1, t);          /* the stem leans forward toward the deck */
const tz = (z)=>(z + 8)/16;
const deckAt = (t, x)=>sheerY(t) - .02 + .07*(1 - (x/2.5)**2);

/* ================================================================== *
 *  Materials. Every one gets the same weathering layer (after the
 *  River Voyage ship): broad tone patches, rain streaks on vertical
 *  faces, dust on the tops, gloss variation and a faint wavy normal,
 *  so no surface is a flat colour. Part shaders add their own detail
 *  on top, including a height field (gH) that bumps the normal.
 * ================================================================== */
const NOISE = /* glsl */`
float wh3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719)))*43758.5453); }
float wn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  return mix(mix(mix(wh3(i), wh3(i + vec3(1,0,0)), f.x), mix(wh3(i + vec3(0,1,0)), wh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wh3(i + vec3(0,0,1)), wh3(i + vec3(1,0,1)), f.x), mix(wh3(i + vec3(0,1,1)), wh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float wfbm(vec3 p){ float s = 0., a = .5; for(int i=0;i<4;i++){ s += a*wn3(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s/.9375; }
float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
`;
function shade(mat, o = {}, decl = '', body = ''){
  const W = { patch:.12, streak:.15, dust:0, gloss:.1, wavy:.002, ...o };
  const f = (v)=>(+v).toFixed(4);
  mat.onBeforeCompile = (sh)=>{
    Object.assign(sh.uniforms, mat.userData.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aK; varying vec3 vP; varying vec3 vN; varying vec4 vK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN = normal; vK = aK;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN; varying vec4 vK;\nfloat gR = -1., gM = -1., gC = -1., gH = 0., gW = 1., gRw = 0.;\n' + NOISE + decl)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${body}
        {
          vec3 wn = normalize(vN);
          float wBig = wfbm(vP*.9), wFine = wn3(vP*vec3(9., 2.2, 9.));
          float wStr = smoothstep(.45, .85, wn3(vec3(vP.x*7. + vP.z*7., vP.y*.6, vP.z*3.))*.7 + wFine*.3)*(1. - abs(wn.y));
          float wUp = smoothstep(.55, .95, wn.y)*smoothstep(.35, .75, wBig + wFine*.3);
          vec3 wc = diffuseColor.rgb;
          wc *= 1. + (wBig - .5)*2.*${f(W.patch)};
          wc *= 1. - ${f(W.streak)}*wStr;
          wc = mix(wc, vec3(.42, .41, .39)*(.35 + .4*wFine), ${f(W.dust)}*wUp);
          diffuseColor.rgb = mix(diffuseColor.rgb, wc, gW);
          gRw = ((wBig - .5)*2.*${f(W.gloss)} + wStr*.08)*gW;
          gH += (wfbm(vP*vec3(1.6, 4., 1.6)) - .5)*${f(W.wavy)}*gW;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif(gR >= 0.) roughnessFactor = gR;\nroughnessFactor = clamp(roughnessFactor + gRw, .03, 1.);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif(gM >= 0.) metalnessFactor = gM;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nif(gC >= 0.) material.clearcoat = gC;\n#endif')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1)*faceDirection;
          vec3 g = sign(det)*(dFdx(gH)*r1 + dFdy(gH)*r2);
          normal = normalize(abs(det)*normal - g);
        }`);
  };
  mat.customProgramCacheKey = ()=>decl + body + JSON.stringify(W);   /* each patched material needs its own program */
  return mat;
}
const lin = (r, g, b)=>new THREE.Color().setRGB(r, g, b);

/* the hull: gloss black with raised diagonal fender plates, a red boot stripe sweeping up to the bow, black antifouling below */
const hullMat = shade(new THREE.MeshPhysicalMaterial({ color:lin(.03, .031, .034), roughness:.34, metalness:.05, clearcoat:.7, clearcoatRoughness:.18 }), { patch:.2, streak:.25, wavy:.003 }, '', /* glsl */`
  {
    float t = clamp((vP.z + 8.)/16., 0., 1.);
    float sY = 1.55 + .75*pow(t, 1.8);
    float st = .1 + .5*pow(smoothstep(.45, 1., t), 1.6);
    vec3 n = normalize(vN);
    float sideF = smoothstep(.5, .7, abs(n.x));
    vec3 c = diffuseColor.rgb;
    float lo = st + .3, hi = sY - .36;
    float u = (vP.z - vP.y*.6)/2.05;
    float dSep = (.5 - abs(fract(u) - .5))*2.05 - .035;
    float d = min(dSep, min(vP.y - lo, hi - vP.y));
    float plate = sideF*smoothstep(0., .04, d)*(1. - smoothstep(.84, .9, t));
    gH += .014*plate;
    float band = sideF*step(lo, vP.y)*step(vP.y, hi)*(1. - smoothstep(.84, .9, t));
    c *= (1. + .9*plate)*(1. - .55*band*(1. - plate));
    float aa = fwidth(vP.y)*1.5 + .002;
    float stripe = 1. - smoothstep(-aa, aa, abs(vP.y - st) - .04);
    c = mix(c, vec3(.52, .035, .02), stripe);
    gH += .003*stripe;
    float below = smoothstep(aa, -aa, vP.y - (st - .04));
    c = mix(c, vec3(.022, .022, .024), below);
    diffuseColor.rgb = c;
    if(below > .5){ gR = .86; gC = .0; }
  }`);
const fenderMat = shade(new THREE.MeshStandardMaterial({ color:lin(.022, .022, .024), roughness:.72 }), { patch:.25, streak:.3, gloss:.15, wavy:.004 });
const deckMat = shade(new THREE.MeshStandardMaterial({ color:lin(.2, .21, .22), roughness:.85 }), { patch:.18, streak:0, dust:.15, wavy:0 }, '', /* glsl */`
  {
    float t = clamp((vP.z + 8.)/16., 0., 1.);
    float u = max(0., (t - .6)/.4);
    float e = 2.5*pow(max(0., 1. - pow(u, 1.6)), .7) - abs(vP.x);
    float hd = min(sdRR(vP.xz - vec2(0., 5.6), vec2(.42), .07), sdRR(vP.xz - vec2(-1.1, -6.35), vec2(.45, .32), .06));
    hd = min(hd, sdRR(vP.xz - vec2(1.15, -4.6), vec2(.3, .3), .05));
    float ns = smoothstep(.22, .25, e)*smoothstep(.06, .09, hd);          /* non-slip field with smooth margins */
    float grit = wn3(vP*vec3(55., 1., 55.));
    float groove = 1. - smoothstep(0., .016, abs(hd));
    vec3 c = diffuseColor.rgb;
    c *= mix(.78, .9 + .25*grit, ns);
    c *= 1. - .6*groove;
    gH += -.004*groove + .005*smoothstep(.01, -.01, hd) + .0012*grit*ns;
    diffuseColor.rgb = c;
    gR = mix(.5, .93, ns);
  }`);
/* the wheelhouse: glossy safety orange with glass set into it. vK carries (z, distance up from the
   window shoulder, length of the window band, x / half width), written by the loft below */
const CABIN = { value:0 };   /* the cabin lights, seen through the windows */
const houseMat = shade(new THREE.MeshPhysicalMaterial({ color:0xf0521c, roughness:.32, clearcoat:.9, clearcoatRoughness:.08 }), { patch:.08, streak:.12, dust:.05 }, 'uniform float uCabin;', /* glsl */`
  {
    vec3 c = diffuseColor.rgb; vec3 n = normalize(vN);
    float z = vK.x, du = vK.y, Lb = vK.z;
    float sd = 1e3;
    /* a long band of five side windows high in the tumblehome, with a corner post before the windscreen */
    if(abs(n.z) < .7 && z > -1.9 && z < 2.1 && du > -.2){
      float w0 = -1.72, pw = (1.84 - w0)/5.;     /* the band stops before the roof drops to the windscreen */
      float k = clamp(floor((z - w0)/pw), 0., 4.);
      float lo = .07, hi = Lb - .36;
      sd = sdRR(vec2(z - (w0 + (k + .5)*pw), du - (lo + hi)*.5), vec2(pw*.5 - .045, (hi - lo)*.5), .07);
    }
    /* the windscreen: three panes in the near-vertical front face */
    if(n.z > .55 && z > 1.8 && z < 2.4){
      float dm = min(abs(abs(vP.x) - .58) - .04, (.9 - abs(vK.w))*1.6);
      sd = min(sd, -min(min(vP.y - 2.72, 3.24 - vP.y), dm));
    }
    /* rear door with a small window */
    float door = 1e3;
    if(n.z < -.8){
      door = sdRR(vec2(vP.x - .62, vP.y - 2.5), vec2(.42, .86), .12);
      sd = min(sd, sdRR(vec2(vP.x - .62, vP.y - 2.98), vec2(.24, .22), .07));
    }
    float aa = length(fwidth(vP))*.9 + .001;       /* pixel size in metres: safe across the region boundaries */
    float glass = 1. - smoothstep(-aa, aa, sd);
    float ring = smoothstep(-aa, aa, sd)*(1. - smoothstep(.035 - aa, .035 + aa, sd));
    float seam = 1. - smoothstep(.0, .014, abs(door));
    /* a big louvred vent low on each side, aft */
    float vd = sdRR(vec2(z + 2.72, vP.y - 1.95), vec2(.55, .25), .1);
    float vent = step(.8, abs(n.x))*(1. - smoothstep(-aa, aa, vd));
    float vrim = step(.8, abs(n.x))*(1. - smoothstep(.0, .03, abs(vd)));
    float louv = smoothstep(.25, .6, abs(fract(vP.y*14.) - .5)*2.);
    c = mix(c, vec3(.012)*(1. + 1.5*louv), vent);
    c *= 1. - .55*seam;
    c = mix(c, vec3(.01), max(ring, vrim*.8));
    c = mix(c, vec3(.004, .006, .009), glass);
    gH += -.018*glass + .004*ring - .006*seam - .012*vent*(1. - louv) + .004*vrim;
    /* the roof top is a matte non-slip finish */
    float roof = smoothstep(.88, .95, n.y)*step(z, 1.9);
    c *= 1. - .1*roof;
    diffuseColor.rgb = c;
    if(roof > .5){ gR = .62; gC = .08; }
    if(vent > .5){ gR = .55; gC = .0; }
    if(ring > .5){ gR = .6; gC = .0; gW = .0; }
    if(glass > .5){ gR = .04; gM = .0; gC = .0; gW = .0; }
    /* a warm glow behind the glass, brighter low in the pane where the cabin lamps sit */
    totalEmissiveRadiance += vec3(1., .62, .3)*uCabin*glass*(.55 + .45*smoothstep(3.3, 2.6, vP.y));
  }`);
houseMat.userData.uniforms = { uCabin:CABIN };
const paint = shade(new THREE.MeshPhysicalMaterial({ color:0xf0521c, roughness:.32, clearcoat:.9, clearcoatRoughness:.08 }), { patch:.08, streak:.12, dust:.05 });
/* the roof cap: the same paint with panel seams and rows of bolts pressed into it */
const roofMat = shade(new THREE.MeshPhysicalMaterial({ color:0xf0521c, roughness:.4, clearcoat:.6, clearcoatRoughness:.15 }), { patch:.08, streak:.1, dust:.08 }, '', /* glsl */`
  {
    vec3 c = diffuseColor.rgb; vec3 n = normalize(vN);
    float top = step(.9, n.y);
    float aa = length(fwidth(vP))*.8 + .001;
    float dx = abs(abs(vP.x) - .62), dz = min(abs(vP.z + 1.25), abs(vP.z - .95));
    float seam = top*(1. - smoothstep(.008 - aa, .008 + aa, min(dx, dz)));
    vec2 q1 = vec2(dx - .055, mod(vP.z, .42) - .21), q2 = vec2(mod(vP.x + .21, .42) - .21, dz - .055);
    float bolt = top*(1. - smoothstep(.012 - aa, .012 + aa, min(length(q1), length(q2))));
    c *= 1. - .55*seam;
    c = mix(c, vec3(.45, .46, .48), bolt);
    gH += -.003*seam + .003*bolt;
    diffuseColor.rgb = c;
    if(bolt > .5){ gR = .3; gM = .9; gC = .0; }
  }`);
const trimMat = shade(new THREE.MeshStandardMaterial({ color:lin(.02, .021, .023), roughness:.6 }), { patch:.15, streak:.2 });
const steel = shade(new THREE.MeshStandardMaterial({ color:0xd9dcdf, roughness:.2, metalness:1 }), { patch:.06, streak:.1, gloss:.1 });
const darkMetal = shade(new THREE.MeshStandardMaterial({ color:lin(.03, .032, .035), roughness:.42, metalness:.3 }), { patch:.2, streak:.25 });
const white = shade(new THREE.MeshPhysicalMaterial({ color:lin(.82, .83, .83), roughness:.35, clearcoat:.5 }), { patch:.06, streak:.15, dust:.1 });
const bronze = shade(new THREE.MeshStandardMaterial({ color:0xc29455, roughness:.24, metalness:1 }), { patch:.12, streak:.05, gloss:.08 });
const strap = new THREE.MeshStandardMaterial({ color:lin(.08, .09, .1), roughness:.8 });
let GLOW = 1;   /* scales the lamps: the studio and the ocean expose differently */
const LAMPS = [];
const glow = (c, k = 3)=>{ const m = new THREE.MeshBasicMaterial({ color:new THREE.Color(c).multiplyScalar(k*GLOW) }); LAMPS.push([m, m.color.clone()]); return m; };


export function buildBoat({ glow:glowScale = 1 } = {}){
  GLOW = glowScale;
  /* ================================================================== *
   *  The parts
   * ================================================================== */
  const boat = new THREE.Group();
  const PARTS = [];
  function part(name, offset, anchor){ const g = new THREE.Group(); g.userData = { name, offset:new V3(...offset), anchor:new V3(...anchor) }; boat.add(g); PARTS.push(g); return g; }

  /* ---- hull: a V bottom and flared topsides meeting at a hard chine, closing on a raked stem ---- */
  {
    const g = part('Hull', [0, 0, 0], [0, -0.3, -4]);
    const NU = 160, ts = (u)=>Math.pow(u, 0.85);
    const bottom = orient(gridGeo(NU, 16, (u, s)=>{ const t = ts(u), y = lerp(keelY(t), chineY(t), s); return [s*chineX(t), y, Z(t) + rake(t, y)]; }), (x, y)=>[x, y - .9, 0]);
    /* topsides flare out concavely toward the bow, and every height closes to x = 0 at the stem */
    const sideP = orient(gridGeo(NU, 14, (u, s)=>{ const t = ts(u), y = lerp(chineY(t), sheerY(t), s), p = 1 + .9*sm(.45, .95, t);
      return [chineX(t) + (sheerX(t) - chineX(t))*Math.pow(s, p), y, Z(t) + rake(t, y)]; }), (x)=>[x, 0, 0]);
    const tp = [[sheerX(0), sheerY(0)], [chineX(0), chineY(0)], [0, keelY(0)], [-chineX(0), chineY(0)], [-sheerX(0), sheerY(0)]];
    const transom = new THREE.ShapeGeometry(new THREE.Shape(tp.map(p=>new THREE.Vector2(p[0], p[1])))); transom.rotateY(Math.PI); transom.translate(0, 0, -8);
    for(const geo of [bottom, mirrorX(bottom), sideP, mirrorX(sideP), transom]) mesh(geo, hullMat, g);
    /* the skeg: a fin under the keel aft, edges rounded */
    const sk = new THREE.Shape([[-7.3, -0.78], [-7.3, -1.18], [-3.6, -1.24], [0.4, -0.9], [0.9, -0.78]].map(p=>new THREE.Vector2(p[0], p[1])));
    const skg = new THREE.ExtrudeGeometry(sk, { depth:.06, bevelEnabled:true, bevelThickness:.04, bevelSize:.035, bevelSegments:4, curveSegments:4 });
    skg.rotateY(-Math.PI/2); skg.translate(.03, 0, 0); mesh(skg, hullMat, g);
  }

  /* ---- deck: a cambered plate inside the sheer ---- */
  {
    const g = part('Deck plate', [0, 4.0, 0], [0, 1.8, -5]);
    const d = gridGeo(90, 14, (u, s)=>{ const t = Math.pow(u, 0.9), w = sheerX(t)*.99, x = (s*2 - 1)*w; return [x, deckAt(t, x), Z(t) + rake(t, sheerY(t))]; });
    mesh(orient(d, ()=>[0, 1, 0]), deckMat, g);
  }

  /* ---- rubber fender: a thick D-section swept round the sheer, resampled evenly so the bow stays round ---- */
  {
    const g = part('Rubber fender', [0, 2.2, 0], [2.7, 1.5, 2]);
    const loop = [], N = 240;
    for(let i=0;i<=N;i++){ const t = i/N; loop.push(new V3(sheerX(t), sheerY(t) - .17, Z(t) + rake(t, sheerY(t)))); }
    for(let i=N-1;i>=0;i--){ const p = loop[i]; loop.push(new V3(-p.x, p.y, p.z)); }
    for(let i=1;i<24;i++) loop.push(new V3(lerp(-sheerX(0), sheerX(0), i/24), sheerY(0) - .17, -8));
    const M = 640;
    let P = new THREE.CatmullRomCurve3(loop, true, 'centripetal').getSpacedPoints(M).slice(0, M);
    for(let k=0;k<8;k++) P = P.map((p, i)=>new V3().addScaledVector(P[(i + M - 1) % M], .25).addScaledVector(p, .5).addScaledVector(P[(i + 1) % M], .25));
    const O = P.map((p, i)=>{ const d = new V3().subVectors(P[(i + 1) % M], P[(i + M - 1) % M]); return new V3(d.z, 0, -d.x).normalize(); });
    if(O.reduce((s, o, i)=>s + o.x*P[i].x + o.z*P[i].z, 0) < 0) O.forEach(o=>o.negate());
    const S = 24, pos = [], idx = [];
    for(let i=0;i<=M;i++){
      const p = P[i % M], o = O[i % M];
      for(let j=0;j<=S;j++){
        const a = j/S*Math.PI*2, c = Math.cos(a), s = Math.sin(a);
        const ex = .06 + .26*Math.sign(c)*Math.pow(Math.abs(c), .42), ey = .23*Math.sign(s)*Math.pow(Math.abs(s), .45);   /* inner face buried in the hull, top just above the deck: closed, no gutter */
        pos.push(p.x + o.x*ex, p.y + ey, p.z + o.z*ex);
      }
    }
    for(let i=0;i<M;i++) for(let j=0;j<S;j++){ const a = i*(S + 1) + j, b = a + S + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setIndex(idx); fg.computeVertexNormals();
    mesh(orient(fg, (x, y, z)=>[x, 0, z]), fenderMat, g);
    for(const sx of [-1, 1]) mesh(rbox(.44, 1.25, .44, .13, sx*2.42, sheerY(0) - .88, -8.04), fenderMat, g);
  }

  /* ---- wheelhouse: one lofted solid with rounded edges. Traced from the side view: a flat roof over a long
          window band, a near-vertical windscreen under a visor, and a long low nose running forward ---- */
  const H = {};
  {
    const g = part('Wheelhouse', [0, 8.4, 0.6], [2.1, 3.0, -0.5]);
    const zA = -3.6, zF = 5.0;
    const pl = (pts, z)=>{ if(z <= pts[0][0]) return pts[0][1]; for(let i=1;i<pts.length;i++) if(z <= pts[i][0]){ const [z0, v0] = pts[i - 1], [z1, v1] = pts[i]; return v0 + (v1 - v0)*(z - z0)/(z1 - z0); } return pts[pts.length - 1][1]; };
    const soft = (pts, z, h = .04)=>(pl(pts, z - h) + pl(pts, z - h/2) + pl(pts, z) + pl(pts, z + h/2) + pl(pts, z + h))/5;
    const ROOF = [[-3.6, 3.62], [1.95, 3.6], [2.12, 2.6], [5.0, 2.4]], HALF = [[-3.6, 1.95], [1.0, 1.95], [2.1, 1.8], [5.0, 1.0]];
    const yb = (z)=>sheerY(tz(z)) - .06, yr = (z)=>soft(ROOF, z), hw = (z)=>soft(HALF, z);
    const ysh = (z)=>Math.min(yb(z) + .68, yr(z) - .2);
    Object.assign(H, { yb, yr, hw, ysh });
    const NF = 6;
    function fillet(ctrl, r, nf){
      const out = [ctrl[0]];
      for(let i=1;i<ctrl.length - 1;i++){
        const p = ctrl[i], a = ctrl[i - 1], b = ctrl[i + 1];
        const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1e-6, lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1e-6;
        const ra = Math.min(r, la*.45), rb = Math.min(r, lb*.45);
        const A = [p[0] + (a[0] - p[0])/la*ra, p[1] + (a[1] - p[1])/la*ra], B = [p[0] + (b[0] - p[0])/lb*rb, p[1] + (b[1] - p[1])/lb*rb];
        for(let k=0;k<=nf;k++){ const s = k/nf, u = 1 - s; out.push([u*u*A[0] + 2*u*s*p[0] + s*s*B[0], u*u*A[1] + 2*u*s*p[1] + s*s*B[1]]); }
      }
      out.push(ctrl[ctrl.length - 1]); return out;
    }
    /* corner k's fillet middle sits at index 1 + (k - 1)*(NF + 1) + NF/2 */
    const mid = (k)=>1 + (k - 1)*(NF + 1) + NF/2, iSh = mid(1), iTop = mid(2), iC = mid(3), iSh2 = mid(5);
    function section(z, k){
      const b = yb(z), top = yr(z), w = hw(z), ys = ysh(z), tb = .2*(top - ys);
      const pts = fillet([[-w, b], [-w, ys], [-(w - tb), top], [0, top + .05], [w - tb, top], [w, ys], [w, b]], .1, NF);
      const L = [0]; for(let i=1;i<pts.length;i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const Lb = L[iTop] - L[iSh], Hh = top + .05 - b, sx = Math.max(0, w - k)/w, sy = Math.max(0, Hh - k)/Hh;
      return pts.map((p, i)=>({ x:p[0]*sx, y:b + (p[1] - b)*sy, du:i <= iC ? L[i] - L[iSh] : L[iSh2] - L[i], Lb, xn:p[0]/w }));
    }
    const r = .09, NC = 5, rows = [{ z:zA, k:1e3 }];
    for(let j=0;j<=NC;j++){ const th = j/NC*Math.PI/2; rows.push({ z:zA + r*(1 - Math.cos(th)), k:r*(1 - Math.sin(th)) }); }
    const NZ = 320; for(let i=1;i<NZ;i++) rows.push({ z:lerp(zA + r, zF - r, i/NZ), k:0 });
    for(let j=NC;j>=0;j--){ const th = j/NC*Math.PI/2; rows.push({ z:zF - r*(1 - Math.cos(th)), k:r*(1 - Math.sin(th)) }); }
    rows.push({ z:zF, k:1e3 });
    const pos = [], aK = [], idx = []; let C = 0;
    for(const { z, k } of rows){ const sec = section(z, k); C = sec.length; for(const p of sec){ pos.push(p.x, p.y, z); aK.push(z, p.du, p.Lb, p.xn); } }
    for(let i=0;i<rows.length - 1;i++) for(let j=0;j<C - 1;j++){ const a = i*C + j, b = a + C; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute('aK', new THREE.Float32BufferAttribute(aK, 4)); hg.setIndex(idx); hg.computeVertexNormals();
    mesh(orient(hg, (x, y, z)=>[x, y - 2.6, z - .7]), houseMat, g);
    const roofW = (z)=>2*(hw(z) - .2*(yr(z) - ysh(z)));
    /* the roof: one chamfered cap sitting on a black trim border that runs all the way round. It overhangs
       the windscreen as the visor and the aft wall as the brow, so it all reads as a single roof */
    const OUT = [[-1.74, -3.9], [1.74, -3.9], [1.74, 1.0], [1.66, 1.7], [1.28, 2.42], [-1.28, 2.42], [-1.66, 1.7], [-1.74, 1.0]];
    const capGeo = (k, depth, bevel)=>{
      const sh = new THREE.Shape(OUT.map(([x, z])=>new THREE.Vector2(x*k, -(z*k + (1 - k)*-.74))));
      const e = new THREE.ExtrudeGeometry(sh, bevel ? { depth, bevelEnabled:true, bevelThickness:.05, bevelSize:.07, bevelSegments:1, curveSegments:1 } : { depth, bevelEnabled:false });
      return e.rotateX(-Math.PI/2);
    };
    mesh(capGeo(1, .06, true).translate(0, 3.71, 0), roofMat, g);                 /* spans y 3.66 .. 3.82 */
    mesh(capGeo(.985, .08, false).translate(0, 3.59, 0), trimMat, g);            /* the black border under its edge */
    H.roofTop = 3.82;
    /* a raised hatch, panel seams and bolts (in the roof shader), black grab handles and vent plates up front */
    mesh(rbox(1.1, .05, .85, .02, 0, 3.835, -.15), roofMat, g);
    for(const sx of [-1, 1]){
      mesh(tube([new V3(sx*.42, 3.82, 1.95), new V3(sx*.42, 3.9, 1.98), new V3(sx*.82, 3.9, 1.98), new V3(sx*.82, 3.82, 1.95)], .022, 24, 8), trimMat, g);
      mesh(rbox(.36, .025, .2, .01, sx*1.08, 3.83, 1.62), trimMat, g);
    }
    /* wipers lying on the windscreen panes */
    const faceZ = (y)=>1.95 + (3.6 - y)*.17 + .035;
    for(const x of [0, 1.06, -1.06]){
      const a = new V3(x - .12, 2.78, faceZ(2.78)), b = new V3(x + .14, 3.18, faceZ(3.18));
      mesh(tube([a, b], .012, 2, 6), darkMetal, g);
      mesh(new THREE.CylinderGeometry(.03, .03, .04, 12).rotateX(Math.PI/2).translate(a.x, a.y, a.z), darkMetal, g);
    }
    /* the name, painted on both sides of the lower wall */
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160;
    const cx = cv.getContext('2d'); cx.fillStyle = '#0b0b0c'; cx.font = '900 118px Helvetica, Arial, sans-serif'; cx.textBaseline = 'middle'; cx.fillText('TIDERUNNER', 8, 84);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const nameMat = new THREE.MeshStandardMaterial({ map:tex, transparent:true, roughness:0.4, polygonOffset:true, polygonOffsetFactor:-2 });
    for(const sx of [-1, 1]){ const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .4), nameMat); p.position.set(sx*1.954, 2.08, -.4); p.rotation.y = sx*Math.PI/2; g.add(p); }
    /* side lights in black screens on the nose, turned in to follow its taper: red to port, green to starboard */
    for(const [sx, c] of [[1, 0xff2214], [-1, 0x19ff5a]]){
      const z = 2.75, yaw = Math.atan2(hw(z + .1) - hw(z - .1), .2);
      const grp = new THREE.Group(); grp.position.set(sx*(hw(z) + .04), yb(z) + .4, z); grp.rotation.y = sx*yaw; g.add(grp);
      mesh(rbox(.07, .22, .42, .025, 0, 0, 0), darkMetal, grp);
      const lens = new THREE.Mesh(new THREE.CapsuleGeometry(.035, .06, 4, 10), glow(c, 2.2)); lens.position.set(sx*.04, 0, .12); grp.add(lens);
    }
    /* grab rails along the roof */
    for(const sx of [-1, 1]) mesh(tube([new V3(sx*1.38, 3.82, -2.7), new V3(sx*1.38, 3.96, -2.52), new V3(sx*1.38, 3.96, 1.0), new V3(sx*1.38, 3.82, 1.18)], .025, 48, 8), steel, g);
  }

  /* ---- mast: a tapered black tower on the aft roof. The radar sits on an arm off its front face so the
          sweep clears everything; the light mast, whips and dome stay behind and outside it ---- */
  let radar;
  {
    const g = part('Mast and radar', [0, 12.2, -1.2], [0.9, 5.6, -2.6]);
    const y0 = 3.56, y1 = 5.55;
    const tw = new THREE.ExtrudeGeometry(new THREE.Shape([[-3.2, y0], [-1.85, y0], [-2.42, y1], [-3.0, y1]].map(p=>new THREE.Vector2(p[0], p[1]))), { depth:.5, bevelEnabled:true, bevelThickness:.06, bevelSize:.05, bevelSegments:4, curveSegments:2 });
    tw.rotateY(-Math.PI/2); tw.translate(.25, 0, 0);
    { const p = tw.attributes.position; for(let i=0;i<p.count;i++){ const k = 1 - .38*Math.min(1, Math.max(0, (p.getY(i) - y0)/(y1 - y0))); p.setX(i, p.getX(i)*k); } tw.computeVertexNormals(); }
    mesh(tw, darkMetal, g);
    /* junction boxes and a ladder of bolts down the tower side */
    for(const sx of [-1, 1]) mesh(rbox(.1, .3, .22, .03, sx*.3, 4.25, -2.6), darkMetal, g);
    /* radar arm, its brace and the scanner */
    mesh(rbox(.24, .1, 1.45, .03, 0, 4.62, -1.62), darkMetal, g);
    mesh(strut(new V3(0, 4.05, -2.0), new V3(0, 4.58, -1.12), .1, .06), darkMetal, g);
    radar = new THREE.Group(); radar.position.set(0, 4.67, -1.05); g.add(radar);
    mesh(new THREE.CylinderGeometry(.2, .23, .34, 28).translate(0, .17, 0), white, radar);
    mesh(new THREE.CylinderGeometry(.16, .16, .05, 24).translate(0, .36, 0), darkMetal, radar);
    /* the open array: a full round tube with flat ends and only slightly rounded edges */
    const ap = [[0, -.86]]; for(let i=0;i<=4;i++){ const a = i/4*Math.PI/2; ap.push([.078 + .022*Math.sin(a), -.838 - .022*Math.cos(a)]); }
    for(let i=0;i<=4;i++){ const a = i/4*Math.PI/2; ap.push([.078 + .022*Math.cos(a), .838 + .022*Math.sin(a)]); } ap.push([0, .86]);
    const arr = new THREE.LatheGeometry(ap.map(p=>new THREE.Vector2(p[0], p[1])), 32); arr.rotateZ(Math.PI/2); arr.translate(0, .5, 0); mesh(arr, white, radar);
    /* top platform, light mast with a crossarm, and a beacon on top */
    mesh(rbox(.62, .06, .6, .02, 0, y1 + .03, -2.71), darkMetal, g);
    mesh(new THREE.CylinderGeometry(.03, .045, 1.35, 12).translate(0, y1 + .7, -2.71), darkMetal, g);
    mesh(rbox(.62, .05, .05, .015, 0, 6.35, -2.71), darkMetal, g);
    for(const [x, y, c] of [[-.27, 6.43, 0xfff4e0], [.27, 6.43, 0xffd9a0]]){
      mesh(new THREE.CylinderGeometry(.05, .05, .08, 14).translate(x, y - .07, -2.71), darkMetal, g);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .07, 14), glow(c, 2)); l.position.set(x, y, -2.71); g.add(l);
    }
    mesh(new THREE.CylinderGeometry(.075, .085, .1, 16).translate(0, 6.95, -2.71), darkMetal, g);
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, .12, 16), glow(0xfff4e0, 1.6)); bl.position.set(0, 7.06, -2.71); g.add(bl);
    mesh(new THREE.CylinderGeometry(.08, .075, .04, 16).translate(0, 7.14, -2.71), darkMetal, g);
    /* side arms carrying the whip antennas */
    for(const [sx, h] of [[1, 2.2], [-1, 1.7]]){
      mesh(rbox(.58, .05, .06, .015, sx*.48, 5.0, -2.62), darkMetal, g);
      mesh(new THREE.CylinderGeometry(.03, .04, .14, 10).translate(sx*.75, 5.09, -2.62), darkMetal, g);
      mesh(new THREE.CylinderGeometry(.008, .015, h, 6).translate(sx*.75, 5.16 + h/2, -2.62), sx > 0 ? darkMetal : white, g);
    }
    /* satellite dome on a post, a searchlight and a camera on the roof, a blue pilot light */
    mesh(new THREE.CylinderGeometry(.05, .06, .3, 10).translate(-1.0, 3.95, -3.0), darkMetal, g);
    mesh(new THREE.SphereGeometry(.2, 24, 14, 0, Math.PI*2, 0, Math.PI*.55).translate(-1.0, 4.12, -3.0), white, g);
    mesh(new THREE.CylinderGeometry(.03, .04, .22, 10).translate(.95, 3.92, -1.3), darkMetal, g);
    mesh(rbox(.24, .2, .3, .05, .95, 4.12, -1.3), darkMetal, g);
    const sl = new THREE.Mesh(new THREE.CircleGeometry(.075, 20), glow(0xeef4ff, 1.2)); sl.position.set(.95, 4.12, -1.149); g.add(sl);
    mesh(new THREE.CylinderGeometry(.03, .04, .2, 10).translate(-.95, 3.91, -1.25), darkMetal, g);
    mesh(rbox(.16, .14, .24, .05, -.95, 4.07, -1.25), white, g);
    const cam_ = new THREE.Mesh(new THREE.CircleGeometry(.045, 16), new THREE.MeshStandardMaterial({ color:0x05070a, roughness:.05 })); cam_.position.set(-.95, 4.07, -1.129); g.add(cam_);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 8), glow(0x4aa0ff, 2.5)); beacon.position.set(.3, 5.08, -2.62); g.add(beacon);
  }

  /* ---- deck fittings: rails that follow the deck edge, bollards, the life raft ---- */
  {
    const g = part('Deck fittings', [0, 5.7, 0], [-2.3, 2.6, -6]);
    function edgeRail(side, t0, t1, h){
      const n = 12, base = [], top = [];
      for(let i=0;i<=n;i++){ const t = lerp(t0, t1, i/n), x = side*(sheerX(t) - .3), y = deckAt(t, x), z = Z(t) + rake(t, sheerY(t)); base.push(new V3(x, y, z)); top.push(new V3(x, y + h, z)); }
      const up = (p, k)=>p.clone().setY(p.y + k);
      mesh(tube([base[0], up(base[0], h - .12), top[0].clone().lerp(top[1], .5), ...top.slice(1, n), top[n].clone().lerp(top[n - 1], .5), up(base[n], h - .12), base[n]], .028, 96), steel, g);
      mesh(tube(base.map(p=>up(p, h*.5)), .018, 48, 8), steel, g);
      const m = base[n >> 1]; mesh(tube([m, up(m, h)], .022, 2, 8), steel, g);
      for(const p of [base[0], m, base[n]]) mesh(new THREE.CylinderGeometry(.05, .06, .025, 14).translate(p.x, p.y + .01, p.z), steel, g);
    }
    for(const sx of [-1, 1]){ edgeRail(sx, .025, .2, .95); edgeRail(sx, .79, .87, .85); }
    const bollard = (x, z, rot = 0)=>{
      const y = deckAt(tz(z), x), grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = rot; g.add(grp);
      for(const dz of [-.19, .19]) mesh(new THREE.LatheGeometry([[0, 0], [.095, 0], [.095, .03], [.072, .06], [.068, .24], [.115, .27], [.115, .31], [.06, .325], [0, .325]].map(p=>new THREE.Vector2(p[0], p[1])), 24).translate(0, .02, dz), steel, grp);
      mesh(rbox(.26, .04, .66, .015, 0, .02, 0), steel, grp);
    };
    bollard(0, 6.45, Math.PI/2); bollard(1.85, -7.2); bollard(-1.85, -7.2); bollard(1.62, 4.15); bollard(-1.62, 4.15);
    mesh(rbox(.42, .2, .46, .06, 0, deckAt(tz(7.15), 0) + .09, 7.15), darkMetal, g);      /* bow fairlead */
    /* the life raft: a white rounded valise lying athwartships in a stainless cradle, aft to port */
    const rz = -6.55, rx = 1.25, ry = deckAt(tz(rz), rx);
    mesh(rbox(1.2, .5, .62, .16, rx, ry + .38, rz), white, g);
    for(const dx of [-.33, .33]) mesh(rbox(.06, .52, .64, .02, rx + dx, ry + .38, rz), strap, g);
    for(const dz of [-.36, .36]) mesh(tube([new V3(rx - .68, ry, rz + dz), new V3(rx - .68, ry + .62, rz + dz), new V3(rx + .68, ry + .62, rz + dz), new V3(rx + .68, ry, rz + dz)], .022, 48, 8), steel, g);
    for(const dx of [-.6, .6]) mesh(rbox(.08, .1, .8, .02, rx + dx, ry + .1, rz), steel, g);
  }

  /* ---- propulsion: shafts leaving the hull through faired stern tubes, P-brackets, twisted
          five-bladed propellers and foil rudders ---- */
  const props = [];
  function propBlades(R, rh, n){
    const geos = [];
    const NR = 18, NCh = 28;
    for(let b=0;b<n;b++){
      const a0 = b/n*Math.PI*2;
      const pos = [], idx = [];
      for(let i=0;i<=NR;i++){
        const rr = i/NR, r = rh*.9 + (R - rh*.9)*rr;
        const halfC = R*(.12 + .3*Math.sin(Math.PI*(.12 + .72*rr)))*Math.sqrt(Math.max(.015, 1 - .97*rr*rr));
        const thick = R*.04*(1 - .8*rr) + .004, phi = Math.atan(2.2*R/(2*Math.PI*r)), skew = .35*rr*rr;
        for(let j=0;j<=NCh;j++){
          const a = j/NCh*Math.PI*2, s = Math.cos(a)*halfC, q = Math.sin(a)*thick*(.55 + .45*Math.cos(a));
          const tg = s*Math.cos(phi) - q*Math.sin(phi), ax = s*Math.sin(phi) + q*Math.cos(phi), ang = a0 + skew + tg/r;
          pos.push(r*Math.cos(ang), r*Math.sin(ang), ax);
        }
      }
      for(let i=0;i<NR;i++) for(let j=0;j<NCh;j++){ const a = i*(NCh + 1) + j, c = a + NCh + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals();
      geos.push(orient(bg, (x, y)=>[x, y, 0]));
    }
    return geos;
  }
  {
    const g = part('Propulsion', [0, -3.2, -2.0], [1.1, -1.2, -6.4]);
    for(const sx of [-1, 1]){
      const x = sx*.88, pc = new V3(x, -1.0, -6.55), entry = new V3(x, -.58, -3.3);
      const dir = new V3().subVectors(pc, entry).normalize();
      /* shaft, and the faired stern tube where it leaves the hull */
      mesh(strut(entry, pc.clone().addScaledVector(dir, -.1), .1, .1), steel, g);
      const ft = new THREE.SphereGeometry(.5, 24, 16); ft.scale(.15, .15, .75);
      ft.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir)); ft.translate(entry.x, entry.y - .02, entry.z - .35); mesh(ft, hullMat, g);
      /* P-bracket: a foil strut from the hull to a barrel around the shaft */
      const bc = pc.clone().addScaledVector(dir, -.62);
      mesh(strut(new V3(x, -.5, bc.z + .02), bc, .24, .055), darkMetal, g);
      const barrel = new THREE.CylinderGeometry(.085, .085, .34, 18); barrel.rotateX(Math.PI/2);
      barrel.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir)); barrel.translate(bc.x, bc.y, bc.z); mesh(barrel, darkMetal, g);
      /* the propeller */
      const p = new THREE.Group(); p.position.copy(pc); p.lookAt(pc.clone().add(dir)); g.add(p); props.push({ p, dir:sx });
      const hub = new THREE.CapsuleGeometry(.1, .2, 8, 18); hub.rotateX(Math.PI/2); mesh(hub, bronze, p);
      const cone = new THREE.ConeGeometry(.1, .2, 18); cone.rotateX(Math.PI/2); cone.translate(0, 0, .24); mesh(cone, bronze, p);
      for(const bgeo of propBlades(.36, .1, 5)) mesh(sx > 0 ? bgeo : mirrorX(bgeo), bronze, p);
      /* a foil rudder hung on its stock behind the propeller */
      const foil = []; for(let i=0;i<=24;i++){ const a = i/24*Math.PI*2, xc = (1 - Math.cos(a))/2, th = .6*.12*(1.4845*Math.sqrt(xc) - .63*xc - 1.758*xc*xc + 1.4215*xc**3 - .5075*xc**4); foil.push(new THREE.Vector2(.6*xc, Math.sign(Math.sin(a))*th*.5 + 1e-4*Math.sin(a))); }
      const rud = new THREE.ExtrudeGeometry(new THREE.Shape(foil), { depth:.72, bevelEnabled:true, bevelThickness:.03, bevelSize:.012, bevelSegments:3, curveSegments:24 });
      rud.rotateX(Math.PI/2); rud.rotateY(-Math.PI/2); rud.translate(x, -.6, -7.62);
      mesh(rud, darkMetal, g);
      mesh(new THREE.CylinderGeometry(.04, .04, .3, 10).translate(x, -.5, -7.47), steel, g);
    }
  }

  const spin = (dt, prop = 9)=>{ radar.rotation.y += dt*1.6; for(const { p, dir } of props) p.rotateZ(dt*prop*dir); };
  /* lamps: a multiplier on the lamps' brightness; cabin: the windows' glow */
  const setLights = ({ lamps = 1, cabin = 0 } = {})=>{ for(const [m, c] of LAMPS) m.color.copy(c).multiplyScalar(lamps); CABIN.value = cabin; };
  return { boat, PARTS, radar, props, spin, setLights };
}
/* the hull's lines, for buoyancy probes and for masking the sea inside the hull */
export const HULL = { Z, plan, sheerY, sheerX, chineX, chineY, keelY, rake, deckAt };
