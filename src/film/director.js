import { TAU } from '../config.js';
import { easeInOut, clamp } from '../core/math.js';

/* ================================================================== *
 *  ?film: a scripted ~67 s promo shot, no HUD, nobody at the wheel.
 *  It rolls on the first click or key (browsers only play sound after
 *  one): the opening swoop starts, the sound starts silent and fades in
 *  as the engine cranks. The director drives the boat with fake
 *  controls, moves the chase camera along keyframes once the opening
 *  is done, and cuts between moods while the camera keeps moving.
 *  window.FILM_DONE is set when the last fade ends.
 *    0   day, the opening swoop and title card
 *    8   engine cranks and catches        10.5  throttle up
 *    12  boost through the swell          19    low orbit at the hull
 *    26  a full circle round the boat     37    golden hour, one held angle
 *    41  sunset                           45    night, lamps and stars
 *    49  a full circle under the stars    57    day, top-down over the wake
 *    62  slow wide pull-back
 * ================================================================== */
const END = 67, ENGINE = 8;

/* the boat: [from, to, controls] */
const DRIVE = [
  [10.5, 12, { fwd:true }],
  [12,   19, { fwd:true, boost:true }],
  [19,   65, { fwd:true }],
];
/* the camera after the opening: [t, yaw, pitch, dist]; yaw 0 is dead astern. Each key eases into the next */
const CAM = [
  [9,     .6,          .13,  28],
  [12,    .3,          .1,   30],
  [15,    .95,         .06,  22],
  [19,    1.2,         .05,  17],
  [22.5,  1.9,         .025, 13],
  [26,    2.6,         .07,  20],
  [36.5,  .55 - TAU,   .14,  30],
  [49,    .55 - TAU,   .14,  30],
  [57,    .55,         .12,  26],
  [59.5,  1.35,        1.15, 62],
  [62,    2.35,        1.15, 70],
  [67,    2.95,        .3,   230],
];
/* the mood cuts: [t, mood]; 2, 3 and 4 switch while the camera holds one angle, as pressing the keys does */
const CUTS = [[37, 'golden'], [41, 'sunset'], [45, 'night'], [57, 'day']];

export function createDirector({ chase, sound, setMood }){
  const fade = document.createElement('div'); fade.id = 'fade'; document.body.append(fade);
  document.body.classList.add('film');
  const st = { t:0, on:false, clicked:false, rolling:false, roll:null, sound:false, cut:0, done:false };
  const controls = { fwd:false, back:false, left:false, right:false, boost:false, stick:{ on:false, x:0, y:0 } };
  const C = chase.state;

  function camera(t){
    let i = 0; while(i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
    const a = CAM[i], b = CAM[i + 1], e = easeInOut(clamp((t - a[0])/(b[0] - a[0]), 0, 1));
    const portrait = innerWidth < innerHeight ? 44/28 : 1;   /* as the opening: pull back so the boat fits */
    C.yaw = a[1] + (b[1] - a[1])*e;
    C.pitch = a[2] + (b[2] - a[2])*e;
    C.dist = Math.exp(Math.log(a[3]) + (Math.log(b[3]) - Math.log(a[3]))*e)*portrait;
  }
  function roll(){ if(st.rolling || !st.clicked || !st.roll) return; st.rolling = true; st.roll(); }

  return {
    get rolling(){ return st.rolling; },
    /* the page is ready: roll on the click (now, if it came already) */
    arm(fn){ st.roll = fn; roll(); },
    /* a click or key: make the sound now (it needs the gesture) but keep it silent until the engine cranks */
    gesture(){
      if(st.clicked) return;
      st.clicked = true;
      sound.start();
      const S = sound.state; if(S.ctx){ S.out.gain.cancelScheduledValues(0); S.out.gain.value = 0; }
      roll();
    },
    start(){ st.on = true; },
    /* this frame's boat controls, after advancing the script */
    update(dt){
      if(!st.on) return controls;
      const t = st.t += dt;
      if(!st.sound && t > ENGINE){
        st.sound = true;
        const S = sound.state; if(S.ctx){ S.crank = 1.3; S.rpm = 0; S.out.gain.setTargetAtTime(.9, S.ctx.currentTime, .6); }
      }
      const d = DRIVE.find(([a, b])=>t >= a && t < b)?.[2] || {};
      controls.fwd = !!d.fwd; controls.boost = !!d.boost;
      if(st.cut < CUTS.length && t >= CUTS[st.cut][0]){
        setMood(CUTS[st.cut++][1]);
      }
      if(!chase.intro.on) camera(t);
      fade.style.opacity = clamp((t - (END - 1.5))/1.5, 0, 1).toFixed(3);
      if(!st.done && t >= END){ st.done = true; window.FILM_DONE = true; console.log('film: done'); }
      return controls;
    },
    get t(){ return st.t; },
  };
}
