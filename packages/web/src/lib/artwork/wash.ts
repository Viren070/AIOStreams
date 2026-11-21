/*
 * The artwork read small, blurred and toned in linear light, then drawn out
 * larger so the screen's stretch shows no steps.
 */

export const GRID_W = 96;
export const GRID_H = 54;
export const WASH_W = 320;
export const WASH_H = 180;

/** Three box passes of this radius approximate a Gaussian. */
const BOX_RADIUS = 8;
/** The mean brightness a wash is brought to, in linear light. */
const MEAN = 0.045;
const MIN_GAIN = 0.08;
const MAX_GAIN = 1.2;
/** Brightness the highlights roll off towards, so no patch glares. */
const WHITE = 0.2;
const SATURATION = 1.5;

const toLinear = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const LUT = 4096;
const toSrgb = new Float32Array(LUT + 1);
for (let i = 0; i <= LUT; i++) {
  const c = i / LUT;
  toSrgb[i] =
    255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
}

export interface Wash {
  /** Linear RGB, GRID_W x GRID_H. */
  rgb: Float32Array;
  /** The colour along the bottom edge, as `#rrggbb`. */
  tint: string;
  /** A dark, quiet shade of its overall colour, for panels over it. */
  panel: string;
}

const PANEL_LIGHTNESS = 0.1;
const PANEL_SATURATION = 0.32;

const hex = (rgb: number[]) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** `rgb` (0-255) with its lightness set and saturation capped, as HSL does it. */
function shade(rgb: number[], lightness: number, saturation: number): string {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d ? Math.min(saturation, d / (1 - Math.abs(2 * l - 1))) : 0;
  const h = !d
    ? 0
    : max === r
      ? ((g - b) / d + 6) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  const a = s * Math.min(lightness, 1 - lightness);
  const f = (n: number) => {
    const k = (n + h * 2) % 12;
    return 255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return hex([f(0), f(8), f(4)]);
}

/** One box pass along rows (`step` 1) or columns (`step` GRID_W), edges held. */
function boxPass(
  src: Float32Array,
  dst: Float32Array,
  lines: number,
  length: number,
  lineStep: number,
  step: number
) {
  const r = BOX_RADIUS;
  const scale = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    const last = base + (length - 1) * step;
    let sum = src[base] * (r + 1);
    for (let i = 1; i <= r; i++)
      sum += src[base + Math.min(i, length - 1) * step];
    for (let i = 0; i < length; i++) {
      dst[base + i * step] = sum * scale;
      const add = i + r + 1;
      const drop = i - r;
      sum +=
        src[add < length ? base + add * step : last] -
        src[drop > 0 ? base + drop * step : base];
    }
  }
}

