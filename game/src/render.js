// Drawing only: the world's state and the current screen in, pixels out. A small software 3D
// renderer paints the island from a heightmap in depth-sorted strips, then the rings, the clouds,
// the aircraft and the instruments. The 1280x800 playfield is scaled to fit the window and
// centred, the margin filled with the backdrop colour.

import { FIELD, FONT, MISSIONS, PALETTE, RING } from './config.js';
import { FAR_RUNWAY, HOME_RUNWAY } from './terrain.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_CRASH = 'crash';
export const SCREEN_COMPLETE = 'complete';

const DEG = Math.PI / 180;
/** Vertical field of view: focal length in pixels for the 800 px field. */
const FOCAL = (FIELD.height / 2) / Math.tan(35 * DEG);
/** Terrain rows, far to near, and samples across each row. */
const ROWS = 46;
const COLS = 33;
const FAR = 3200;
const NEAR = 36;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
  return [Math.round(mix(c1[0], c2[0], t)), Math.round(mix(c1[1], c2[1], t)), Math.round(mix(c1[2], c2[2], t))];
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const C = {};
for (const [key, value] of Object.entries(PALETTE)) C[key] = hexToRgb(value);

function css(rgb, alpha = 1) {
  return alpha === 1
    ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/** Terrain colour for a ground point: water, sand, grass, forest, rock or snow. The strips
 * are drawn as flat quads over the terrain (drawRunways), so the ground underneath stays
 * grass and no 50 m cell is painted the wrong colour. */
function groundColor(terrain, x, z, height, slope, noise) {
  if (height < 1.5) {
    const deep = clamp((1.5 - height) / 12, 0, 1);
    return mixColor(C.seaShallow, C.seaDeep, deep);
  }
  let base;
  if (height < 6) base = C.sand;
  else if (height > 330) base = C.snow;
  else if (slope > 0.5 || height > 290) base = C.rock;
  else if (noise > 0.62) base = C.forest;
  else base = mixColor(C.grass, C.grassDry, noise);
  const shade = 1 - slope * 0.25 - clamp((height - 200) / 800, 0, 0.15);
  return [Math.round(base[0] * shade), Math.round(base[1] * shade), Math.round(base[2] * shade)];
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const fonts = new Map();

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align, baseline = 'alphabetic') {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.textAlign = align;
    context.textBaseline = baseline;
    // A soft dark underlay keeps light text readable over sky and clouds.
    context.fillStyle = 'rgba(8, 12, 20, 0.45)';
    context.fillText(value, x + 1.5, y + 1.5);
    context.fillStyle = color;
    context.fillText(value, x, y);
  }

  /** Camera basis from the plane: chase behind it, or in the cockpit. */
  function cameraBasis(state, camera) {
    const plane = state.plane;
    const heading = plane.heading;
    const pitch = plane.pitch * DEG;
    const roll = plane.roll * DEG * (camera === 'cockpit' ? 0.55 : 0.4);
    const fx = Math.sin(heading) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = Math.cos(heading) * Math.cos(pitch);
    let eye;
    if (camera === 'cockpit') {
      eye = {
        x: plane.x + fx * 2 + Math.sin(heading) * 0,
        y: plane.y + 1.4,
        z: plane.z + fz * 2,
      };
    } else {
      eye = {
        x: plane.x - fx * 15,
        y: plane.y - fy * 15 + 4.2,
        z: plane.z - fz * 15,
      };
    }
    // Right and up, rolled with the aircraft so the horizon banks with the turn.
    let rx = Math.cos(heading);
    let rz = -Math.sin(heading);
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const right = { x: rx * cosR, y: sinR, z: rz * cosR };
    // Up = cross(forward, right), recomputed properly:
    const fwd = { x: fx, y: fy, z: fz };
    const upv = {
      x: fwd.y * right.z - fwd.z * right.y,
      y: fwd.z * right.x - fwd.x * right.z,
      z: fwd.x * right.y - fwd.y * right.x,
    };
    return { eye, fwd, right, up: upv };
  }

  function project(point, basis) {
    const dx = point.x - basis.eye.x;
    const dy = point.y - basis.eye.y;
    const dz = point.z - basis.eye.z;
    const X = dx * basis.right.x + dy * basis.right.y + dz * basis.right.z;
    const Y = dx * basis.up.x + dy * basis.up.y + dz * basis.up.z;
    const Z = dx * basis.fwd.x + dy * basis.fwd.y + dz * basis.fwd.z;
    if (Z < 1) return null;
    return { x: FIELD.width / 2 + (FOCAL * X) / Z, y: FIELD.height / 2 - (FOCAL * Y) / Z, z: Z };
  }

  function drawSky(state, basis) {
    const gradient = context.createLinearGradient(0, 0, 0, FIELD.height);
    gradient.addColorStop(0, PALETTE.skyTop);
    gradient.addColorStop(0.45, PALETTE.skyMid);
    gradient.addColorStop(0.72, PALETTE.skyLow);
    gradient.addColorStop(1, PALETTE.haze);
    context.fillStyle = gradient;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    // The sun, fixed in the west, with a soft glow.
    const sunDir = { x: -0.55, y: 0.42, z: -0.35 };
    const sun = project(
      { x: basis.eye.x + sunDir.x * 3000, y: basis.eye.y + sunDir.y * 3000, z: basis.eye.z + sunDir.z * 3000 },
      basis,
    );
    if (sun !== null) {
      const glow = context.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 130);
      glow.addColorStop(0, PALETTE.sunGlow);
      glow.addColorStop(1, 'rgba(255,236,170,0)');
      context.fillStyle = glow;
      context.fillRect(sun.x - 130, sun.y - 130, 260, 260);
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sun.x, sun.y, 22, 0, Math.PI * 2);
      context.fill();
    }
    void state;
  }

  function drawTerrain(state, basis) {
    const terrain = state.terrain;
    const plane = state.plane;
    const heading = plane.heading;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    // Depth rows, log-spaced so near ground stays detailed and far ground stays cheap.
    const depths = [];
    for (let i = 0; i < ROWS; i += 1) depths.push(NEAR * Math.pow(FAR / NEAR, i / (ROWS - 1)));
    // Rows are stored far to near: index 0 is the farthest row.
    depths.reverse();
    const spreadAt = (depth) => depth * 1.18;
    let previous = null;
    for (let row = 0; row < ROWS; row += 1) {
      const depth = depths[row];
      const spread = spreadAt(depth);
      const points = [];
      for (let col = 0; col < COLS; col += 1) {
        const lateral = -spread + (2 * spread * col) / (COLS - 1);
        const wx = basis.eye.x + sinH * depth + cosH * lateral;
        const wz = basis.eye.z + cosH * depth - sinH * lateral;
        const height = terrain.heightAt(wx, wz);
        const projected = project({ x: wx, y: height, z: wz }, basis);
        const noise = 0.5
          + 0.32 * Math.sin(wx * 0.008 + wz * 0.011)
          + 0.18 * Math.sin(wx * 0.003 - wz * 0.005 + 1.7);
        const slope = terrain.slopeAt(wx, wz);
        points.push({ projected, height, slope, noise, wx, wz, depth });
      }
      if (previous !== null) {
        for (let col = 0; col < COLS - 1; col += 1) {
          const a = previous[col];
          const b = previous[col + 1];
          const c = points[col + 1];
          const d = points[col];
          if (!a.projected || !b.projected || !c.projected || !d.projected) continue;
          const fog = clamp((c.depth - 250) / 2800, 0, 0.92);
          let color = groundColor(terrain, c.wx, c.wz, c.height, c.slope, c.noise);
          color = mixColor(color, C.haze, fog);
          context.fillStyle = css(color);
          context.beginPath();
          context.moveTo(a.projected.x, a.projected.y);
          context.lineTo(b.projected.x, b.projected.y);
          context.lineTo(c.projected.x, c.projected.y);
          context.lineTo(d.projected.x, d.projected.y);
          context.closePath();
          context.fill();
        }
      }
      previous = points;
    }
    // The ground between the nearest row and the camera has no row of its own: extend the
    // nearest row's band down to the bottom of the screen, or the lower half stays sky.
    if (previous !== null) {
      for (let col = 0; col < COLS - 1; col += 1) {
        const a = previous[col];
        const b = previous[col + 1];
        if (!a.projected || !b.projected) continue;
        let color = groundColor(terrain, a.wx, a.wz, a.height, a.slope, a.noise);
        color = mixColor(color, C.haze, clamp((a.depth - 250) / 2800, 0, 0.92));
        context.fillStyle = css(color);
        context.beginPath();
        context.moveTo(a.projected.x, a.projected.y);
        context.lineTo(b.projected.x, b.projected.y);
        context.lineTo(b.projected.x, FIELD.height + 60);
        context.lineTo(a.projected.x, FIELD.height + 60);
        context.closePath();
        context.fill();
      }
    }
  }

  /** A cuboid (hangar, tower) drawn as three shaded faces, when it is near enough to matter. */
  function drawBox(basis, box) {
    const corners = [];
    for (const [sx, sy, sz] of [
      [-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1],
      [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
    ]) {
      const x = box.x + sx * box.hw;
      const y = box.y + sy * box.h;
      const z = box.z + sz * box.hd;
      corners.push(project({ x, y, z }, basis));
    }
    if (corners.some((corner) => corner === null)) return;
    const faces = [
      { points: [4, 5, 6, 7], shade: 0.92 },
      { points: [1, 2, 6, 5], shade: 0.78 },
      { points: [0, 1, 5, 4], shade: 0.66 },
    ];
    for (const face of faces) {
      const rgb = mixColor(hexToRgb(box.color), [0, 0, 0], 1 - face.shade);
      context.fillStyle = css(rgb);
      context.beginPath();
      context.moveTo(corners[face.points[0]].x, corners[face.points[0]].y);
      for (let i = 1; i < face.points.length; i += 1) {
        context.lineTo(corners[face.points[i]].x, corners[face.points[i]].y);
      }
      context.closePath();
      context.fill();
    }
  }

  /** Both strips as flat quads over the flattened ground: asphalt, centreline dashes and
   * threshold bars. Drawn after the terrain so the markings stay crisp at any distance; a
   * strip a hill hides is skipped (a line-of-sight sample from the camera to the strip). */
  function drawRunways(state, basis) {
    for (const runway of [HOME_RUNWAY, FAR_RUNWAY]) {
      const distance = Math.hypot(runway.x - state.plane.x, runway.z - state.plane.z);
      if (distance > 3600) continue;
      const eye = basis.eye;
      const sin = Math.sin(runway.heading);
      const cos = Math.cos(runway.heading);
      const half = runway.length / 2;
      // The nearest threshold is what the eye actually sees first: sample the ground
      // between the camera and it, and skip the strip only if a hill hides that end.
      const ends = [
        { x: runway.x - sin * half, z: runway.z - cos * half },
        { x: runway.x + sin * half, z: runway.z + cos * half },
      ];
      const near = ends.sort((a, b) =>
        Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z))[0];
      let hidden = false;
      for (let step = 1; step < 8; step += 1) {
        const t = step / 8;
        const x = eye.x + (near.x - eye.x) * t;
        const z = eye.z + (near.z - eye.z) * t;
        const lineY = eye.y + (runway.height - eye.y) * t;
        if (state.terrain.heightAt(x, z) + 0.5 > lineY) { hidden = true; break; }
      }
      if (hidden) continue;
      const y = runway.height + 0.6;
      const corner = (along, across) => project({
        x: runway.x + sin * along + cos * across,
        y,
        z: runway.z + cos * along - sin * across,
      }, basis);
      const quad = (a1, a2, across1, across2, fill) => {
        const points = [corner(a1, across1), corner(a2, across1), corner(a2, across2), corner(a1, across2)];
        if (points.some((point) => point === null)) return;
        context.fillStyle = fill;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < 4; index += 1) context.lineTo(points[index].x, points[index].y);
        context.closePath();
        context.fill();
      };
      quad(-half, half, -15, 15, css(C.asphalt));
      // Centreline dashes, 24 m on, 36 m off.
      for (let along = -half + 42; along < half - 30; along += 60) {
        quad(along - 12, along + 12, -0.9, 0.9, css(C.asphaltLine));
      }
      // Threshold bars at both ends.
      for (const end of [-1, 1]) {
        const start = end * (half - 30);
        quad(start - 4, start + 4, -5.5, 5.5, css(C.asphaltLine));
      }
    }
  }

  function drawAirfield(state, basis) {
    const plane = state.plane;
    const buildings = [
      { x: HOME_RUNWAY.x - 90, y: HOME_RUNWAY.height, z: HOME_RUNWAY.z + 70, hw: 26, h: 14, hd: 18, color: '#5a6b7a' },
      { x: HOME_RUNWAY.x - 140, y: HOME_RUNWAY.height, z: HOME_RUNWAY.z + 40, hw: 20, h: 11, hd: 14, color: '#6b5a4a' },
      { x: HOME_RUNWAY.x + 60, y: HOME_RUNWAY.height, z: HOME_RUNWAY.z - 80, hw: 8, h: 26, hd: 8, color: '#7a828c' },
      { x: FAR_RUNWAY.x - 70, y: FAR_RUNWAY.height, z: FAR_RUNWAY.z + 60, hw: 22, h: 12, hd: 16, color: '#5a6b7a' },
    ];
    for (const building of buildings) {
      const distance = Math.hypot(building.x - plane.x, building.z - plane.z);
      if (distance < 1600) drawBox(basis, building);
    }
    // The windsock by the home runway: a pole and a cone leaning with the wind.
    const sock = project({ x: HOME_RUNWAY.x + 20, y: HOME_RUNWAY.height + 12, z: HOME_RUNWAY.z + 45 }, basis);
    const sockBase = project({ x: HOME_RUNWAY.x + 20, y: HOME_RUNWAY.height, z: HOME_RUNWAY.z + 45 }, basis);
    if (sock !== null && sockBase !== null) {
      context.strokeStyle = '#dfe3e8';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(sockBase.x, sockBase.y);
      context.lineTo(sock.x, sock.y);
      context.stroke();
      context.fillStyle = '#ff7a2e';
      context.beginPath();
      context.moveTo(sock.x, sock.y);
      context.lineTo(sock.x + 16, sock.y + 4);
      context.lineTo(sock.x + 16, sock.y + 10);
      context.lineTo(sock.x, sock.y + 8);
      context.closePath();
      context.fill();
    }
  }

  function drawRings(state, basis) {
    const rings = state.rings.filter((ring) => !ring.done).slice().sort((a, b) => {
      const da = Math.hypot(a.x - state.plane.x, a.z - state.plane.z);
      const db = Math.hypot(b.x - state.plane.x, b.z - state.plane.z);
      return db - da;
    });
    for (let index = 0; index < rings.length; index += 1) {
      const ring = rings[index];
      const centre = project({ x: ring.x, y: ring.y, z: ring.z }, basis);
      if (centre === null) continue;
      const radius = (FOCAL * RING.radius) / centre.z;
      if (radius < 2) continue;
      const isNext = ring === state.rings[state.nextRing];
      const color = isNext ? PALETTE.ringNext : PALETTE.ring;
      const alpha = clamp(1.4 - centre.z / 2600, 0.25, 1);
      context.strokeStyle = css(hexToRgb(color), alpha);
      context.lineWidth = Math.max(2, radius * 0.09);
      context.beginPath();
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = css(hexToRgb(color), alpha * 0.35);
      context.lineWidth = Math.max(4, radius * 0.22);
      context.beginPath();
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      context.stroke();
      // A thin tether down to the ground, so the ring's height reads at a glance.
      const ground = project({ x: ring.x, y: state.terrain.heightAt(ring.x, ring.z), z: ring.z }, basis);
      if (ground !== null) {
        context.strokeStyle = css(hexToRgb(color), alpha * 0.4);
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(centre.x, centre.y + radius);
        context.lineTo(ground.x, ground.y);
        context.stroke();
      }
      if (isNext) {
        text(`${ring.index + 1}`, centre.x, centre.y - radius - 12, 22, PALETTE.ringNext, 'center');
      }
    }
  }

  function drawClouds(state, basis) {
    const sorted = state.clouds.slice().sort((a, b) => {
      const da = Math.hypot(a.x - state.plane.x, a.z - state.plane.z);
      const db = Math.hypot(b.x - state.plane.x, b.z - state.plane.z);
      return db - da;
    });
    for (const cloud of sorted) {
      const centre = project({ x: cloud.x, y: cloud.y, z: cloud.z }, basis);
      if (centre === null) continue;
      const size = (FOCAL * cloud.size) / centre.z;
      if (size < 4) continue;
      const alpha = clamp(1.2 - centre.z / 3200, 0.15, 0.85);
      context.fillStyle = `rgba(255,255,255,${alpha})`;
      for (const [dx, dy, scale] of [[-0.5, 0.1, 0.55], [0, -0.12, 0.7], [0.5, 0.08, 0.6], [0.15, 0.14, 0.5]]) {
        context.beginPath();
        context.ellipse(centre.x + dx * size, centre.y + dy * size, size * scale, size * scale * 0.42, 0, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  /** The aircraft from behind, banked with the roll: fuselage, wings, tail and a spinning prop. */
  function drawPlane(state, time) {
    const plane = state.plane;
    const cx = FIELD.width / 2;
    const cy = FIELD.height * 0.60;
    const scale = 1;
    context.save();
    context.translate(cx, cy);
    context.rotate((-plane.roll * DEG * 0.9));
    context.translate(0, plane.pitch * 1.1);
    // Prop disc, spinning: a translucent ellipse with two blade streaks.
    const propAngle = time * 22;
    context.save();
    context.translate(0, -58 * scale);
    context.fillStyle = 'rgba(200, 220, 235, 0.20)';
    context.beginPath();
    context.ellipse(0, 0, 46 * scale, 52 * scale, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(230, 240, 250, 0.5)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(Math.cos(propAngle) * 44, Math.sin(propAngle) * 50);
    context.lineTo(-Math.cos(propAngle) * 44, -Math.sin(propAngle) * 50);
    context.moveTo(Math.cos(propAngle + 1.2) * 44, Math.sin(propAngle + 1.2) * 50);
    context.lineTo(-Math.cos(propAngle + 1.2) * 44, -Math.sin(propAngle + 1.2) * 50);
    context.stroke();
    context.restore();
    // Wings, with a touch of dihedral.
    context.fillStyle = PALETTE.planeBody;
    context.strokeStyle = PALETTE.planeTrim;
    context.lineWidth = 2;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(side * 18, -34);
      context.lineTo(side * 150, -52);
      context.lineTo(side * 158, -40);
      context.lineTo(side * 24, -14);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = PALETTE.planeTrim;
      context.fillRect(side * 138 - (side < 0 ? 12 : 0), -52, 12, 12);
      context.fillStyle = PALETTE.planeBody;
    }
    // Tailplane and fin.
    context.fillStyle = PALETTE.planeBody;
    context.beginPath();
    context.moveTo(-52, 62);
    context.lineTo(52, 62);
    context.lineTo(58, 74);
    context.lineTo(-58, 74);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeTrim;
    context.beginPath();
    context.moveTo(-8, 62);
    context.lineTo(8, 62);
    context.lineTo(14, 6);
    context.lineTo(-14, 6);
    context.closePath();
    context.fill();
    // Fuselage: a tapered body with a red cheatline and cockpit glass.
    const body = context.createLinearGradient(-26, 0, 26, 0);
    body.addColorStop(0, '#c9c4b8');
    body.addColorStop(0.5, PALETTE.planeBody);
    body.addColorStop(1, '#c9c4b8');
    context.fillStyle = body;
    context.beginPath();
    context.moveTo(-24, 78);
    context.quadraticCurveTo(-30, 10, -16, -48);
    context.quadraticCurveTo(0, -66, 16, -48);
    context.quadraticCurveTo(30, 10, 24, 78);
    context.quadraticCurveTo(0, 88, -24, 78);
    context.closePath();
    context.fill();
    context.fillStyle = PALETTE.planeTrim;
    context.fillRect(-25, 34, 50, 7);
    context.fillStyle = PALETTE.planeGlass;
    context.beginPath();
    context.ellipse(0, -38, 12, 15, 0, 0, Math.PI * 2);
    context.fill();
    // Navigation lights, blinking with the clock.
    if (Math.floor(time * 2) % 2 === 0) {
      context.fillStyle = '#ff4b4b';
      context.beginPath();
      context.arc(-152, -46, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#37e07a';
      context.beginPath();
      context.arc(152, -46, 4, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  /** One round gauge: a lit face, ticks, a needle and a digital readout. */
  function drawGauge(x, y, radius, label, value, min, max, unit) {
    const face = context.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    face.addColorStop(0, '#2a3140');
    face.addColorStop(1, PALETTE.gaugeFace);
    context.fillStyle = face;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 3;
    context.stroke();
    context.strokeStyle = PALETTE.gaugeLit;
    context.lineWidth = 1.5;
    for (let tick = 0; tick <= 10; tick += 1) {
      const angle = -Math.PI * 0.75 + (tick / 10) * Math.PI * 1.5;
      const inner = radius * (tick % 5 === 0 ? 0.78 : 0.86);
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      context.lineTo(x + Math.cos(angle) * radius * 0.94, y + Math.sin(angle) * radius * 0.94);
      context.stroke();
    }
    const fraction = clamp((value - min) / (max - min), 0, 1);
    const needle = -Math.PI * 0.75 + fraction * Math.PI * 1.5;
    context.strokeStyle = PALETTE.gaugeNeedle;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + Math.cos(needle) * radius * 0.8, y + Math.sin(needle) * radius * 0.8);
    context.stroke();
    context.fillStyle = PALETTE.gaugeLit;
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    text(label, x, y + radius + 18, 15, PALETTE.muted, 'center');
    text(String(value), x, y + radius * 0.45, 20, PALETTE.text, 'center');
    text(unit, x, y + radius * 0.72, 12, PALETTE.muted, 'center');
  }

  /** The artificial horizon: sky and ground split by the bank, sliding with the pitch. */
  function drawAttitude(x, y, radius, plane) {
    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.clip();
    context.translate(x, y);
    context.rotate((-plane.roll * DEG));
    context.translate(0, plane.pitch * 1.6);
    context.fillStyle = '#7fb2e0';
    context.fillRect(-radius, -radius * 2, radius * 2, radius * 2);
    context.fillStyle = '#6b4a2f';
    context.fillRect(-radius, 0, radius * 2, radius * 2);
    context.strokeStyle = '#eef1f5';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-radius, 0);
    context.lineTo(radius, 0);
    context.stroke();
    context.restore();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = PALETTE.gaugeLit;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x - 18, y);
    context.lineTo(x - 5, y);
    context.moveTo(x + 5, y);
    context.lineTo(x + 18, y);
    context.stroke();
  }

  /** The cockpit: a lit instrument panel under the windscreen, with the nose and the prop. */
  function drawCockpit(state) {
    const plane = state.plane;
    const instruments = { knots: 0, feet: 0, heading: 0, throttle: 0, fuel: 0 };
    instruments.knots = Math.round(plane.speed / 0.514444);
    instruments.feet = Math.round(plane.y / 0.3048);
    instruments.heading = Math.round((((plane.heading * 180) / Math.PI) % 360 + 360) % 360);
    instruments.throttle = Math.round(plane.throttle * 100);
    instruments.fuel = Math.round(plane.fuel);
    // The cowling: low and light, like the fuselage, with a red trim line — it sits
    // below the windscreen, never up in the view.
    context.fillStyle = '#d8d3c8';
    context.beginPath();
    context.moveTo(FIELD.width / 2 - 95, FIELD.height);
    context.quadraticCurveTo(FIELD.width / 2 - 70, 540, FIELD.width / 2, 505);
    context.quadraticCurveTo(FIELD.width / 2 + 70, 540, FIELD.width / 2 + 95, FIELD.height);
    context.closePath();
    context.fill();
    context.strokeStyle = '#c0392b';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(FIELD.width / 2 - 78, FIELD.height - 60);
    context.quadraticCurveTo(FIELD.width / 2 - 55, 555, FIELD.width / 2, 540);
    context.quadraticCurveTo(FIELD.width / 2 + 55, 555, FIELD.width / 2 + 78, FIELD.height - 60);
    context.stroke();
    context.strokeStyle = 'rgba(230,240,250,0.35)';
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(FIELD.width / 2, 495, 150, 26, 0, Math.PI, Math.PI * 2);
    context.stroke();
    // The panel itself, warm-lit.
    const panelTop = 560;
    const panel = context.createLinearGradient(0, panelTop, 0, FIELD.height);
    panel.addColorStop(0, '#2b313e');
    panel.addColorStop(1, PALETTE.panel);
    context.fillStyle = panel;
    context.fillRect(0, panelTop, FIELD.width, FIELD.height - panelTop);
    context.fillStyle = PALETTE.panelEdge;
    context.fillRect(0, panelTop, FIELD.width, 3);
    drawGauge(210, 668, 62, 'AIRSPEED', instruments.knots, 0, 180, 'KT');
    drawAttitude(FIELD.width / 2, 668, 62, plane);
    drawGauge(FIELD.width - 210, 668, 62, 'ALTITUDE', instruments.feet, 0, 5000, 'FT');
    // Compass tape across the top of the panel. Ticks every 10°, labels at absolute
    // multiples of 30° (a tick grid only lands on a label when the heading happens to
    // line up, so labels are placed from the headings themselves).
    const tapeY = panelTop + 34;
    context.fillStyle = PALETTE.gaugeFace;
    context.fillRect(FIELD.width / 2 - 260, tapeY - 16, 520, 32);
    for (let offset = -120; offset <= 120; offset += 10) {
      const heading = (instruments.heading + offset + 360) % 360;
      const x = FIELD.width / 2 + offset * 2.1;
      const isCardinal = heading % 90 === 0;
      context.strokeStyle = isCardinal ? PALETTE.gaugeLit : PALETTE.muted;
      context.lineWidth = isCardinal ? 2 : 1;
      context.beginPath();
      context.moveTo(x, tapeY - 8);
      context.lineTo(x, tapeY + (isCardinal ? 10 : 4));
      context.stroke();
    }
    for (let label = 0; label < 360; label += 30) {
      const offset = ((label - instruments.heading + 540) % 360) - 180;
      if (Math.abs(offset) > 118) continue;
      const x = FIELD.width / 2 + offset * 2.1;
      const isCardinal = label % 90 === 0;
      text(label === 0 ? 'N' : label === 90 ? 'E' : label === 180 ? 'S' : label === 270 ? 'W' : String(label), x, tapeY + 26, 13, isCardinal ? PALETTE.gaugeLit : PALETTE.muted, 'center');
    }
    context.fillStyle = PALETTE.gaugeNeedle;
    context.beginPath();
    context.moveTo(FIELD.width / 2, tapeY - 16);
    context.lineTo(FIELD.width / 2 - 6, tapeY - 26);
    context.lineTo(FIELD.width / 2 + 6, tapeY - 26);
    context.closePath();
    context.fill();
    // Throttle lever and fuel, left; gear and flaps lights, right.
    const throttleY = panelTop + 190 - instruments.throttle * 1.1;
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(90, panelTop + 80);
    context.lineTo(90, panelTop + 190);
    context.stroke();
    context.fillStyle = PALETTE.gaugeLit;
    context.beginPath();
    context.arc(90, throttleY, 10, 0, Math.PI * 2);
    context.fill();
    text('THR', 90, panelTop + 210, 13, PALETTE.muted, 'center');
    // Fuel, top left of the panel; gear and flaps lights, top right — clear of the gauges.
    const fuelWidth = 150;
    text('FUEL', 28, tapeY + 10, 13, PALETTE.muted, 'left');
    context.fillStyle = '#0c0f14';
    context.fillRect(28, tapeY + 16, fuelWidth, 12);
    context.fillStyle = instruments.fuel < 20 ? PALETTE.danger : PALETTE.good;
    context.fillRect(28, tapeY + 16, fuelWidth * (instruments.fuel / 100), 12);
    text(`${instruments.fuel}%`, 28 + fuelWidth + 10, tapeY + 27, 13, PALETTE.muted, 'left');
    text(plane.gear ? 'GEAR DOWN' : 'GEAR UP', FIELD.width - 28, tapeY + 10, 15, plane.gear ? PALETTE.good : PALETTE.danger, 'right');
    if (plane.flaps) text('FLAPS', FIELD.width - 28, tapeY + 32, 15, PALETTE.gaugeLit, 'right');
  }

  function drawHud(state, screen, camera) {
    const plane = state.plane;
    const knots = Math.round(plane.speed / 0.514444);
    const feet = Math.round(plane.y / 0.3048);
    const vsi = Math.round((plane.verticalSpeed * 196.85) / 10) * 10;
    const heading = Math.round((((plane.heading * 180) / Math.PI) % 360 + 360) % 360);
    context.textBaseline = 'alphabetic';
    // Left: speed, altitude, vertical speed.
    text('SPD', 28, 34, 15, PALETTE.muted, 'left');
    text(`${knots}`, 28, 72, 40, PALETTE.text, 'left');
    text('KT', 108, 72, 16, PALETTE.muted, 'left');
    text('ALT', 28, 112, 15, PALETTE.muted, 'left');
    text(`${feet}`, 28, 150, 40, PALETTE.text, 'left');
    text('FT', 148, 150, 16, PALETTE.muted, 'left');
    text(`VSI ${vsi >= 0 ? '+' : ''}${vsi} FT/MIN`, 28, 178, 16, vsi < -800 ? PALETTE.warn : PALETTE.muted, 'left');
    // Centre: the compass tape. Ticks every 5°, labels at absolute multiples of 30°.
    const tapeY = 44;
    for (let offset = -90; offset <= 90; offset += 5) {
      const mark = (heading + offset + 360) % 360;
      const x = FIELD.width / 2 + offset * 3.4;
      const cardinal = mark % 90 === 0;
      context.strokeStyle = cardinal ? PALETTE.text : PALETTE.muted;
      context.lineWidth = cardinal ? 2 : 1;
      context.beginPath();
      context.moveTo(x, tapeY - 10);
      context.lineTo(x, tapeY + (cardinal ? 8 : 3));
      context.stroke();
    }
    for (let label = 0; label < 360; label += 30) {
      const offset = ((label - heading + 540) % 360) - 180;
      if (Math.abs(offset) > 88) continue;
      const x = FIELD.width / 2 + offset * 3.4;
      const cardinal = label % 90 === 0;
      text(label === 0 ? 'N' : label === 90 ? 'E' : label === 180 ? 'S' : label === 270 ? 'W' : String(label), x, tapeY + 28, 14, cardinal ? PALETTE.text : PALETTE.muted, 'center');
    }
    text(String(heading).padStart(3, '0'), FIELD.width / 2, tapeY - 18, 18, PALETTE.text, 'center');
    // Right: score, mission, clock, fuel.
    text('SCORE', FIELD.width - 28, 34, 15, PALETTE.muted, 'right');
    text(String(state.score), FIELD.width - 28, 72, 40, PALETTE.text, 'right');
    text(state.mission.name.toUpperCase(), FIELD.width - 28, 104, 17, PALETTE.gaugeLit, 'right');
    if (state.mission.timeLimit > 0) {
      const left = Math.max(0, Math.ceil(state.timeLeft));
      text(`TIME ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, FIELD.width - 28, 130, 17, left < 30 ? PALETTE.danger : PALETTE.text, 'right');
    }
    if (state.mission.id === 'rings' || state.mission.id === 'free') {
      text(`RINGS ${state.ringsDone}/${state.rings.length}`, FIELD.width - 28, 156, 17, PALETTE.text, 'right');
    }
    const fuelWidth = 150;
    context.fillStyle = 'rgba(12,15,20,0.7)';
    context.fillRect(FIELD.width - 28 - fuelWidth, 168, fuelWidth, 12);
    context.fillStyle = plane.fuel < 20 ? PALETTE.danger : PALETTE.good;
    context.fillRect(FIELD.width - 28 - fuelWidth, 168, fuelWidth * (plane.fuel / 100), 12);
    text('FUEL', FIELD.width - 28 - fuelWidth - 8, 179, 13, PALETTE.muted, 'right');
    // Bottom left: throttle and gear — the cockpit panel shows these itself, so the
    // HUD keeps them only in the chase view.
    if (camera !== 'cockpit') {
      const throttleWidth = 150;
      context.fillStyle = 'rgba(12,15,20,0.7)';
      context.fillRect(28, FIELD.height - 44, throttleWidth, 12);
      context.fillStyle = PALETTE.gaugeLit;
      context.fillRect(28, FIELD.height - 44, throttleWidth * plane.throttle, 12);
      text(`THR ${Math.round(plane.throttle * 100)}%`, 28, FIELD.height - 52, 14, PALETTE.muted, 'left');
      text(plane.gear ? 'GEAR DOWN' : 'GEAR UP', 196, FIELD.height - 32, 14, plane.gear ? PALETTE.good : PALETTE.danger, 'left');
      if (plane.flaps) text('FLAPS', 300, FIELD.height - 32, 14, PALETTE.gaugeLit, 'left');
    }
    // Warnings, flashing with the clock.
    const warnings = [];
    if (plane.stalled) warnings.push(['STALL', PALETTE.danger]);
    if (plane.fuel < 20) warnings.push(['LOW FUEL', PALETTE.warn]);
    if (plane.fuel <= 0) warnings.push(['ENGINE OUT', PALETTE.danger]);
    const ground = state.terrain.heightAt(plane.x, plane.z);
    if (!plane.onGround && plane.y - ground < 60 && plane.verticalSpeed < -3) warnings.push(['TERRAIN', PALETTE.danger]);
    if (warnings.length > 0 && Math.floor(state.elapsed * 2.5) % 2 === 0) {
      warnings.forEach(([message, color], index) => {
        text(message, FIELD.width / 2, 210 + index * 30, 24, color, 'center');
      });
    }
    // A short-lived message, such as a ring or a landing.
    if (state.messageTime > 0) {
      text(state.message, FIELD.width / 2, 260, 26, PALETTE.good, 'center');
    }
    void screen;
  }

  function drawPanel(title, lines, prompt, accent) {
    const width = 640;
    const height = 150 + lines.length * 34 + 64;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(16, 20, 29, 0.88)';
    context.fillRect(x, y, width, height);
    context.strokeStyle = accent || PALETTE.panelEdge;
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    text(title, FIELD.width / 2, y + 66, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + 122 + index * 34, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 36, 22, PALETTE.gaugeLit, 'center');
  }

  function drawTitle(state, best) {
    const lines = [
      'A bush-plane courier over a green island: rings to thread,',
      'two runways to land on, and fuel that always runs out.',
      '',
      `1  ${MISSIONS[0].name} — ${MISSIONS[0].blurb}`,
      `2  ${MISSIONS[1].name} — ${MISSIONS[1].blurb}`,
      `3  ${MISSIONS[2].name} — ${MISSIONS[2].blurb}`,
      '',
      'Fly with Arrow keys or W A S D · Shift / Ctrl throttle · G gear · F flaps',
      'C cockpit view · P pause · M mute',
      '',
      `Best score ${best}`,
    ];
    const mission = state.mission.name;
    drawPanel('SKY COURIER', lines, `Press Space to fly — ${mission} selected`, PALETTE.gaugeLit);
  }

  /** Paint one frame: sky, ground, airfield, rings, clouds, aircraft, instruments and panels. */
  function draw(state, screen, best, camera, time) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    const basis = cameraBasis(state, camera);
    drawSky(state, basis);
    drawTerrain(state, basis);
    drawRunways(state, basis);
    drawAirfield(state, basis);
    drawClouds(state, basis);
    drawRings(state, basis);
    if (screen === SCREEN_TITLE) {
      drawPlane(state, time);
      drawTitle(state, best);
      return;
    }
    if (camera === 'cockpit') drawCockpit(state);
    else drawPlane(state, time);
    drawHud(state, screen, camera);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The island will wait for you.', '', 'Arrow keys / W A S D fly · Shift / Ctrl throttle · G gear · F flaps · C camera'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      const lines = [`Score ${state.score}`, `Best ${best}`, ''];
      if (state.mission.id === 'rings') lines.push(`Rings ${state.ringsDone} of ${state.rings.length}`);
      if (state.mission.id === 'hop') lines.push(`Island hop legs done: ${state.hopLeg} of 2`);
      drawPanel('Sortie over', lines, 'Press Space to fly again');
    } else if (screen === SCREEN_CRASH) {
      const causes = {
        terrain: 'You met the mountain.',
        water: 'You ditched in the sea.',
        gear: 'You landed with the gear up.',
        hard: 'That landing was far too hard.',
        fuel: 'The tank ran dry over rough ground.',
      };
      drawPanel('Crashed', [causes[state.crashCause] || 'The aircraft is done.', `Score ${state.score}`, `Best ${best}`], 'Press Space to fly again', PALETTE.danger);
    } else if (screen === SCREEN_COMPLETE) {
      drawPanel('Mission complete', [`Score ${state.score}`, `Best ${best}`, state.mission.id === 'hop' ? 'Both island legs flown.' : 'Every ring threaded.'], 'Press Space to fly again', PALETTE.good);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
