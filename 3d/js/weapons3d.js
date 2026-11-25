// 武器の3Dモデル（その場で組み立てる）。前＝+Z、持つ手（右手）の位置が原点。
// 返り値：{ g, muzzle（銃口）, fore（左手の位置）, pose（構え方）, mag（弾倉の位置）, sight（覗く目の位置）, optic（光る照準つき）}
import * as THREE from '../lib/three.js';
import { RoundedBoxGeometry, mergeGeometries } from '../lib/three.js';

let M = null;
function mats() {
  if (M) return M;
  M = {
    metal: new THREE.MeshStandardMaterial({ color: 0x2c3038, metalness: 0.9, roughness: 0.32 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c939e, metalness: 1, roughness: 0.22 }),
    poly: new THREE.MeshStandardMaterial({ color: 0x17191f, metalness: 0.2, roughness: 0.62 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4126, metalness: 0, roughness: 0.55 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 1, roughness: 0.12 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc89a3c, metalness: 1, roughness: 0.3 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a1020, metalness: 0.5, roughness: 0.05, emissive: 0x2050ff, emissiveIntensity: 0.6 }),
  };
  return M;
}
const glowCache = {};
function glow(color, k = 1.5) {
  const key = color + k;
  return glowCache[key] || (glowCache[key] = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(color), emissiveIntensity: k, roughness: 0.4 }));
}

function box(g, w, h, d, mat, x, y, z, r) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.22), mat);
  m.position.set(x, y, z); if (r) m.rotation.set(r[0] || 0, r[1] || 0, r[2] || 0);
  m.castShadow = true; g.add(m); return m;
}
function cyl(g, r1, r2, len, mat, x, y, z, axis = 'z', seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
}
function torus(g, r, t, mat, x, y, z) { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 24), mat); m.position.set(x, y, z); g.add(m); return m; }