function blur(channel: Float32Array, scratch: Float32Array) {
  for (let pass = 0; pass < 3; pass++) {
    boxPass(channel, scratch, GRID_H, GRID_W, GRID_W, 1);
    boxPass(scratch, channel, GRID_W, GRID_H, 1, GRID_W);
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The wash of `rgba`, the art drawn at GRID_W x GRID_H. */
export function makeWash(rgba: Uint8ClampedArray): Wash {
  const n = GRID_W * GRID_H;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    r[i] = toLinear[rgba[i * 4]];
    g[i] = toLinear[rgba[i * 4 + 1]];
    b[i] = toLinear[rgba[i * 4 + 2]];
  }
  const scratch = new Float32Array(n);
  blur(r, scratch);
  blur(g, scratch);
  blur(b, scratch);

  let mean = 0;
  for (let i = 0; i < n; i++)
    mean += 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  mean /= n;
  const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, MEAN / (mean || 1e-4)));

  const rgb = new Float32Array(n * 3);
  const edge = [0, 0, 0];
  const whole = [0, 0, 0];
  const edgeFrom = GRID_H - 4;
  for (let y = 0; y < GRID_H; y++) {
    const v = y / (GRID_H - 1);
    // Darker towards the bottom, where rows and text sit, and a little at the sides.
    const fall = 1 - 0.3 * smoothstep(0.3, 1, v);
    for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x;
      const u = (2 * x) / (GRID_W - 1) - 1;
      const shade = fall * (1 - 0.12 * u * u);
      let cr = r[i] * gain;
      let cg = g[i] * gain;
      let cb = b[i] * gain;
      const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      cr = Math.max(0, lum + (cr - lum) * SATURATION);
      cg = Math.max(0, lum + (cg - lum) * SATURATION);
      cb = Math.max(0, lum + (cb - lum) * SATURATION);
      const toned = 1 / (1 + lum / WHITE);
      whole[0] += cr * toned;
      whole[1] += cg * toned;
      whole[2] += cb * toned;
      if (y >= edgeFrom) {
        edge[0] += cr * toned;
        edge[1] += cg * toned;
        edge[2] += cb * toned;
      }
      rgb[i * 3] = cr * toned * shade;
      rgb[i * 3 + 1] = cg * toned * shade;
      rgb[i * 3 + 2] = cb * toned * shade;
    }
  }

  // Before the vignette, which would leave it all but black.
  const srgb = (sum: number[], cells: number) =>
    sum.map((v) => toSrgb[Math.min(LUT, ((v / cells) * LUT) | 0)]);
  const tint = hex(srgb(edge, (GRID_H - edgeFrom) * GRID_W));
  const panel = shade(srgb(whole, n), PANEL_LIGHTNESS, PANEL_SATURATION);
  return { rgb, tint, panel };
}

/** Where each output column samples the grid: two cells (x3 for RGB) and the weight between. */
const col0 = new Int32Array(WASH_W);
const col1 = new Int32Array(WASH_W);
const colWeight = new Float32Array(WASH_W);
for (let x = 0; x < WASH_W; x++) {
  const g = Math.min(
    GRID_W - 1,
    Math.max(0, ((x + 0.5) * GRID_W) / WASH_W - 0.5)
  );
  col0[x] = (g | 0) * 3;
  col1[x] = Math.min(GRID_W - 1, (g | 0) + 1) * 3;
  colWeight[x] = g - (g | 0);
}

const NOISE = 64;
/** Triangular noise of +-1 step, tiled: cheaper than drawing two randoms per channel. */
const noise = new Float32Array(NOISE * NOISE * 3);
{
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < noise.length; i++) noise[i] = rand() - rand();
}

/**
 * The wash drawn out to WASH_W x WASH_H, dithered: a smooth dark gradient
 * stretched across a screen otherwise shows its 8-bit steps as bands.
 */
export function drawWash(wash: Wash, out: Uint8ClampedArray) {
  const { rgb } = wash;
  for (let y = 0; y < WASH_H; y++) {
    const g = Math.min(
      GRID_H - 1,
      Math.max(0, ((y + 0.5) * GRID_H) / WASH_H - 0.5)
    );
    const y0 = g | 0;
    const fy = g - y0;
    const row0 = y0 * GRID_W * 3;
    const row1 = Math.min(GRID_H - 1, y0 + 1) * GRID_W * 3;
    const noiseRow = (y & (NOISE - 1)) * NOISE;
    let o = y * WASH_W * 4;
    for (let x = 0; x < WASH_W; x++, o += 4) {
      const a0 = row0 + col0[x];
      const a1 = row0 + col1[x];
      const b0 = row1 + col0[x];
      const b1 = row1 + col1[x];
      const fx = colWeight[x];
      const n = (noiseRow + (x & (NOISE - 1))) * 3;
      for (let ch = 0; ch < 3; ch++) {
        const top = rgb[a0 + ch] + (rgb[a1 + ch] - rgb[a0 + ch]) * fx;
        const bottom = rgb[b0 + ch] + (rgb[b1 + ch] - rgb[b0 + ch]) * fx;
        const lin = Math.min(1, top + (bottom - top) * fy);
        out[o + ch] = toSrgb[(lin * LUT) | 0] + noise[n + ch];
      }
      out[o + 3] = 255;
    }
  }
}
