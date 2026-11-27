// The island: one seeded heightmap, two flattened airfields, a lake, and the ring courses.
// Everything here is pure numbers — no drawing, no browser — so the shots and the game read
// the same ground.

import { WORLD } from './config.js';
import { createNoise } from './random.js';

const SIZE = WORLD.cells;
const CELL = WORLD.cell;
const HALF = (SIZE * CELL) / 2;

/** The home runway: east-west, 900 m long, 30 m wide, at 8 m above the sea. */
export const HOME_RUNWAY = {
  x: 0,
  z: 0,
  heading: Math.PI / 2,
  length: 900,
  width: 30,
  height: 8,
};

/** The far runway: on the north-east headland, heading 20 degrees, 800 m long. */
export const FAR_RUNWAY = {
  x: 2350,
  z: -1750,
  heading: (20 * Math.PI) / 180,
  length: 800,
  width: 30,
  height: 46,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Blend factor 0..1: 1 deep inside the strip, 0 outside it (with a soft edge). */
function runwayBlend(x, z, runway) {
  const dx = x - runway.x;
  const dz = z - runway.z;
  const along = dx * Math.sin(runway.heading) + dz * Math.cos(runway.heading);
  const across = dx * Math.cos(runway.heading) - dz * Math.sin(runway.heading);
  if (Math.abs(along) > runway.length / 2 + 90 || Math.abs(across) > runway.width / 2 + 90) return 0;
  const edge = Math.max(
    0,
    1 - Math.max(0, Math.abs(along) - runway.length / 2) / 90,
    1 - Math.max(0, Math.abs(across) - runway.width / 2) / 90,
  );
  return clamp(edge, 0, 1);
}

/** Is this ground point paved runway, and where on the strip (for the painted markings)? */
export function runwayAt(x, z) {
  for (const runway of [HOME_RUNWAY, FAR_RUNWAY]) {
    const dx = x - runway.x;
    const dz = z - runway.z;
    const along = dx * Math.sin(runway.heading) + dz * Math.cos(runway.heading);
    const across = dx * Math.cos(runway.heading) - dz * Math.sin(runway.heading);
    if (Math.abs(along) <= runway.length / 2 && Math.abs(across) <= runway.width / 2) {
      return { runway, along, across };
    }
  }
  return null;
}

export function createTerrain(random) {
  const coarse = createNoise(random, 8);
  const mid = createNoise(random, 24);
  const fine = createNoise(random, 64);
  const heights = new Float32Array(SIZE * SIZE);

  for (let gz = 0; gz < SIZE; gz += 1) {
    for (let gx = 0; gx < SIZE; gx += 1) {
      const x = (gx + 0.5) * CELL - HALF;
      const z = (gz + 0.5) * CELL - HALF;
      // The island falls away to the sea toward the edges of the map.
      const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
      const falloff = clamp(1 - Math.pow(Math.max(0, edge - 0.55) / 0.45, 2), 0, 1);
      let height =
        coarse(x / 900 + 3, z / 900 + 7) * 190 +
        mid(x / 320 + 11, z / 320 + 5) * 130 +
        fine(x / 110 + 2, z / 110 + 9) * 34;
      height = (height - 120) * falloff;
      // A mountain ridge across the north half, and a lake basin south-east.
      const ridge = Math.exp(-Math.pow((z + 1500) / 420, 2)) * 150 * falloff;
      const lake = Math.exp(-(Math.pow((x - 1500) / 520, 2) + Math.pow((z - 1400) / 420, 2)));
      height += ridge;
      height = height * (1 - lake * 0.9) - lake * 6;
      // Flatten the ground under both runways so the strip sits level.
      for (const runway of [HOME_RUNWAY, FAR_RUNWAY]) {
        const blend = runwayBlend(x, z, runway);
        height = height * (1 - blend) + runway.height * blend;
      }
      heights[gz * SIZE + gx] = height;
    }
  }

  function heightAt(x, z) {
    const gx = clamp((x + HALF) / CELL - 0.5, 0, SIZE - 1.001);
    const gz = clamp((z + HALF) / CELL - 0.5, 0, SIZE - 1.001);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    const a = heights[z0 * SIZE + x0];
    const b = heights[z0 * SIZE + x0 + 1];
    const c = heights[(z0 + 1) * SIZE + x0];
    const d = heights[(z0 + 1) * SIZE + x0 + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  /** Rough slope (0 flat, 1 cliff) from the neighbours, for rock colouring. */
  function slopeAt(x, z) {
    const step = CELL;
    const dx = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step);
    const dz = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step);
    return Math.min(1, Math.hypot(dx, dz));
  }

  return { heightAt, slopeAt };
}

/** The ring course: eight hoops around the island, each facing the next one. */
export function ringCourse() {
  const spots = [
    { x: 700, z: -500, y: 170 },
    { x: 1500, z: -1200, y: 220 },
    { x: 2350, z: -1750, y: 200 },
    { x: 1800, z: -2400, y: 280 },
    { x: 400, z: -2200, y: 300 },
    { x: -900, z: -1500, y: 240 },
    { x: -1400, z: -200, y: 180 },
    { x: -600, z: 900, y: 160 },
  ];
  return spots.map((spot, index) => {
    const next = spots[(index + 1) % spots.length];
    return { ...spot, heading: Math.atan2(next.x - spot.x, next.z - spot.z), index };
  });
}

/** Clouds: soft puffs drifting slowly over the island. */
export function createClouds(random) {
  const clouds = [];
  for (let index = 0; index < 26; index += 1) {
    clouds.push({
      x: (random() - 0.5) * 6200,
      z: (random() - 0.5) * 6200,
      y: 520 + random() * 420,
      size: 120 + random() * 220,
      drift: 2 + random() * 3,
    });
  }
  return clouds;
}