// のぞく窓（ドットサイト・ホロサイト）。窓の真ん中に光る照準（撃つ人の側にだけ見える）
const glassCache = {}, reticleCache = {};
function glassMat(color) {
  return glassCache[color] || (glassCache[color] = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0x9fd8ff), 0.7), metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
}
function reticleMat(color) {
  return reticleCache[color] || (reticleCache[color] = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5), transparent: true, depthWrite: false, toneMapped: false }));
}
function noShadow(o) { o.castShadow = false; o.receiveShadow = false; o.userData.optic = true; return o; }
// 照準の模様：点＋輪（holo）か、点だけ（dot）。窓は前＝+Z の平面、撃つ人は -Z 側から見る
function reticle(g, style, color, x, y, z, s = 1) {
  const mat = reticleMat(color);
  const add = (geo) => { const m = noShadow(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); m.rotation.y = Math.PI; m.renderOrder = 3; g.add(m); };
  add(new THREE.CircleGeometry(0.0013 * s, 12));
  if (style === 'holo') { add(new THREE.RingGeometry(0.0062 * s, 0.0072 * s, 32)); for (let i = 0; i < 4; i++) { const t = new THREE.PlaneGeometry(0.0007 * s, 0.0026 * s); t.translate(0, 0.0086 * s, 0); t.rotateZ(i * Math.PI / 2); add(t); } }
}
function reflexSight(g, m, color, y, z, o = {}) {
  const w = o.w || 0.042, h = o.h || 0.034, base = o.base != null ? o.base : y - h / 2 - 0.01, th = 0.006, dz = o.d || 0.032;
  // 台
  box(g, Math.min(0.034, w * 0.8), Math.max(0.008, y - h / 2 - base), dz + 0.02, m.metal, 0, (y - h / 2 + base) / 2, z - 0.004);
  // 枠
  box(g, th, h + th, dz, m.metal, -(w / 2 + th / 2), y, z); box(g, th, h + th, dz, m.metal, w / 2 + th / 2, y, z);
  box(g, w + th * 2, th, dz + 0.008, m.metal, 0, y + h / 2 + th / 2, z + 0.003);
  box(g, w + th * 2, th, dz, m.poly, 0, y - h / 2 - th / 2, z);
  box(g, w * 0.5, 0.003, 0.004, glow(color), 0, y + h / 2 + th + 0.0015, z - dz * 0.3);
  // ガラスと照準
  const gl = noShadow(new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat(color))); gl.position.set(0, y, z + dz * 0.2); gl.renderOrder = 2; g.add(gl);
  reticle(g, o.style || 'holo', o.ret || '#ff3b3b', 0, y, z + dz * 0.2 - 0.0005, o.rs || 1);
}
function miniDot(g, m, color, y, z, base) {
  box(g, 0.024, Math.max(0.008, y - 0.016 - base), 0.04, m.metal, 0, (y - 0.016 + base) / 2, z - 0.004);
  const r = torus(g, 0.017, 0.0045, m.metal, 0, y, z); r.scale.set(1, 1, 2.2); r.castShadow = true;
  box(g, 0.01, 0.003, 0.004, glow(color), 0, y + 0.023, z);
  const gl = noShadow(new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), glassMat(color))); gl.position.set(0, y, z + 0.004); gl.renderOrder = 2; g.add(gl);
  reticle(g, 'dot', '#ff3b3b', 0, y, z + 0.0035, 1.1);
}
// 金属の照準（前の柱・後ろのみぞ）。y＝目線の高さ
function ironSights(g, m, color, y, zr, zf, base, o = {}) {
  // 後ろ：みぞ（2本の柱）か輪
  if (o.ring) {
    box(g, 0.012, Math.max(0.006, y - 0.012 - base), 0.012, m.metal, 0, (y - 0.012 + base) / 2, zr);
    const r = torus(g, 0.012, 0.0035, m.metal, 0, y, zr); r.castShadow = true;
  } else {
    for (const s of [-1, 1]) box(g, 0.007, y + 0.005 - base, 0.01, m.metal, s * 0.0075, (y + 0.005 + base) / 2, zr);
    box(g, 0.022, 0.004, 0.01, m.metal, 0, base + 0.002, zr);
  }
  // 前：柱の先が目線の高さ（先に光る点）
  const fb = o.fbase != null ? o.fbase : base;
  box(g, 0.0045, y - fb, 0.008, m.metal, 0, (y + fb) / 2 - 0.001, zf);
  const dot = noShadow(new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), reticleMat(o.dot || '#7CFF6B'))); dot.position.set(0, y - 0.002, zf - 0.004); g.add(dot);
}

