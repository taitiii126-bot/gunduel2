// ステージ作りの共通の道具：箱・坂・ジャンプ台を「見た目」と「当たり判定」の両方に一度で足す。同じ材質の箱は1つにまとめて描く（描く回数を減らす）
import * as THREE from '../lib/three.js';
import { mergeGeometries } from '../lib/three.js';
import { CollisionWorld } from './collision.js';
import { boxGeometry, TEX } from './textures.js';
import { BODY } from './data.js';

export const U = { time: { value: 0 }, wind: { value: 1 } };   // シェーダー全部で使う時刻

// 風でゆれる（草・旗）。頂点の高さ（uv.y）ほど大きくゆれる
export function windify(mat, amp = 0.15, freq = 1.6) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time; sh.uniforms.uWind = U.wind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wp = (instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
      #else
        vec3 wp = vec3(0.0);
      #endif
      float sway = sin(uTime * ${freq.toFixed(2)} + wp.x * 0.35 + wp.z * 0.27) + 0.4 * sin(uTime * ${(freq * 2.3).toFixed(2)} + wp.z * 0.9);
      float hk = uv.y * uv.y;
      transformed.x += sway * ${amp.toFixed(3)} * hk * uWind;
      transformed.z += cos(uTime * ${(freq * 0.8).toFixed(2)} + wp.x * 0.5) * ${(amp * 0.6).toFixed(3)} * hk * uWind;`);
  };
  mat.customProgramCacheKey = () => 'wind' + amp + freq;
  return mat;
}

// 光る線（縁の飾り）。強さを時間でゆっくり変える
export function pulseEmissive(mat, speed = 1.2, depth = 0.25) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.time;
    sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= 1.0 - ${depth.toFixed(3)} + ${depth.toFixed(3)} * sin(uTime * ${speed.toFixed(2)} + vViewPosition.x * 0.0);`);
  };
  mat.customProgramCacheKey = () => 'pulse' + speed + depth;
  return mat;
}

export class ArenaBuilder {
  constructor(quality) {
    this.q = quality;
    this.world = new CollisionWorld();
    this.group = new THREE.Group();
    this.mats = {};
    this.batches = {};      // 材質の名前 → 形の一覧（あとで1つにまとめる）
    this.pads = [];
    this.updaters = [];
    this.spawns = { duel: [], team: [[], []], ffa: [] };
  }

  addMat(name, mat, texScale = 2) { mat.userData.texScale = texScale; this.mats[name] = mat; return mat; }

  // 見た目と当たり判定の箱。中心の下（足もと）を基準：x,z＝中心、y＝底の高さ
  box(x, y, z, w, h, d, matName, o = {}) {
    const m = this.mats[matName];
    if (m && o.visual !== false) {
      const g = boxGeometry(w, h, d, m.userData.texScale || 2, [x * 0.13 % 1, z * 0.17 % 1]);
      g.translate(x, y + h / 2, z);
      if (o.rotY) { g.translate(-x, 0, -z); g.rotateY(o.rotY); g.translate(x, 0, z); }
      (this.batches[matName] = this.batches[matName] || []).push({ g, cast: o.cast !== false });
    }
    if (o.collide !== false) this.world.addBox(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, o);
  }

