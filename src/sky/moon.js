import * as THREE from 'three';

/* ================================================================== *
 *  The moon, for the night mood. A billboard 40 km out along the moon's
 *  direction, travelling with the camera like the stars, so the clouds
 *  pass in front of it and the air hazes it near the horizon.
 *  The disc has limb darkening, dark maria and a speckle of craters;
 *  around it a soft, cool halo, the glow of moonlight in thin haze.
 *  Drawn larger than life (about 3.5x), as long-lens photographs of a
 *  big moon over the sea look.
 * ================================================================== */
const DIST = 40000, RADIUS = .016*DIST, EXTENT = 6;   /* quad half-size in moon radii: room for the halo */

export function createMoon(){
  const material = new THREE.ShaderMaterial({
    uniforms:{ uDir:{ value:new THREE.Vector3(0, 1, 0) }, uGain:{ value:12 } },
    vertexShader:/* glsl */`
      uniform vec3 uDir; varying vec2 vP;
      void main(){
        vec3 d = normalize(uDir), r = normalize(cross(d, abs(d.y) > .99 ? vec3(1., 0., 0.) : vec3(0., 1., 0.))), u = cross(r, d);
        vP = position.xy*${EXTENT}.;
        vec3 w = cameraPosition + d*${DIST}. + (r*position.x + u*position.y)*${(RADIUS*EXTENT).toFixed(1)};
        gl_Position = projectionMatrix*viewMatrix*vec4(w, 1.);
      }`,
    fragmentShader:/* glsl */`
      uniform float uGain; varying vec2 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p), u = f*f*(3. - 2.*f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*n(p); p = p*2.03 + 7.1; a *= .5; } return s; }
      void main(){
        float r = length(vP), aa = fwidth(r)*1.5 + .002;
        vec3 col = vec3(0.);
        if(r < 1.02){
          float mu = sqrt(max(1. - r*r, 0.));
          /* the near side: dark basalt seas, brighter highlands, a speckle of small craters */
          float maria = smoothstep(.5, .66, fbm(vP*1.35 + vec2(3.7, 1.2)));
          float speck = fbm(vP*7. + 11.)*.18 + smoothstep(.82, .9, n(vP*11.))*.12;
          vec3 surf = vec3(1., .975, .93)*(1. - .42*maria - speck);
          col = surf*(.62 + .38*pow(mu, .6))*uGain*(1. - smoothstep(1. - aa, 1., r));
        }
        /* a soft cool halo: a bright collar fading into a wide faint glow */
        float e = max(r - 1., 0.);
        col += vec3(.78, .85, 1.)*uGain*(exp(-e*2.4)*.14 + exp(-e*.6)*.035)*step(1. - aa, r);
        if(max(col.r, max(col.g, col.b)) < .003*uGain) discard;
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -1;
  return {
    object:mesh,
    set direction(v){ material.uniforms.uDir.value.copy(v); },
    set gain(v){ material.uniforms.uGain.value = v; },
  };
}
