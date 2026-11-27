// The game's rules and state, with no drawing and no browser in it: the plane, the missions,
// the rings, the fuel, the landings and the crashes. step() advances one fixed step and returns
// what happened as bit flags, so the caller can react without the world knowing about screens.

import { MISSIONS, PLANE, RING, SCORE } from './config.js';
import { createPlane, stepPlane } from './physics.js';
import { FAR_RUNWAY, HOME_RUNWAY, createClouds, createTerrain, ringCourse, runwayAt } from './terrain.js';

export const EVENT_RING = 1;
export const EVENT_LAND = 2;
export const EVENT_CRASH = 4;
export const EVENT_OVER = 8;
export const EVENT_FUEL_LOW = 16;
export const EVENT_MISSION = 32;

export const CRASH_TERRAIN = 'terrain';
export const CRASH_WATER = 'water';
export const CRASH_GEAR = 'gear';
export const CRASH_HARD = 'hard';
export const CRASH_FUEL = 'fuel';

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function createWorld(random) {
  const terrain = createTerrain(random);
  const clouds = createClouds(random);
  const course = ringCourse();
  const plane = createPlane();
  const state = {
    plane,
    terrain,
    clouds,
    course,
    missionIndex: 0,
    mission: MISSIONS[0],
    rings: [],
    nextRing: 0,
    ringsDone: 0,
    score: 0,
    time: 0,
    timeLeft: 0,
    elapsed: 0,
    hopLeg: 0,
    hopDone: false,
    crashCause: null,
    landed: false,
    fuelWarned: false,
    message: '',
    messageTime: 0,
  };

  function missionRings() {
    if (state.mission.id === 'rings') return course.map((ring) => ({ ...ring, done: false }));
    if (state.mission.id === 'free') return course.map((ring) => ({ ...ring, done: false }));
    return [];
  }

  function placeOnRunway(runway, heading) {
    plane.x = runway.x - Math.sin(runway.heading) * (runway.length / 2 - 60);
    plane.z = runway.z - Math.cos(runway.heading) * (runway.length / 2 - 60);
    plane.y = runway.height + 1.2;
    plane.heading = runway.heading;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 0;
    plane.throttle = 0;
    plane.gear = true;
    plane.flaps = false;
    plane.fuel = PLANE.fuelMax;
    plane.onGround = true;
    plane.stalled = false;
  }

  function reset() {
    placeOnRunway(HOME_RUNWAY, HOME_RUNWAY.heading);
    state.mission = MISSIONS[state.missionIndex];
    state.rings = missionRings();
    state.nextRing = 0;
    state.ringsDone = 0;
    state.score = 0;
    state.time = 0;
    state.timeLeft = state.mission.timeLimit;
    state.elapsed = 0;
    state.hopLeg = 0;
    state.hopDone = false;
    state.crashCause = null;
    state.landed = false;
    state.fuelWarned = false;
    state.message = '';
    state.messageTime = 0;
  }

  function setMission(index) {
    state.missionIndex = index;
    reset();
  }

  function flash(message) {
    state.message = message;
    state.messageTime = 3;
  }

  function checkRings(events) {
    if (state.nextRing >= state.rings.length) return events;
    const ring = state.rings[state.nextRing];
    const before = distance3(plane, ring);
    if (before < RING.radius + 6) {
      ring.done = true;
      state.ringsDone += 1;
      state.nextRing += 1;
      state.score += RING.points;
      flash(`Ring ${state.ringsDone} of ${state.rings.length}  +${RING.points}`);
      events |= EVENT_RING;
      if (state.mission.id === 'free' && state.nextRing >= state.rings.length) {
        state.rings = missionRings();
        state.nextRing = 0;
      }
      if (state.mission.id === 'rings' && state.ringsDone >= state.rings.length) {
        const bonus = Math.max(0, Math.round(state.timeLeft)) * SCORE.timeBonusPerSecond;
        state.score += bonus;
        flash(`Course complete! Time bonus +${bonus}`);
        events |= EVENT_MISSION | EVENT_OVER;
      }
    }
    return events;
  }

  function checkLanding(events, verticalSpeed) {
    if (!plane.onGround) return events;
    const ground = terrain.heightAt(plane.x, plane.z);
    const strip = runwayAt(plane.x, plane.z);
    if (strip === null) {
      // Touching anything that is not a runway is a crash, unless barely moving on flat ground.
      if (plane.speed > 8 || ground < 1) {
        state.crashCause = ground < 1 ? CRASH_WATER : CRASH_TERRAIN;
        return events | EVENT_CRASH | EVENT_OVER;
      }
      return events;
    }
    if (!plane.gear) {
      state.crashCause = CRASH_GEAR;
      return events | EVENT_CRASH | EVENT_OVER;
    }
    if (verticalSpeed < -PLANE.landSinkMax || plane.speed > PLANE.landSpeedMax + 14) {
      state.crashCause = CRASH_HARD;
      return events | EVENT_CRASH | EVENT_OVER;
    }
    if (state.landed) return events;
    state.landed = true;
    plane.fuel = PLANE.fuelMax;
    state.score += SCORE.landing;
    flash(`Landed clean. +${SCORE.landing}  Fuel full.`);
    events |= EVENT_LAND;
    if (state.mission.id === 'hop') {
      const target = state.hopLeg === 0 ? FAR_RUNWAY : HOME_RUNWAY;
      const here = strip.runway === target;
      if (here) {
        state.score += SCORE.hopLeg;
        state.hopLeg += 1;
        flash(`Island hop leg ${state.hopLeg} done! +${SCORE.hopLeg}`);
        events |= EVENT_MISSION;
        if (state.hopLeg >= 2) {
          state.hopDone = true;
          events |= EVENT_OVER;
        }
      }
    }
    return events;
  }

  /**
   * One fixed step. `controls` is the pilot's input for this step. With `harmless` set (the
   * title screen's backdrop) the plane flies itself in a gentle circuit and nothing can end it.
   */
  function step(dt, controls, harmless) {
    let events = 0;
    state.elapsed += dt;
    if (state.messageTime > 0) state.messageTime -= dt;
    if (!harmless) {
      state.time += dt;
      if (state.timeLeft > 0) state.timeLeft = Math.max(0, state.timeLeft - dt);
    }
    for (const cloud of clouds) {
      cloud.x += cloud.drift * dt;
      if (cloud.x > 3400) cloud.x = -3400;
    }

    const wasAirborne = !plane.onGround;
    const verticalSpeed = stepPlane(plane, controls, dt, terrain.heightAt);

    if (!harmless) {
      events = checkRings(events);
      // A touchdown only counts the moment the wheels meet the ground, not while the
      // plane is parked on the runway at the start of a sortie.
      if (wasAirborne && plane.onGround) events = checkLanding(events, verticalSpeed);
      // Rolling off the strip into the sea at speed is still a ditching.
      if (plane.onGround && plane.speed > 2 && terrain.heightAt(plane.x, plane.z) < 1) {
        state.crashCause = CRASH_WATER;
        events |= EVENT_CRASH | EVENT_OVER;
      }
      // Out of fuel on the ground with no speed left: the sortie is over, gently.
      if (plane.fuel <= 0 && plane.onGround && plane.speed < 3 && !state.landed) {
        flash('Out of fuel — sortie over');
        events |= EVENT_OVER;
      }
      if (plane.fuel <= 0 && !plane.onGround) {
        state.crashCause = CRASH_FUEL;
        // Out of fuel is not an instant crash: the glider keeps flying until it meets the ground.
        if (plane.y <= terrain.heightAt(plane.x, plane.z) + 1.3) {
          events |= EVENT_CRASH | EVENT_OVER;
        }
      } else if (!state.fuelWarned && plane.fuel < 20) {
        state.fuelWarned = true;
        flash('LOW FUEL — find a runway');
        events |= EVENT_FUEL_LOW;
      }
      if (state.mission.id === 'rings' && state.timeLeft === 0 && state.ringsDone < state.rings.length) {
        flash('Time up — course over');
        events |= EVENT_OVER;
      }
      if (plane.y > 1500) {
        plane.y = 1500;
        plane.pitch = Math.min(plane.pitch, 0);
      }
    }
    return events;
  }

  reset();
  return { state, reset, setMission, step, placeOnRunway };
}
