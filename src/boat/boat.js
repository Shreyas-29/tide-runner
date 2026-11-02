import * as THREE from 'three';
import { BOAT, params } from '../config.js';
import { REFLECT_LAYER, BOAT_LAYER } from '../sky/passes.js';
import { buildBoat } from './model.js';
import { createBoatPhysics } from './physics.js';
import { createReflection } from './reflection.js';

/* ================================================================== *
 *  TIDERUNNER on the sea: the model, its physics, its mirror image in
 *  the water, its lights, and the vessel record the wake reads.
 *  The model lives on layers 1 (the sea's mirror) and 2 (the boat pass)
 *  but not 0, so the clouds never see it.
 * ================================================================== */
const DECK_LAMP = new THREE.Vector3(0, 4.5, -3.6);   /* floodlight over the aft deck, boat space */

export function createBoat(app, { ocean, sky, surface }){
  const enabled = !params.has('noboat');
  const model = buildBoat({ glow:.5 });
  model.boat.visible = enabled;
  model.boat.traverse((o)=>{ o.layers.disable(0); o.layers.enable(REFLECT_LAYER); o.layers.enable(BOAT_LAYER); });
  app.scene.add(model.boat);

  /* a warm deck floodlight, lit at night */
  const deck = new THREE.PointLight(0xffc48a, 0, 16, 1.6);
  deck.position.copy(DECK_LAMP); deck.layers.enable(REFLECT_LAYER); deck.layers.enable(BOAT_LAYER);
  model.boat.add(deck);

  const physics = createBoatPhysics(app, ocean);
  const reflection = createReflection(app, surface.uniforms);
  const S = physics.state;
  const vessel = app.vessel;
  Object.assign(vessel, { length:BOAT.length, beam:BOAT.beam, active:enabled });
  const su = surface.uniforms, sun = sky.sunLight;
  su.uBoatOn.value = enabled ? 1 : 0;
  let lampColor = new THREE.Color(0, 0, 0);

  function applyMood(m){
    const n = m.night;
    model.setLights({ lamps:n ? n.lamps : 1, cabin:n ? n.cabin : 0 });
    deck.intensity = n ? n.deck : 0;
    lampColor = n ? new THREE.Color(0xffc48a).multiplyScalar(n.deck*.06) : new THREE.Color(0, 0, 0);
  }

  const _lamp = new THREE.Vector3();
  function update(dt, controls){
    if(!enabled) return;
    physics.probe();
    physics.step(dt, controls);
    model.boat.position.set(S.x, S.y, S.z);
    model.boat.rotation.set(-S.pitch, S.h, S.roll, 'YXZ');
    model.spin(dt, 3 + Math.abs(S.u)*2.4);
    Object.assign(vessel, { x:S.x, z:S.z, heading:S.h, speed:Math.max(0, S.u), y:S.y, pitch:S.pitch, roll:S.roll, lev:S.lev, thr:S.thr });
    /* the sun's shadow box rides with the boat */
    sun.target.position.set(S.x, S.y, S.z);
    sun.position.copy(sun.target.position).addScaledVector(sky.U.sunDir.value, sun.distance);
    model.boat.updateMatrixWorld();
    su.uBoatInv.value.copy(model.boat.matrixWorld).invert();
    su.uLampPos.value.copy(_lamp.copy(DECK_LAMP).applyMatrix4(model.boat.matrixWorld)); su.uLampCol.value.copy(lampColor);
  }

  return {
    model, physics, reflection, state:S, enabled, applyMood, update,
    renderReflection(){ if(enabled) reflection.render(S.wl); },
    /* the opening: sun ahead and a little to one side */
    faceSun(dir){ S.h = Math.atan2(dir.x, dir.z) + 1.1; },
  };
}
