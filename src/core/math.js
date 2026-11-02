import { TAU } from '../config.js';

/* a small seeded PRNG (mulberry32) and a standard normal from it */
export function rng(seed){
  return ()=>{ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; };
}
export const gauss = (r)=>{ const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v); };

/* wrap an angle to (-π, π] */
export const wrapA = (a)=>Math.atan2(Math.sin(a), Math.cos(a));
export const clamp = (x, a, b)=>Math.min(b, Math.max(a, x));
export const smooth = (a, b, x)=>{ x = clamp((x - a)/(b - a), 0, 1); return x*x*(3 - 2*x); };
export const easeInOut = (x)=>x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2;
/* frame-rate independent exponential approach: the fraction to move this frame at a given rate (1/s) */
export const approach = (rate, dt)=>1 - Math.exp(-rate*dt);
