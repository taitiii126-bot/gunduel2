// エフェクト：GPU で動くパーティクル（火花・煙・光の粒）、弾の光跡（リボン）、弾痕、マズルフラッシュの光、衝撃波
// パーティクルは生まれた時刻・速さ・重さだけを書き込み、位置の計算はすべて頂点シェーダー（GPU）で行う
import * as THREE from '../lib/three.js';

const PARTICLE_VS = `
  attribute vec3 aVel; attribute vec4 aInfo; attribute vec4 aCol; attribute vec3 aSize;
  uniform float uTime; uniform float uScale; uniform float uGrav;
  varying vec4 vCol; varying float vT; varying float vKind; varying float vSeed;
  void main(){
    float age = uTime - aInfo.x; float life = aInfo.y; float t = age / life;
    vT = t; vKind = aSize.z; vSeed = fract(aInfo.x * 7.31 + position.x * 3.17 + position.z * 1.93);
    if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float drag = aInfo.z;
    float k = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = position + aVel * k;
    p.y -= 0.5 * uGrav * aInfo.w * age * age;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(aSize.x, aSize.y, t);
    gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 0.0, 256.0);
    vCol = aCol;
  }`;
const PARTICLE_FS = `
  varying vec4 vCol; varying float vT; varying float vKind; varying float vSeed;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  void main(){
    vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
    float a;
    if (vKind < 0.5) {            // 光の粒（中心が白く熱い）
      a = smoothstep(1.0, 0.0, r); a *= a;
      vec3 col = mix(vCol.rgb, vec3(1.0), smoothstep(0.35, 0.0, r) * 0.6);
      gl_FragColor = vec4(col * vCol.a * a * (1.0 - vT * vT), 1.0);
      return;
    } else if (vKind < 1.5) {     // 煙（ふわふわ・ゆっくり消える）
      float n = noise(gl_PointCoord * 3.0 + vSeed * 17.0 + vT * 1.5);
      a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6) * (1.0 - vT) * vCol.a;
      gl_FragColor = vec4(vCol.rgb * (0.75 + 0.35 * n), a * 0.55);
      return;
    } else {                      // 輪（衝撃・回復の輪）
      a = smoothstep(0.08, 0.0, abs(r - 0.82)) ;
      gl_FragColor = vec4(vCol.rgb * vCol.a * a * (1.0 - vT), 1.0);
      return;
    }
  }`;

