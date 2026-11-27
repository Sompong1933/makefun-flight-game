// The screenshot scenes behind ?shot=cover|cockpit|rings|landing. Each one sets the plane
// down in a real situation and flies it forward with a simple autopilot (point the nose at the
// next ring or the runway, hold a steady altitude, keep the throttle open), so the frame is what
// a short game really looks like and the same seed always gives the same frame.

import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const SAMPLE = STEP;

/** Steer the plane toward a point: roll into the turn, pitch to hold the target altitude. */
function autopilot(state, target, altitude) {
  const plane = state.plane;
  const dx = target.x - plane.x;
  const dz = target.z - plane.z;
  const wantedHeading = Math.atan2(dx, dz);
  let error = wantedHeading - plane.heading;
  while (error > Math.PI) error -= Math.PI * 2;
  while (error < -Math.PI) error += Math.PI * 2;
  const roll = Math.max(-1, Math.min(1, error * 1.4));
  const altitudeError = altitude - plane.y;
  const pitch = Math.max(-0.35, Math.min(0.35, altitudeError * 0.008));
  return { pitch, roll, throttle: 1, gear: false, flaps: false };
}

function flyForward(world, seconds, steer) {
  const steps = Math.round(seconds / SAMPLE);
  for (let index = 0; index < steps; index += 1) {
    const controls = steer(world.state);
    world.step(SAMPLE, controls, false);
  }
}

/**
 * Set the world to the named scene and return the screen to draw over it, the camera to use and
 * the best score to show. Unknown names stage the cover.
 */
export function stageShot(name, world) {
  const state = world.state;
  const plane = state.plane;
  if (name === 'cockpit') {
    // Low over the lake, the far runway ahead, instruments lit.
    state.missionIndex = 1;
    world.reset();
    plane.x = 900;
    plane.z = 600;
    plane.y = 210;
    plane.heading = Math.atan2(2350 - 900, -1750 - 600);
    plane.pitch = -2;
    plane.roll = 0;
    plane.speed = 58;
    plane.throttle = 0.72;
    plane.onGround = false;
    return { screen: SCREEN_PLAY, camera: 'cockpit', best: 0 };
  }
  if (name === 'rings') {
    // Threading the course over the ridge, the next ring dead ahead.
    state.missionIndex = 0;
    world.reset();
    const ring = state.rings[1];
    plane.x = ring.x - Math.sin(ring.heading) * 250;
    plane.z = ring.z - Math.cos(ring.heading) * 250;
    plane.y = ring.y + 12;
    plane.heading = ring.heading;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 60;
    plane.throttle = 0.75;
    plane.onGround = false;
    state.ringsDone = 1;
    state.nextRing = 1;
    state.score = 100;
    return { screen: SCREEN_PLAY, camera: 'chase', best: 0 };
  }
  if (name === 'landing') {
    // Short final to the far runway, gear down, flaps out, the strip filling the windscreen.
    state.missionIndex = 1;
    world.reset();
    const runway = { x: 2350, z: -1750, heading: (20 * Math.PI) / 180, length: 800, height: 46 };
    plane.x = runway.x - Math.sin(runway.heading) * 500;
    plane.z = runway.z - Math.cos(runway.heading) * 500;
    plane.y = runway.height + 170;
    plane.heading = runway.heading;
    plane.pitch = -8;
    plane.roll = 0;
    plane.speed = 42;
    plane.throttle = 0.3;
    plane.gear = true;
    plane.flaps = true;
    plane.onGround = false;
    state.score = 500;
    return { screen: SCREEN_PLAY, camera: 'chase', best: 0 };
  }
  // The cover: on the ring course, 300 m out from the first ring at the ring's own
  // height, so the plane flies level with the hoop ahead and the island below.
  state.missionIndex = 0;
  world.reset();
  const ring = state.rings[0];
  plane.x = ring.x - Math.sin(ring.heading) * 300;
  plane.z = ring.z - Math.cos(ring.heading) * 300;
  plane.y = ring.y;
  plane.heading = ring.heading;
  plane.pitch = 0;
  plane.roll = -6;
  plane.speed = 60;
  plane.throttle = 0.75;
  plane.onGround = false;
  flyForward(world, 0.5, (current) => autopilot(current, ring, ring.y));
  return { screen: SCREEN_PLAY, camera: 'chase', best: 0 };
}

export function stageTitle(world) {
  world.reset();
  const state = world.state;
  const plane = state.plane;
  plane.x = -400;
  plane.z = 700;
  plane.y = 120;
  plane.heading = Math.PI / 2;
  plane.pitch = 0;
  plane.speed = 45;
  plane.throttle = 0.6;
  plane.onGround = false;
  return { screen: SCREEN_TITLE, camera: 'chase', best: 0 };
}
