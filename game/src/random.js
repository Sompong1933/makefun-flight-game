// A small seeded random source, so one seed always builds the same island and the same
// screenshot scenes: mulberry32 for the stream, a value-noise field on top of it.

export function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 2D value-noise field: smooth hills from a grid of random heights, bilinearly blended. */
export function createNoise(random, grid) {
  const size = grid + 1;
  const heights = new Float32Array(size * size);
  for (let index = 0; index < heights.length; index += 1) heights[index] = random();
  function at(gx, gy) {
    const x = ((gx % grid) + grid) % grid;
    const y = ((gy % grid) + grid) % grid;
    return heights[y * size + x];
  }
  function smooth(t) {
    return t * t * (3 - 2 * t);
  }
  return function noise(x, y) {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const fx = smooth(x - gx);
    const fy = smooth(y - gy);
    const a = at(gx, gy);
    const b = at(gx + 1, gy);
    const c = at(gx, gy + 1);
    const d = at(gx + 1, gy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
