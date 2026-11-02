# Open Ocean · Tiderunner

Drive a 16 m pilot boat across a real-time ocean in the browser. Every wave, cloud, rivet and engine note is generated in code: no models, no textures, no audio files.

- **Ocean:** a Tessendorf FFT sea on the GPU, made of three cascades with a JONSWAP wind sea plus swell, choppy waves, Jacobian whitecaps, sky reflections and a sun glint.
- **Sky:** takram's physically based atmosphere and volumetric clouds, in four moods: Day, Golden hour, Sunset and **Night** (moon, stars, boat lamps).
- **Boat:** TIDERUNNER, modelled procedurally and floating on the waves with heave, pitch, roll and planing.
- **Wake:** an analytic Kelvin V plus a wave-equation sim around the hull. The bow throws a crest, the props churn the water, and **waves that reach the hull get pushed back and break white against it**.
- **Sound:** a synthesized diesel that cranks, idles and revs with the throttle, plus waves, hull laps, rush and spray.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve dist/
```

`npm run dev` and `npm run build` first copy takram's atmosphere and cloud data from `node_modules` into `public/assets/`, so the site serves its own copies and nothing comes from a third-party host at runtime.

## Controls

| | Desktop | Phone |
|---|---|---|
| Throttle / astern | W / S (↑ / ↓) | thumb stick up / down |
| Steer | A / D (← / →) | thumb stick sideways |
| Boost | Shift | stick to the rim |
| Camera | drag to orbit, scroll to zoom | drag, pinch |
| Mood | 1 2 3 4 or the pills | the pills |
| Wind | [ ] | |
| Sound / HUD | M / H | |

URL flags: `?mood=night`, `?nointro`, `?mute`, `?q=0..3` (pins a quality tier; 0 is best), `?dpr=1.5`, `?noboat`, `?debug` (puts internals on `window`, plus `step()` and `bench()`).

## Layout

```
src/
  main.js              wires the modules together and runs the frame
  config.js            every tunable: sea, moods, wake, quality tiers, assets
  core/                GPU pass runner, maths, auto quality
  ocean/               FFT sea (ocean.js), spectrum, the surface mesh and its shaders
  sky/                 atmosphere + clouds + post-processing (sky.js), custom passes, stars
  wake/                Kelvin wake map (kelvin.js), dynamic waves + hull interaction (dynamic.js)
  boat/                the procedural model, physics, reflection, lights
  camera/chase.js      chase camera and the opening shot
  ui/                  input (keys, mouse, touch stick), HUD, loading curtain
  audio/sound.js       synthesized engine and sea
```

Each module is a `createX(app, deps)` factory that returns `update()` and whatever its neighbours need. `app` holds the renderer, the scene, the camera, a full-screen pass runner, and `app.vessel`, the boat state that the wake systems read.

### Frame order

ocean FFT → boat probes and physics → camera → Kelvin wake → dynamic waves → sound → sky light → sea uniforms → boat reflection → composer (clouds + atmosphere → saved sky → boat pass → night grade → bloom → tone mapping → SMAA)

### Tuning

- Moods, colours and exposure: `MOODS` in `src/config.js`. A mood with a `night` block turns on the grade, stars, bloom and lamps.
- How hard the hull pushes the water and how much of the waves it throws back: `DYN.PUSH` and `DYN.SEA`.
- Quality tiers: `QUALITY`. Touch devices start at tier 2, and every device steps down if the frame rate sags.

## Deploy (GitHub + Vercel)

1. Create an empty GitHub repo (for example `tiderunner`), then push from this folder:
   ```bash
   git init && git add . && git commit -m "Open Ocean · Tiderunner v1"
   git branch -M main
   git remote add origin https://github.com/<you>/tiderunner.git
   git push -u origin main
   ```
2. In Vercel, choose **Add New → Project**, import the repo, and keep the defaults. Vite is detected and `vercel.json` sets the build command, the output directory and the cache headers.
3. Under **Settings → Domains**, add `tiderunner.heyshreyas.com`. If the domain's DNS is on Vercel, it connects automatically. Otherwise add a CNAME record `tiderunner` → `cname.vercel-dns.com` at your DNS provider.
4. The share card's URLs are in `index.html` (`og:url`, `og:image`, `twitter:image`). Change them if you use a different domain, and check the card at opengraph.xyz before posting.

## Credits

- Atmosphere, clouds and geospatial helpers: [takram-design-engineering/three-geospatial](https://github.com/takram-design-engineering/three-geospatial) (MIT). The precomputed atmosphere and the cloud and STBN textures come from that project.
- [three.js](https://threejs.org) (MIT) and [postprocessing](https://github.com/pmndrs/postprocessing) (Zlib).
- Fonts: Syncopate, Space Grotesk, JetBrains Mono (Google Fonts, OFL).