  // 坂（見た目はくさび）。axis の向きに上がる。up=+1 なら座標の大きい側が高い
  ramp(x0, z0, x1, z1, y0, y1, axis, up, matName, o = {}) {
    const r = this.world.addRamp(x0, z0, x1, z1, y0, y1, axis, up, o);
    const m = this.mats[matName];
    if (!m) return r;
    const X0 = r.x0, X1 = r.x1, Z0 = r.z0, Z1 = r.z1, B = r.base;
    // くさびの頂点（低い側の上の辺は y0、高い側は y1）
    const hi = (x, z) => this.world.rampHeight(r, x, z);
    const P = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]].map(([x, z]) => [x, hi(x, z), z]);
    const pos = [], uv = [], s = m.userData.texScale || 2;
    const quad = (a, b, c, d, uvs) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]); };
    const tri = (a, b, c, uvs) => { pos.push(...a, ...b, ...c); uv.push(...uvs[0], ...uvs[1], ...uvs[2]); };
    const len = Math.hypot(axis === 'x' ? X1 - X0 : Z1 - Z0, y1 - y0) / s, wid = (axis === 'x' ? Z1 - Z0 : X1 - X0) / s;
    // 上の面（坂）
    if (axis === 'x') quad(P[3], P[2], P[1], P[0], [[0, wid], [len, wid], [len, 0], [0, 0]]);
    else quad(P[0], P[3], P[2], P[1], [[0, 0], [0, len], [wid, len], [wid, 0]]);
    const b = (p) => [p[0], B, p[2]];
    // 横と高い側の面
    const sides = [[P[0], P[1]], [P[1], P[2]], [P[2], P[3]], [P[3], P[0]]];
    for (const [a, c] of sides) {
      const ha = a[1] - B, hc = c[1] - B;
      if (ha < 0.01 && hc < 0.01) continue;
      const L = Math.hypot(c[0] - a[0], c[2] - a[2]) / s;
      if (ha > 0.01 && hc > 0.01) quad(b(a), b(c), c, a, [[0, 0], [L, 0], [L, hc / s], [0, ha / s]]);
      else if (ha > 0.01) tri(b(a), b(c), a, [[0, 0], [L, 0], [0, ha / s]]);
      else tri(b(a), b(c), c, [[0, 0], [L, 0], [L, hc / s]]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // 面の向きをそろえる（外向きに）：中心から外へ向かうように三角形を並べ替える
    const ctr = new THREE.Vector3((X0 + X1) / 2, (B + Math.max(y0, y1)) / 2, (Z0 + Z1) / 2);
    const p = g.attributes.position, idx = [];
    for (let i = 0; i < p.count; i += 3) {
      const A = new THREE.Vector3().fromBufferAttribute(p, i), Bv = new THREE.Vector3().fromBufferAttribute(p, i + 1), C = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(C, A));
      const mid = A.clone().add(Bv).add(C).multiplyScalar(1 / 3);
      if (n.dot(mid.sub(ctr)) < 0) idx.push(i, i + 2, i + 1); else idx.push(i, i + 1, i + 2);
    }
    g.setIndex(idx);
    g.computeVertexNormals();
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    (this.batches[matName] = this.batches[matName] || []).push({ g: ng, cast: true });
    return r;
  }

  // ジャンプ台：乗ると land の場所まで飛ぶ
  pad(x, y, z, land, color = '#FFC53D') {
    const dx = land[0] - x, dy = land[1] - y, dz = land[2] - z, dist = Math.hypot(dx, dz);
    const T = 0.75 + dist * 0.028 + Math.max(0, dy) * 0.03, g = BODY.gravity;
    const v = [dx / T, (dy + 0.5 * g * T * T) / T, dz / T];
    this.world.addPad(x, y, z, 1.05, v, land);
    // 見た目：台座・光る輪・上向きの光の柱
    const grp = new THREE.Group(); grp.position.set(x, y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.18, 40), this.mats.padBase || new THREE.MeshStandardMaterial({ color: 0x222833, metalness: 0.8, roughness: 0.35 }));
    base.position.y = 0.09; base.receiveShadow = true; base.castShadow = true; grp.add(base);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.06, 10, 48), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; grp.add(ring);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.6), transparent: true, opacity: 0.75 }));
    core.rotation.x = -Math.PI / 2; core.position.y = 0.185; grp.add(core);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uCol: { value: new THREE.Color(color) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; varying vec2 vUv; void main(){ float s = fract(vUv.y*3.0 - uTime*1.6); float a = (1.0-vUv.y) * (0.25 + 0.75*smoothstep(0.0,0.15,s)*smoothstep(0.5,0.15,s)); gl_FragColor = vec4(uCol*a*1.6, 1.0); }',
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 32, 1, true), beamMat); beam.position.y = 1.5; grp.add(beam);
    // 飛ぶ先を示す矢印
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), ringMat); arrow.position.y = 0.6; arrow.rotation.z = 0;
    const ang = Math.atan2(dx, dz); arrow.rotation.set(Math.PI / 2 - 0.5, 0, 0); const holder = new THREE.Group(); holder.rotation.y = ang; holder.add(arrow); arrow.position.set(0, 0.55, 0.55); grp.add(holder);
    this.group.add(grp);
    this.updaters.push((dt, t) => { ring.scale.setScalar(1 + Math.sin(t * 4) * 0.04); arrow.position.y = 0.55 + Math.sin(t * 5) * 0.08; });
    return grp;
  }

  // まとめて1つの形にする
  finish() {
    for (const [name, list] of Object.entries(this.batches)) {
      const cast = list.filter(x => x.cast).map(x => x.g), nocast = list.filter(x => !x.cast).map(x => x.g);
      for (const [geos, c] of [[cast, true], [nocast, false]]) {
        if (!geos.length) continue;
        const merged = mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, this.mats[name]);
        mesh.castShadow = c; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        mesh.name = 'static-' + name;
        this.group.add(mesh);
      }
    }
    this.batches = {};
  }

  // 出てくる場所が床の上で、体が入るか確かめる（ずれていたら近くへ動かす）
  checkSpawns() {
    const W = this.world, fix = (s) => {
      for (let r = 0; r < 4; r += 0.5) for (let a = 0; a < 6.28; a += 0.8) {
        const x = s[0] + Math.cos(a) * r, z = s[2] + Math.sin(a) * r;
        const g = W.groundAt(x, z, 0.2, s[1] + 0.6, 0.7);
        if (g && W.fits(x, g.y, z, BODY.r, BODY.h)) { s[0] = x; s[1] = g.y; s[2] = z; return; }
      }
      console.warn('spawn not valid', s);
    };
    this.spawns.duel.forEach(fix); this.spawns.team.forEach(t => t.forEach(fix)); this.spawns.ffa.forEach(fix);
  }
}

