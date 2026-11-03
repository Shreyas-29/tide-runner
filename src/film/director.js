import { MOOD_KEYS } from '../config.js';
import { easeInOut, clamp } from '../core/math.js';

/* ================================================================== *
 *  ?film: a scripted ~48 s promo shot, no HUD, nobody at the wheel.
 *  The director drives the boat with fake controls, places the chase
 *  camera from keyframes once the opening swoop is done, starts the
 *  sound as the engine is due to crank, and dips to black to hide each
 *  mood cut. It cuts back to golden hour for the top-down shot: at night
 *  the wake is too dark to read from above. window.FILM_DONE is set
 *  when the last fade ends.
 *    0   golden hour, the opening swoop and title card
 *    8   engine cranks and catches        10.5  throttle up
 *    12  boost through the swell          19    low orbit at the hull
 *    26  moods 1 → 2 → 3 → 4 underway     34    night, lamps and stars
 *    39  golden again, top-down over the wake    43  slow wide pull-back
 * ================================================================== */
const END = 48;

/* the boat: [from, to, controls] */
const DRIVE = [
  [10.5, 12,  { fwd:true }],
  [12,   19,  { fwd:true, boost:true }],
  [19,   30,  { fwd:true }],
  [30,   32,  { fwd:true, left:true }],
  [32,   44,  { fwd:true }],
];
/* the camera after the opening: [t, yaw, pitch, dist]; yaw 0 is dead astern. Each key eases into the next */
const CAM = [
  [9,    .6,   .13,  28],
  [12,   .3,   .1,   30],
  [15,   .95,  .06,  22],
  [19,   1.2,  .05,  17],
  [22.5, 1.9,  .025, 13],
  [26,   2.6,  .03,  14],
  [27.5, .55,  .14,  30],
  [34,   .5,   .13,  30],
  [39,  -.4,   .1,   22],
  [41,  -.4,   1.15, 62],
  [43,   1.6,  1.15, 70],
  [48,   2.1,  .3,   230],
];
/* the mood cuts: [t, mood], each in the middle of a dip to black */
const CUTS = [[26, 0], [28, 1], [30, 2], [32, 3], [39, 1]];
const DIP = .35;

export function createDirector({ chase, sound, setMood }){
  const fade = document.createElement('div'); fade.id = 'fade'; document.body.append(fade);
  document.body.classList.add('film');
  const st = { t:0, on:false, sound:false, cut:0, done:false };
  const controls = { fwd:false, back:false, left:false, right:false, boost:false, stick:{ on:false, x:0, y:0 } };

  function camera(t){
    let i = 0; while(i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
    const a = CAM[i], b = CAM[i + 1], e = easeInOut(clamp((t - a[0])/(b[0] - a[0]), 0, 1));
    const C = chase.state, portrait = innerWidth < innerHeight ? 44/28 : 1;   /* as the opening: pull back so the boat fits */
    C.yaw = a[1] + (b[1] - a[1])*e;
    C.pitch = a[2] + (b[2] - a[2])*e;
    C.dist = Math.exp(Math.log(a[3]) + (Math.log(b[3]) - Math.log(a[3]))*e)*portrait;
  }

  return {
    start(){ st.on = true; },
    /* this frame's boat controls, after advancing the script */
    update(dt){
      if(!st.on) return controls;
      const t = st.t += dt;
      if(!st.sound && t > 8){ st.sound = true; sound.start(); }
      const d = DRIVE.find(([a, b])=>t >= a && t < b)?.[2] || {};
      controls.fwd = !!d.fwd; controls.boost = !!d.boost; controls.left = !!d.left; controls.right = !!d.right;
      if(!chase.intro.on) camera(t);
      if(st.cut < CUTS.length && t >= CUTS[st.cut][0]) setMood(MOOD_KEYS[CUTS[st.cut++][1]]);
      let black = Math.max(0, ...CUTS.map(([c])=>1 - Math.abs(t - c)/DIP));
      black = Math.max(black, clamp((t - (END - 1.5))/1.5, 0, 1));
      fade.style.opacity = Math.min(1, black*1.6).toFixed(3);
      if(!st.done && t >= END){ st.done = true; window.FILM_DONE = true; console.log('film: done'); }
      return controls;
    },
    get t(){ return st.t; },
  };
}