export function buildWeapon(id, color) {
  const m = mats(), g = new THREE.Group(), acc = glow(color);
  const muzzle = new THREE.Object3D();
  let fore = new THREE.Vector3(0, 0, 0.2), pose = 'rifle', mag = new THREE.Vector3(0, -0.06, 0.08), sight = new THREE.Vector3(0, 0.1, 0.0);   // sight＝覗くときに目が来る場所
  switch (id) {
    case 2: { // ピストル
      box(g, 0.042, 0.05, 0.22, m.metal, 0, 0.065, 0.07);
      box(g, 0.036, 0.03, 0.17, m.poly, 0, 0.03, 0.06);
      box(g, 0.036, 0.12, 0.052, m.poly, 0, -0.02, -0.005, [0.28, 0, 0]);
      box(g, 0.044, 0.008, 0.16, acc, 0, 0.078, 0.07);
      ironSights(g, m, color, 0.1, -0.022, 0.172, 0.09);
      sight.set(0, 0.1, -0.022); muzzle.position.set(0, 0.066, 0.19); fore.set(-0.01, -0.03, 0.0); pose = 'pistol'; mag.set(0, -0.08, -0.01);
      break;
    }
    case 8: { // リボルバー
      cyl(g, 0.017, 0.017, 0.22, m.steel, 0, 0.07, 0.16);
      cyl(g, 0.036, 0.036, 0.06, m.metal, 0, 0.055, 0.03, 'z', 10);
      box(g, 0.034, 0.05, 0.12, m.metal, 0, 0.05, 0.02);
      box(g, 0.036, 0.13, 0.05, m.wood, 0, -0.02, -0.04, [0.38, 0, 0]);
      torus(g, 0.02, 0.004, acc, 0, 0.07, 0.27);
      ironSights(g, m, color, 0.1, -0.03, 0.255, 0.075, { fbase: 0.085 });
      sight.set(0, 0.1, -0.03); muzzle.position.set(0, 0.07, 0.28); fore.set(-0.01, -0.03, -0.01); pose = 'pistol'; mag.set(0, 0.055, 0.03);
      break;
    }
    case 4: { // サブマシンガン
      box(g, 0.05, 0.075, 0.3, m.metal, 0, 0.05, 0.08);
      cyl(g, 0.013, 0.013, 0.12, m.steel, 0, 0.06, 0.28);
      box(g, 0.03, 0.16, 0.042, m.poly, 0, -0.06, 0.12);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.03, -0.02, [0.25, 0, 0]);
      box(g, 0.03, 0.04, 0.16, m.poly, 0, 0.04, -0.13);
      for (const sx of [-1, 1]) box(g, 0.006, 0.012, 0.22, acc, sx * 0.025, 0.06, 0.08);
      miniDot(g, m, color, 0.125, 0.06, 0.095);
      sight.set(0, 0.125, 0.064); muzzle.position.set(0, 0.06, 0.35); fore.set(0, -0.04, 0.17); mag.set(0, -0.1, 0.12);
      break;
    }
    case 6: { // アサルト
      box(g, 0.055, 0.085, 0.42, m.metal, 0, 0.05, 0.1);
      box(g, 0.05, 0.065, 0.22, m.poly, 0, 0.04, 0.36);
      cyl(g, 0.012, 0.012, 0.16, m.steel, 0, 0.055, 0.55);
      box(g, 0.035, 0.15, 0.05, m.poly, 0, -0.06, 0.12, [-0.25, 0, 0]);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.03, -0.02, [0.25, 0, 0]);
      box(g, 0.045, 0.09, 0.24, m.poly, 0, 0.03, -0.2);
      box(g, 0.058, 0.01, 0.3, acc, 0, 0.0, 0.18);
      reflexSight(g, m, color, 0.137, 0.1, { base: 0.092 });
      sight.set(0, 0.137, 0.1064); muzzle.position.set(0, 0.055, 0.64); fore.set(0, -0.0, 0.35); mag.set(0, -0.1, 0.12);
      break;
    }
    case 7: { // バースト（ブルパップ）
      box(g, 0.06, 0.1, 0.56, m.metal, 0, 0.05, 0.04);
      box(g, 0.025, 0.04, 0.3, m.poly, 0, 0.12, 0.08);
      cyl(g, 0.012, 0.012, 0.14, m.steel, 0, 0.06, 0.38);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.04, 0.04, [0.2, 0, 0]);
      box(g, 0.035, 0.13, 0.05, m.poly, 0, -0.04, -0.14);
      box(g, 0.062, 0.012, 0.44, acc, 0, 0.07, 0.04);
      box(g, 0.062, 0.012, 0.44, acc, 0, 0.02, 0.04);
      reflexSight(g, m, color, 0.175, 0.1, { base: 0.14, w: 0.046, h: 0.036, d: 0.04 });
      sight.set(0, 0.175, 0.108); muzzle.position.set(0, 0.06, 0.46); fore.set(0, -0.01, 0.22); mag.set(0, -0.08, -0.14);
      break;
    }
    case 9: { // LMG
      box(g, 0.075, 0.11, 0.46, m.metal, 0, 0.05, 0.08);
      cyl(g, 0.028, 0.028, 0.34, m.poly, 0, 0.065, 0.46, 'z', 10);
      cyl(g, 0.014, 0.014, 0.5, m.steel, 0, 0.065, 0.5);
      box(g, 0.09, 0.09, 0.12, m.metal, -0.01, -0.04, 0.12);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.04, -0.03, [0.25, 0, 0]);
      box(g, 0.05, 0.1, 0.24, m.poly, 0, 0.03, -0.24);
      for (const sx of [-1, 1]) box(g, 0.006, 0.014, 0.36, acc, sx * 0.0375, 0.075, 0.1);
      for (const s of [-1, 1]) cyl(g, 0.006, 0.006, 0.26, m.steel, s * 0.02, 0.0, 0.52, 'z', 6);
      reflexSight(g, m, color, 0.152, 0.13, { base: 0.116, w: 0.05, h: 0.036, style: 'dot', rs: 1.4 });
      sight.set(0, 0.152, 0.1364); muzzle.position.set(0, 0.065, 0.76); fore.set(0, -0.0, 0.3); mag.set(-0.01, -0.06, 0.12); pose = 'heavy';
      break;
    }
    case 3: { // スナイパー
      box(g, 0.05, 0.065, 0.5, m.metal, 0, 0.05, 0.12);
      cyl(g, 0.014, 0.012, 0.62, m.steel, 0, 0.06, 0.66);
      cyl(g, 0.028, 0.03, 0.3, m.poly, 0, 0.13, 0.12, 'z', 16);
      torus(g, 0.03, 0.006, acc, 0, 0.13, 0.27);
      box(g, 0.054, 0.054, 0.004, m.lens, 0, 0.13, 0.272);
      box(g, 0.036, 0.12, 0.05, m.wood, 0, -0.03, -0.04, [0.3, 0, 0]);
      box(g, 0.045, 0.11, 0.28, m.wood, 0, 0.02, -0.24);
      cyl(g, 0.008, 0.008, 0.06, m.steel, 0.04, 0.07, 0.02, 'x', 6);
      box(g, 0.03, 0.08, 0.05, m.poly, 0, -0.04, 0.12);
      box(g, 0.052, 0.008, 0.3, acc, 0, 0.02, 0.18);
      sight.set(0, 0.13, -0.05); muzzle.position.set(0, 0.06, 0.98); fore.set(0, -0.01, 0.4); mag.set(0, -0.06, 0.12);
      break;
    }
    case 5: { // ショットガン（二連）
      for (const s of [-1, 1]) cyl(g, 0.019, 0.019, 0.6, m.steel, s * 0.02, 0.07, 0.36);
      box(g, 0.07, 0.045, 0.28, m.wood, 0, 0.035, 0.32);
      box(g, 0.06, 0.07, 0.14, m.metal, 0, 0.05, 0.03);
      box(g, 0.04, 0.12, 0.05, m.wood, 0, -0.03, -0.04, [0.32, 0, 0]);
      box(g, 0.05, 0.11, 0.26, m.wood, 0, 0.01, -0.22, [0.05, 0, 0]);
      torus(g, 0.045, 0.006, acc, 0, 0.07, 0.6);
      box(g, 0.012, 0.008, 0.46, m.metal, 0, 0.092, 0.4);
      ironSights(g, m, color, 0.112, 0.02, 0.63, 0.085, { ring: true, fbase: 0.09, dot: '#ffb020' });
      sight.set(0, 0.112, 0.02); muzzle.position.set(0, 0.07, 0.67); fore.set(0, -0.0, 0.32); mag.set(0, 0.07, 0.08);
      break;
    }
    case 10: { // グレネードランチャー
      cyl(g, 0.065, 0.065, 0.12, m.metal, 0, 0.04, 0.12, 'z', 6);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cyl(g, 0.018, 0.018, 0.125, m.poly, Math.cos(a) * 0.04, 0.04 + Math.sin(a) * 0.04, 0.12, 'z', 8); }
      cyl(g, 0.036, 0.036, 0.3, m.metal, 0, 0.07, 0.34);
      torus(g, 0.04, 0.008, acc, 0, 0.07, 0.48);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.04, -0.01, [0.25, 0, 0]);
      box(g, 0.04, 0.09, 0.22, m.poly, 0, 0.02, -0.16);
      box(g, 0.035, 0.08, 0.04, m.poly, 0, -0.02, 0.3);
      ironSights(g, m, color, 0.13, 0.03, 0.46, 0.105, { ring: true, fbase: 0.104, dot: '#ff5577' });
      sight.set(0, 0.13, 0.03); muzzle.position.set(0, 0.07, 0.5); fore.set(0, -0.04, 0.3); mag.set(0, 0.04, 0.12); pose = 'heavy';
      break;
    }
    case 11: { // レールガン
      box(g, 0.06, 0.08, 0.3, m.metal, 0, 0.04, 0.0);
      for (const s of [-1, 1]) box(g, 0.016, 0.035, 0.66, m.steel, s * 0.032, 0.06, 0.36);
      for (let i = 0; i < 4; i++) { const t = torus(g, 0.05, 0.008, acc, 0, 0.06, 0.16 + i * 0.14); t.userData.coil = i; }
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.04, -0.03, [0.25, 0, 0]);
      box(g, 0.045, 0.1, 0.2, m.poly, 0, 0.02, -0.22);
      reflexSight(g, m, color, 0.122, 0.05, { base: 0.08, w: 0.044, h: 0.032, ret: '#7cf3ff' });
      sight.set(0, 0.122, 0.0564); muzzle.position.set(0, 0.06, 0.7); fore.set(0, -0.0, 0.26); mag.set(0, -0.06, 0.0);
      break;
    }
    case 16: { // フォーカスライフル
      box(g, 0.05, 0.07, 0.5, m.metal, 0, 0.05, 0.12);
      cyl(g, 0.016, 0.016, 0.3, m.steel, 0, 0.06, 0.5);
      for (let i = 0; i < 3; i++) { const t = torus(g, 0.035 - i * 0.006, 0.006, acc, 0, 0.06, 0.42 + i * 0.09); t.userData.lens = i; }
      // 輪の照準（後ろと前の輪を細い柱でつなぐ）
      box(g, 0.018, 0.018, 0.04, m.metal, 0, 0.093, 0.02); box(g, 0.018, 0.018, 0.04, m.metal, 0, 0.093, 0.17);
      for (const z of [0.02, 0.17]) { const r = torus(g, 0.024, 0.005, m.metal, 0, 0.13, z); r.scale.z = 2.2; r.castShadow = true; }
      for (const s of [-1, 1]) box(g, 0.004, 0.004, 0.15, m.steel, s * 0.024, 0.13, 0.095);
      torus(g, 0.0285, 0.0018, glow(color, 2.2), 0, 0.13, 0.17);
      { const gl = noShadow(new THREE.Mesh(new THREE.CircleGeometry(0.023, 32), glassMat(color))); gl.position.set(0, 0.13, 0.17); gl.renderOrder = 2; g.add(gl); }
      reticle(g, 'holo', '#7cf3ff', 0, 0.13, 0.1695, 1.2);
      box(g, 0.036, 0.11, 0.05, m.poly, 0, -0.04, -0.03, [0.25, 0, 0]);
      box(g, 0.045, 0.1, 0.24, m.poly, 0, 0.03, -0.22);
      for (const sx of [-1, 1]) box(g, 0.007, 0.01, 0.4, acc, sx * 0.022, 0.088, 0.12);
      sight.set(0, 0.13, 0.17); muzzle.position.set(0, 0.06, 0.66); fore.set(0, -0.01, 0.32); mag.set(0, -0.06, 0.1);
      break;
    }
    case 1: { // ナイフ（右手で逆手に近く持つ）
      box(g, 0.026, 0.026, 0.11, m.poly, 0, 0, 0.0);
      box(g, 0.05, 0.012, 0.02, m.steel, 0, 0, 0.06);
      const bl = box(g, 0.008, 0.032, 0.2, m.blade, 0, 0.004, 0.17); bl.scale.set(1, 1, 1);
      box(g, 0.009, 0.004, 0.18, acc, 0, -0.012, 0.16);
      sight = null; muzzle.position.set(0, 0, 0.27); fore = null; pose = 'knife';
      break;
    }
    case 12: { // ナックル（両手）
      for (let i = 0; i < 4; i++) torus(g, 0.014, 0.006, m.gold, 0, 0.0, -0.025 + i * 0.018).rotation.y = Math.PI / 2;
      box(g, 0.04, 0.02, 0.08, m.gold, 0, -0.02, 0);
      box(g, 0.042, 0.006, 0.06, acc, 0, -0.03, 0);
      sight = null; muzzle.position.set(0, 0, 0.06); fore = null; pose = 'fist';
      break;
    }
    case 13: { // 槍
      cyl(g, 0.017, 0.017, 1.9, m.wood, 0, 0, 0.55, 'z', 10);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 4), m.blade); tip.rotation.x = Math.PI / 2; tip.position.set(0, 0, 1.66); tip.scale.set(1, 1, 0.35); tip.castShadow = true; g.add(tip);
      torus(g, 0.028, 0.008, acc, 0, 0, 1.48); torus(g, 0.024, 0.006, m.gold, 0, 0, 1.45);
      box(g, 0.01, 0.01, 0.3, acc, 0, 0.0, 1.62);
      sight = null; muzzle.position.set(0, 0, 1.82); fore.set(0, 0, 0.55); pose = 'spear';
      break;
    }
    case 14: { // ウォーハンマー
      cyl(g, 0.022, 0.022, 1.0, m.wood, 0, 0, 0.38, 'z', 10);
      box(g, 0.17, 0.17, 0.3, m.metal, 0, 0, 0.88, [0, 0, 0]).rotation.y = Math.PI / 2;
      box(g, 0.18, 0.04, 0.31, acc, 0, 0, 0.88).rotation.y = Math.PI / 2;
      for (const s of [-1, 1]) box(g, 0.19, 0.19, 0.05, m.steel, s * 0.15, 0, 0.88).rotation.y = Math.PI / 2;
      torus(g, 0.03, 0.008, m.gold, 0, 0, 0.0);
      sight = null; muzzle.position.set(0, 0, 0.9); fore.set(0, 0, 0.32); pose = 'hammer';
      break;
    }
    default: box(g, 0.05, 0.08, 0.4, m.metal, 0, 0.05, 0.1); muzzle.position.set(0, 0.05, 0.32);
  }
  g.add(muzzle);
  mergeParts(g);
  const optic = [4, 6, 7, 9, 11, 16].includes(id);   // 窓に光る照準がある（覗いたら画面の十字は消す）
  // 覗いたときの目と照準の距離（一人称の手元。台尻が目の後ろに来るように）
  const adsD = { 2: 0.3, 8: 0.3, 4: 0.13, 6: 0.17, 7: 0.16, 9: 0.2, 11: 0.155, 16: 0.2, 5: 0.11, 10: 0.13 }[id] || 0.2;
  return { g, muzzle, fore, pose, mag, acc, sight, optic, adsD };
}

