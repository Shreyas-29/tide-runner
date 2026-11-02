import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, BloomEffect } from 'postprocessing';
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, SunDirectionalLight, SkyLightProbe } from '@takram/three-atmosphere';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { DataTextureLoader, Ellipsoid, Geodetic, parseUint8Array, radians, STBNLoader } from '@takram/three-geospatial';
import { DitheringEffect } from '@takram/three-geospatial-effects';
import { ASSETS, params } from '../config.js';
import { SaveSkyPass, BoatPass, NightGradeEffect, REFLECT_LAYER, BOAT_LAYER } from './passes.js';
import { createStars } from './stars.js';
import { createMoon } from './moon.js';

/* ================================================================== *
 *  Sky: takram's physically based atmosphere (Bruneton) and volumetric
 *  clouds (MIT, github.com/takram-design-engineering/three-geospatial).
 *  Their maths runs on the real Earth, so the local scene (x north,
 *  y up, z east, sea level at y = 0) is pinned to a spot in the
 *  mid-Atlantic. Pipeline:
 *    scene → clouds + atmosphere → sky saved for next frame's sea
 *    reflections → boat laid on top → (night grade) → (bloom) → tone
 *    mapping → SMAA + dithering.
 *  Also here: the sun light (with the boat's shadows), the sky light
 *  probe, the uniforms the sea shares, the mood switch and the
 *  environment map the boat's paint reflects.
 * ================================================================== */
export const ASSET_COUNT = 6;