export function stdMat(tex, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex ? tex.map : null, normalMap: tex ? tex.normal : null, roughnessMap: tex ? tex.rough : null, metalnessMap: tex && o.metalMap ? tex.rough : null,
    roughness: o.roughness != null ? o.roughness : 1, metalness: o.metalness != null ? o.metalness : 0,
    color: o.color != null ? o.color : 0xffffff, envMapIntensity: o.env != null ? o.env : 1,
  });
  if (tex && tex.normal) m.normalScale.set(o.ns || 1, o.ns || 1);
  if (o.emissive) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei || 1; }
  return m;
}

// 光る線の材質（ブルームで光って見える）
export function glowMat(color, k = 3) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: k, roughness: 0.4, metalness: 0 });
}

// 浮島の岩：上が平らで、下がとがった形。ノイズででこぼこに
export function floatingRock(radius, depth, seed, topY = 0) {
  const g = new THREE.CylinderGeometry(radius, radius * 0.05, depth, 28, 10, false);
  g.translate(0, -depth / 2 + topY, 0);
  const p = g.attributes.position, v = new THREE.Vector3();
  const rnd = (a, b, c) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + seed * 4.1) * 43758.5453; return s - Math.floor(s); };
  const n3 = (x, y, z) => {   // 簡単な値ノイズ
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf), q = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(rnd(xi, yi, zi), rnd(xi + 1, yi, zi), u), L(rnd(xi, yi + 1, zi), rnd(xi + 1, yi + 1, zi), u), w), L(L(rnd(xi, yi, zi + 1), rnd(xi + 1, yi, zi + 1), u), L(rnd(xi, yi + 1, zi + 1), rnd(xi + 1, yi + 1, zi + 1), u), w), q);
  };
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const top = v.y > topY - 0.01;
    const k = (topY - v.y) / depth;
    const nn = n3(v.x * 0.25, v.y * 0.25, v.z * 0.25) * 0.7 + n3(v.x * 0.8, v.y * 0.8, v.z * 0.8) * 0.3;
    if (!top) {
      const s = 1 + (nn - 0.5) * 0.7 * (0.3 + k);
      v.x *= s; v.z *= s;
      v.y -= (nn - 0.5) * depth * 0.12;
      // 下へ行くほど細く・ねじれる
      const tw = k * 0.6 + seed;
      const x = v.x * Math.cos(tw * 0.3) - v.z * Math.sin(tw * 0.3), z = v.x * Math.sin(tw * 0.3) + v.z * Math.cos(tw * 0.3);
      v.x = x; v.z = z;
    } else v.y += (nn - 0.5) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// 遠くの雲の海（GPU の fbm ノイズで、ゆっくり流れる）
