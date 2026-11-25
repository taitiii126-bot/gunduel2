// キャラクターの3Dモデル：部品を組み立て、毎フレーム手続きで動かす（走り・しゃがみ・ジャンプ・ロール・撃つ・近接・リロード・持ち替え・回復・やられ）
// 腕と脚は2本の骨の IK（関節の位置を計算）。武器の位置を先に決め、手がそこへ届くように腕を曲げる
import * as THREE from '../lib/three.js';
import { RoundedBoxGeometry, mergeGeometries } from '../lib/three.js';
import { buildWeapon } from './weapons3d.js';
import { TEX } from './textures.js';
import { U } from './arena-common.js';
import { WEAPONS } from './data.js';

const Y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

// キャラクター用の材質：輪郭の光（リム）・撃たれたときの白い光・やられたときに溶けて消える
function fighterMat(params, uni) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHit = uni.uHit; sh.uniforms.uDis = uni.uDis; sh.uniforms.uRim = uni.uRim; sh.uniforms.uRimK = uni.uRimK; sh.uniforms.uEdge = uni.uEdge; sh.uniforms.uGhost = uni.uGhost;
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `uniform float uHit, uDis, uRimK, uGhost; uniform vec3 uRim, uEdge; varying vec3 vWP;
      float dh(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float dn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(dh(i),dh(i+vec3(1,0,0)),f.x),mix(dh(i+vec3(0,1,0)),dh(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(dh(i+vec3(0,0,1)),dh(i+vec3(1,0,1)),f.x),mix(dh(i+vec3(0,1,1)),dh(i+vec3(1,1,1)),f.x),f.y),f.z); }
      ` + sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dnoise = dn(vWP * 9.0) * 0.6 + dn(vWP * 23.0) * 0.4;
        if (uDis > 0.0 && dnoise < uDis) discard;
        if (uGhost > 0.0 && fract(gl_FragCoord.y * 0.25) < 0.5 * uGhost) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.5);
        totalEmissiveRadiance += uRim * fres * uRimK + vec3(uHit * 0.55, uHit * 0.4, uHit * 0.4);
        if (uDis > 0.0 && dnoise < uDis + 0.07) totalEmissiveRadiance += uEdge * 5.0;
        if (uGhost > 0.0) totalEmissiveRadiance += uRim * 1.2 * uGhost;`);
  };
  m.customProgramCacheKey = () => 'fighterMat3';
  return m;
}

// 2本の骨の IK：A から T へ、長さ l1・l2、曲げる向き pole。関節の位置を J に入れる
function ik2(A, T, l1, l2, pole, J, E) {
  _a.subVectors(T, A);
  let d = _a.length();
  const dmax = l1 + l2 - 0.001, dmin = Math.abs(l1 - l2) + 0.01;
  if (d < 1e-5) { _a.set(0, -1, 0); d = 1e-5; }
  _a.divideScalar(d);
  d = Math.min(dmax, Math.max(dmin, d));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-6) _b.set(0, 0, 1);
  _b.normalize();
  J.copy(A).addScaledVector(_a, a).addScaledVector(_b, h);
  if (E) E.copy(A).addScaledVector(_a, d);
}
function placeSeg(mesh, P, Q) {
  _c.subVectors(Q, P);
  const L = _c.length();
  mesh.position.addVectors(P, Q).multiplyScalar(0.5);
  if (L > 1e-5) mesh.quaternion.setFromUnitVectors(Y, _c.divideScalar(L));
}


function wrap(a) { a %= Math.PI * 2; if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// ばね（o[x] を tgt へ、速さ o[v]）
function stepSpring(o, x, v, tgt, k, c, dt) { const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n; for (let i = 0; i < n; i++) { o[v] += (-k * (o[x] - tgt) - c * o[v]) * h; o[x] += o[v] * h; } }

// 部品の形を、骨の空間に置いて焼きこむ
function partGeo(geo, pos, rot, scl) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...(pos || [0, 0, 0])), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new THREE.Vector3(...(scl || [1, 1, 1])));
  g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
const CAP = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);
const RB = (w, h, d, rad) => new RoundedBoxGeometry(w, h, d, 3, rad != null ? rad : Math.min(w, h, d) * 0.3);
const SPH = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

export class FighterModel {
  constructor(o) {
    this.o = o;
    const uni = this.uni = { uHit: { value: 0 }, uDis: { value: 0 }, uRim: { value: new THREE.Color(o.colors.glow) }, uRimK: { value: 0.22 }, uEdge: { value: new THREE.Color(o.colors.glow) }, uGhost: { value: 0 } };
    const C = o.colors;
    const mat = this.mats = {
      skin: fighterMat({ color: o.skin, roughness: 0.62 }, uni),
      hair: fighterMat({ color: o.hair, roughness: 0.55 }, uni),
      jacket: fighterMat({ color: C.main, roughness: 0.55, metalness: 0.05 }, uni),
      jacketDark: fighterMat({ color: new THREE.Color(C.main).multiplyScalar(0.45), roughness: 0.6 }, uni),
      pants: fighterMat({ color: new THREE.Color(C.dark).lerp(new THREE.Color(0x22252c), 0.5), roughness: 0.75 }, uni),
      boots: fighterMat({ color: 0x17171b, roughness: 0.45, metalness: 0.3 }, uni),
      gear: fighterMat({ color: 0x23262e, roughness: 0.4, metalness: 0.7 }, uni),
      glow: fighterMat({ color: 0x050505, emissive: new THREE.Color(C.glow), emissiveIntensity: 2.4, roughness: 0.4 }, uni),
      eye: fighterMat({ color: 0x0a0a10, roughness: 0.2, emissive: new THREE.Color(o.eye || '#2B1B14'), emissiveIntensity: 0.25 }, uni),
      accent: fighterMat({ color: o.accent || '#E8B730', roughness: 0.35, metalness: 0.6 }, uni),
      white: fighterMat({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.3 }, uni),
      scarf: fighterMat({ color: C.light, roughness: 0.7, side: THREE.DoubleSide }, uni),
    };
    // 骨（ここを動かすと、まとめた1つの形が一緒に動く）。部品は骨ごとの空間で作る
    const bones = [], parts = [];
    const bone = (name, parent) => { const b = new THREE.Bone(); b.name = name; if (parent) parent.add(b); bones.push(b); return b; };
    const part = (b, geo, m, pos, rot, scl) => parts.push({ i: bones.indexOf(b), g: partGeo(geo, pos, rot, scl), m });
    const root = this.root = new THREE.Group();
    const tumble = this.tumble = bone('tumble');
    const body = this.body = bone('body', tumble);
    const hips = this.hips = bone('hips', body);
    part(hips, RB(0.3, 0.17, 0.2), mat.pants, [0, -0.02, 0]);
    const spine = this.spine = bone('spine', hips); spine.position.y = 0.05;
    part(spine, RB(0.36, 0.44, 0.23, 0.08), mat.jacket, [0, 0.24, 0]);
    part(spine, RB(0.28, 0.17, 0.06, 0.02), mat.gear, [0, 0.31, 0.11]);
    for (const s of [-1, 1]) part(spine, RB(0.018, 0.2, 0.02, 0.006), mat.glow, [s * 0.12, 0.2, 0.118]);
    part(spine, RB(0.34, 0.06, 0.245, 0.02), mat.gear, [0, 0.035, 0]);
    part(spine, RB(0.06, 0.045, 0.02, 0.01), mat.accent, [0, 0.035, 0.125]);
    part(spine, RB(0.26, 0.08, 0.18, 0.04), mat.jacketDark, [0, 0.46, -0.01]);
    part(spine, RB(0.25, 0.3, 0.11, 0.04), mat.gear, [0, 0.26, -0.165]);
    part(spine, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 18), mat.glow, [0, 0.28, -0.225], [Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) part(spine, SPH(0.085), mat.jacketDark, [s * 0.21, 0.42, 0], null, [1, 0.8, 1]);
    // マフラー（風でゆれる）
    const scarf = this.scarf = bone('scarf', spine); scarf.position.set(0.05, 0.48, -0.13); scarf.rotation.x = 0.35;
    { const sg = new THREE.PlaneGeometry(0.12, 0.62, 1, 8); sg.translate(0, -0.31, 0); part(scarf, sg, mat.scarf); }
    // 首と頭
    const neck = this.neck = bone('neck', spine); neck.position.set(0, 0.47, 0);
    part(neck, CAP(0.05, 0.06), mat.skin, [0, 0.03, 0]);
    const head = this.head = bone('head', neck); head.position.set(0, 0.15, 0);
    part(head, SPH(0.145, 24, 18), mat.skin, null, null, [0.96, 1.04, 1]);
    part(head, new THREE.SphereGeometry(0.158, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), mat.hair, [0, 0.012, -0.012], [-0.25, 0, 0]);
    for (let i = 0; i < 5; i++) part(head, new THREE.ConeGeometry(0.04, 0.12, 6), mat.hair, [-0.08 + i * 0.04, 0.1, 0.1 - Math.abs(i - 2) * 0.01], [1.9, 0, (i - 2) * 0.25]);
    part(head, SPH(0.15, 16, 12), mat.hair, [0, -0.02, -0.04], null, [1, 0.9, 0.9]);
    for (const s of [-1, 1]) {
      part(head, new THREE.CapsuleGeometry(0.019, 0.028, 3, 8), mat.eye, [s * 0.052, 0, 0.132], [-0.1, 0, 0]);
      part(head, SPH(0.007, 6, 6), mat.white, [s * 0.052 + 0.006, 0.014, 0.15]);
      part(head, new THREE.CylinderGeometry(0.05, 0.05, 0.035, 18), mat.gear, [s * 0.152, -0.005, 0], [0, 0, Math.PI / 2]);
      part(head, new THREE.TorusGeometry(0.035, 0.007, 6, 18), mat.glow, [s * 0.172, -0.005, 0], [0, Math.PI / 2, 0]);
    }
    part(head, new THREE.TorusGeometry(0.16, 0.012, 6, 28, Math.PI), mat.gear, null, [0, Math.PI / 2, 0]);
    // 腕（背骨の空間。位置は毎フレーム計算）
    this.arm = {};
    for (const side of ['L', 'R']) {
      const up = bone('up' + side, spine), fo = bone('fo' + side, spine), hand = bone('hand' + side, spine), cuff = bone('cuff' + side, spine);
      part(up, CAP(0.055, 0.17), mat.jacket); part(fo, CAP(0.047, 0.17), mat.jacketDark); part(hand, SPH(0.052, 12, 10), mat.gear); part(cuff, new THREE.TorusGeometry(0.05, 0.012, 6, 16), mat.glow);
      this.arm[side] = { up, fo, hand, cuff, sh: new THREE.Vector3(side === 'R' ? 0.215 : -0.215, 0.4, 0), el: new THREE.Vector3(), wr: new THREE.Vector3(), target: new THREE.Vector3() };
    }
    // 脚（体の空間）
    this.leg = {};
    for (const side of ['L', 'R']) {
      const th = bone('th' + side, body), sh = bone('sh' + side, body), boot = bone('boot' + side, body), knee = bone('knee' + side, body);
      part(th, CAP(0.088, 0.26), mat.pants); part(sh, CAP(0.075, 0.28), mat.pants);
      part(boot, RB(0.12, 0.1, 0.25, 0.04), mat.boots); part(boot, RB(0.125, 0.025, 0.26, 0.008), mat.glow, [0, -0.055, 0]);
      part(knee, SPH(0.06, 10, 8), mat.gear);
      this.leg[side] = { th, sh, boot, knee, hip: new THREE.Vector3(), kn: new THREE.Vector3(), ft: new THREE.Vector3(), target: new THREE.Vector3(), side: side === 'R' ? 1 : -1 };
    }
    // 材質ごとにまとめて、1つのスキンメッシュに（描く回数は材質の数だけ）
    const order = [], byMat = new Map();
    for (const p of parts) {
      const n = p.g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) { si[k * 4] = p.i; sw[k * 4] = 1; }
      p.g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      p.g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!byMat.has(p.m)) { byMat.set(p.m, []); order.push(p.m); }
      byMat.get(p.m).push(p.g);
    }
    const perMat = order.map(m => { const L = byMat.get(m); const g = L.length === 1 ? L[0] : mergeGeometries(L, false); L.forEach(x => { if (x !== g) x.dispose(); }); return g; });
    const geo = mergeGeometries(perMat, true);
    perMat.forEach(g => g.dispose());
    const mesh = this.mesh = new THREE.SkinnedMesh(geo, order);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.add(tumble);
    root.add(mesh);
    // 骨の「元の位置」は単位行列（部品は骨の空間で作ってある）
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    // 武器の持ち手
    this.holder = new THREE.Group(); spine.add(this.holder);
    this.weapons = {};
    this.wid = 0; this.cur = null;
    this.knL = null;
    // 名前の札
    if (o.name && o.showName) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.label(o.name, C.glow), depthWrite: false, transparent: true }));
      tag.scale.set(1.5, 0.28, 1); tag.position.y = 2.18; tag.renderOrder = 30; root.add(tag); this.tag = tag;
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16; this.hpCv = cv;
      const hpT = new THREE.CanvasTexture(cv); hpT.colorSpace = THREE.SRGBColorSpace;
      const hp = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpT, depthWrite: false, transparent: true }));
      hp.scale.set(0.9, 0.11, 1); hp.position.y = 2.0; hp.renderOrder = 30; root.add(hp); this.hpSprite = hp; this.hpTex = hpT; this.lastHp = -1;
      this.drawHp(100, 100);
    }
    // 動きの状態
    this.phase = 0; this.legYaw = 0; this.air = 0; this.crouch = 0; this.hipH = 0.93; this.lean = 0; this.stepCb = null; this.lastStep = 0;
    this.time = Math.random() * 10;
  }

  drawHp(hp, max) {
    if (!this.hpCv) return;
    const v = Math.round(hp);
    if (v === this.lastHp) return;
    this.lastHp = v;
    const g = this.hpCv.getContext('2d');
    g.clearRect(0, 0, 128, 16);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 2, 128, 12);
    const k = Math.max(0, hp / max);
    g.fillStyle = k > 0.5 ? '#34D399' : k > 0.25 ? '#FBBF24' : '#F87171';
    g.fillRect(2, 4, 124 * k, 8);
    this.hpTex.needsUpdate = true;
  }

  // 画面に出すレイヤー（一人称の自分は 1：画面には出ず、影だけ落とす）
  setLayer(l) {
    this.layer = l;
    this.root.traverse(o => o.layers.set(l));
    for (const w of Object.values(this.weapons)) w.g.traverse(o => o.layers.set(l));
    if (this.knL) this.knL.traverse(o => o.layers.set(l));
  }
  // 持つ武器を先に作っておく
  prebuild(ids) { for (const id of ids) if (!this.weapons[id]) { const w = this.weapons[id] = buildWeapon(id, WEAPONS[id].color); w.g.traverse(o => { if (o.isMesh) o.castShadow = true; o.layers.set(this.layer || 0); }); } }

  setWeapon(id) {
    if (this.wid === id) return;
    if (this.cur) this.holder.remove(this.cur.g);
    if (this.knL) { this.spine.remove(this.knL); this.knL = null; }
    let w = this.weapons[id];
    if (!w) { w = this.weapons[id] = buildWeapon(id, WEAPONS[id].color); w.g.traverse(o => { if (o.isMesh) { o.castShadow = true; } o.layers.set(this.layer || 0); }); }
    this.cur = w; this.wid = id;
    this.holder.add(w.g);
    if (w.pose === 'fist') {
      // ナックルは両手。左手の分は手に直接つける
      this.knL = w.g.clone(); this.spine.add(this.knL); this.knL.traverse(o => o.layers.set(this.layer || 0));
    }
  }

  // st：速さ・向き・地面・しゃがみ・狙いの上下・していること など
  update(dt, st) {
    this.time += dt;
    const t = this.time;
    const root = this.root;
    root.position.set(st.x, st.y, st.z);
    root.rotation.y = st.yaw;
    if (dt <= 0) { this.updateArms(0, st); return; }
    // 動きの速さはなめらかにしてから使う（ぶつかったときの小さなゆれで脚がばたつかない）
    const sv = this.sv || (this.sv = { x: 0, z: 0, px: 0, pz: 0 });
    const kv = 1 - Math.exp(-dt * 14);
    sv.x += (st.moveLocal.x - sv.x) * kv; sv.z += (st.moveLocal.z - sv.z) * kv;
    const ax = (sv.x - sv.px) / dt, az = (sv.z - sv.pz) / dt; sv.px = sv.x; sv.pz = sv.z;
    const speed = Math.hypot(sv.x, sv.z);
    // 加速・減速で体が傾く（ばね）
    const lean = this.leanS || (this.leanS = { x: 0, vx: 0, z: 0, vz: 0 });
    stepSpring(lean, 'x', 'vx', clamp(az * 0.012, -0.16, 0.16), 90, 13, dt);
    stepSpring(lean, 'z', 'vz', clamp(-ax * 0.012, -0.14, 0.14), 90, 13, dt);
    // 着地の沈み込み
    const dip = this.dipS || (this.dipS = { x: 0, v: 0 });
    if (st.onGround && this.wasAir && (this.lastVy || 0) < -3) dip.v -= Math.min(2.6, -this.lastVy * 0.2);
    this.wasAir = !st.onGround; this.lastVy = st.vy;
    stepSpring(dip, 'x', 'v', 0, 120, 12, dt);
    this.air += ((st.onGround ? 0 : 1) - this.air) * (1 - Math.exp(-dt * 12));
    this.crouch += ((st.crouch ? 1 : 0) - this.crouch) * (1 - Math.exp(-dt * 14));
    // 下半身の向き（世界）。歩くと動く向きへ（後ろ歩きは反対向き）。立ち止まっているときは足をつけたまま上半身だけひねり、ひねりすぎたら足を踏みかえる
    if (this.lowerYaw == null) this.lowerYaw = st.yaw;
    let back = false, turning = 0;
    if (speed > 0.4 && st.onGround) {
      let tg = Math.atan2(sv.x, sv.z);
      if (Math.abs(tg) > 1.75) { back = true; tg = tg > 0 ? tg - Math.PI : tg + Math.PI; }
      tg = Math.max(-1.25, Math.min(1.25, tg));
      this.lowerYaw += wrap(st.yaw + tg - this.lowerYaw) * (1 - Math.exp(-dt * 10));
      this.turnStep = false;
    } else if (!st.onGround) {
      this.lowerYaw += wrap(st.yaw - this.lowerYaw) * (1 - Math.exp(-dt * 6));
    } else {
      const d = wrap(this.lowerYaw - st.yaw);
      if (Math.abs(d) > 0.8) this.turnStep = true;
      if (this.turnStep) {
        const step = Math.sign(-d) * Math.min(Math.abs(d), dt * 7);
        this.lowerYaw += step; turning = Math.abs(step) / dt;
        if (Math.abs(d) < 0.06) this.turnStep = false;
      }
    }
    this.legYaw = Math.max(-1.3, Math.min(1.3, wrap(this.lowerYaw - st.yaw)));
    // 歩幅と足の運び（立っている足は地面にくっついたまま。すべらない）
    let run = Math.min(1, speed / 1.2) * (1 - this.air);
    let stride = (0.18 + Math.min(speed, 7) * 0.072) * (1 - this.crouch * 0.25);
    if (turning > 0.1 && speed < 0.4) { run = Math.max(run, 0.35); stride = 0.1; this.phase += turning * dt * 0.32; }
    this.phase += (back ? -1 : 1) * speed * dt / (4 * stride);
    // 足音
    const ph2 = Math.floor(this.phase * 2);
    if (ph2 !== this.lastStep) { this.lastStep = ph2; if (run > 0.5 && speed > 1.5 && this.stepCb) this.stepCb(); }
    const ph = this.phase * Math.PI * 2;
    const bob = (1 - Math.cos(ph * 2)) * 0.5 * 0.045 * run * Math.min(1, speed / 4);
    const roll = st.rollK > 0 ? st.rollK : 0;
    this.hipH = 0.93 - this.crouch * 0.33 - bob + this.air * 0.04 + dip.x * 0.12 - (roll > 0 ? 0.25 : 0) - (st.deadK ? st.deadK * 0.5 : 0);
    this.hips.position.set(Math.sin(ph) * 0.018 * run, this.hipH, 0);
    // ロール：体ごと転がる
    if (roll > 0) {
      const dir = _d.set(st.rollDir.x, 0, st.rollDir.z);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      const axis = _c.crossVectors(Y, dir).normalize();
      this.tumble.position.set(0, 0.55, 0); this.body.position.set(0, -0.55, 0);
      this.tumble.quaternion.setFromAxisAngle(axis, roll * Math.PI * 2);
    } else { this.tumble.position.set(0, 0, 0); this.body.position.set(0, 0, 0); this.tumble.quaternion.identity(); }
    // 背骨：前傾・加速の傾き・狙いの上下・撃たれたときのゆれ・やられ
    const pitch = st.pitch;
    const leanF = run * 0.1 * Math.min(1, speed / 5) + this.crouch * 0.18 + lean.x;
    const hitWob = st.hitK > 0 ? Math.sin(t * 40) * 0.08 * st.hitK : 0;
    this.spine.rotation.set(-pitch * 0.3 + leanF + (st.deadK ? st.deadK * 0.8 : 0), -this.legYaw * 0.15 - Math.sin(ph) * 0.06 * run, hitWob + lean.z * 0.8);
    this.hips.rotation.set(0, this.legYaw * 0.55 + Math.sin(ph) * 0.08 * run, Math.sin(ph) * 0.04 * run + lean.z * 0.4);
    this.neck.rotation.set(-pitch * 0.35 - leanF * 0.4, Math.sin(ph) * 0.03 * run, -lean.z * 0.5);
    this.head.rotation.set(-pitch * 0.25, 0, 0);
    // 息づかい
    this.spine.position.y = 0.05 + Math.sin(t * 2.2) * 0.006;
    // マフラー
    this.scarf.rotation.x = 0.35 + run * 0.6 * Math.min(1, speed / 5) + this.air * 0.5 + Math.sin(t * 5 + this.phase) * 0.08 + lean.x;
    this.scarf.rotation.z = Math.sin(t * 2.7) * 0.15 - lean.z;

    this.updateLegs(dt, st, run, stride, back);
    this.updateArms(dt, st);
    // 撃たれた光・溶けて消える
    this.uni.uHit.value = Math.max(0, st.hitK || 0) * 0.6;
    this.uni.uDis.value = st.dissolve || 0;
    this.uni.uGhost.value = st.ghost || 0;
    this.uni.uRimK.value = st.rim != null ? st.rim : 0.22;
    if (this.tag) { this.tag.visible = !!st.showTag; this.hpSprite.visible = !!st.showTag && st.hp < st.maxHp; this.drawHp(st.hp, st.maxHp); }
    // 武器の部品の動き（レールガンの輪・フォーカスのレンズ）
    if (this.cur) {
      const ch = st.charge || 0;
      this.cur.g.children.forEach(c => {
        if (c.userData.coil != null) { c.rotation.z = t * (2 + ch * 30) + c.userData.coil; c.scale.setScalar(1 + ch * 0.25 * Math.sin(t * 40 + c.userData.coil)); }
        if (c.userData.lens != null) { c.rotation.z = t * (1 + ch * 10) * (c.userData.lens % 2 ? -1 : 1); }
      });
      if (this.cur.acc) this.cur.acc.emissiveIntensity = 2.2 + ch * 5;
    }
  }

  updateLegs(dt, st, run, stride, back) {
    const ly = this.legYaw, cy = Math.cos(ly), sy = Math.sin(ly);
    for (const side of ['L', 'R']) {
      const L = this.leg[side], s = L.side;
      // 股関節（腰の向きに合わせて回す）
      const hx = s * 0.1;
      L.hip.set(hx * cy, this.hipH - 0.06, -hx * sy);
      // 足の置き場所（脚の向きの空間）
      const p = ((this.phase + (s > 0 ? 0.5 : 0)) % 1 + 1) % 1;
      let fz, fy;
      if (p < 0.5) { fz = stride * (1 - p * 4); fy = 0; }   // 地面についている足：体の速さと同じだけ後ろへ
      else { const u = (p - 0.5) / 0.5; fz = -stride * Math.cos(u * Math.PI); fy = Math.sin(u * Math.PI) * (0.06 + Math.min(0.14, stride * 0.2)); }   // 浮かせた足：なめらかに前へ
      fz *= run; fy *= run;
      if (back) fz = -fz;
      let fx = s * 0.13;
      // しゃがみ：足を少し開く
      fx += s * this.crouch * 0.05; fz += (s > 0 ? 0.06 : -0.08) * this.crouch;
      // 空中：足を引き寄せる
      const air = this.air;
      fy = fy * (1 - air) + air * (0.42 + (s > 0 ? 0.08 : -0.02) + Math.min(0.2, Math.max(-0.2, -st.vy * 0.02)));
      fz = fz * (1 - air) + air * (s > 0 ? 0.16 : -0.12);
      if (st.rollK > 0) { fy = 0.5; fz = 0.05 * s; }
      // 脚の空間 → 体の空間
      L.target.set(fx * cy + fz * sy, fy, -fx * sy + fz * cy);
      // 足首の高さ（靴の厚み）
      L.target.y += 0.06;
      const pole = _d.set(sy * 1 + s * 0.15 * cy, 0, cy * 1 - s * 0.15 * sy);
      ik2(L.hip, L.target, 0.44, 0.44, pole, L.kn, L.ft);
      placeSeg(L.th, L.hip, L.kn); placeSeg(L.sh, L.kn, L.ft);
      L.knee.position.copy(L.kn).addScaledVector(pole, 0.05);
      L.boot.position.set(L.ft.x + sy * 0.05, L.ft.y - 0.03, L.ft.z + cy * 0.05);
      L.boot.rotation.set(fy > 0.02 && air < 0.5 ? -0.3 : 0, ly, 0);
    }
  }

  updateArms(dt, st) {
    const w = this.cur, h = this.holder, t = this.time;
    const pose = w ? w.pose : 'rifle';
    const pitchL = st.pitch * 0.7;   // 背骨が残りを受け持つ
    const act = st.act || {}, k = act.k || 0;
    let px = 0.17, py = 0.34, pz = 0.2, rx = -pitchL, ry = 0, rz = 0;
    if (pose === 'pistol') { px = 0.06; py = 0.36; pz = 0.36; }
    else if (pose === 'heavy') { px = 0.19; py = 0.24; pz = 0.2; }
    else if (pose === 'knife') { px = 0.22; py = 0.26; pz = 0.28; rx = -pitchL - 0.3; }
    else if (pose === 'spear') { px = 0.16; py = 0.22; pz = -0.08; rx = -pitchL * 0.8 + 0.05; }
    else if (pose === 'hammer') { px = 0.19; py = 0.2; pz = 0.12; rx = -0.95; ry = -0.25; }
    // 反動
    const rk = st.recoil || 0;
    pz -= rk * 0.07; rx -= rk * 0.16;
    // していること
    if (act.type === 'reload') { const s = Math.sin(k * Math.PI); rz += s * 0.7; rx += s * 0.45; py -= s * 0.06; }
    else if (act.type === 'swap') { const s = Math.sin(k * Math.PI); py -= s * 0.3; rx += s * 1.1; }
    else if (act.type === 'charge') { px += (Math.random() - 0.5) * 0.004 * k; py += (Math.random() - 0.5) * 0.004 * k; }
    else if (act.type === 'melee') {
      if (pose === 'knife') { const s = Math.sin(Math.min(1, k * 1.3) * Math.PI); pz += s * 0.38; px -= s * 0.12; ry += (act.alt ? 1 : -1) * s * 0.9; rx += s * 0.2; }
      else if (pose === 'spear') { const back = k < 0.3 ? k / 0.3 : Math.max(0, 1 - (k - 0.3) * 4); const fwd = k < 0.3 ? 0 : Math.sin(Math.min(1, (k - 0.3) / 0.4) * Math.PI); pz += -back * 0.22 + fwd * 0.72; }
      else if (pose === 'hammer') {
        if (k < 0.35) { const u = k / 0.35; rx = -0.95 - u * 1.6; py += u * 0.25; }
        else if (k < 0.55) { const u = (k - 0.35) / 0.2; rx = -2.55 + u * 3.4; py += 0.25 - u * 0.35; pz += u * 0.25; }
        else { const u = (k - 0.55) / 0.45; rx = 0.85 - u * 1.8; py -= 0.1 * (1 - u); pz += 0.25 * (1 - u); }
      }
    }
    if (st.victory) { rx = -1.4; py += 0.1; }
    if (st.deadK) { rx += st.deadK * 1.2; py -= st.deadK * 0.25; }
    h.position.set(px, py, pz);
    h.rotation.set(rx, ry, rz);
    h.updateMatrix();
    const R = this.arm.R, L = this.arm.L;
    if (pose === 'fist') {
      // 両手でかまえる。打つ手が前へ
      const s = act.type === 'melee' ? Math.sin(Math.min(1, k * 1.6) * Math.PI) : 0;
      const right = !act.alt;
      R.target.set(0.13, 0.34 - pitchL * 0.1, 0.24 + (right ? s * 0.42 : 0));
      L.target.set(-0.13, 0.36 - pitchL * 0.1, 0.2 + (right ? 0 : s * 0.42));
      h.position.set(0, 0, 0); h.rotation.set(0, 0, 0);
      if (w) { w.g.position.copy(R.target); w.g.rotation.set(-pitchL, 0, 0); }
      if (this.knL) { this.knL.position.copy(L.target); this.knL.rotation.set(-pitchL, 0, 0); }
    } else {
      R.target.set(0, -0.02, 0).applyMatrix4(h.matrix);
      if (w && w.fore) L.target.copy(w.fore).applyMatrix4(h.matrix);
      else L.target.set(-0.14, 0.3 + Math.sin(t * 2) * 0.01, 0.18);
      if (w) { w.g.position.set(0, 0, 0); w.g.rotation.set(0, 0, 0); }
      if (act.type === 'reload' && w && w.mag && k > 0.15 && k < 0.75) {
        const u = Math.sin((k - 0.15) / 0.6 * Math.PI);
        _a.copy(w.mag).applyMatrix4(h.matrix);
        L.target.lerp(_a, u);
      }
      if (act.type === 'heal') { const u = Math.sin(k * Math.PI); L.target.lerp(_a.set(0.0, 0.3, 0.14), u); }
    }
    // 腕の IK（肘は下と外へ）
    ik2(R.sh, R.target, 0.27, 0.26, _d.set(0.55, -1, -0.45), R.el, R.wr);
    placeSeg(R.up, R.sh, R.el); placeSeg(R.fo, R.el, R.wr); R.hand.position.copy(R.wr);
    R.cuff.position.lerpVectors(R.el, R.wr, 0.82); R.cuff.quaternion.copy(R.fo.quaternion).multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), Math.PI / 2));
    ik2(L.sh, L.target, 0.27, 0.26, _d.set(-0.55, -1, -0.45), L.el, L.wr);
    placeSeg(L.up, L.sh, L.el); placeSeg(L.fo, L.el, L.wr); L.hand.position.copy(L.wr);
    L.cuff.position.lerpVectors(L.el, L.wr, 0.82); L.cuff.quaternion.copy(L.fo.quaternion).multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), Math.PI / 2));
  }

  // 銃口の場所（世界）
  muzzleWorld(out) {
    if (!this.cur) return out.set(this.root.position.x, this.root.position.y + 1.4, this.root.position.z);
    this.cur.muzzle.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.cur.muzzle.matrixWorld);
  }
  headWorld(out) { this.head.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.head.matrixWorld); }

  dispose() {
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    for (const w of Object.values(this.weapons)) w.g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (this.mesh.skeleton) this.mesh.skeleton.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
