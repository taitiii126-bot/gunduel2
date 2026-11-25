// その場で作る絵（テクスチャ）：石の床・石積み・コンクリート・金属の板・波板・氷・雪・岩・ネオンの看板。
// 高さの絵から凹凸（法線マップ）も作る。どれも継ぎ目なく並べられる
import * as THREE from '../lib/three.js';

// 継ぎ目のない値ノイズ（周期 P）
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256); for (let i = 0; i < 256; i++) val[i] = rnd();
  const v2 = (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const X0 = ((xi % P) + P) % P, Y0 = ((yi % P) + P) % P, X1 = (X0 + 1) % P, Y1 = (Y0 + 1) % P;
    const a = val[perm[X0 + perm[Y0]]], b = val[perm[X1 + perm[Y0]]], c = val[perm[X0 + perm[Y1]]], d = val[perm[X1 + perm[Y1]]];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return {
    // fbm：u,v は 0..1、freq は1周に入る数（整数）
    fbm(u, v, freq, oct, gain = 0.5) {
      let amp = 1, sum = 0, norm = 0, f = freq;
      for (let o = 0; o < oct; o++) { sum += amp * v2(u * f, v * f, f); norm += amp; amp *= gain; f *= 2; }
      return sum / norm;
    },
    rnd,
  };
}

function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

function toTex(cv, srgb, rep) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) t.repeat.set(rep, rep);
  t.anisotropy = 8;
  return t;
}

// 高さの配列から法線マップ
function normalFromHeight(h, size, strength) {
  const cv = canvas(size), g = cv.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
    const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
    let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
    const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(cv, false);
}

// 色・高さ・ざらつきを1ピクセルずつ決める関数から、3枚の絵を作る
function generate(size, fn, normalStrength) {
  const cvC = canvas(size), cvR = canvas(size);
  const gC = cvC.getContext('2d'), gR = cvR.getContext('2d');
  const iC = gC.createImageData(size, size), iR = gR.createImageData(size, size);
  const H = new Float32Array(size * size), out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8, metal: 0 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, out);
    const i = (y * size + x) * 4;
    iC.data[i] = Math.max(0, Math.min(255, out.r * 255)); iC.data[i + 1] = Math.max(0, Math.min(255, out.g * 255)); iC.data[i + 2] = Math.max(0, Math.min(255, out.b * 255)); iC.data[i + 3] = 255;
    // ざらつき（緑）と金属っぽさ（青）を1枚に（three.js の roughnessMap は G、metalnessMap は B を読む）
    iR.data[i] = 255; iR.data[i + 1] = Math.max(0, Math.min(255, out.rough * 255)); iR.data[i + 2] = Math.max(0, Math.min(255, out.metal * 255)); iR.data[i + 3] = 255;
    H[y * size + x] = out.h;
  }
  gC.putImageData(iC, 0, 0); gR.putImageData(iR, 0, 0);
  return { map: toTex(cvC, true), rough: toTex(cvR, false), normal: normalFromHeight(H, size, normalStrength || 2.5) };
}