export function cloudSea(o) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uLit: { value: new THREE.Color(o.lit) }, uShade: { value: new THREE.Color(o.shade) }, uFog: { value: new THREE.Color(o.fog) },
      uSun: { value: new THREE.Vector3().copy(o.sunDir).normalize() }, uSunCol: { value: new THREE.Color(o.sunCol || '#ffffff') }, uScale: { value: o.scale || 0.006 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uLit, uShade, uFog, uSun, uSunCol; uniform float uScale; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){
        vec2 p = vW.xz * uScale + vec2(uTime*0.006, uTime*0.004);
        float d = fbm(p) ; float d2 = fbm(p*2.2 + d*1.5 - uTime*0.01);
        float dens = smoothstep(0.28, 0.75, d*0.65 + d2*0.45);
        vec3 V = normalize(vW - cameraPosition);
        float sunGlow = pow(max(0.0, dot(V, uSun)), 6.0);
        vec3 col = mix(uShade, uLit, smoothstep(0.2, 0.95, d2*0.6 + dens*0.5));
        col += uSunCol * sunGlow * 0.9 * (0.4 + dens);
        float dist = length(vW.xz - cameraPosition.xz);
        float fogK = smoothstep(120.0, 900.0, dist);
        col = mix(col, uFog, fogK);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 1, 1), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = o.y; m.renderOrder = -5;
  return m;
}

// 空の中の光る粒（ほこり・花粉・雪の舞い）。カメラのまわりでくり返す、GPU だけで動く
export function ambientMotes(o) {
  const n = o.count, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * o.box; pos[i * 3 + 1] = Math.random() * o.box * 0.5; pos[i * 3 + 2] = Math.random() * o.box; seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uBox: { value: o.box }, uCol: { value: new THREE.Color(o.color) }, uSize: { value: o.size }, uFall: { value: o.fall || 0 }, uScale: { value: 600 }, uStreak: { value: o.streak || 0 } },
    vertexShader: `
      attribute float aSeed; uniform float uTime, uBox, uSize, uFall, uScale; varying float vA; varying float vS;
      void main(){
        vec3 p = position;
        p.y -= uTime * uFall * (0.7 + aSeed * 0.6);
        p.x += sin(uTime*0.4 + aSeed*30.0) * 1.2 + uTime * uFall * 0.12;
        p.z += cos(uTime*0.3 + aSeed*20.0) * 1.2;
        vec3 c = cameraPosition;
        vec3 b = vec3(uBox, uBox*0.5, uBox);
        p = mod(p - c + b*0.5, b) - b*0.5 + c;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = smoothstep(uBox*0.5, uBox*0.2, d) * smoothstep(0.3, 1.5, d) * (0.5 + 0.5*sin(uTime*2.0 + aSeed*40.0));
        vS = aSeed;
        gl_PointSize = uSize * uScale / max(0.5, d);
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uStreak; varying float vA; varying float vS;
      void main(){ vec2 c = gl_PointCoord - 0.5; c.x *= 1.0 + uStreak * 6.0; float r = length(c)*2.0; float a = smoothstep(1.0, 0.0, r) * vA; gl_FragColor = vec4(uCol * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 15;
  pts.userData.mat = mat;
  return pts;
}

// 雨：カメラのまわりの細い線（GPU で落とし続ける）
export function rain(o) {
  const n = o.count, pos = new Float32Array(n * 6), seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * o.box, y = Math.random() * o.box, z = Math.random() * o.box, s = Math.random();
    pos.set([x, y, z, x, y, z], i * 6); seed[i * 2] = s; seed[i * 2 + 1] = s;
  }
  const end = new Float32Array(n * 2); for (let i = 0; i < n; i++) end[i * 2 + 1] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uBox: { value: o.box }, uCol: { value: new THREE.Color(o.color || '#9fb4d8') }, uSpeed: { value: o.speed || 24 }, uLen: { value: o.len || 0.7 } },
    vertexShader: `attribute float aSeed; attribute float aEnd; uniform float uTime, uBox, uSpeed, uLen; varying float vA;
      void main(){ vec3 p = position; p.y -= uTime * uSpeed * (0.85 + aSeed*0.3); p.x += uTime * 2.5;
        vec3 c = cameraPosition; vec3 b = vec3(uBox);
        p = mod(p - c + b*0.5, b) - b*0.5 + c;
        p.y += aEnd * uLen; p.x -= aEnd * uLen * 0.1;
        vec4 mv = viewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
        vA = smoothstep(uBox*0.5, uBox*0.15, -mv.z) * (0.35 + aEnd*0.65); }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol * vA * 0.55, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(g, mat); lines.frustumCulled = false; lines.renderOrder = 16;
  return lines;
}

export { TEX };
