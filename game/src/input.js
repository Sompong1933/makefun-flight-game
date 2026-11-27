// Keyboard and pointer input. Held keys steer and set the throttle; one-shot presses (start,
// pause, gear, flaps, camera, mission) are queued as bit flags and taken once by the loop, so a
// press between two frames is never lost and never counted twice.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_GEAR = 4;
export const ACTION_FLAPS = 8;
export const ACTION_CAMERA = 16;
export const ACTION_MUTE = 32;
export const ACTION_MISSION_1 = 64;
export const ACTION_MISSION_2 = 128;
export const ACTION_MISSION_3 = 256;

const PITCH_UP = new Set(['ArrowUp', 'KeyW']);
const PITCH_DOWN = new Set(['ArrowDown', 'KeyS']);
const ROLL_LEFT = new Set(['ArrowLeft', 'KeyA']);
const ROLL_RIGHT = new Set(['ArrowRight', 'KeyD']);
const THROTTLE_UP = new Set(['ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd']);
const THROTTLE_DOWN = new Set(['ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const GEAR = new Set(['KeyG']);
const FLAPS = new Set(['KeyF']);
const CAMERA = new Set(['KeyC']);
const MUTE = new Set(['KeyM']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;

  function press(code) {
    if (PITCH_UP.has(code) || PITCH_DOWN.has(code)) held.add(code);
    else if (ROLL_LEFT.has(code) || ROLL_RIGHT.has(code)) held.add(code);
    else if (THROTTLE_UP.has(code) || THROTTLE_DOWN.has(code)) held.add(code);
    else if (CONFIRM.has(code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(code)) actions |= ACTION_PAUSE;
    else if (GEAR.has(code)) actions |= ACTION_GEAR;
    else if (FLAPS.has(code)) actions |= ACTION_FLAPS;
    else if (CAMERA.has(code)) actions |= ACTION_CAMERA;
    else if (MUTE.has(code)) actions |= ACTION_MUTE;
    else if (code === 'Digit1') actions |= ACTION_MISSION_1;
    else if (code === 'Digit2') actions |= ACTION_MISSION_2;
    else if (code === 'Digit3') actions |= ACTION_MISSION_3;
    else return false;
    return true;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat && !PITCH_UP.has(event.code) && !PITCH_DOWN.has(event.code)
      && !ROLL_LEFT.has(event.code) && !ROLL_RIGHT.has(event.code)
      && !THROTTLE_UP.has(event.code) && !THROTTLE_DOWN.has(event.code)) return;
    if (press(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => held.clear());
  target.addEventListener('pointerdown', () => {
    actions |= ACTION_CONFIRM;
  });

  function has(set) {
    for (const code of set) if (held.has(code)) return true;
    return false;
  }

  return {
    /** Pitch -1..1 (up positive), roll -1..1 (right positive), throttle -1..1. */
    controls() {
      return {
        pitch: (has(PITCH_UP) ? 1 : 0) - (has(PITCH_DOWN) ? 1 : 0),
        roll: (has(ROLL_RIGHT) ? 1 : 0) - (has(ROLL_LEFT) ? 1 : 0),
        throttle: (has(THROTTLE_UP) ? 1 : 0) - (has(THROTTLE_DOWN) ? 1 : 0),
        gear: false,
        flaps: false,
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
