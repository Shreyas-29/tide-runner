import { TAU, params } from '../config.js';

/* ================================================================== *
 *  Sound, all synthesized (no audio files).
 *  The engine is a sampled-style diesel: one buffer holds a run of six-
 *  cylinder firing pulses (exhaust resonances, a thump, a crack of
 *  noise, each cylinder a little different, every stroke jittered),
 *  and it loops at a playback rate that is the revs, the way engine
 *  sound tools do it. It cranks slowly, catches and settles to idle.
 *  The sea is waves: noise through a filter that opens as each wave
 *  rises and breaks and closes as it runs out, panned around you, over
 *  a low surf bed. Near the boat water laps the hull; underway it
 *  rushes and hisses, and the hull slaps when it lands.
 *  Browsers need a gesture: start() is called on the first key or touch.
 * ================================================================== */
export function createSound({ boat, camera, ocean }){
  const S = { ctx:null, muted:params.has('mute'), rpm:0, crank:0, nextWave:0, nextLap:0, t:0, vyPrev:0 };
  const B = boat.state;

  function start(){
    if(S.muted) return;
    if(S.ctx){ if(S.ctx.state === 'suspended') S.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
    const ctx = S.ctx = new AC(), now = ctx.currentTime, sr = ctx.sampleRate;
    const out = S.out = ctx.createGain(); out.gain.value = 0; out.gain.setTargetAtTime(.9, now, .6);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 2.5; comp.attack.value = .005; comp.release.value = .25;
    comp.connect(out); out.connect(ctx.destination); S.bus = comp;
    const filt = (type, f, q = .7, g = 0)=>{ const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g; return n; };
    const gain = (v)=>{ const g = ctx.createGain(); g.gain.value = v; return g; };
    const chain = (...n)=>{ for(let i=0;i<n.length - 1;i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
    /* pink noise (Kellet), stereo, 10 s */
    const pink = ctx.createBuffer(2, sr*10, sr);
    for(let c=0;c<2;c++){ const d = pink.getChannelData(c); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for(let i=0;i<d.length;i++){ const w = Math.random()*2 - 1;
        b0 = .99886*b0 + w*.0555179; b1 = .99332*b1 + w*.0750759; b2 = .969*b2 + w*.153852; b3 = .8665*b3 + w*.3104856; b4 = .55*b4 + w*.5329522; b5 = -.7616*b5 - w*.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w*.5362)*.11; b6 = w*.115926; } }
    S.pink = pink;
    const loop = (buf, rate = 1)=>{ const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(now, Math.random()*buf.duration); return s; };

    /* the engine: a run of firing strokes rendered once, played at the revs */
    const BASE = 600, fire = BASE/60*3, n = 60, L = Math.round(sr*n/fire), eb = ctx.createBuffer(1, L, sr), ed = eb.getChannelData(0);
    const cyl = [1, .86, 1.08, .93, 1.02, .9];                    /* each cylinder a little different */
    for(let i=0;i<n;i++){
      const t0 = Math.round((i + (Math.random() - .5)*.06)*sr/fire), a = cyl[i % 6]*(.85 + .3*Math.random());
      const len = Math.round(sr*.05);
      for(let j=0;j<len;j++){
        const t = j/sr, k = (t0 + j + L) % L;
        const thump = Math.sin(TAU*52*t)*Math.exp(-t/.014);
        const bark = (Math.sin(TAU*118*t + .3)*.9 + Math.sin(TAU*265*t + 1.1)*.5 + Math.sin(TAU*610*t)*.22)*Math.exp(-t/.0065);
        const crack = (Math.random()*2 - 1)*Math.exp(-t/.0022)*.5;
        ed[k] += a*(thump*.8 + bark + crack);
      }
    }
    let mx = 0; for(let i=0;i<L;i++) mx = Math.max(mx, Math.abs(ed[i])); for(let i=0;i<L;i++) ed[i] /= mx;
    const shaper = ctx.createWaveShaper(); { const m = 2048, c = new Float32Array(m); for(let i=0;i<m;i++){ const x = i/(m - 1)*2 - 1; c[i] = Math.tanh(x*1.8)/Math.tanh(1.8); } shaper.curve = c; }
    S.engSrc = loop(eb, 0); S.engSrc.playbackRate.value = .001;
    S.engLP = filt('lowpass', 900, .8); S.eng = gain(0);
    chain(S.engSrc, shaper, S.engLP, filt('peaking', 110, 1.2, 5), filt('peaking', 420, 2, 2.5), S.eng, comp);
    /* the crankshaft and hull drumming under it: the same strokes an octave down, only the lows */
    S.subSrc = loop(eb, 0); S.subSrc.playbackRate.value = .001; S.sub = gain(0); chain(S.subSrc, filt('lowpass', 140, .9), S.sub, comp);
    S.engBase = BASE; S.crank = 1.3; S.rpm = 0;

    /* the sea */
    S.bed = gain(0); chain(loop(pink, .8), filt('lowpass', 650, .5), S.bed, comp);
    S.rush = gain(0); S.rushF = filt('bandpass', 900, .6); chain(loop(pink, 1.1), S.rushF, S.rush, comp);
    S.spray = gain(0); chain(loop(pink, 1.3), filt('highpass', 3000, .6), S.spray, comp);
    S.wind = gain(0); S.windF = filt('bandpass', 500, 1.4); chain(loop(pink, .7), S.windF, S.wind, comp);
  }

  /* one-shots: a wave rising and breaking somewhere around you, a wet knock on the hull, a hard landing */
  function burst({ type, q = .7, from, to, dur, attack, level, pan = 0 }){
    const ctx = S.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = S.pink; s.playbackRate.value = .85 + Math.random()*.3;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from[0], t);
    if(from[1]) f.frequency.exponentialRampToValueAtTime(from[1], t + attack);
    f.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(level, .0002), t + attack*.9); g.gain.setTargetAtTime(.0001, t + attack, dur/3);
    p.pan.value = pan;
    s.connect(f); f.connect(g); g.connect(p); p.connect(S.bus);
    s.start(t, Math.random()*8); s.stop(t + attack + dur + 1);
  }
  const wave = (level)=>burst({ type:'lowpass', q:.4, from:[180, 900 + Math.random()*1900], to:220, attack:1.4 + Math.random()*1.8, dur:2.5 + Math.random()*3, level, pan:Math.random()*1.6 - .8 });
  const lap = (level)=>burst({ type:'bandpass', q:1.6, from:[350 + Math.random()*500], to:180 + Math.random()*120, attack:.03, dur:.12 + Math.random()*.3, level, pan:Math.random()*1.2 - .6 });
  const slap = (k)=>burst({ type:'lowpass', from:[300 + 300*Math.random()], to:250, attack:.012, dur:.45, level:Math.min(1.6, k*2) });

  function update(dt){
    const ctx = S.ctx; if(!ctx || dt <= 0) return;
    const t = ctx.currentTime, set = (p, v, tc = .08)=>p.setTargetAtTime(v, t, tc);
    S.t += dt;
    const d = camera.position.distanceTo(boat.model.boat.position), near = boat.enabled ? 1/(1 + Math.max(0, d - 12)/45) : 0;
    const spd = Math.max(0, B.u), sf = Math.min(1, spd/12), sea = .55 + .45*Math.min(1, ocean.hs/2);
    /* the sea */
    set(S.bed.gain, .16*sea, .5);
    if((S.nextWave -= dt) < 0){ S.nextWave = 1.6 + Math.random()*3.8; wave((.18 + .3*Math.random())*sea); }
    if((S.nextLap -= dt) < 0){ S.nextLap = .25 + Math.random()*.9; if(boat.enabled) lap(near*(.08 + .14*Math.random())*(1 - .8*sf)); }
    set(S.wind.gain, .03 + .06*sf*sf, .6); set(S.windF.frequency, 380 + 160*Math.sin(S.t*.27) + 450*sf, .6);
    /* the engine: crank, catch, then revs from throttle and load */
    const thr = B.thrIn > 0 ? Math.min(1, B.thrIn/5.2*1.3) : B.thrIn < 0 ? .4 : 0;
    let rpmT;
    if(S.crank > 0){ S.crank -= dt; rpmT = S.crank > 0 ? 170 + 30*Math.sin(S.t*21) : 1050; }
    else rpmT = 650 + 1650*Math.max(thr*(.5 + .5*sf), sf*.8);
    S.rpm += (rpmT - S.rpm)*Math.min(1, dt*(S.crank > 0 ? 12 : rpmT > S.rpm ? 2.4 : 1.3));
    const rate = S.rpm/S.engBase*(1 + .006*Math.sin(S.t*5.3));
    set(S.engSrc.playbackRate, rate, .04); set(S.subSrc.playbackRate, rate*.5, .04);
    const load = Math.max(thr, sf*.55), cranking = S.crank > 0;
    set(S.engLP.frequency, cranking ? 500 : 500 + 1700*load + .4*S.rpm, .1);
    set(S.eng.gain, near*(cranking ? .35 : .45 + .4*load), .08);
    set(S.sub.gain, near*(cranking ? .2 : .35 + .25*load), .08);
    /* underway: water rushing past and spray hiss */
    set(S.rush.gain, near*.5*Math.pow(sf, 1.4), .2); set(S.rushF.frequency, 500 + 900*sf, .3);
    set(S.spray.gain, near*.12*sf*sf, .2);
    const landing = S.vyPrev < -.3 && B.vy > S.vyPrev + .2 && spd > 3;
    if(landing) slap(near*Math.min(1, -S.vyPrev)*(.4 + .6*sf));
    S.vyPrev = B.vy;
  }

  return {
    start, update, state:S,
    toggleMute(){ S.muted = !S.muted; if(S.ctx) S.out.gain.setTargetAtTime(S.muted ? 0 : .9, S.ctx.currentTime, .2); else start(); },
  };
}