export function createSky(app, { onAsset = ()=>{} } = {}){
  const { renderer, scene, camera } = app;
  const site = new Geodetic(radians(-28), radians(36), 0).toECEF();
  const worldToECEF = Ellipsoid.WGS84.getNorthUpEastFrame(site, new THREE.Matrix4());
  const localToECEF = new THREE.Matrix3().setFromMatrix4(worldToECEF);
  const toECEF = (v)=>v.clone().applyMatrix3(localToECEF).normalize();

  /* ---------------- effects ---------------- */
  const aerial = new AerialPerspectiveEffect(camera);
  aerial.sky = true; aerial.sun = true; aerial.moon = false;   /* at night the sun disc is off and our own moon is drawn (moon.js) */
  aerial.worldToECEFMatrix.copy(worldToECEF);
  const clouds = new CloudsEffect(camera);
  clouds.worldToECEFMatrix.copy(worldToECEF);
  clouds.localWeatherVelocity.set(.0005, 0);
  clouds.qualityPreset = params.get('quality') || 'medium';   /* 'high' adds light shafts and costs ~3x */
  clouds.turbulence = true;                                  /* the wispy, torn detail at cloud edges */
  clouds.clouds.minStepSize = 35;                            /* finer steps through the cloud: crisper edges */
  clouds.localWeatherRepeat.setScalar(80);                   /* cloud fields: grouped cumulus clusters with open sky between */
  clouds.shapeRepeat.setScalar(.0004);                       /* billow size within a cluster */
  clouds.cloudLayers[1].altitude = 900;                      /* the cumulus layer: taller, so tops build up into heaps */
  clouds.cloudLayers[1].height = 1900;
  clouds.cloudLayers[0].densityScale = .12;                  /* the low flat layer: lighter, so bases don't read as slabs */
  clouds.shapeDetailRepeat.setScalar(.009);
  clouds.events.addEventListener('change', (e)=>{
    if(e.property === 'atmosphereOverlay') aerial.overlay = clouds.atmosphereOverlay;
    if(e.property === 'atmosphereShadow') aerial.shadow = clouds.atmosphereShadow;
    if(e.property === 'atmosphereShadowLength') aerial.shadowLength = clouds.atmosphereShadowLength;
  });

  const saveSky = new SaveSkyPass(camera.near, camera.far);
  const boatPass = new BoatPass(scene, camera);
  const night = new NightGradeEffect();
  const bloom = new BloomEffect({ mipmapBlur:true, luminanceThreshold:1.4, luminanceSmoothing:.4, intensity:1, radius:.72 });
  const toneMap = new ToneMappingEffect({ mode:ToneMappingMode.AGX });
  const nightPass = new EffectPass(camera, night), bloomPass = new EffectPass(camera, bloom);
  nightPass.enabled = bloomPass.enabled = false;

  const composer = new EffectComposer(renderer, { frameBufferType:THREE.HalfFloatType, multisampling:0 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera, clouds, aerial));
  composer.addPass(saveSky);
  composer.addPass(boatPass);
  composer.addPass(nightPass);
  composer.addPass(bloomPass);
  composer.addPass(new EffectPass(camera, toneMap));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset:SMAAPreset.HIGH }), new DitheringEffect()));   /* anti-aliasing on the tone-mapped image */

  /* ---------------- data: the precomputed atmosphere and the cloud textures ---------------- */
  const atmo = new PrecomputedTexturesLoader().setType(renderer).load(ASSETS.atmosphere, onAsset);
  Object.assign(aerial, atmo); Object.assign(clouds, atmo);
  const prep = (t, mip)=>{ t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; if(t.isData3DTexture){ t.wrapR = THREE.RepeatWrapping; t.format = THREE.RedFormat; }
    t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };
  const tex = new THREE.TextureLoader();
  tex.load(ASSETS.weather, (t)=>{ clouds.localWeatherTexture = prep(t, true); onAsset(); });
  tex.load(ASSETS.turbulence, (t)=>{ clouds.turbulenceTexture = prep(t, true); onAsset(); });
  const cube = (n)=>({ width:n, height:n, depth:n });
  new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, cube(CLOUD_SHAPE_TEXTURE_SIZE)).load(ASSETS.shape, (t)=>{ clouds.shapeTexture = prep(t, false); onAsset(); });
  new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, cube(CLOUD_SHAPE_DETAIL_TEXTURE_SIZE)).load(ASSETS.detail, (t)=>{ clouds.shapeDetailTexture = prep(t, false); onAsset(); });
  new STBNLoader().load(ASSETS.stbn, (t)=>{ aerial.stbnTexture = t; clouds.stbnTexture = t; onAsset(); });

  /* ---------------- light: the sun (or moon) through the air, and the sky's light ---------------- */
  const sunLight = new SunDirectionalLight();
  sunLight.transmittanceTexture = atmo.transmittanceTexture;   /* set directly: the constructor reads a differently named option */
  sunLight.worldToECEFMatrix.copy(worldToECEF);
  sunLight.layers.enable(REFLECT_LAYER); sunLight.layers.enable(BOAT_LAYER); sunLight.shadow.camera.layers.enable(BOAT_LAYER);
  sunLight.castShadow = true; sunLight.distance = 70;
  sunLight.shadow.mapSize.set(2048, 2048); Object.assign(sunLight.shadow.camera, { left:-12, right:12, top:12, bottom:-12, near:1, far:150 });
  sunLight.shadow.bias = -.0004; sunLight.shadow.normalBias = .03;
  scene.add(sunLight, sunLight.target);
  const skyProbe = new SkyLightProbe({ irradianceTexture:atmo.irradianceTexture });
  skyProbe.worldToECEFMatrix.copy(worldToECEF);

  /* uniforms shared with the sea */
  const U = {
    sunDir:{ value:new THREE.Vector3(0, 1, 0) }, sunCol:{ value:new THREE.Color(0, 0, 0) }, zen:{ value:new THREE.Color(.02, .04, .08) }, hor:{ value:new THREE.Color(.05, .06, .07) },
    scatter:{ value:new THREE.Color() }, sss:{ value:new THREE.Color() }, time:{ value:0 }, cover:{ value:.3 },
    tSS:{ value:saveSky.rt.texture }, vpRot:{ value:new THREE.Matrix4() }, ssOK:{ value:0 },
    specK:{ value:1 },   /* the glint's strength: the moon's path on the water is far gentler than the sun's */
  };

  const stars = createStars(), moon = createMoon();
  scene.add(stars.object, moon.object);

  let lightDirty = true, current = null;
  const localDir = (el, az)=>{ const e = el*Math.PI/180, a = az*Math.PI/180; return new THREE.Vector3(Math.cos(e)*Math.cos(a), Math.sin(e), Math.cos(e)*Math.sin(a)); };

  function applyMood(m){
    current = m;
    const dir = localDir(m.el, m.az), ecef = toECEF(dir);
    aerial.sunDirection.copy(ecef); clouds.sunDirection.copy(ecef);
    sunLight.sunDirection.copy(ecef); skyProbe.sunDirection.copy(ecef);
    U.sunDir.value.copy(dir);
    clouds.coverage = m.cover; U.cover.value = m.cover;
    renderer.toneMappingExposure = m.exp;
    sunLight.intensity = params.has('sun') ? +params.get('sun') : m.boatSun;
    scene.environmentIntensity = params.has('env') ? +params.get('env') : m.env;
    toneMap.mode = ToneMappingMode[m.tone];   /* ACES keeps the sunset's pinks and oranges saturated; AgX for daylight */
    U.scatter.value.setRGB(...m.water); U.sss.value.setRGB(...m.sss);
    const n = m.night;
    nightPass.enabled = bloomPass.enabled = !!n; night.amount = n ? n.grade : 0; bloom.intensity = n ? n.bloom : 0;
    stars.object.visible = moon.object.visible = !!n; aerial.sun = !n;
    if(n){ stars.gain = n.stars; moon.gain = n.moon; moon.direction = dir; }
    U.specK.value = n ? n.glint : 1;
    lightDirty = true;
  }

  /* read the sun colour and the sky's light from takram's model once its textures have arrived */
  const _v = new THREE.Vector3(), _d = new THREE.Vector3();
  function updateLight(){
    if(!atmo.transmittanceTexture?.image?.data || !atmo.irradianceTexture?.image?.data) return;
    sunLight.update(); skyProbe.update();
    U.sunCol.value.copy(sunLight.color);                         /* the sea takes the sun at full strength; the boat's share is sunLight.intensity */
    skyProbe.sh.getAt(_d.set(0, 1, 0), _v); U.zen.value.setRGB(Math.max(_v.x, 0), Math.max(_v.y, 0), Math.max(_v.z, 0));
    const s = U.sunDir.value; _d.set(-s.x, .08, -s.z).normalize();
    skyProbe.sh.getAt(_d, _v); U.hor.value.setRGB(Math.max(_v.x, 0), Math.max(_v.y, 0), Math.max(_v.z, 0));
    lightDirty = false;
  }

  /* the environment the boat's paint and glass reflect: sky gradient above, dark sea below, rebuilt per mood */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.ShaderMaterial({ side:THREE.BackSide, depthWrite:false,
    uniforms:{ uZen:U.zen, uHor:U.hor, uSun:U.sunDir, uSunCol:U.sunCol, uScatter:U.scatter },
    vertexShader:'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); }',
    fragmentShader:`uniform vec3 uZen, uHor, uSun, uSunCol, uScatter; varying vec3 vD;
      void main(){ vec3 d = normalize(vD);
        vec3 c = d.y > 0. ? mix(uHor, uZen, pow(d.y, .5)) : mix(uHor*.1, uHor*.03 + uScatter*.22, smoothstep(0., -.2, d.y));
        c += uSunCol*.02*pow(max(dot(d, uSun), 0.), 24.)*step(0., d.y);
        gl_FragColor = vec4(c, 1.); }` })));
  let envFor = null;

  function update(dt, t){
    if(lightDirty || app.frame % 120 === 0) updateLight();
    if(envFor !== current && !lightDirty){ const old = scene.environment; scene.environment = pmrem.fromScene(envScene, 0, .1, 100).texture; old?.dispose(); envFor = current; }
    U.time.value = t;
    if(stars.object.visible) stars.update(t, renderer.getPixelRatio());
  }

  return { composer, aerial, clouds, toneMap, boatPass, saveSky, sunLight, skyProbe, U, stars, applyMood, update, get lightReady(){ return !lightDirty; } };
}
