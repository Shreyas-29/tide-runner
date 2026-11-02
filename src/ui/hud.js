import { MOODS, MOOD_KEYS } from '../config.js';

/* the HUD: brand top-left, mood pills top-right (clickable), sea readouts, speed and heading, key hints */
const K = (...k)=>k.map((x)=>`<kbd>${x}</kbd>`).join('');
const $ = (id)=>document.getElementById(id);

export function createHud({ onMood }){
  const root = $('hud'), moods = $('moods'), sea = $('sea'), kn = $('kn'), thr = $('thr'), hdg = $('hdg'), keys = $('keys');
  moods.addEventListener('click', (e)=>{ const b = e.target.closest('button'); if(b) onMood(b.dataset.k); });
  keys.innerHTML = `<span>${K('W', 'S')} throttle</span><span>${K('A', 'D')} steer</span><span>${K('⇧')} boost</span>`
    + `<span>drag orbit</span><span>scroll zoom</span><span>${K('1', '4')} mood</span><span>${K('M')} sound</span><span>${K('H')} hide</span>`;
  let shownMood = '';

  return {
    show(){ root.classList.remove('pre'); },
    toggle(){ root.classList.toggle('off'); },
    fatal(msg){ const d = document.createElement('div'); d.id = 'fatal'; d.textContent = msg; document.body.append(d); },
    update({ mood, wind, hs, fps, speed, heading }){
      if(shownMood !== mood){
        shownMood = mood;
        moods.innerHTML = MOOD_KEYS.map((k, i)=>`<button data-k="${k}" class="${k === mood ? 'on' : ''}"><i>${i + 1}</i>${MOODS[k].label}</button>`).join('');
      }
      sea.innerHTML = `WIND ${wind.toFixed(0)} M/S ${K('[', ']')}<br>SEA HS ${hs.toFixed(1)} M · ${fps.toFixed(0)} FPS`;
      const knots = Math.max(0, speed)*1.944;
      kn.textContent = knots.toFixed(0);
      thr.style.width = Math.min(100, knots/30*100).toFixed(1) + '%';
      hdg.textContent = 'HDG ' + String(Math.round(((heading*180/Math.PI) % 360 + 360) % 360)).padStart(3, '0') + '°';
    },
  };
}
