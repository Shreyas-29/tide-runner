/* ================================================================== *
 *  Every tunable in one place. Units are metres, seconds, radians
 *  unless a name says otherwise. URL flags:
 *    ?debug        exposes internals on window and step()/bench()
 *    ?mood=night   day | golden | sunset | night
 *    ?q=0..3       pins a quality tier (0 = best)   ?dpr=1.5 pins the pixel ratio
 *    ?nointro      skips the opening shot           ?mute starts silent
 *    ?noboat       the sea alone
 * ================================================================== */
export const params = new URLSearchParams(location.search);
export const DEBUG = params.has('debug');
export const TOUCH = matchMedia('(pointer: coarse)').matches;

export const TAU = Math.PI*2, G = 9.81;

/* ---------------- ocean ---------------- */
export const FFT = { N:256, LOG2N:8 };
/* three tiling patches: long swell and wind sea, metre-scale chop, short ripples */
export const CASCADES = [
  { L:640, kMin:0,           kMax:TAU/96*6, foam:.9  },
  { L:96,  kMin:TAU/96*6,    kMax:TAU/16*6, foam:.82 },
  { L:16,  kMin:TAU/16*6,    kMax:1e9,      foam:.6  },
];
export const SEA = { wind:10, fetch:150000, windDir:.35, swellHs:.9, swellT:11, swellDir:.05, swellSpread:24, chop:.9, cutoff:.045 };

/* ---------------- moods ----------------
   el/az: degrees, local, az from north (x) toward east (z). exp: camera exposure.
   boatSun: the boat's share of the sun (paint is ~10x brighter than the dark sea).
   env: how strongly the sky gradient lights the boat. water/sss: sea body colour and its glow.
   night: the light is the moon. The sky is rendered as daylight and graded day-for-night (as film
   does), with stars, a bloom on the bright things, and the boat's lamps on. */
export const MOODS = {
  day:    { label:'Day',         el:38,  az:150, cover:.28, exp:5,   tone:'AGX',         boatSun:.38, env:.55, wind:7, chop:1,    water:[.006, .045, .065], sss:[.04, .32, .36] },
  golden: { label:'Golden hour', el:11,  az:240, cover:.3,  exp:6,   tone:'AGX',         boatSun:.2,  env:.75, wind:8, chop:1.05, water:[.005, .036, .052], sss:[.06, .32, .32] },
  sunset: { label:'Sunset',      el:1.4, az:250, cover:.2,  exp:7.8, tone:'ACES_FILMIC', boatSun:.24, env:1.1, wind:7, chop:1,    water:[.012, .05, .075],  sss:[.08, .34, .34] },
  night:  { label:'Night',       el:24,  az:205, cover:.24, exp:.75, tone:'AGX',         boatSun:.16, env:.4,  wind:6, chop:.95,  water:[.004, .03, .05],   sss:[.03, .2, .26],
            night:{ grade:1, stars:8, bloom:.8, lamps:9, cabin:7, deck:22 } },
};
export const MOOD_KEYS = ['day', 'golden', 'sunset', 'night'];

/* ---------------- boat ---------------- */
export const BOAT = { length:16, beam:5 };

/* ---------------- wake ---------------- */
export const WAKE = { RES:1024, TEX:1, REACH:160, AMP:.15 };
/* the dynamic-wave grid around the boat: two wave speeds as a crude dispersion */
export const DYN = { RES:512, DX:.25, C:[2.5, 4.6], PUSH:.42, SEA:.3 };   /* PUSH: water displaced by the hull; SEA: how much of the waves' relief the hull throws back */

/* ---------------- render quality tiers (auto steps down while the frame rate sags) ---------------- */
export const QUALITY = [
  { dpr:1.5,  clouds:'medium', refl:true,  shadow:2048 },
  { dpr:1.15, clouds:'medium', refl:true,  shadow:2048 },
  { dpr:.9,   clouds:'low',    refl:true,  shadow:1024 },
  { dpr:.72,  clouds:'low',    refl:false, shadow:1024 },
];

/* ---------------- assets (served from public/assets, copied from the npm packages) ---------------- */
export const ASSETS = {
  atmosphere:'assets/atmosphere',
  weather:'assets/clouds/local_weather.png', turbulence:'assets/clouds/turbulence.png',
  shape:'assets/clouds/shape.bin', detail:'assets/clouds/shape_detail.bin',
  stbn:'assets/stbn.bin',
};
