// The flight model: an arcade plane with enough discipline to be flown, not just steered.
// Throttle sets a target speed, the elevator pitches, the ailerons bank and the bank turns the
// plane. Fly too slow and the wing quits; land too hard, or with the gear up, and the sortie ends.

import { PLANE } from './config.js';

const G = 9.81;
const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(target, value + maxDelta);
  return Math.max(target, value - maxDelta);
}

export function createPlane() {
  return {
    x: 0,
    y: 60,
    z: 500,
    heading: Math.PI / 2,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    gear: true,
    flaps: false,
    fuel: PLANE.fuelMax,
    onGround: true,
    verticalSpeed: 0,
    stalled: false,
  };
}

/**
 * One step. `controls` is { pitch: -1..1 (up positive), roll: -1..1 (right positive),
 * throttle: -1..1 (up positive), gear, flaps }. `heightAt` reads the ground. Returns the
 * vertical speed in m/s, so the caller can judge a touchdown.
 */
export function stepPlane(plane, controls, dt, heightAt) {
  // Throttle: Shift/Ctrl nudge it; it stays where the pilot leaves it.
  plane.throttle = clamp(plane.throttle + controls.throttle * 0.55 * dt, 0, 1);
  if (controls.gear) plane.gear = !plane.gear;
  if (controls.flaps) plane.flaps = !plane.flaps;

  const flapLift = plane.flaps ? PLANE.flapLift : 0;
  const drag = 1 + (plane.flaps ? PLANE.flapDrag / 10 : 0) + (plane.gear ? PLANE.gearDrag / 10 : 0);
  // Throttle 0 means stopped on the ground and a gliding sink in the air: there is no
  // idle speed that would roll the plane off the runway by itself.
  const targetSpeed = (plane.throttle * PLANE.maxSpeed) / drag;
  const accel = plane.onGround ? PLANE.accel * 1.6 : PLANE.accel;
  plane.speed = approach(plane.speed, targetSpeed, accel * dt);

  // The elevator answers at every speed, but a slow wing will not hold the nose up.
  const pitchTarget = clamp(controls.pitch * PLANE.pitchUp, PLANE.pitchDown, PLANE.pitchUp);
  plane.pitch = approach(plane.pitch, pitchTarget, PLANE.pitchRate * dt);
  const rollTarget = clamp(controls.roll * PLANE.rollMax, -PLANE.rollMax, PLANE.rollMax);
  plane.roll = approach(plane.roll, rollTarget, PLANE.rollRate * dt);

  plane.stalled = plane.speed < PLANE.stallSpeed - flapLift && !plane.onGround;
  if (plane.stalled) plane.pitch = approach(plane.pitch, -8, 30 * dt);

  // A banked wing turns the nose: the turn rate grows with the bank and falls with speed.
  const turnRate = (-G * Math.tan(plane.roll * DEG)) / Math.max(20, plane.speed);
  plane.heading += turnRate * dt;

  // Climb from pitch, sink from a slow wing, and a little help from the flaps.
  let vertical = plane.speed * Math.sin(plane.pitch * DEG);
  if (plane.speed < PLANE.stallSpeed) vertical -= (PLANE.stallSpeed - plane.speed) * 0.35;
  if (plane.flaps && plane.speed > 20) vertical += 0.8;
  plane.verticalSpeed = vertical;

  const windX = 1.2;
  const windZ = -0.8;
  plane.x += (plane.speed * Math.cos(plane.pitch * DEG) * Math.sin(plane.heading) + windX) * dt;
  plane.z += (plane.speed * Math.cos(plane.pitch * DEG) * Math.cos(plane.heading) + windZ) * dt;
  plane.y += vertical * dt;

  // Fuel burns with the throttle; an empty tank means a glider.
  const burn = PLANE.burnIdle + plane.throttle * PLANE.burnFull;
  plane.fuel = Math.max(0, plane.fuel - burn * dt);
  if (plane.fuel === 0) plane.throttle = Math.max(0, plane.throttle - 0.2 * dt);

  const ground = heightAt(plane.x, plane.z);
  const wasAirborne = !plane.onGround;
  if (plane.y <= ground + 1.2) {
    plane.y = ground + 1.2;
    plane.onGround = true;
    // Parked or taxiing: the dial reads level, even though the wing still sinks below stall.
    plane.verticalSpeed = 0;
  } else if (plane.y > ground + 4) {
    plane.onGround = false;
  }
  // The caller judges a touchdown by the sink rate just before the wheels touch, so a
  // landing frame returns that rate even though the dial now reads zero.
  return wasAirborne && plane.onGround ? vertical : plane.verticalSpeed;
}

/** Knots, feet and a 0..360 heading for the HUD. */
export function readInstruments(plane) {
  return {
    knots: Math.round(plane.speed / 0.514444),
    feet: Math.round(plane.y / 0.3048),
    vsi: Math.round((plane.verticalSpeed * 196.85) / 10) * 10,
    heading: Math.round(((plane.heading * 180) / Math.PI % 360 + 360) % 360),
    throttle: Math.round(plane.throttle * 100),
    fuel: Math.round(plane.fuel),
  };
}