const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const TEX = {
  // 石の床（大きな板石。目地・欠け・汚れ）
  stoneTiles(o = {}) {
    const N = makeNoise(o.seed || 3), n = o.tiles || 4, base = o.base || [0.78, 0.7, 0.58], gw = o.grout || 0.022;
    const cellRnd = []; for (let i = 0; i < n * n; i++) cellRnd.push(N.rnd());
    return generate(o.size || 512, (u, v, out) => {
      const cu = u * n, cv = v * n, ix = Math.floor(cu), iy = Math.floor(cv), fx = cu - ix, fy = cv - iy;
      const cr = cellRnd[(iy % n) * n + (ix % n)];
      const edge = Math.min(fx, fy, 1 - fx, 1 - fy);
      const grout = 1 - sstep(gw * 0.4, gw, edge);
      const big = N.fbm(u, v, 4, 4), fine = N.fbm(u, v, 32, 3), crack = Math.abs(N.fbm(u, v, 8, 4) - 0.5);
      const cracks = (1 - sstep(0.004, 0.018, crack)) * (o.cracks === false ? 0 : 0.8);
      let k = 0.82 + cr * 0.22 + (big - 0.5) * 0.35 + (fine - 0.5) * 0.18;
      k *= 1 - cracks * 0.45;
      const tint = o.tint || [1, 1, 1];
      out.r = mix(base[0] * k * tint[0], 0.16, grout); out.g = mix(base[1] * k * tint[1], 0.14, grout); out.b = mix(base[2] * k * tint[2], 0.12, grout);
      out.h = (1 - grout) * (0.75 + fine * 0.2 + cr * 0.05) - cracks * 0.3 - sstep(0.0, gw * 2.5, gw * 2.5 - edge) * 0.15;
      out.rough = 0.78 + fine * 0.15 + grout * 0.08 - (o.wet ? sstep(0.55, 0.7, big) * 0.6 : 0);
      out.metal = 0;
    }, o.normal || 3.2);
  },
  // 石積みの壁（ずらして積んだ石）
  bricks(o = {}) {
    const N = makeNoise(o.seed || 7), rows = o.rows || 6, cols = o.cols || 3, base = o.base || [0.72, 0.64, 0.52];
    return generate(o.size || 512, (u, v, out) => {
      const rv = v * rows, row = Math.floor(rv), fy = rv - row;
      const cu = u * cols + (row % 2) * 0.5, col = Math.floor(cu), fx = cu - col;
      const id = (row * 31 + ((col % cols) + cols) % cols * 17) % 97 / 97;
      const edge = Math.min(fx / cols * rows, (1 - fx) / cols * rows, fy, 1 - fy);
      const grout = 1 - sstep(0.02, 0.06, edge);
      const fine = N.fbm(u, v, 24, 3), big = N.fbm(u, v, 4, 3);
      let k = 0.78 + id * 0.3 + (fine - 0.5) * 0.25 + (big - 0.5) * 0.2;
      const moss = o.moss ? sstep(0.58, 0.72, N.fbm(u, v, 6, 4)) * (1 - v * 0.6) : 0;
      out.r = mix(mix(base[0] * k, 0.3, moss), 0.12, grout); out.g = mix(mix(base[1] * k, 0.42, moss), 0.11, grout); out.b = mix(mix(base[2] * k, 0.18, moss), 0.1, grout);
      out.h = (1 - grout) * (0.7 + fine * 0.3 - sstep(0.06, 0.0, edge) * 0.2);
      out.rough = 0.85 + fine * 0.1; out.metal = 0;
    }, o.normal || 4);
  },
  // コンクリート（雨にぬれた水たまり）
  concrete(o = {}) {
    const N = makeNoise(o.seed || 11), base = o.base || [0.32, 0.33, 0.36];
    return generate(o.size || 512, (u, v, out) => {
      const big = N.fbm(u, v, 3, 4), fine = N.fbm(u, v, 40, 3), mid = N.fbm(u, v, 12, 3);
      const seam = Math.min(Math.abs((u * 2) % 1 - 0.5), Math.abs((v * 2) % 1 - 0.5));
      const joint = 1 - sstep(0.004, 0.01, 0.5 - seam);
      const puddle = o.wet ? sstep(0.5, 0.62, big) : 0;
      const k = 0.85 + (mid - 0.5) * 0.3 + (fine - 0.5) * 0.2;
      out.r = base[0] * k * (1 - puddle * 0.45) * (1 - joint * 0.5); out.g = base[1] * k * (1 - puddle * 0.45) * (1 - joint * 0.5); out.b = base[2] * k * (1 - puddle * 0.4) * (1 - joint * 0.5);
      out.h = 0.5 + fine * 0.3 + mid * 0.2 - puddle * 0.4 - joint * 0.3;
      out.rough = Math.max(0.16, 0.82 + fine * 0.12 - puddle * 0.62 - (o.wet ? 0.14 : 0));
      out.metal = 0;
    }, o.normal || 1.8);
  },
  // 金属の板（継ぎ目とリベット、使い込んだ傷）
  metalPanels(o = {}) {
    const N = makeNoise(o.seed || 5), base = o.base || [0.45, 0.47, 0.5], n = o.panels || 2;
    return generate(o.size || 512, (u, v, out) => {
      const pu = (u * n) % 1, pv = (v * n) % 1;
      const edge = Math.min(pu, pv, 1 - pu, 1 - pv);
      const seam = 1 - sstep(0.004, 0.012, edge);
      const rv = (pu * 8) % 1, rw = (pv * 8) % 1;
      const rivet = (edge < 0.05) ? sstep(0.12, 0.05, Math.hypot(rv - 0.5, rw - 0.5) / 4) : 0;
      const scratch = Math.abs(N.fbm(u * 0.2, v * 3, 16, 3) - 0.5) < 0.01 ? 1 : 0;
      const fine = N.fbm(u, v, 32, 3), grime = N.fbm(u, v, 5, 4);
      const k = 0.85 + (fine - 0.5) * 0.15 - sstep(0.55, 0.8, grime) * 0.25 + scratch * 0.25;
      out.r = base[0] * k * (1 - seam * 0.6) + rivet * 0.15; out.g = base[1] * k * (1 - seam * 0.6) + rivet * 0.15; out.b = base[2] * k * (1 - seam * 0.6) + rivet * 0.15;
      out.h = 0.6 - seam * 0.5 + rivet * 0.4 + fine * 0.05;
      out.rough = 0.42 + fine * 0.2 + sstep(0.55, 0.8, grime) * 0.3 - scratch * 0.2;
      out.metal = 0.85;
    }, o.normal || 3);
  },
  // 波板（コンテナの壁）
  corrugated(o = {}) {
    const N = makeNoise(o.seed || 13), base = o.base || [0.7, 0.2, 0.15], ridges = o.ridges || 24;
    return generate(o.size || 256, (u, v, out) => {
      const w = Math.sin(u * ridges * Math.PI * 2), rust = sstep(0.6, 0.8, N.fbm(u, v, 6, 4)), fine = N.fbm(u, v, 32, 2);
      const k = 0.8 + w * 0.12 + (fine - 0.5) * 0.15;
      out.r = mix(base[0] * k, 0.35, rust); out.g = mix(base[1] * k, 0.18, rust); out.b = mix(base[2] * k, 0.08, rust);
      out.h = w * 0.5 + 0.5; out.rough = 0.5 + rust * 0.4 + fine * 0.1; out.metal = 0.6 * (1 - rust);
    }, o.normal || 5);
  },
  // 氷（ひびと、中の気泡）
  ice(o = {}) {
    const N = makeNoise(o.seed || 17);
    return generate(o.size || 512, (u, v, out) => {
      const big = N.fbm(u, v, 3, 5), crack = Math.abs(N.fbm(u, v, 6, 5) - 0.5), fine = N.fbm(u, v, 30, 2);
      const c = 1 - sstep(0.003, 0.012, crack);
      const k = 0.75 + big * 0.35;
      out.r = (0.55 + c * 0.35) * k; out.g = (0.78 + c * 0.2) * k; out.b = (0.92 + c * 0.08) * k;
      out.h = 0.6 - c * 0.5 + fine * 0.1; out.rough = 0.08 + fine * 0.12 + c * 0.3; out.metal = 0;
    }, o.normal || 2);
  },
  // 雪
  snow(o = {}) {
    const N = makeNoise(o.seed || 19);
    return generate(o.size || 512, (u, v, out) => {
      const big = N.fbm(u, v, 4, 4), fine = N.fbm(u, v, 48, 2), sp = N.fbm(u, v, 64, 1) > 0.82 ? 1 : 0;
      const k = 0.88 + big * 0.12;
      out.r = 0.86 * k; out.g = 0.9 * k; out.b = 0.97 * k;
      out.h = big * 0.6 + fine * 0.3; out.rough = 0.72 - sp * 0.5; out.metal = 0;
    }, o.normal || 2.5);
  },
  // 岩（浮島の崖）
  rock(o = {}) {
    const N = makeNoise(o.seed || 23), base = o.base || [0.42, 0.36, 0.3];
    return generate(o.size || 512, (u, v, out) => {
      const strata = Math.sin((v * 14 + N.fbm(u, v, 4, 4) * 3) * Math.PI) * 0.5 + 0.5;
      const big = N.fbm(u, v, 4, 5), fine = N.fbm(u, v, 32, 3);
      const k = 0.65 + strata * 0.25 + (big - 0.5) * 0.4 + (fine - 0.5) * 0.2;
      out.r = base[0] * k; out.g = base[1] * k; out.b = base[2] * k;
      out.h = strata * 0.5 + big * 0.4 + fine * 0.2; out.rough = 0.9; out.metal = 0;
    }, o.normal || 5);
  },
  // 草
  grass(o = {}) {
    const N = makeNoise(o.seed || 29);
    return generate(o.size || 512, (u, v, out) => {
      const big = N.fbm(u, v, 4, 4), fine = N.fbm(u, v, 64, 2), blade = N.fbm(u * 3, v * 0.5, 48, 2);
      const k = 0.7 + big * 0.4 + (fine - 0.5) * 0.3 + (blade - 0.5) * 0.3;
      out.r = 0.22 * k + big * 0.08; out.g = 0.42 * k; out.b = 0.12 * k;
      out.h = fine * 0.5 + blade * 0.5; out.rough = 0.9; out.metal = 0;
    }, o.normal || 3);
  },
  // 黄色と黒の注意の帯
  hazard() {
    const cv = canvas(256), g = cv.getContext('2d');
    g.fillStyle = '#16130C'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#E8B500';
    for (let i = -256; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + 256, 256); g.lineTo(i + 256, 256); g.closePath(); g.fill(); }
    g.globalAlpha = 0.25; g.fillStyle = '#000';
    for (let k = 0; k < 400; k++) g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1 + Math.random() * 2);
    return toTex(cv, true);
  },
  // ネオンの看板（光る文字）。発光マップとして使う
  neon(text, color, w = 512, h = 128, font) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.font = font || `900 ${Math.floor(h * 0.62)}px "Dela Gothic One","Zen Kaku Gothic New",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = h * 0.18;
    g.strokeStyle = color; g.lineWidth = h * 0.05;
    g.strokeText(text, w / 2, h / 2 + h * 0.04);
    g.shadowBlur = h * 0.08; g.fillStyle = '#FFFFFF';
    g.fillText(text, w / 2, h / 2 + h * 0.04);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  },
  // 名前の札（頭の上）
  label(text, color) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const g = cv.getContext('2d');
    g.font = '700 46px "Zen Kaku Gothic New","Chakra Petch",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(500, g.measureText(text).width + 36);
    g.fillStyle = 'rgba(8,10,16,0.55)';
    const x0 = 256 - w / 2;
    g.beginPath(); g.roundRect ? g.roundRect(x0, 14, w, 64, 20) : g.rect(x0, 14, w, 64); g.fill();
    g.fillStyle = color; g.fillRect(x0 + 14, 70, w - 28, 4);
    g.fillStyle = '#fff'; g.fillText(text, 256, 46);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },
  // 光の点（スプライト用の丸いぼかし）
  glow(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
    const cv = canvas(size), g = cv.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },
};

// 箱の形：面ごとに、実際の大きさに合わせた UV（どの箱でも模様の大きさがそろう）
export function boxGeometry(w, h, d, scale = 2, uvOff = [0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su / scale + uvOff[0], uv.getY(i) * sv / scale + uvOff[1]);
  }
  return g;
}

export function setAniso(tex, renderer) {
  const a = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of tex) if (t) t.anisotropy = a;
}
