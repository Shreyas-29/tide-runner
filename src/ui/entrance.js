/* ================================================================== *
 *  The entrance: a curtain while the sky's data loads and the clouds
 *  settle (they converge over many frames), then it lifts on the
 *  opening shot with a title card. A fallback lifts it after 15 s
 *  whatever happens, so nobody is ever stuck behind it.
 * ================================================================== */
const STEPS = ['setting the sky', 'reading the atmosphere', 'raising the clouds', 'shaping the clouds', 'carving the cloud detail', 'scattering the light', 'launching tiderunner'];
const WARM_FRAMES = 90;

export function createEntrance({ assets, onReveal }){
  const curtain = document.getElementById('curtain'), bar = document.getElementById('pb'), status = document.getElementById('cs'), title = document.getElementById('title');
  const st = { loaded:0, warm:-1, revealed:false };
  const fallback = setTimeout(()=>{ if(st.warm < 0) st.warm = 0; }, 15000);

  function reveal(){
    st.revealed = true; clearTimeout(fallback);
    curtain.classList.add('gone');
    setTimeout(()=>curtain.remove(), 2400);
    onReveal();
  }
  return {
    get revealed(){ return st.revealed; },
    /* one asset arrived */
    loaded(){
      st.loaded++;
      bar.style.width = (st.loaded/assets*100) + '%';
      status.textContent = STEPS[Math.min(st.loaded, STEPS.length - 1)];
      if(st.loaded >= assets && st.warm < 0) st.warm = 0;
    },
    /* every frame: count the warm-up frames once everything is in */
    tick(){ if(st.warm >= 0 && !st.revealed && ++st.warm > WARM_FRAMES) reveal(); },
    title(show){ title.classList.toggle('show', show); },
  };
}
