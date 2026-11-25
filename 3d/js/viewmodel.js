// 一人称の手元（ビューモデル）：腕と武器を、世界とは別の場面・別のカメラで描く（壁にめりこまない・ゆがまない）
// 動きはすべてばね（ゆれ・反動・着地・歩くゆれ・覗き込み）と、リロード・持ち替え・近接の手続きアニメーション
import * as THREE from '../lib/three.js';
import { RoundedBoxGeometry } from '../lib/three.js';
import { buildWeapon } from './weapons3d.js';
import { WEAPONS, SKILLS, SWAP_TIME, clamp } from './data.js';

// 減衰するばね（x を t に戻す）。v に勢いを足すと「けられた」動きになる
class Spring {
  constructor(k = 160, c = 20) { this.x = 0; this.v = 0; this.k = k; this.c = c; this.t = 0; }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) { const a = -this.k * (this.x - this.t) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
    return this.x;
  }
  kick(v) { this.v += v; }
  reset() { this.x = this.v = 0; }
}

// 構え方ごとの「腰だめ」の位置（カメラの空間。前＝-Z）と回し（x＝銃口が上、y＝左、z＝傾き）
const HIP = {
  rifle:  { p: [0.12, -0.125, -0.28], r: [0.025, 0.045, -0.025], ads: 0.26 },
  pistol: { p: [0.1, -0.11, -0.31],   r: [0.02, 0.05, 0.0], ads: 0.32 },
  heavy:  { p: [0.13, -0.15, -0.27],  r: [0.02, 0.05, -0.04], ads: 0.27 },
  knife:  { p: [0.15, -0.13, -0.3],   r: [0.6, 0.3, -0.35] },
  fist:   { p: [0.17, -0.2, -0.36],   r: [0.0, 0.0, 0.0] },
  spear:  { p: [0.15, -0.21, -0.12],  r: [0.12, 0.06, 0.0] },
  hammer: { p: [0.2, -0.22, -0.28],   r: [1.3, -0.3, -0.45] },
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

function ik2(A, T, l1, l2, pole, J, E) {
  _a.subVectors(T, A);
  let d = _a.length();
  if (d < 1e-5) { _a.set(0, -1, 0); d = 1e-5; }
  _a.divideScalar(d);
  d = Math.min(l1 + l2 - 0.001, Math.max(Math.abs(l1 - l2) + 0.01, d));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, -1, 0);
  _b.normalize();
  J.copy(A).addScaledVector(_a, a).addScaledVector(_b, h);
  E.copy(A).addScaledVector(_a, d);
}
function placeSeg(mesh, P, Q) {
  _c.subVectors(Q, P); const L = _c.length();
  mesh.position.addVectors(P, Q).multiplyScalar(0.5);
  if (L > 1e-5) mesh.quaternion.setFromUnitVectors(Y, _c.divideScalar(L));
}
const ease = (k) => k * k * (3 - 2 * k);

function flashTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.18, 'rgba(255,220,150,0.9)'); gr.addColorStop(0.5, 'rgba(255,150,60,0.25)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,230,180,0.85)';
  for (let i = 0; i < 6; i++) { g.save(); g.translate(64, 64); g.rotate(i / 6 * Math.PI * 2 + 0.3); g.beginPath(); g.moveTo(0, -4); g.lineTo(60, 0); g.lineTo(0, 4); g.fill(); g.restore(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 20);
    this.scene.add(this.cam);
    this.root = new THREE.Group(); this.cam.add(this.root);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.amb = new THREE.HemisphereLight(0xbfcbe8, 0x3a3228, 0.35); this.scene.add(this.amb);
    this.flashLight = new THREE.PointLight(0xffc880, 0, 2.5, 2); this.root.add(this.flashLight);
    // 武器は実物より小さく見せる（画面をふさがないように）
    this.scale = 0.6;
    this.pivot = new THREE.Group(); this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.inner.scale.setScalar(this.scale); this.inner.updateMatrix();
    this.pivot.add(this.inner); this.root.add(this.pivot);
    this.weapons = {}; this.cur = null; this.wid = 0; this.knL = null;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.8, 1.3) }));
    this.flash.visible = false; this.flashT = 0; this.root.add(this.flash);
    // ばね
    this.sw = { x: new Spring(120, 16), y: new Spring(120, 16), rx: new Spring(140, 18), ry: new Spring(140, 18), rz: new Spring(110, 15) };
    this.rc = { z: new Spring(240, 24), rx: new Spring(220, 22), ry: new Spring(200, 22), y: new Spring(200, 22) };
    this.land = new Spring(150, 15);
    this.bob = 0; this.bobK = 0; this.time = 0; this.shadowK = 1; this.swapK = 1; this.lastSlot = -1; this.lastW = 0;
    this.arm = null; this.colors = null;
  }

  // 腕（チームの色の袖と手袋）。手は手のひら・曲げた指・親指で、にぎっている形
  setColors(colors) {
    if (this.colors === colors) return;
    this.colors = colors;
    if (this.arm) for (const a of Object.values(this.arm)) for (const k of ['up', 'fo', 'hand', 'cuff', 'elbow']) { this.root.remove(a[k]); a[k].traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    const sleeve = new THREE.MeshStandardMaterial({ color: colors.main, roughness: 0.62, metalness: 0.04 });
    const sleeve2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.main).multiplyScalar(0.55), roughness: 0.66 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.58, metalness: 0.12 });
    const pad = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.7, metalness: 0.05 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(colors.glow), emissiveIntensity: 1.4, roughness: 0.4 });
    this.arm = {};
    for (const side of ['L', 'R']) {
      const sg = side === 'R' ? 1 : -1;
      const up = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.36, 4, 14), sleeve);
      const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.031, 1, 16, 1, true), sleeve2);   // 手首に向かって細く（長さは毎フレーム合わせる）
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), sleeve2);
      // 手：原点＝手首、+Z＝指の向き、+Y＝手の甲
      const hand = new THREE.Group();
      const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); hand.add(m); return m; };
      add(new RoundedBoxGeometry(0.05, 0.024, 0.058, 2, 0.01), glove, 0, 0, 0.032);
      add(new RoundedBoxGeometry(0.046, 0.007, 0.03, 1, 0.003), pad, 0, 0.012, 0.03);   // 手の甲の板
      add(new RoundedBoxGeometry(0.03, 0.0035, 0.008, 1, 0.0015), glow, 0, 0.0165, 0.03);
      const fing = new THREE.Group(); fing.position.set(0, -0.004, 0.058); hand.add(fing);   // 指（つけ根で曲げる）
      const f1 = new THREE.Mesh(new RoundedBoxGeometry(0.048, 0.019, 0.03, 2, 0.008), glove); f1.position.set(0, 0, 0.012); fing.add(f1);
      const fj = new THREE.Group(); fj.position.set(0, 0, 0.026); fing.add(fj);
      const f2 = new THREE.Mesh(new RoundedBoxGeometry(0.046, 0.017, 0.026, 2, 0.007), glove); f2.position.set(0, 0, 0.01); fj.add(f2);
      const th = new THREE.Group(); th.position.set(0.022 * sg, -0.008, 0.014); hand.add(th);   // 親指
      const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.03, 3, 8), glove); t1.rotation.x = Math.PI / 2; t1.position.z = 0.02; th.add(t1);
      th.rotation.set(0.55, 0.42 * sg, 0);
      const cuff = new THREE.Group();
      const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.03, 0.034, 16), glove); c1.rotation.x = Math.PI / 2; cuff.add(c1);
      const c2 = new THREE.Mesh(new THREE.TorusGeometry(0.0295, 0.0028, 6, 24), glow); c2.position.z = -0.012; cuff.add(c2);
      hand.scale.setScalar(0.9); cuff.scale.setScalar(0.92);
      for (const m of [up, fo, elbow, hand, cuff]) { m.traverse(o => { if (o.isMesh) o.renderOrder = 2; }); this.root.add(m); }
      this.arm[side] = { up, fo, elbow, hand, cuff, fing, fj, th, sg, sh: new THREE.Vector3(side === 'R' ? 0.25 : -0.23, -0.58, 0.1), el: new THREE.Vector3(), wr: new THREE.Vector3(), target: new THREE.Vector3(), grip: new THREE.Vector3(), back: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), curl: 1.2, fist: 0 };
    }
  }

  setWeapon(id) {
    if (this.wid === id) return;
    if (this.cur) this.inner.remove(this.cur.g);
    if (this.knL) { this.root.remove(this.knL); this.knL = null; }
    let w = this.weapons[id];
    if (!w) {
      w = this.weapons[id] = buildWeapon(id, WEAPONS[id].color);
      // 目の前なので光る部品は弱めにする（まぶしくならないように）
      const swap = new Map();
      w.g.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = false; if (!o.material.transparent) o.renderOrder = 1;
        const mt = o.material;
        if (mt.emissive && mt.emissiveIntensity >= 1 && !mt.transparent) { let c = swap.get(mt); if (!c) { c = mt.clone(); c.emissiveIntensity *= 0.5; swap.set(mt, c); } o.material = c; }
      });
      if (swap.has(w.acc)) w.acc = swap.get(w.acc);
    }
    this.cur = w; this.wid = id;
    this.inner.add(w.g);
    if (w.pose === 'fist') { this.knL = w.g.clone(); this.knL.scale.setScalar(this.scale); this.root.add(this.knL); }
  }

  // 撃った：反動のばねをける
  onShot(W) {
    const k = W.recoil || 1, ads = this.adsK || 0;
    this.rc.z.kick(0.35 + k * 0.22);
    this.rc.rx.kick((0.8 + k * 0.9) * (1 - ads * 0.55));
    this.rc.ry.kick((Math.random() - 0.5) * (0.4 + k * 0.25));
    this.rc.y.kick(0.08 * k * (1 - ads * 0.6));
    if (W.kind !== 'melee') { this.flashT = 0.045; this.flash.material.rotation = Math.random() * 6.28; const s = 0.07 + Math.min(0.09, k * 0.014) + Math.random() * 0.03; this.flash.scale.set(s, s, s); this.flashLight.intensity = 6 + k * 1.5; }
  }
  onLand(k) { this.land.kick(-0.9 * k); }
  onJump() { this.land.kick(0.35); }

  // 世界の太陽の向きと色に合わせる（影の中なら暗く）
  light(arena, inShadow, dt) {
    if (!arena) return;
    const s = arena.sun;
    this.sun.color.copy(s.color);
    this.shadowK += ((inShadow ? 0.35 : 1) - this.shadowK) * Math.min(1, dt * 6);
    this.sun.intensity = s.intensity * this.shadowK;
    this.sun.position.copy(s.position).normalize().multiplyScalar(10); this.sun.target.position.set(0, 0, 0);
  }

  // 毎フレーム。f＝自分、look＝この1フレームで回した角度（dyaw, dpitch）、worldCam＝世界のカメラ
  update(dt, f, look, worldCam, opt) {
    this.time += dt;
    const show = opt.show && f.alive;
    this.root.visible = show;
    this.cam.quaternion.copy(worldCam.quaternion);
    this.cam.aspect = worldCam.aspect;
    if (!show) return;
    const W = WEAPONS[f.loadout[f.slot]];
    this.setColors(f.colors);
    if (f.loadout[f.slot] !== this.wid) this.setWeapon(f.loadout[f.slot]);
    const w = this.cur, pose = w.pose, H = HIP[pose] || HIP.rifle;
    const ads = this.adsK = (W.kind !== 'melee' && w.sight) ? f.adsK : 0;
    this.scene.environment = opt.env; this.scene.environmentIntensity = opt.envK;
    // ばねを進める
    const sw = this.sw, rc = this.rc;
    const lk = 1 - ads * 0.7;
    sw.x.kick(clamp(look.dyaw, -0.2, 0.2) * 2.2 * lk); sw.y.kick(-clamp(look.dpitch, -0.2, 0.2) * 2.2 * lk);
    sw.rz.kick(clamp(look.dyaw, -0.2, 0.2) * 5 * lk); sw.ry.kick(clamp(look.dyaw, -0.2, 0.2) * 3 * lk); sw.rx.kick(-clamp(look.dpitch, -0.2, 0.2) * 3 * lk);
    for (const s of Object.values(sw)) s.step(dt);
    for (const s of Object.values(rc)) s.step(dt);
    this.land.step(dt);
    // 歩くゆれ（足音と同じ速さ）
    const sp = Math.hypot(f.vel[0], f.vel[2]);
    const want = f.onGround && sp > 0.5 ? Math.min(1, sp / 6.6) : 0;
    this.bobK += (want - this.bobK) * Math.min(1, dt * 8);
    this.bob += dt * sp / 1.3 * Math.PI;
    const bk = this.bobK * (1 - ads * 0.85) * (f.crouching ? 0.6 : 1) * (opt.bob ? 1 : 0.35);
    const breath = (1 - ads * 0.8);
    // 腰だめ → 覗く
    let px = H.p[0], py = H.p[1], pz = H.p[2], rx = H.r[0], ry = H.r[1], rz = H.r[2];
    if (ads > 0 && w.sight) {
      const d = w.adsD || H.ads || 0.3;
      _d.copy(w.sight).applyMatrix4(this.inner.matrix);   // 照準の点（持ち手からの位置。向き・大きさ込み）
      const ax = -_d.x, ay = -_d.y, az = -d - _d.z;   // 照準の点がカメラの真ん中に来る位置
      px += (ax - px) * ease(ads); py += (ay - py) * ease(ads); pz += (az - pz) * ease(ads);
      rx *= 1 - ads; ry *= 1 - ads; rz *= 1 - ads;
    }
    // していること
    const S = SKILLS;
    if (f.swapT > 0) { const k = ease(clamp(1 - f.swapT / SWAP_TIME, 0, 1)); py -= 0.3 * (1 - k); rx -= 0.7 * (1 - k); rz += 0.3 * (1 - k); }
    if (f.reloadT > 0 && W.reload) {
      const k = clamp(1 - f.reloadT / W.reload, 0, 1), s = Math.sin(k * Math.PI);
      rz += 0.55 * s; rx -= 0.32 * s; py -= 0.06 * s; px -= 0.04 * s;
      if (k > 0.55 && k < 0.7) py += Math.sin((k - 0.55) / 0.15 * Math.PI) * 0.015;   // 弾倉を押しこむ
    }
    let charge = 0;
    if (f.chargeT > 0) charge = 1 - f.chargeT / (W.charge || 1);
    else if (f.focusT >= 0) charge = Math.min(1, f.focusT / (W.full || 1));
    if (charge > 0) { const tr = 0.0025 * charge; px += (Math.random() - 0.5) * tr; py += (Math.random() - 0.5) * tr; pz += 0.012 * charge; }
    let mk = -1;
    if (f.meleeT >= 0) mk = clamp(f.meleeT / Math.max(W.rate, W.wind + 0.12), 0, 1);
    let fistR = 0, fistL = 0;
    if (mk >= 0) {
      if (pose === 'knife') {
        const s = Math.sin(Math.min(1, mk * 1.3) * Math.PI), dir = f.meleeAlt ? 1 : -1;
        px -= 0.26 * s * (dir > 0 ? 1 : 0.4); pz -= 0.14 * s; py += 0.05 * s;
        ry += 0.9 * s * dir; rz -= 0.6 * s * dir; rx -= 0.35 * s;
      } else if (pose === 'fist') {
        const s = Math.sin(Math.min(1, mk * 1.6) * Math.PI);
        if (f.meleeAlt) fistL = s; else fistR = s;
      } else if (pose === 'spear') {
        const back = mk < 0.3 ? ease(mk / 0.3) : Math.max(0, 1 - (mk - 0.3) * 4), fwd = mk < 0.3 ? 0 : Math.sin(Math.min(1, (mk - 0.3) / 0.4) * Math.PI);
        pz += back * 0.12 - fwd * 0.46; py += fwd * 0.05; px -= fwd * 0.05;
      } else if (pose === 'hammer') {
        // 肩にかついだ所から、後ろへ振りかぶって、真ん中へ振り下ろす
        let a = 0, b = 0;
        if (mk < 0.35) { const u = ease(mk / 0.35); a = 0.7 * u; py += 0.08 * u; pz += 0.05 * u; }
        else if (mk < 0.55) { const u = ease((mk - 0.35) / 0.2); a = 0.7 - 2.4 * u; b = u; py += 0.08 - 0.26 * u; pz -= 0.12 * u; px -= 0.1 * u; }
        else { const u = ease((mk - 0.55) / 0.45); a = -1.7 * (1 - u); b = 1 - u; py -= 0.18 * (1 - u); pz -= 0.12 * (1 - u); px -= 0.1 * (1 - u); }
        rx += a; ry += 0.5 * b; rz += 0.45 * b;
      }
    }
    if (f.rollT > 0) { const k = Math.sin((1 - f.rollT / S.roll.dur) * Math.PI); py -= 0.12 * k; rz += 0.7 * k; rx -= 0.3 * k; }
    if (f.parryT > 0) { py += 0.05; rz += 1.0; ry += 0.45; px -= 0.06; }
    if (f.crouching) { py -= 0.015; rz -= 0.04; }
    if (f.act && f.act.type === 'heal') { const s = Math.sin(f.act.k * Math.PI); py -= 0.06 * s; }
    // ばね・ゆれを足す
    px += sw.x.x + Math.sin(this.bob) * 0.012 * bk;
    py += sw.y.x - Math.abs(Math.cos(this.bob)) * 0.014 * bk + this.land.x * 0.05 + Math.sin(this.time * 1.7) * 0.002 * breath - rc.y.x * 0.02;
    pz += rc.z.x * 0.05;
    rx += sw.rx.x * 0.5 + rc.rx.x * 0.05 + Math.sin(this.time * 1.1) * 0.004 * breath;
    ry += sw.ry.x * 0.5 + rc.ry.x * 0.05;
    rz += sw.rz.x * 0.5 + Math.sin(this.bob) * 0.012 * bk;
    this.pivot.position.set(px, py, pz);
    this.pivot.rotation.set(rx, ry, rz);
    this.pivot.updateMatrix(); this.inner.updateMatrix();
    // 手の位置（武器の空間 → カメラの空間）。grip＝にぎる所、back＝手の甲の向き
    const R = this.arm.R, L = this.arm.L, PM = this.pivot.matrix.elements;
    const gx = _a.set(PM[0], PM[1], PM[2]).normalize(), gy = _b.set(PM[4], PM[5], PM[6]).normalize();
    if (pose === 'fist') {
      const bb = Math.sin(this.bob) * 0.008 * bk, fy = -0.13 + sw.y.x - Math.abs(Math.cos(this.bob)) * 0.01 * bk + this.land.x * 0.04;
      R.grip.set(0.14 - fistR * 0.07 + sw.x.x + bb, fy + fistR * 0.05, -0.3 - fistR * 0.26 + rc.z.x * 0.02);
      L.grip.set(-0.14 + fistL * 0.07 + sw.x.x + bb, fy + fistL * 0.05 - 0.005, -0.29 - fistL * 0.26);
      w.g.position.set(0, 0, 0); this.pivot.position.copy(R.grip); this.pivot.rotation.set(0.05, 0, 0); this.pivot.updateMatrix();
      if (this.knL) { this.knL.position.copy(L.grip); this.knL.rotation.set(0.05, Math.PI, 0); }
      R.back.set(0.25, 1, 0.1); L.back.set(-0.25, 1, 0.1);
      R.curl = L.curl = 1.75;
    } else {
      R.grip.set(0, -0.035, -0.005).applyMatrix4(this.inner.matrix).applyMatrix4(this.pivot.matrix);
      if (w.fore) L.grip.copy(w.fore).add(_c.set(0, -0.006, 0)).applyMatrix4(this.inner.matrix).applyMatrix4(this.pivot.matrix);
      else L.grip.set(-0.2, -0.42, -0.2);
      // 手の甲：右手は外（右）と少し上、左手は下と外（手のひらで下から支える）
      R.back.copy(gx).multiplyScalar(0.85).addScaledVector(gy, 0.35);
      L.back.copy(gy).multiplyScalar(-0.85).addScaledVector(gx, -0.45);
      R.curl = 1.45; L.curl = pose === 'pistol' ? 1.3 : 1.15;
      if (pose === 'pistol') { L.grip.copy(R.grip).addScaledVector(gx, -0.022).addScaledVector(gy, -0.012); L.back.copy(gx).multiplyScalar(-0.9).addScaledVector(gy, -0.3); }   // 両手でにぎる
      if (pose === 'knife') { R.back.copy(gx).multiplyScalar(0.5).addScaledVector(gy, 0.8); R.curl = 1.7; }
      if (pose === 'spear' || pose === 'hammer') { R.back.copy(gx).multiplyScalar(0.8).addScaledVector(gy, -0.4); L.back.copy(gx).multiplyScalar(-0.8).addScaledVector(gy, -0.4); R.curl = L.curl = 1.6; }
      if (f.reloadT > 0 && W.reload && w.mag) {
        const k = clamp(1 - f.reloadT / W.reload, 0, 1);
        if (k > 0.12 && k < 0.78) { const u = Math.sin((k - 0.12) / 0.66 * Math.PI); _d.copy(w.mag).applyMatrix4(this.inner.matrix).applyMatrix4(this.pivot.matrix); _d.y -= 0.06 * Math.sin((k - 0.12) / 0.66 * Math.PI * 2); L.grip.lerp(_d, u); L.curl += (0.7 - L.curl) * u; }
      }
      if (!w.fore && pose !== 'pistol') L.curl = 0.9;
      if (f.act && f.act.type === 'heal') { const s = Math.sin(f.act.k * Math.PI); L.grip.lerp(_d.set(-0.05, -0.2, -0.26), s); L.back.lerp(_c.set(0, 0, 1), s); L.curl += (0.4 - L.curl) * s; }
    }
    this.solveArm(R, _d.set(0.9, -1, 0.25));
    this.solveArm(L, _d.set(-0.9, -1, 0.25));
    // 武器の部品の動き（レールガンの輪・フォーカスのレンズ）
    w.g.children.forEach(c => {
      if (c.userData.coil != null) { c.rotation.z = this.time * (2 + charge * 30) + c.userData.coil; c.scale.setScalar(1 + charge * 0.25 * Math.sin(this.time * 40 + c.userData.coil)); }
      if (c.userData.lens != null) c.rotation.z = this.time * (1 + charge * 10) * (c.userData.lens % 2 ? -1 : 1);
    });
    if (w.acc) w.acc.emissiveIntensity = 0.6 + charge * 4;
    // 銃口の光
    this.flashT -= dt;
    const mz = this.muzzleCam(_b);
    this.flash.visible = this.flashT > 0;
    this.flash.position.copy(mz);
    this.flashLight.position.copy(mz);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    // 画角（覗くと少し寄る）
    const fov = 58 - ads * 10;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; }
    this.cam.updateProjectionMatrix();
  }

  // 腕：手のひらの真ん中が grip に来るよう手首の位置を決め、2本の骨で肩から届かせる
  solveArm(A, pole) {
    for (let it = 0; it < 2; it++) {
      A.target.copy(A.grip).addScaledVector(A.dir, -0.031).addScaledVector(_c.copy(A.back).normalize(), 0.016);
      ik2(A.sh, A.target, 0.46, 0.4, pole, A.el, A.wr);
      _c.subVectors(A.wr, A.el); const L = _c.length(); if (L > 1e-5) A.dir.copy(_c).divideScalar(L);
    }
    placeSeg(A.up, A.sh, A.el);
    placeSeg(A.fo, A.el, _e.copy(A.wr).addScaledVector(A.dir, -0.012)); A.fo.scale.set(1, A.el.distanceTo(A.wr) - 0.012, 1);
    A.elbow.position.copy(A.el);
    // 手の向き：+Z＝腕の向き、+Y＝手の甲
    const z = A.dir, y = _a.copy(A.back).addScaledVector(z, -A.back.dot(z));
    if (y.lengthSq() < 1e-6) y.set(0, 1, 0); y.normalize();
    const x = _b.crossVectors(y, z);
    _m.makeBasis(x, y, z);
    A.hand.position.copy(A.wr); A.hand.quaternion.setFromRotationMatrix(_m);
    A.cuff.position.copy(A.wr).addScaledVector(z, -0.006); A.cuff.quaternion.copy(A.hand.quaternion);
    A.fing.rotation.x = A.curl * 0.55; A.fj.rotation.x = A.curl * 0.75;
  }

  // 銃口の場所（カメラの空間）
  muzzleCam(out) {
    if (!this.cur) return out.set(0.15, -0.15, -0.6);
    out.copy(this.cur.muzzle.position).applyMatrix4(this.inner.matrix).applyMatrix4(this.pivot.matrix);
    return out;
  }
  // 銃口が画面に見える場所の、世界での位置（弾の光跡はここから出す）
  muzzleWorld(worldCam, out) {
    // 手元のカメラで画面の位置（NDC）にし、世界のカメラでその方向へ 0.8m の点にする
    const ndc = this.muzzleCam(_a).applyMatrix4(this.cam.projectionMatrix);
    ndc.z = 0.5;
    out.copy(ndc).unproject(worldCam).sub(worldCam.position).normalize().multiplyScalar(0.8).add(worldCam.position);
    return out;
  }
}
