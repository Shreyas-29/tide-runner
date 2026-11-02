import { QUALITY, QUALITY_TOUCH, QUALITY_DESKTOP, TOUCH, params } from '../config.js';

/* ================================================================== *
 *  Auto quality: start sensibly for the device, then step down while
 *  the frame rate sags: cloud detail and shadow resolution first, the
 *  pixel ratio after, and on phones finally the boat's reflection.
 *
 *  Every step is a trial. If dropping a tier doesn't actually make the
 *  frames faster, the frame rate is capped by something else (a
 *  browser's battery saver holding pages at 30 fps, a 30 Hz display),
 *  so the step is undone and adapting stops: quality is never thrown
 *  away for nothing. It never steps back up, so nothing flickers.
 *  ?q=0..4 pins a tier, ?dpr= pins the pixel ratio.
 * ================================================================== */
const SLOW_MS = 23, TRIAL_S = 3.5, GAIN = .88;

export function createQuality({ renderer, sky, boat, resize }){
  const range = TOUCH ? QUALITY_TOUCH : QUALITY_DESKTOP;
  const pinned = params.has('q') || params.has('dpr');
  const st = { tier:params.has('q') ? Math.max(0, Math.min(QUALITY.length - 1, +params.get('q'))) : range.start, slow:0, trial:null, locked:false };

  function apply(){
    const q = QUALITY[st.tier];
    renderer.setPixelRatio(params.has('dpr') ? +params.get('dpr') : Math.min(devicePixelRatio || 1, q.dpr));
    resize();
    if(!params.has('quality')) sky.clouds.qualityPreset = q.clouds;
    const sh = sky.sunLight.shadow;
    if(sh.mapSize.x !== q.shadow){ sh.mapSize.set(q.shadow, q.shadow); if(sh.map){ sh.map.dispose(); sh.map = null; } }
    boat.reflection.enabled = q.refl;
  }

  /* frameMs: the smoothed frame time; dt: the real time since the last frame.
     Returns true when the tier changed, so the caller restarts its frame-time average */
  function watch(frameMs, dt){
    if(pinned || st.locked || document.hidden || dt > .5) return false;
    if(st.trial){
      if((st.trial.t += dt) < TRIAL_S) return false;
      const helped = frameMs < st.trial.before*GAIN;
      if(!helped){ st.tier = st.trial.from; apply(); st.locked = true; }   /* capped elsewhere: put it back and leave it */
      st.trial = null; st.slow = 0;
      return !helped;
    }
    if(frameMs > SLOW_MS){
      if((st.slow += dt) > 2.5 && st.tier < range.max){
        st.trial = { from:st.tier, before:frameMs, t:0 };
        st.tier++; apply(); st.slow = 0;
        return true;
      }
    } else st.slow = Math.max(0, st.slow - dt*.5);
    return false;
  }
  return { apply, watch, get tier(){ return st.tier; }, get locked(){ return st.locked; } };
}
