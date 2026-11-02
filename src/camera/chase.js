import * as THREE from 'three';
import { params } from '../config.js';
import { wrapA, easeInOut, approach, clamp } from '../core/math.js';

/* ================================================================== *
 *  The chase camera: behind the boat, lagging its turns a little.
 *  Drag orbits, the wheel or a pinch zooms. The opening shot starts
 *  low and wide (horizon, clouds, a speck of a boat) and swoops down
 *  and round to the chase over nine seconds; any input hurries it.
 * ================================================================== */
const DIST = [9, 220], PITCH = [-.02, 1.2];

export function createChaseCamera(app, boat){
  const { camera } = app;
  const S = boat.state;
  const C = { yaw:.6, pitch:.13, dist:28, sh:0, pos:new THREE.Vector3(), init:false };
  const intro = { on:boat.enabled && !params.has('nointro'), go:false, t:0, dur:9, fast:1 };

  function introPose(k){
    const e = easeInOut(k);
    C.dist = Math.exp(Math.log(360)*(1 - e) + Math.log(innerWidth < innerHeight ? 44 : 28)*e);   /* portrait phones: pull back so the boat fits */
    C.pitch = .17*(1 - e) + .13*e + .1*Math.sin(Math.PI*e);   /* low and wide first; it rises a little as it closes in */
    C.yaw = 2.5*(1 - e) + .6*e;
  }
  if(intro.on) introPose(0);

  const _tg = new THREE.Vector3(), _want = new THREE.Vector3();
  function update(dt){
    if(intro.on && intro.go){
      intro.t += dt*intro.fast;
      const k = Math.min(1, intro.t/intro.dur); introPose(k);
      if(k >= 1) intro.on = false;
    }
    if(!C.init) C.sh = S.h;
    C.sh += wrapA(S.h - C.sh)*Math.min(1, dt*2.2);
    _tg.set(S.x, S.y + 2.6, S.z);
    const yaw = C.sh + Math.PI + C.yaw, cp = Math.cos(C.pitch);
    _want.set(_tg.x + Math.sin(yaw)*cp*C.dist, _tg.y + Math.sin(C.pitch)*C.dist, _tg.z + Math.cos(yaw)*cp*C.dist);
    if(!C.init){ C.pos.copy(_want); C.init = true; } else C.pos.lerp(_want, approach(6, dt));
    C.pos.y = Math.max(C.pos.y, 1.8 + Math.max(0, S.y));
    camera.position.copy(C.pos); camera.lookAt(_tg);
  }

  return {
    state:C, intro, update,
    /* how far through the opening (0..1), 1 when there is none */
    get introProgress(){ return intro.on ? Math.min(1, intro.t/intro.dur) : 1; },
    startIntro(){ intro.go = true; },
    hurry(){ if(intro.on && intro.go) intro.fast = 4; },
    orbit(dx, dy){ C.yaw -= dx*.004; C.pitch = clamp(C.pitch + dy*.003, ...PITCH); },
    zoom(f){ C.dist = clamp(C.dist*f, ...DIST); },
  };
}
