import './styles.css';
import * as THREE from 'three';
import { params, DEBUG, MOODS, MOOD_KEYS } from './config.js';
import { createPassRunner } from './core/gpu.js';
import { createQuality } from './core/quality.js';
import { createOcean } from './ocean/ocean.js';
import { createSurface } from './ocean/surface.js';
import { createSky, ASSET_COUNT } from './sky/sky.js';
import { createWake } from './wake/kelvin.js';
import { createDynamicWaves } from './wake/dynamic.js';
import { createBoat } from './boat/boat.js';
import { createChaseCamera } from './camera/chase.js';
import { createInput } from './ui/input.js';
import { createHud } from './ui/hud.js';
import { createEntrance } from './ui/entrance.js';
import { createSound } from './audio/sound.js';

/* ================================================================== *
 *  Open Ocean · Tiderunner. Wires the pieces together and runs the
 *  frame: ocean FFT → boat physics → camera → wake + dynamic waves →
 *  sound → sky light → sea uniforms → boat mirror → composer.
 * ================================================================== */
const canvas = document.getElementById('c');
const hud = createHud({ onMood:(k)=>setMood(k) });

const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, depth:false, stencil:false, powerPreference:'high-performance' });
if(!renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')){
  hud.fatal('Open Ocean needs WebGL 2 with float render targets. Try a recent Chrome, Edge or Safari.');
  throw new Error('unsupported GPU');
}
renderer.toneMapping = THREE.NoToneMapping;   /* the composer tone-maps */
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;   /* updated once a frame, before the mirror */

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, .5, 60000);
camera.rotation.order = 'YXZ';

/* what every module shares: the renderer, the scene, a full-screen pass runner, and the vessel the wake follows */
const app = {
  renderer, scene, camera, frame:0,
  runPass:createPassRunner(renderer),
  vessel:{ x:0, z:0, heading:0, speed:0, length:16, beam:5, active:false, y:0, pitch:0, roll:0, lev:0, thr:0 },
};

const entrance = createEntrance({ assets:ASSET_COUNT, onReveal });
const ocean = createOcean(app);
const sky = createSky(app, { onAsset:()=>entrance.loaded() });
const dyn = createDynamicWaves(app, ocean);
const wake = createWake(app, dyn);
const surface = createSurface(app, { ocean, sky, wake, dyn });
const boat = createBoat(app, { ocean, sky, surface });
const chase = createChaseCamera(app, boat);
const sound = createSound({ boat, camera, ocean });
const input = createInput({ canvas, camera:chase, onKey, onGesture });

function resize(){
  sky.composer.setSize(innerWidth, innerHeight);
  const pr = renderer.getPixelRatio();
  boat.reflection.setSize(innerWidth*pr, innerHeight*pr);
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
}
const quality = createQuality({ renderer, sky, boat, resize });
addEventListener('resize', resize);

/* ---------------- moods and shortcuts ---------------- */
let mood = MOODS[params.get('mood')] ? params.get('mood') : 'day';
function setMood(k){
  const m = MOODS[k]; if(!m) return;
  mood = k;
  sky.applyMood(m); ocean.setWeather(m); boat.applyMood(m);
}
function onKey(code){
  const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
  if(i >= 0) setMood(MOOD_KEYS[i]);
  if(code === 'BracketRight') ocean.nudgeWind(1);
  if(code === 'BracketLeft') ocean.nudgeWind(-1);
  if(code === 'KeyH') hud.toggle();
  if(code === 'KeyM') sound.toggleMute();
}
/* any key, click or touch: sound may start now, and the player is taking over from the opening shot */
let titleTimers = [];
function onGesture(){
  sound.start();
  if(chase.intro.on && chase.intro.go){ chase.hurry(); titleTimers.forEach(clearTimeout); entrance.title(false); }
}
function onReveal(){
  chase.startIntro();
  if(chase.intro.on) titleTimers = [setTimeout(()=>entrance.title(true), 1100), setTimeout(()=>entrance.title(false), 5600)];
  else hud.show();
}

setMood(mood);
boat.faceSun(sky.U.sunDir.value, MOODS[mood].face);
resize();
quality.apply();

/* ---------------- the frame ---------------- */
const _rot = new THREE.Matrix4();
let last = performance.now(), T = 0, frameMs = 16.7;
function frame(now, manual){
  const raw = (now - last)/1000;
  if(!manual && raw < 1/75){ requestAnimationFrame(frame); return; }   /* cap near 75 fps: high-refresh screens needn't run the sea twice as often */
  last = now;
  const dt = (DEBUG && window.FREEZE) ? 0 : Math.min(raw, 1/20);
  T += dt; app.frame++;
  if(raw < .1) frameMs += (raw*1000 - frameMs)*.05;
  if(!manual && entrance.revealed && quality.watch(frameMs, raw)) frameMs = 16.7;

  ocean.simulate(T, dt);
  boat.update(dt, input.read());
  entrance.tick();
  chase.update(dt);
  if(entrance.revealed && chase.introProgress > .72) hud.show();
  if(dt > 0){ wake.update(dt); dyn.update(dt); }
  sound.update(dt);
  sky.update(dt, T);
  surface.update();

  camera.updateMatrixWorld();
  _rot.extractRotation(camera.matrixWorldInverse);
  sky.U.vpRot.value.multiplyMatrices(camera.projectionMatrix, _rot);
  renderer.shadowMap.needsUpdate = true;
  boat.renderReflection();
  sky.composer.render(dt);
  sky.U.ssOK.value = 1;   /* from now on there is a saved sky for the sea to reflect */

  if(app.frame % 6 === 0) hud.update({ mood, wind:ocean.sea.wind, hs:ocean.hs, fps:1000/frameMs, speed:boat.state.u, heading:boat.state.h });
  if(!manual) requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ last = performance.now(); requestAnimationFrame(frame); } });
requestAnimationFrame(frame);

/* ---------------- ?debug: internals on window, and a way to step and time frames ---------------- */
if(DEBUG) Object.assign(window, {
  THREE, app, renderer, scene, camera, ocean, sky, wake, dyn, surface, boat, chase, sound, quality, setMood,
  BOAT:boat.state, CH:chase.state, surfU:surface.uniforms,
  step:(n = 1, h = 1/60)=>{ window.FREEZE = false; for(let i=0;i<n;i++){ last = performance.now() - h*1000; frame(performance.now(), true); } window.FREEZE = true; },
  bench:(n = 60)=>{ const px = new Uint8Array(4), g = renderer.getContext(); frame(performance.now(), true); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
    const t0 = performance.now(); for(let i=0;i<n;i++){ last = performance.now() - 16.7; frame(performance.now(), true); } g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
    return ((performance.now() - t0)/n).toFixed(2) + ' ms/frame @ ' + renderer.domElement.width + 'x' + renderer.domElement.height; },
});
