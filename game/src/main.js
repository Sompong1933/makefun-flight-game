// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between six screens: title, play, paused, game over, crashed and mission complete.
//
// ?seed=N fixes the island. ?shot=cover|cockpit|rings|landing (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_CRASH,
  EVENT_FUEL_LOW,
  EVENT_LAND,
  EVENT_MISSION,
  EVENT_OVER,
  EVENT_RING,
} from './world.js';
import {
  ACTION_CAMERA,
  ACTION_CONFIRM,
  ACTION_FLAPS,
  ACTION_GEAR,
  ACTION_MISSION_1,
  ACTION_MISSION_2,
  ACTION_MISSION_3,
  ACTION_MUTE,
  ACTION_PAUSE,
  createInput,
} from './input.js';
import { createAudio } from './audio.js';
import {
  SCREEN_COMPLETE,
  SCREEN_CRASH,
  SCREEN_OVER,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  createRenderer,
} from './render.js';
import { stageShot, stageTitle } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, scene.camera, 3.2);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let camera = 'chase';
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let clock = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce(`Flying ${world.state.mission.name}.`);
  }

  function endGame(crashed) {
    screen = crashed ? SCREEN_CRASH : world.state.hopDone || world.state.ringsDone >= world.state.rings.length
      ? SCREEN_COMPLETE
      : SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(crashed ? `Crashed. Score ${world.state.score}.` : `Sortie over. Score ${world.state.score}. Best ${best}.`);
  }

  function handleActions(actions) {
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Muted.' : 'Sound on.');
    }
    if (actions & ACTION_CAMERA && screen === SCREEN_PLAY) {
      camera = camera === 'chase' ? 'cockpit' : 'chase';
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_MISSION_1) world.setMission(0);
      else if (actions & ACTION_MISSION_2) world.setMission(1);
      else if (actions & ACTION_MISSION_3) world.setMission(2);
      if (actions & ACTION_CONFIRM) {
        audio.unlock();
        startGame();
      }
      return;
    }
    if (actions & ACTION_CONFIRM && (screen === SCREEN_OVER || screen === SCREEN_CRASH || screen === SCREEN_COMPLETE)) {
      audio.unlock();
      startGame();
    } else if (actions & ACTION_PAUSE && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & (ACTION_PAUSE | ACTION_CONFIRM) && screen === SCREEN_PAUSED) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function step(actions) {
    if (screen === SCREEN_TITLE) {
      // The title's backdrop: the plane cruises a gentle circuit over the home runway.
      const plane = world.state.plane;
      plane.fuel = 100;
      plane.throttle = 0.6;
      world.step(STEP, { pitch: 0, roll: 0.4, throttle: 0, gear: false, flaps: false }, true);
      return;
    }
    const controls = input.controls();
    controls.gear = Boolean(actions & ACTION_GEAR);
    controls.flaps = Boolean(actions & ACTION_FLAPS);
    const events = world.step(STEP, controls, false);
    if (events & EVENT_RING) audio.ring();
    if (events & EVENT_LAND) audio.land();
    if (events & EVENT_FUEL_LOW) audio.warn();
    if (events & EVENT_MISSION) audio.ring();
    if (events & EVENT_CRASH) {
      audio.crash();
      endGame(true);
    } else if (events & EVENT_OVER) {
      endGame(false);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    clock += dt;
    const actions = input.takeActions();
    handleActions(actions);
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      accumulator += dt;
      let first = true;
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        // One-shot presses (gear, flaps) fire on the first step of the frame only.
        step(first ? actions : 0);
        first = false;
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    audio.engine(world.state.plane.throttle, screen === SCREEN_PLAY && !world.state.plane.onGround);
    renderer.draw(world.state, screen, best, camera, clock);
  }

  // Leaving the tab pauses a running game rather than letting it fly on unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  // The title's backdrop starts over the home runway, already in the air.
  stageTitle(world);
  announce('Sky Courier. Press Space to fly. Keys 1, 2 and 3 pick a mission.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
