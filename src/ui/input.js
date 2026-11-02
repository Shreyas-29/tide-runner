import { TOUCH } from '../config.js';

/* ================================================================== *
 *  Input: the keyboard, mouse and touch, turned into boat controls and
 *  camera moves.
 *    W/S or ↑/↓ throttle, A/D or ←/→ steer, Shift boost.
 *    Drag orbits the camera, the wheel or a pinch zooms.
 *    On touch screens a thumb stick drives: up throttle (to the rim
 *    boosts), down astern, sideways steers.
 *  onKey(code) gets every key press for shortcuts; onGesture() fires on
 *  any key, click or touch (sound needs one; it also hurries the intro).
 * ================================================================== */
export function createInput({ canvas, camera, onKey = ()=>{}, onGesture = ()=>{} }){
  const keys = {};
  const stick = { on:false, x:0, y:0, id:null };
  if(TOUCH) document.body.classList.add('touch');

  addEventListener('keydown', (e)=>{ keys[e.code] = true; onKey(e.code, e); onGesture(); });
  addEventListener('keyup', (e)=>{ keys[e.code] = false; });
  addEventListener('blur', ()=>{ for(const k in keys) keys[k] = false; });   /* no stuck throttle after switching tabs */

  /* one finger or the mouse orbits; two fingers pinch to zoom */
  const ptr = new Map(); let pinch = 0, last = null;
  canvas.addEventListener('pointerdown', (e)=>{ ptr.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; pinch = 0;
    try{ canvas.setPointerCapture(e.pointerId); }catch(_){} onGesture(); });
  canvas.addEventListener('pointermove', (e)=>{
    if(!ptr.has(e.pointerId)) return;
    ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if(ptr.size === 2){
      const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if(pinch) camera.zoom(pinch/d);
      pinch = d; return;
    }
    if(ptr.size === 1 && last){ camera.orbit(e.clientX - last[0], e.clientY - last[1]); last = [e.clientX, e.clientY]; }
  });
  const end = (e)=>{ ptr.delete(e.pointerId); pinch = 0; last = ptr.size ? [...ptr.values()][0] : null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e)=>{ e.preventDefault(); camera.zoom(Math.exp(e.deltaY*.001)); onGesture(); }, { passive:false });

  /* the thumb stick */
  {
    const el = document.getElementById('stick'), ring = el.querySelector('.ring'), knob = el.querySelector('.knob');
    const move = (e)=>{ const r = ring.getBoundingClientRect(), R = r.width/2;
      let x = (e.clientX - r.left - R)/R, y = -(e.clientY - r.top - R)/R; const m = Math.hypot(x, y); if(m > 1){ x /= m; y /= m; }
      stick.x = x; stick.y = y; knob.style.transform = `translate(${x*R*.62}px, ${-y*R*.62}px)`; };
    ring.addEventListener('pointerdown', (e)=>{ stick.on = true; stick.id = e.pointerId; el.classList.add('held'); try{ ring.setPointerCapture(e.pointerId); }catch(_){} move(e); onGesture(); });
    ring.addEventListener('pointermove', (e)=>{ if(stick.on && e.pointerId === stick.id) move(e); });
    const up = (e)=>{ if(e.pointerId !== stick.id) return; stick.on = false; stick.x = stick.y = 0; el.classList.remove('held'); knob.style.transform = ''; };
    ring.addEventListener('pointerup', up); ring.addEventListener('pointercancel', up);
  }

  const controls = { fwd:false, back:false, left:false, right:false, boost:false, stick };
  return {
    keys, stick,
    /* this frame's boat controls */
    read(){
      controls.fwd = !!(keys.KeyW || keys.ArrowUp); controls.back = !!(keys.KeyS || keys.ArrowDown);
      controls.left = !!(keys.KeyA || keys.ArrowLeft); controls.right = !!(keys.KeyD || keys.ArrowRight);
      controls.boost = !!(keys.ShiftLeft || keys.ShiftRight);
      return controls;
    },
  };
}
