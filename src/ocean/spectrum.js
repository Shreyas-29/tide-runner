import { TAU, G } from '../config.js';
import { wrapA } from '../core/math.js';

/* JONSWAP frequency spectrum (peak enhancement gamma) */
export function jonswap(w, alpha, wp, gamma){
  const sig = w <= wp ? .07 : .09;
  const r = Math.exp(-.5*((w - wp)/(sig*wp))**2);
  return alpha*G*G/Math.pow(w, 5)*Math.exp(-1.25*Math.pow(wp/w, 4))*Math.pow(gamma, r);
}

/* Donelan-Banner directional spreading */
export function donelan(w, wp, th){
  const x = w/wp; let b;
  if(x < .95) b = 2.61*Math.pow(x, 1.3);
  else if(x < 1.6) b = 2.28*Math.pow(x, -1.3);
  else b = Math.pow(10, -.4 + .8393*Math.exp(-.567*Math.log(x*x)));
  const a = Math.min(Math.abs(b*th), 20);
  return b/(2*Math.tanh(b*Math.PI))/Math.cosh(a)**2;
}

/* the sea state as a directional spectrum S(ω, θ): a fetch-limited wind sea plus a long swell */
export function seaSpectrum(sea){
  const U = Math.max(sea.wind, .5), F = sea.fetch;
  const alpha = .076*Math.pow(U*U/(F*G), .22), wp = 22*Math.pow(G*G/(U*F), 1/3);
  const ws = TAU/sea.swellT, gs = 6;
  const alphaS = (sea.swellHs/4)**2*5*ws**4/(G*G)*(1 - .287*Math.log(gs));
  const s = sea.swellSpread, qn = Math.sqrt(s + .25)/(2*Math.sqrt(Math.PI));
  return (w, th)=>{
    let S = jonswap(w, alpha, wp, 3.3)*donelan(w, wp, wrapA(th - sea.windDir));
    if(sea.swellHs > .001) S += jonswap(w, alphaS, ws, gs)*qn*Math.pow(Math.abs(Math.cos(wrapA(th - sea.swellDir)/2)), 2*s);
    return S;
  };
}
