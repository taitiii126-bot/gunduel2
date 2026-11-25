// ステージ3「氷の聖域」：雪山の頂上の古いお社。夜空にオーロラ、雪が舞う。真ん中のくぼみと、東西の高台
import * as THREE from '../lib/three.js';
import { ArenaBuilder, stdMat, glowMat, floatingRock, cloudSea, ambientMotes, U, TEX } from './arena-common.js';

export function buildFrost(q) {
  const B = new ArenaBuilder(q), W = B.world;
  const sz = q.id === 'low' ? 256 : 512;
  const tSnow = TEX.snow({ size: sz });
  const tStone = TEX.bricks({ size: sz, rows: 5, cols: 2, base: [0.42, 0.46, 0.55], seed: 51 });
  const tTile = TEX.stoneTiles({ size: sz, tiles: 3, base: [0.55, 0.6, 0.68], seed: 53, tint: [0.95, 1, 1.08] });
  const tIce = TEX.ice({ size: sz });
  const tRock = TEX.rock({ size: sz, base: [0.36, 0.38, 0.44], seed: 57 });
  B.addMat('snow', stdMat(tSnow, { ns: 0.8 }), 6);
  B.addMat('tile', stdMat(tTile, { ns: 1 }), 5);
  B.addMat('stone', stdMat(tStone, { ns: 1.3 }), 3);
  const ice = stdMat(tIce, { ns: 0.6, env: 1.8 }); ice.color.set(0xbfe6ff); ice.emissive = new THREE.Color(0x0a3a5a); ice.emissiveIntensity = 0.6;
  B.addMat('ice', ice, 3);
  B.addMat('wood', new THREE.MeshStandardMaterial({ color: 0xa3261e, roughness: 0.45, metalness: 0.05 }), 2);
  B.addMat('woodDark', new THREE.MeshStandardMaterial({ color: 0x1b1414, roughness: 0.6 }), 2);
  B.addMat('glowIce', glowMat('#5CF2FF', 2.6), 2);
  B.addMat('lantern', glowMat('#FFB25A', 3.5), 2);
  B.mats.padBase = new THREE.MeshStandardMaterial({ color: 0x1c2533, metalness: 0.8, roughness: 0.3 });

  // ---- 地面（真ん中はくぼみ）----
  B.box(0, -3, 14.5, 44, 3, 15, 'snow');
  B.box(0, -3, -14.5, 44, 3, 15, 'snow');
  B.box(14.5, -3, 0, 15, 3, 14, 'snow');
  B.box(-14.5, -3, 0, 15, 3, 14, 'snow');
  // くぼみ（底は石の床）
  B.box(0, -4, 0, 14, 1.6, 14, 'tile');
  for (const s of [-1, 1]) { B.box(6.92 * s, -2.4, 0, 0.16, 2.38, 13.7, 'stone', { collide: false }); B.box(0, -2.4, 6.92 * s, 13.7, 2.38, 0.16, 'stone', { collide: false }); }
  B.box(0, -0.02, 7.05, 14.2, 0.06, 0.12, 'glowIce', { collide: false, cast: false });
  B.box(0, -0.02, -7.05, 14.2, 0.06, 0.12, 'glowIce', { collide: false, cast: false });
  B.box(7.05, -0.02, 0, 0.12, 0.06, 14.2, 'glowIce', { collide: false, cast: false });
  B.box(-7.05, -0.02, 0, 0.12, 0.06, 14.2, 'glowIce', { collide: false, cast: false });
  // くぼみへ下りる坂（点対称）
  B.ramp(-5.5, 1.5, -2.5, 7, -2.4, 0, 'z', 1, 'tile', { base: -2.4 });
  B.ramp(2.5, -7, 5.5, -1.5, -2.4, 0, 'z', -1, 'tile', { base: -2.4 });
  // 真ん中の氷の柱と、まわりの小さな氷
  B.box(0, -2.4, 0, 1.8, 4.6, 1.8, 'ice');
  B.box(4.5, -2.4, 3.5, 1.5, 1.2, 1.5, 'ice');
  B.box(-4.5, -2.4, -3.5, 1.5, 1.2, 1.5, 'ice');
  // ジャンプ台（くぼみから高台へ）
  B.pad(5.2, -2.4, -0.2, [17.6, 3.6, 1.5], '#5CF2FF');
  B.pad(-5.2, -2.4, 0.2, [-17.6, 3.6, -1.5], '#5CF2FF');

  // ---- 東と西の高台 ----
  for (const s of [-1, 1]) {
    B.box(18.5 * s, 0, 0, 7, 3.6, 14, 'stone');
    B.box(18.5 * s, 3.6, 0, 7.1, 0.1, 14.1, 'snow', { collide: false });
    B.box(21.75 * s, 3.6, 0, 0.5, 1.0, 14, 'stone');                 // 外側の壁
    B.box(15.25 * s, 3.6, -4.5 * s, 0.5, 1.0, 5, 'stone');           // 内側の壁（くぼみを見下ろす）
    B.box(15.25 * s, 4.42, -4.5 * s, 0.54, 0.05, 5.04, 'glowIce', { collide: false, cast: false });
  }
  B.ramp(9, 4.5, 15, 7, 0, 3.6, 'x', 1, 'tile');
  B.ramp(-15, -7, -9, -4.5, 0, 3.6, 'x', -1, 'tile');

  // ---- 鳥居（北と南）----
  for (const s of [-1, 1]) {
    for (const x of [-4, 4]) { B.box(x, 0, 15 * s, 0.9, 5.2, 0.9, 'wood'); B.box(x, 0, 15 * s, 1.2, 0.5, 1.2, 'woodDark'); }
    B.box(0, 5.2, 15 * s, 11, 0.55, 1.1, 'woodDark', { collide: false });
    B.box(0, 4.25, 15 * s, 9.2, 0.35, 0.6, 'wood', { collide: false });
    B.box(0, 5.75, 15 * s, 11.6, 0.2, 1.3, 'woodDark', { collide: false });
  }

  // ---- 遮蔽物（点対称）----
  const both = (fn) => { fn(1); fn(-1); };
  both(s => { B.box(-10 * s, 0, 12 * s, 2, 1.3, 3, 'stone'); B.box(-10 * s, 1.3, 12 * s, 2.1, 0.18, 3.1, 'snow', { collide: false }); });
  both(s => { B.box(13 * s, 0, 13 * s, 2, 2.6, 2, 'ice'); });
  both(s => { B.box(-4 * s, 0, 10.5 * s, 4, 1.1, 0.6, 'stone'); B.box(-4 * s, 1.1, 10.5 * s, 4.1, 0.15, 0.7, 'snow', { collide: false }); });
  both(s => { B.box(9 * s, 0, 18.5 * s, 3, 1.1, 0.6, 'stone'); });
  both(s => { B.box(-17 * s, 0, 18 * s, 1.6, 1.4, 1.6, 'ice'); B.box(-18.5 * s, 0, 15.5 * s, 1.0, 2.2, 1.0, 'ice'); });
  both(s => { B.box(10.5 * s, 0, -10 * s, 1.2, 3.4, 1.2, 'stone'); });
  // 石の灯籠
  both(s => {
    for (const [x, z] of [[8, 21], [-8, 21]]) {
      const X = x * s, Z = z * s;
      B.box(X, 0, Z, 0.7, 1.2, 0.7, 'stone');
      B.box(X, 1.2, Z, 0.95, 0.12, 0.95, 'stone', { collide: false });
      B.box(X, 1.32, Z, 0.55, 0.42, 0.55, 'lantern', { collide: false, cast: false });
      B.box(X, 1.74, Z, 1.05, 0.18, 1.05, 'stone', { collide: false });
    }
  });

  // ---- まわりの低い雪の壁 ----
  const wall = (x, z, w, d) => B.box(x, 0, z, w, 0.9, d, 'stone');
  const segX = (z, list) => list.forEach(([a, b]) => wall((a + b) / 2, z, b - a, 0.6));
  const segZ = (x, list) => list.forEach(([a, b]) => wall(x, (a + b) / 2, 0.6, b - a));
  segX(21.7, [[-22, -12], [-5, 5], [12, 22]]); segX(-21.7, [[-22, -12], [-5, 5], [12, 22]]);
  segZ(21.7, [[-22, -12], [12, 22]]); segZ(-21.7, [[-22, -12], [12, 22]]);

  B.spawns.duel = [[0, 0, 19, Math.PI], [0, 0, -19, 0]];
  B.spawns.team = [[[-2.5, 0, 19, Math.PI], [2.5, 0, 19, Math.PI]], [[2.5, 0, -19, 0], [-2.5, 0, -19, 0]]];
  B.spawns.ffa = [[0, 0, 19, Math.PI], [0, 0, -19, 0], [18.5, 3.6, -2, -Math.PI / 2], [-18.5, 3.6, 2, Math.PI / 2], [18, 0, 14, -Math.PI / 2], [-18, 0, -14, Math.PI / 2], [-14, 0, 19.5, Math.PI], [14, 0, -19.5, 0]];
  W.bounds = { minX: -23, maxX: 23, minZ: -23, maxZ: 23 };
  W.killY = -16;
  B.finish();
  B.checkSpawns();

  const G = B.group;
  // 山の頂上の岩
  const rockMat = stdMat(tRock, { ns: 1.4 }); tRock.map.repeat.set(6, 3); tRock.normal.repeat.set(6, 3); tRock.rough.repeat.set(6, 3);
  const peak = new THREE.Mesh(floatingRock(25, 120, 4.2, -3.02), rockMat); peak.receiveShadow = true; G.add(peak);
  // 雪の木（まとめて描く）
  const treeGeo = (() => { const parts = []; for (let i = 0; i < 3; i++) { const c = new THREE.ConeGeometry(1.4 - i * 0.35, 1.8, 8); c.translate(0, 1.2 + i * 1.0, 0); parts.push(c.toNonIndexed()); } const tr = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6); tr.translate(0, 0.6, 0); parts.push(tr.toNonIndexed()); return mergeSimple(parts); })();
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x2c4a44, roughness: 0.85 });
  const snowCap = new THREE.MeshStandardMaterial({ color: 0xe6f0ff, roughness: 0.7 });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, 60), caps = new THREE.InstancedMesh(treeGeo, snowCap, 60);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
  let k = 0;
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * 6.28, r = 26 + Math.random() * 10;
    ps.set(Math.cos(a) * r, -3 - (r - 25) * 1.2 - Math.random() * 2, Math.sin(a) * r);
    const s = 1 + Math.random() * 1.4; qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
    trees.setMatrixAt(k, m4.compose(ps, qq, sc.set(s, s, s)));
    caps.setMatrixAt(k, m4.compose(ps.add(new THREE.Vector3(0, 0.12 * s, 0)), qq, sc.set(s * 0.92, s * 0.75, s * 0.92)));
    k++;
  }
  trees.castShadow = true; G.add(trees); G.add(caps);
  // 浮かぶ氷のかけら
  const shardGeo = new THREE.OctahedronGeometry(1, 0); shardGeo.scale(0.5, 1.6, 0.5);
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x3ad7ff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.1, envMapIntensity: 2 });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, 30), sd = [];
  for (let i = 0; i < 30; i++) sd.push({ a: Math.random() * 6.28, r: 27 + Math.random() * 12, y: 1 + Math.random() * 12, s: 0.6 + Math.random() * 1.5, sp: (Math.random() < 0.5 ? -1 : 1) * (0.015 + Math.random() * 0.03) });
  G.add(shards);
  B.updaters.push((dt, t) => {
    for (let i = 0; i < sd.length; i++) { const d = sd[i], a = d.a + t * d.sp; ps.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.6 + i) * 0.8, Math.sin(a) * d.r); qq.setFromEuler(new THREE.Euler(0.3 * Math.sin(t + i), t * 0.4 + i, 0)); sc.setScalar(d.s); shards.setMatrixAt(i, m4.compose(ps, qq, sc)); }
    shards.instanceMatrix.needsUpdate = true;
  });
  // 真ん中の氷の柱の中の光
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.5, 4) })); core.position.set(0, 0.4, 0); G.add(core);
  const coreL = new THREE.PointLight(0x5cf2ff, 14, 14, 2); coreL.position.set(0, 1.2, 0); G.add(coreL);
  B.updaters.push((dt, t) => { core.rotation.y = t; coreL.intensity = 12 + Math.sin(t * 2.2) * 3; });
  // 灯籠の光（2つだけ。数を決めておく）
  const lan1 = new THREE.PointLight(0xffa64a, 10, 14, 2); lan1.position.set(0, 2, 20); G.add(lan1);
  const lan2 = new THREE.PointLight(0xffa64a, 10, 14, 2); lan2.position.set(0, 2, -20); G.add(lan2);
  B.updaters.push((dt, t) => { lan1.intensity = 9 + Math.sin(t * 9) * 0.6 + Math.sin(t * 23) * 0.4; lan2.intensity = 9 + Math.sin(t * 8 + 1) * 0.6; });

  // 遠くの山なみ（ノイズで作った輪）
  const mtn = mountains();
  G.add(mtn);
  // 雲の海（山の下）
  G.add(cloudSea({ y: -120, lit: '#5c6f9a', shade: '#1a2140', fog: '#18203a', sunDir: new THREE.Vector3(0.3, 0.4, -0.8), sunCol: '#5a7ab0', scale: 0.004 }));
  // 夜空・星・月・オーロラ
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      void main(){ float y = vP.y;
        vec3 col = mix(vec3(0.07,0.12,0.22), vec3(0.01,0.015,0.05), smoothstep(-0.1, 0.7, y));
        col += vec3(0.1,0.2,0.35) * exp(-abs(y)*7.0) * 0.6;
        vec3 sp = floor(vP * 420.0); float st = h(sp);
        float star = step(0.9965, st) * smoothstep(0.0, 0.2, y) * (0.6 + 0.4*sin(uTime*3.0 + st*100.0));
        col += vec3(star) * (0.8 + 1.5*step(0.9995, st));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  G.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat));
  const moonPos = new THREE.Vector3(-0.35, 0.55, -0.76).normalize();
  const moonMesh = new THREE.Mesh(new THREE.CircleGeometry(38, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.3, 2.6), fog: false }));
  moonMesh.position.copy(moonPos).multiplyScalar(1200); moonMesh.lookAt(0, 0, 0); G.add(moonMesh);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow(256, 'rgba(170,200,255,1)', 'rgba(120,150,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.6 }));
  moonGlow.position.copy(moonMesh.position); moonGlow.scale.setScalar(420); G.add(moonGlow);
  for (let i = 0; i < 4; i++) G.add(auroraRibbon(i));

  // 雪
  G.add(ambientMotes({ count: Math.round(2600 * q.particles), box: 60, color: '#E8F2FF', size: 0.06, fall: 2.2 }));

  // ---- 光 ----
  const moon = new THREE.DirectionalLight(0xbfd0ff, 1.9); moon.position.copy(moonPos).multiplyScalar(110); G.add(moon); G.add(moon.target);
  const hemi = new THREE.HemisphereLight(0x6d8dc8, 0x1a2030, 0.85); G.add(hemi);
  // 環境マップ（夜空と雪の照り返し）
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8), new THREE.MeshBasicMaterial({ color: 0x1c2a48, side: THREE.BackSide })));
  const aur = new THREE.Mesh(new THREE.PlaneGeometry(600, 80), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 0.8), side: THREE.DoubleSide })); aur.position.set(0, 140, -200); aur.lookAt(0, 0, 0); env.add(aur);
  env.add(new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2).translate(0, -20, 0), new THREE.MeshBasicMaterial({ color: 0x8090b0 })));

  return {
    id: 'frost', builder: B, group: G, world: W, spawns: B.spawns, sun: moon, sunExtent: 32, envScene: env,
    fog: new THREE.Fog(0x1a2540, 60, 520), background: null,
    grade: { tint: new THREE.Color(0.96, 1.0, 1.06), sat: 1.05, contrast: 1.06, bloom: 0.6, bloomThreshold: 1.05, bloomRadius: 0.6, exposure: 1.1, vignette: 0.34 },
    dust: 0.85, music: 'battle',
    update(dt, t) { for (const f of B.updaters) f(dt, t); },
    title: { center: new THREE.Vector3(0, 1, 0), radius: 25, height: 8 },
  };
}

