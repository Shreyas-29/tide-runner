import { QUALITY, TOUCH, params } from '../config.js';

/* ================================================================== *
 *  Auto quality: start sensibly for the device (touch screens one tier
 *  down from the top two), then step down while the frame rate sags:
 *  pixel ratio, cloud quality, shadow resolution, and finally the
 *  boat's reflection. It never steps back up, so nothing flickers.
 *  ?q=0..3 pins a tier, ?dpr= pins the pixel ratio.
 * ================================================================== */
export function createQuality({ renderer, sky, boat, resize }){
  const pinned = params.has('q') || params.has('dpr');
  const st = { tier:params.has('q') ? Math.max(0, Math.min(QUALITY.length - 1, +params.get('q'))) : (TOUCH ? 2 : 0), slow:0, cool:0 };

  function apply(){
    const q = QUALITY[st.tier];
    renderer.setPixelRatio(params.has('dpr') ? +params.get('dpr') : Math.min(devicePixelRatio || 1, q.dpr));
    resize();
    if(!params.has('quality')) sky.clouds.qualityPreset = q.clouds;
    const sh = sky.sunLight.shadow;
    if(sh.mapSize.x !== q.shadow){ sh.mapSize.set(q.shadow, q.shadow); if(sh.map){ sh.map.dispose(); sh.map = null; } }
    boat.reflection.enabled = q.refl;
  }

  /* frameMs: the smoothed frame time; dt: the real time since the last frame */
  function watch(frameMs, dt){
    if(pinned || document.hidden || dt > .5) return;
    if((st.cool -= dt) > 0) return;
    if(frameMs > 23){
      if((st.slow += dt) > 2.5 && st.tier < QUALITY.length - 1){ st.tier++; apply(); st.slow = 0; st.cool = 3; return true; }
    } else st.slow = Math.max(0, st.slow - dt*.5);
    return false;
  }
  return { apply, watch, get tier(){ return st.tier; } };
}