// 動かない部品を材質ごとにまとめる
function mergeParts(g) {
  const byMat = new Map();
  for (const c of g.children.slice()) {
    if (!c.isMesh || c.userData.coil != null || c.userData.lens != null) continue;
    c.updateMatrix();
    const geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    geo.applyMatrix4(c.matrix);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(geo);
    g.remove(c); c.geometry.dispose();
  }
  for (const [mat, list] of byMat) {
    const m = new THREE.Mesh(list.length === 1 ? list[0] : mergeGeometries(list, false), mat);
    // ガラスと照準は影を落とさず、不透明な部品のあとに描く
    if (mat.transparent) { m.castShadow = false; m.renderOrder = mat.isMeshBasicMaterial ? 3 : 2; } else m.castShadow = true;
    g.add(m);
  }
}

// アイコン用：武器のモデルを横から見た絵にする
export function weaponIconScene(id, color) {
  const sc = new THREE.Scene();
  const w = buildWeapon(id, color);
  const box3 = new THREE.Box3().setFromObject(w.g), c = box3.getCenter(new THREE.Vector3()), s = box3.getSize(new THREE.Vector3());
  w.g.position.sub(c);
  const holder = new THREE.Group(); holder.add(w.g); holder.rotation.y = -Math.PI / 2; holder.rotation.z = 0.08;
  sc.add(holder);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x404050, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 3); d.position.set(1, 2, 2); sc.add(d);
  const r = new THREE.DirectionalLight(new THREE.Color(color), 2.5); r.position.set(-2, 0.5, -1); sc.add(r);
  const L = Math.max(s.z, s.y * 2.4, 0.2);
  const cam = new THREE.OrthographicCamera(-L * 0.56, L * 0.56, L * 0.28, -L * 0.28, 0.01, 10);
  cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0);
  return { sc, cam };
}