class ParticlePool {
  constructor(cap, additive, scene) {
    this.cap = cap; this.head = 0; this.dirtyLo = Infinity; this.dirtyHi = -1; this.wrapped = false;
    const g = this.geo = new THREE.BufferGeometry();
    const mk = (n) => { const a = new THREE.BufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.pos = mk(3); this.vel = mk(3); this.info = mk(4); this.col = mk(4); this.size = mk(3);
    for (let i = 0; i < cap; i++) this.info.array[i * 4] = -1e6;
    g.setAttribute('position', this.pos); g.setAttribute('aVel', this.vel); g.setAttribute('aInfo', this.info); g.setAttribute('aCol', this.col); g.setAttribute('aSize', this.size);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uGrav: { value: 9.8 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    if (additive) this.mat.blending = THREE.CustomBlending, this.mat.blendSrc = THREE.OneFactor, this.mat.blendDst = THREE.OneFactor;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
    scene.add(this.points);
  }
  // kind：0=光 1=煙 2=輪。grav：重さの倍率
  emit(t, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, kind, drag, grav) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    if (this.head === 0) this.wrapped = true;
    this.pos.array.set([x, y, z], i * 3);
    this.vel.array.set([vx, vy, vz], i * 3);
    this.info.array.set([t, life, drag || 0, grav || 0], i * 4);
    this.col.array.set([r, g, b, a], i * 4);
    this.size.array.set([s0, s1, kind || 0], i * 3);
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }
  flush(time, scale) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uScale.value = scale;
    if (this.dirtyHi < 0) return;
    for (const a of [this.pos, this.vel, this.info, this.col, this.size]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyLo * a.itemSize, (this.dirtyHi - this.dirtyLo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyLo = Infinity; this.dirtyHi = -1;
  }
}

// 弾の光跡：カメラの方を向いた細い帯。頭が start から end へ速く進み、尾を引く
const TRACER_VS = `
  attribute vec3 aA; attribute vec3 aB; attribute vec4 aT; attribute vec4 aC;
  uniform float uTime;
  varying float vU; varying float vV; varying vec4 vC; varying float vFade;
  void main(){
    float age = uTime - aT.x; float life = aT.y;
    vec3 dir = aB - aA; float len = max(0.001, length(dir)); dir /= len;
    float speed = aT.z; float streak = aT.w;
    float headD = speed > 0.0 ? min(len, age * speed) : len;
    float tailD = speed > 0.0 ? max(0.0, headD - streak) : 0.0;
    float fade = clamp(1.0 - age / life, 0.0, 1.0);
    if (age < 0.0 || age > life || (speed > 0.0 && tailD >= len)) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
    vec3 p = mix(aA + dir * tailD, aA + dir * headD, position.x);
    vec3 camPos = cameraPosition;
    vec3 side = normalize(cross(dir, normalize(p - camPos)));
    float w = aC.a * (speed > 0.0 ? 1.0 : (0.35 + 0.65 * fade));
    p += side * position.y * w;
    vU = position.x; vV = position.y; vC = aC; vFade = speed > 0.0 ? 1.0 : fade;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const TRACER_FS = `
  varying float vU; varying float vV; varying vec4 vC; varying float vFade;
  void main(){
    float core = smoothstep(1.0, 0.0, abs(vV) * 2.0);
    float glow = core * core;
    vec3 col = mix(vC.rgb, vec3(1.0), glow * 0.55) * (0.25 + vU * 0.95);
    gl_FragColor = vec4(col * glow * vFade * 2.2, 1.0);
  }`;

class TracerPool {
  constructor(cap, scene) {
    this.cap = cap; this.head = 0;
    const base = new THREE.PlaneGeometry(1, 1, 1, 1);
    base.translate(0.5, 0, 0);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
    const mk = (n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.a = mk(3); this.b = mk(3); this.t = mk(4); this.c = mk(4);
    for (let i = 0; i < cap; i++) this.t.array[i * 4] = -1e6, this.t.array[i * 4 + 1] = 0.001;
    g.setAttribute('aA', this.a); g.setAttribute('aB', this.b); g.setAttribute('aT', this.t); g.setAttribute('aC', this.c);
    g.instanceCount = cap;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({ vertexShader: TRACER_VS, fragmentShader: TRACER_FS, uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 25;
    scene.add(this.mesh);
    this.dirty = false;
  }
  add(time, a, b, color, width, speed, streak, life) {
    const i = this.head; this.head = (this.head + 1) % this.cap;
    this.a.array.set([a.x, a.y, a.z], i * 3); this.b.array.set([b.x, b.y, b.z], i * 3);
    this.t.array.set([time, life, speed, streak], i * 4);
    this.c.array.set([color.r, color.g, color.b, width], i * 4);
    this.dirty = true;
  }
  flush(time) {
    this.mat.uniforms.uTime.value = time;
    if (!this.dirty) return;
    this.a.needsUpdate = this.b.needsUpdate = this.t.needsUpdate = this.c.needsUpdate = true;
    this.dirty = false;
  }
}

// 弾痕：小さな板を面に貼る（InstancedMesh で一度に描く）
function holeTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.25, 'rgba(10,8,6,.95)'); gr.addColorStop(0.5, 'rgba(30,24,20,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.2;
  for (let k = 0; k < 7; k++) { const a = Math.random() * 6.28, l = 10 + Math.random() * 14; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  constructor(scene, quality) {
    this.scene = scene;
    this.time = 0;
    this.mult = quality.particles;
    this.add = new ParticlePool(Math.round(9000 * Math.max(0.5, this.mult)), true, scene);
    this.smoke = new ParticlePool(Math.round(2400 * Math.max(0.5, this.mult)), false, scene);
    this.tracers = new TracerPool(320, scene);
    // 弾痕
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.decals = new THREE.InstancedMesh(dg, this.decalMat, 300);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 300; i++) this.decals.setMatrixAt(i, zero);
    this.decals.frustumCulled = false; this.decals.renderOrder = 5;
    scene.add(this.decals);
    this.decalHead = 0;
    // 光（数を変えるとシェーダーを作り直すことになるので、最初に数を決めて使い回す）
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight(0xffffff, 0, 8, 2);
      L.userData.t = 0; L.userData.life = 0.06; L.userData.peak = 0;
      scene.add(L); this.lights.push(L);
    }
    this.lightHead = 0;
    // 衝撃波の輪
    this.rings = [];
    const rg = new THREE.RingGeometry(0.85, 1, 48, 1);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 22; scene.add(m); this.rings.push({ m, t: 0, life: 0.5, r0: 0.5, r1: 5 });
    }
    this.ringHead = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  n(k) { return Math.max(1, Math.round(k * this.mult)); }

  flash(pos, color, intensity, dist, life) {
    const L = this.lights[this.lightHead]; this.lightHead = (this.lightHead + 1) % this.lights.length;
    L.position.copy(pos); L.color.set(color); L.distance = dist || 8; L.userData.peak = intensity; L.userData.t = 0; L.userData.life = life || 0.06;
    L.intensity = intensity;
  }

  ring(pos, color, r0, r1, life) {
    const R = this.rings[this.ringHead]; this.ringHead = (this.ringHead + 1) % this.rings.length;
    R.m.position.copy(pos); R.m.material.color.set(color); R.t = 0; R.life = life; R.r0 = r0; R.r1 = r1; R.m.visible = true;
  }

  // 銃口の火花
  muzzle(pos, dir, color, big) {
    const c = this._c.set(color), t = this.time, n = this.n(big ? 10 : 5);
    for (let i = 0; i < n; i++) {
      const s = 4 + Math.random() * 10;
      this.add.emit(t, pos.x, pos.y, pos.z, dir.x * s + (Math.random() - 0.5) * 2.5, dir.y * s + (Math.random() - 0.5) * 2.5, dir.z * s + (Math.random() - 0.5) * 2.5,
        0.05 + Math.random() * 0.07, big ? 0.45 : 0.28, 0.02, 1, 0.75 + c.g * 0.25, 0.4 + c.b * 0.3, 1.6, 0, 6, 0);
    }
    this.add.emit(t, pos.x, pos.y, pos.z, 0, 0, 0, 0.05, big ? 1.1 : 0.7, 0.2, 1, 0.85, 0.55, 2.2, 0, 0, 0);
    if (Math.random() < 0.6) this.smoke.emit(t, pos.x, pos.y, pos.z, dir.x * 1.2, 0.4 + dir.y, dir.z * 1.2, 0.6, 0.15, 0.7, 0.7, 0.7, 0.72, 0.35, 1, 2, -0.05);
    this.flash(pos, color, big ? 26 : 14, big ? 9 : 6, 0.055);
  }

  // 壁に当たった：火花・ほこり・弾痕
  impact(pos, normal, color, opts = {}) {
    const t = this.time, c = this._c.set(color || '#FFD27A');
    const n = this.n(opts.big ? 14 : 7);
    for (let i = 0; i < n; i++) {
      const s = 3 + Math.random() * 7;
      const vx = normal.x * s * 0.8 + (Math.random() - 0.5) * s, vy = normal.y * s * 0.8 + (Math.random() - 0.1) * s, vz = normal.z * s * 0.8 + (Math.random() - 0.5) * s;
      this.add.emit(t, pos.x, pos.y, pos.z, vx, vy, vz, 0.25 + Math.random() * 0.35, 0.12, 0.02, 1, 0.7 + c.g * 0.3, 0.35 + c.b * 0.3, 1.4, 0, 1.5, 1.2);
    }
    const dust = this.n(opts.big ? 5 : 2);
    for (let i = 0; i < dust; i++) this.smoke.emit(t, pos.x, pos.y, pos.z, normal.x * 1.5 + (Math.random() - 0.5), normal.y * 1.5 + Math.random() * 0.6, normal.z * 1.5 + (Math.random() - 0.5), 0.8 + Math.random() * 0.5, 0.2, 1.1, opts.dust || 0.62, opts.dust || 0.58, (opts.dust || 0.55) * 0.95, 0.5, 1, 2.5, -0.04);
    if (!opts.noDecal) this.decal(pos, normal, opts.big ? 0.32 : 0.13);
  }

  decal(pos, normal, size) {
    const i = this.decalHead; this.decalHead = (this.decalHead + 1) % 300;
    this._v.set(normal.x, normal.y, normal.z);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._v);
    const spin = new THREE.Quaternion().setFromAxisAngle(this._v, Math.random() * 6.28);
    this._q.premultiply(spin);
    this._m.compose(this._s.set(pos.x + normal.x * 0.012, pos.y + normal.y * 0.012, pos.z + normal.z * 0.012), this._q, new THREE.Vector3(size, size, size));
    this.decals.setMatrixAt(i, this._m);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  // 人に当たった：チームの色の光のしぶき（血は出さない）
  hit(pos, dir, color, head) {
    const t = this.time, c = this._c.set(color), n = this.n(head ? 18 : 9);
    for (let i = 0; i < n; i++) {
      const s = 2 + Math.random() * 6;
      this.add.emit(t, pos.x, pos.y, pos.z, -dir.x * s * 0.4 + (Math.random() - 0.5) * s, (Math.random() - 0.2) * s, -dir.z * s * 0.4 + (Math.random() - 0.5) * s,
        0.25 + Math.random() * 0.3, head ? 0.22 : 0.15, 0.02, c.r * 1.5 + 0.2, c.g * 1.5 + 0.2, c.b * 1.5 + 0.2, 1.6, 0, 3, 0.5);
    }
    if (head) this.add.emit(t, pos.x, pos.y, pos.z, 0, 0, 0, 0.18, 0.4, 1.6, 1, 0.95, 0.6, 1.2, 2, 0, 0);
  }

  // 爆発：火の玉・火花・煙・衝撃波・光
  explosion(pos, color, radius) {
    const t = this.time, c = this._c.set(color || '#FF8A3D');
    const R = radius || 4;
    for (let i = 0, n = this.n(40); i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = R * (1.2 + Math.random() * 2.4);
      this.add.emit(t, pos.x, pos.y, pos.z, Math.cos(a) * s * sp, Math.abs(u) * sp * 0.9 + 1, Math.sin(a) * s * sp, 0.35 + Math.random() * 0.4, 1.4 + Math.random(), 0.2, 1, 0.55 + c.g * 0.3, 0.18, 1.5, 0, 3.2, 0.3);
    }
    for (let i = 0, n = this.n(36); i < n; i++) {
      const a = Math.random() * 6.283, sp = 6 + Math.random() * 14;
      this.add.emit(t, pos.x, pos.y, pos.z, Math.cos(a) * sp, 3 + Math.random() * 8, Math.sin(a) * sp, 0.6 + Math.random() * 0.8, 0.14, 0.02, 1, 0.8, 0.45, 1.5, 0, 0.8, 1.4);
    }
    for (let i = 0, n = this.n(18); i < n; i++) {
      const a = Math.random() * 6.283, sp = 1 + Math.random() * 3;
      this.smoke.emit(t + Math.random() * 0.1, pos.x + Math.cos(a) * 0.5, pos.y + Math.random() * 0.6, pos.z + Math.sin(a) * 0.5, Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp, 1.6 + Math.random() * 1.4, 1.2, 4.5, 0.16, 0.14, 0.13, 0.75, 1, 1.4, -0.08);
    }
    this.add.emit(t, pos.x, pos.y, pos.z, 0, 0, 0, 0.12, R * 2.6, R * 3.4, 1, 0.9, 0.7, 3, 0, 0, 0);
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.08, pos.z), color || '#FFB070', 0.4, R * 1.6, 0.45);
    this.flash(pos, '#FFB36B', 120, R * 5, 0.22);
    this.decal(new THREE.Vector3(pos.x, pos.y - 0.0, pos.z), { x: 0, y: 1, z: 0 }, R * 0.9);
  }

  // やられた：体がチームの色の光の粒になって散る
  dissolve(pos, color) {
    const t = this.time, c = this._c.set(color);
    for (let i = 0, n = this.n(70); i < n; i++) {
      const y = Math.random() * 1.7, a = Math.random() * 6.283, r = Math.random() * 0.35;
      this.add.emit(t + Math.random() * 0.5, pos.x + Math.cos(a) * r, pos.y + y, pos.z + Math.sin(a) * r, Math.cos(a) * 0.6, 0.8 + Math.random() * 2.2, Math.sin(a) * 0.6,
        0.8 + Math.random() * 0.9, 0.12, 0.01, c.r * 1.4 + 0.15, c.g * 1.4 + 0.15, c.b * 1.4 + 0.15, 1.5, 0, 0.6, -0.15);
    }
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.05, pos.z), color, 0.3, 2.2, 0.6);
  }

  // 回復：緑の光が体を下から上へ
  heal(pos) {
    const t = this.time;
    for (let i = 0, n = this.n(46); i < n; i++) {
      const a = Math.random() * 6.283, r = 0.45 + Math.random() * 0.2;
      this.add.emit(t + Math.random() * 0.35, pos.x + Math.cos(a) * r, pos.y + Math.random() * 0.4, pos.z + Math.sin(a) * r, -Math.cos(a) * 0.3, 2 + Math.random() * 2.5, -Math.sin(a) * 0.3,
        0.6 + Math.random() * 0.4, 0.16, 0.03, 0.25, 1.4, 0.65, 1.4, 0, 0.5, -0.1);
    }
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.06, pos.z), '#34D399', 0.2, 1.6, 0.5);
  }

  // スキルなど：好きな色の光の輪と粒
  burst(pos, color, n, speed, life, size) {
    const t = this.time, c = this._c.set(color);
    for (let i = 0, k = this.n(n); i < k; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.8);
      this.add.emit(t, pos.x, pos.y, pos.z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, life * (0.6 + Math.random() * 0.6), size || 0.15, 0.01, c.r * 1.3 + 0.1, c.g * 1.3 + 0.1, c.b * 1.3 + 0.1, 1.4, 0, 2, 0);
    }
  }

  // 走ったときの砂ぼこり・着地
  dust(pos, amt, tint) {
    const t = this.time, d = tint || 0.6;
    for (let i = 0, n = this.n(amt); i < n; i++) {
      const a = Math.random() * 6.283, sp = 0.6 + Math.random() * 1.6;
      this.smoke.emit(t, pos.x + Math.cos(a) * 0.25, pos.y + 0.05, pos.z + Math.sin(a) * 0.25, Math.cos(a) * sp, 0.3 + Math.random() * 0.5, Math.sin(a) * sp, 0.6 + Math.random() * 0.5, 0.18, 0.75, d, d * 0.96, d * 0.9, 0.38, 1, 2.2, -0.02);
    }
  }

  tracer(a, b, color, width, speed, streak, life) { this.tracers.add(this.time, a, b, this._c.set(color), width, speed, streak, life); }

  // 試合が変わったら、弾痕・光・輪を消す（前のステージの弾痕が宙に残らないように）
  clear() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 300; i++) this.decals.setMatrixAt(i, zero);
    this.decals.instanceMatrix.needsUpdate = true; this.decalHead = 0;
    for (const L of this.lights) L.intensity = 0;
    for (const R of this.rings) R.m.visible = false;
  }

  // 雨・雪のような、ずっと続く物は arenas 側。ここは毎フレームの片付け
  update(dt, camera, viewportH) {
    this.time += dt;
    const scale = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.add.flush(this.time, scale);
    this.smoke.flush(this.time, scale);
    this.tracers.flush(this.time);
    for (const L of this.lights) {
      if (L.intensity <= 0) continue;
      L.userData.t += dt;
      const k = 1 - L.userData.t / L.userData.life;
      L.intensity = k > 0 ? L.userData.peak * k * k : 0;
    }
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.t += dt;
      const k = R.t / R.life;
      if (k >= 1) { R.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3), s = R.r0 + (R.r1 - R.r0) * e;
      R.m.scale.set(s, 1, s);
      R.m.material.opacity = (1 - k) * 0.9;
    }
  }
}