function mergeSimple(list) {
  const pos = [], nor = [];
  for (const g of list) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// 山なみ：遠くをぐるっと囲む、雪をかぶった峰（頂点の色で岩と雪を塗り分け）
function mountains() {
  const seg = 160, rings = 6, pos = [], col = [], idx = [];
  const R0 = 380, R1 = 900;
  const nz = (a, r) => { let s = 0, f = 1, amp = 1; for (let o = 0; o < 5; o++) { s += amp * (Math.sin(a * 3 * f + o * 1.7) * 0.5 + Math.sin(a * 7.3 * f + r * 0.01 + o) * 0.5); f *= 2.03; amp *= 0.5; } return s; };
  for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, t = j / rings, r = R0 + (R1 - R0) * t;
    const ridge = Math.abs(nz(a, r));
    const h = (j === 0 ? -260 : j === rings ? -120 : 60 + ridge * 220 * Math.sin(t * Math.PI) + (1 - t) * 40) ;
    pos.push(Math.cos(a) * r, h - 140, Math.sin(a) * r);
    const snow = h > 120 ? 1 : h > 70 ? (h - 70) / 50 : 0;
    col.push(0.28 + snow * 0.55, 0.32 + snow * 0.55, 0.42 + snow * 0.5);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
}

// オーロラ：空の高いところで、ゆっくり波打つ光のカーテン
function auroraRibbon(i) {
  const g = new THREE.PlaneGeometry(900, 160, 120, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uSeed: { value: i * 3.7 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform float uTime; uniform float uSeed; varying vec2 vUv; varying float vX;
      void main(){ vUv = uv; vec3 p = position;
        p.z += sin(p.x*0.006 + uTime*0.12 + uSeed) * 90.0 + sin(p.x*0.017 - uTime*0.2 + uSeed*2.0) * 30.0;
        p.y += sin(p.x*0.01 + uTime*0.15 + uSeed) * 18.0;
        vX = p.x; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uSeed; varying vec2 vUv; varying float vX;
      void main(){
        float curtain = 0.5 + 0.5*sin(vX*0.08 + uTime*0.6 + uSeed*5.0) * sin(vX*0.023 - uTime*0.25);
        float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y) * smoothstep(0.0,0.15,vUv.x) * smoothstep(1.0,0.85,vUv.x);
        vec3 col = mix(vec3(0.1,1.0,0.55), vec3(0.6,0.25,1.0), smoothstep(0.35, 1.0, vUv.y));
        gl_FragColor = vec4(col * fade * (0.25 + curtain*0.75) * 0.55, 1.0);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.set(-150 + i * 120, 230 + i * 25, -420 - i * 60);
  m.rotation.set(0.25, 0.3 * (i - 1.5), 0);
  return m;
}
