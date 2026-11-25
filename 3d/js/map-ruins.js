// ステージ1「天空遺跡ソラリア」：雲の海に浮かぶ古い石の闘技場。夕暮れの太陽、遠くの浮島と滝、空にかかる大きな石の輪
import * as THREE from '../lib/three.js';
import { Sky } from '../lib/three.js';
import { ArenaBuilder, stdMat, glowMat, floatingRock, cloudSea, ambientMotes, windify, U, TEX } from './arena-common.js';

export function buildRuins(q) {
  const B = new ArenaBuilder(q), W = B.world;
  const sz = q.id === 'low' ? 256 : 512;
  // ---- 材質 ----
  const tFloor = TEX.stoneTiles({ size: sz, tiles: 4, base: [0.74, 0.64, 0.5], seed: 3 });
  const tStone = TEX.bricks({ size: sz, rows: 6, cols: 3, base: [0.78, 0.68, 0.54], moss: true, seed: 9 });
  const tDark = TEX.bricks({ size: sz, rows: 4, cols: 2, base: [0.5, 0.45, 0.4], seed: 12 });
  const tRock = TEX.rock({ size: sz, base: [0.5, 0.4, 0.32], seed: 23 });
  const tGrass = TEX.grass({ size: sz });
  B.addMat('floor', stdMat(tFloor, { ns: 1 }), 6);
  B.addMat('stone', stdMat(tStone, { ns: 1.2 }), 3);
  B.addMat('dark', stdMat(tDark, { ns: 1.2 }), 3);
  B.addMat('gold', new THREE.MeshStandardMaterial({ color: 0xd8a34a, metalness: 1, roughness: 0.28 }), 2);
  B.addMat('trim', glowMat('#FFB52E', 1.1), 2);
  B.mats.padBase = new THREE.MeshStandardMaterial({ color: 0x3a2f24, metalness: 0.7, roughness: 0.35 });

  // ---- 地面（角を落とした四角の大きな石の台）----
  B.box(0, -3, 0, 46, 3, 32, 'floor');
  B.box(0, -3, 0, 32, 3, 46, 'floor');
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) B.box(sx * 18.5, -3, sz2 * 18.5, 5, 3, 5, 'floor');
  // 縁石（落ちる場所の目印）
  const curb = (x, z, w, d) => B.box(x, 0, z, w, 0.22, d, 'dark');
  // ---- まわりの低い壁（すきまから落ちることがある）----
  const wall = (x, z, w, d, h = 1.0) => { B.box(x, 0, z, w, h, d, 'stone'); B.box(x, h - 0.2, z, w + 0.05, 0.05, d + 0.05, 'trim', { collide: false, cast: false }); };
  const segX = (z, list) => list.forEach(([a, b]) => wall((a + b) / 2, z, b - a, 0.6));
  const segZ = (x, list) => list.forEach(([a, b]) => wall(x, (a + b) / 2, 0.6, b - a));
  segX(22.7, [[-16, -9], [-4, 4], [9, 16]]); segX(-22.7, [[-16, -9], [-4, 4], [9, 16]]);
  segZ(22.7, [[-16, -11], [-5, 5], [11, 16]]); segZ(-22.7, [[-16, -11], [-5, 5], [11, 16]]);
  for (const s of [-1, 1]) { curb(s * -6.5, 22.75, 5, 0.5); curb(s * 6.5, 22.75, 5, 0.5); curb(22.75, s * 8, 0.5, 6); curb(-22.75, s * 8, 0.5, 6); }
  for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) { curb(sx * 18.5, sz2 * 20.85, 5, 0.3); curb(sx * 20.85, sz2 * 18.5, 0.3, 5); }

  // ---- 真ん中の台（坂2つ）と、石のアーチ ----
  B.box(0, 0, 0, 10, 1.2, 10, 'stone');
  B.box(0, 1.2, 0, 10.4, 0.2, 10.4, 'floor');
  B.box(0, 1.1, 0, 10.46, 0.05, 10.46, 'trim', { collide: false, cast: false });
  B.ramp(5.2, -2, 9.4, 2, 0, 1.4, 'x', -1, 'floor');
  B.ramp(-9.4, -2, -5.2, 2, 0, 1.4, 'x', 1, 'floor');
  for (const s of [-1, 1]) {
    B.box(0, 1.4, s * 3.5, 1.2, 4.6, 1.2, 'stone');
    B.box(0, 1.4, s * 3.5, 1.5, 0.35, 1.5, 'dark');
    B.box(0, 5.75, s * 3.5, 1.5, 0.3, 1.5, 'gold', { collide: false });
  }
  B.box(0, 6.0, 0, 1.3, 0.75, 8.6, 'stone', { collide: true });
  B.box(0, 6.32, 0, 1.36, 0.05, 8.66, 'trim', { collide: false, cast: false });

  // ---- 2つの塔（上はスナイパーの場所。坂とジャンプ台で上がる）----
  const tower = (s) => {
    const cx = 14 * s, cz = -8 * s;
    B.box(cx, 0, cz, 7, 4.4, 7, 'stone');
    B.box(cx, 4.4, cz, 7.3, 0.15, 7.3, 'floor', { collide: false });
    B.box(cx, 4.12, cz, 7.06, 0.05, 7.06, 'trim', { collide: false, cast: false });
    // 上の低い壁
    const top = 4.4;
    const tw = (x, z, w, d) => { B.box(x, top, z, w, 0.95, d, 'stone'); };
    tw(cx, cz + 3.25 * s, 7, 0.5);                 // 真ん中側
    tw(cx + 3.25 * s, cz, 0.5, 7);                 // 外側
    tw(cx + 1 * s, cz - 3.25 * s, 5, 0.5);         // 坂の反対
    tw(cx - 3.25 * s, cz + 1.5 * s, 0.5, 4);       // 坂の上の横
    // 坂（真ん中のほうから上がる）
    if (s > 0) B.ramp(1.5, -11.5, 10.5, -9, 0, 4.4, 'x', 1, 'floor');
    else B.ramp(-10.5, 9, -1.5, 11.5, 0, 4.4, 'x', -1, 'floor');
    // 塔の柱の飾り
    for (const [ox, oz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) B.box(cx + ox, 0, cz + oz, 0.9, 5.6, 0.9, 'dark', { collide: false });
  };
  tower(1); tower(-1);

  // ---- 遮蔽物（点対称に置く）----
  const both = (fn) => { fn(1); fn(-1); };
  both(s => { B.box(-8 * s, 0, 13 * s, 5, 1.15, 0.6, 'stone'); B.box(-8 * s, 0.92, 13 * s, 5.05, 0.05, 0.65, 'trim', { collide: false, cast: false }); });
  both(s => { B.box(9 * s, 0, 12 * s, 0.6, 1.15, 4, 'stone'); });
  both(s => { B.box(-15 * s, 0, -1 * s, 0.6, 1.15, 5, 'stone'); });
  both(s => { B.box(-4 * s, 0, 7.8 * s, 1.3, 3.2, 1.3, 'stone'); B.box(-4 * s, 0, 7.8 * s, 1.6, 0.3, 1.6, 'dark'); });
  both(s => { B.box(5 * s, 0, 7.5 * s, 1.3, 2.2, 1.3, 'stone'); B.box(5 * s, 0, 7.5 * s, 1.6, 0.3, 1.6, 'dark'); });
  both(s => { B.box(-10 * s, 0, 3 * s, 1.3, 4.0, 1.3, 'stone'); B.box(-10 * s, 3.85, 3 * s, 1.5, 0.25, 1.5, 'gold', { collide: false }); });
  both(s => { B.box(18 * s, 0, 13 * s, 1.3, 3.0, 1.3, 'stone'); });
  both(s => { B.box(-2 * s, 0, 15.5 * s, 1.8, 1.6, 1.8, 'dark'); });
  both(s => { B.box(14 * s, 0, 8 * s, 1.8, 1.6, 1.8, 'dark'); B.box(14.3 * s, 1.6, 8.2 * s, 1.2, 1.0, 1.2, 'stone'); });
  both(s => { B.box(-19 * s, 0, 6 * s, 2, 1.3, 3, 'dark'); });
  // 倒れた柱（当たり判定は箱、見た目は円柱）
  const colMat = B.mats.stone;
  both(s => {
    W.addBox(6.5 * s - 2.25, 0, 15 * s - 0.5, 6.5 * s + 2.25, 1.0, 15 * s + 0.5);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 4.5, 20), colMat);
    c.rotation.z = Math.PI / 2; c.position.set(6.5 * s, 0.52, 15 * s); c.castShadow = c.receiveShadow = true; B.group.add(c);
  });

  // ---- ジャンプ台 ----
  B.pad(19.6, 0, 2.5, [15.2, 4.4, -6.4], '#FFC53D');
  B.pad(-19.6, 0, -2.5, [-15.2, 4.4, 6.4], '#FFC53D');

  // ---- 出てくる場所 ----
  B.spawns.duel = [[0, 0, 19.5, Math.PI], [0, 0, -19.5, 0]];
  B.spawns.team = [[[-3, 0, 19.5, Math.PI], [3, 0, 19.5, Math.PI]], [[3, 0, -19.5, 0], [-3, 0, -19.5, 0]]];
  B.spawns.ffa = [[0, 0, 19.5, Math.PI], [0, 0, -19.5, 0], [20.5, 0, 7, -Math.PI / 2], [-20.5, 0, -7, Math.PI / 2], [20.5, 0, -15, -Math.PI / 2], [-20.5, 0, 15, Math.PI / 2], [-12, 0, -19, 0], [12, 0, 19, Math.PI]];
  W.bounds = { minX: -24, maxX: 24, minZ: -24, maxZ: 24 };
  W.killY = -14;
  B.finish();
  B.checkSpawns();

  // ================= 見た目だけの物 =================
  const G = B.group;
  // 台の下の大きな岩
  const rockMat = stdMat(tRock, { ns: 1.5 });
  tRock.map.repeat.set(6, 3); tRock.normal.repeat.set(6, 3); tRock.rough.repeat.set(6, 3);
  const under = new THREE.Mesh(floatingRock(25.5, 52, 1.3, -3.02), rockMat); under.receiveShadow = true; G.add(under);
  const grassMat = stdMat(tGrass, {}); tGrass.map.repeat.set(8, 8);

  // 草のふさ（GPU でまとめて描き、風でゆれる）
  const tuftGeo = (() => { const g1 = new THREE.PlaneGeometry(0.7, 0.55, 1, 3); g1.translate(0, 0.27, 0); const g2 = g1.clone(); g2.rotateY(Math.PI / 2); const g3 = g1.clone(); g3.rotateY(Math.PI / 4); return mergeBuf([g1, g2, g3]); })();
  const tuftMat = windify(new THREE.MeshStandardMaterial({ color: 0x6e8f3a, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5, map: bladeTexture() }), 0.12, 1.8);
  const tuftN = Math.round(900 * q.decor);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftN);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let k = 0;
  // 台の上の、壁ぎわ・柱のまわりの草
  for (const b of W.boxes) {
    if (k >= tuftN) break;
    if (b.max[1] < 0.9 || b.min[1] > 0.05 || b.max[1] > 7) continue;
    for (let j = 0; j < 9 && k < tuftN; j++) {
      const side = Math.random() < 0.5 ? 0 : 1, t = Math.random();
      const x = side ? (Math.random() < 0.5 ? b.min[0] - 0.15 : b.max[0] + 0.15) : b.min[0] + (b.max[0] - b.min[0]) * t;
      const z = side ? b.min[2] + (b.max[2] - b.min[2]) * t : (Math.random() < 0.5 ? b.min[2] - 0.15 : b.max[2] + 0.15);
      if (Math.abs(x) > 22.5 || Math.abs(z) > 22.5) continue;
      ps.set(x, 0, z); qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28); const s = 0.5 + Math.random() * 0.5; sc.set(s, s, s);
      tufts.setMatrixAt(k++, m4.compose(ps, qq, sc));
    }
  }
  tufts.count = k; tufts.castShadow = false; tufts.receiveShadow = true; G.add(tufts);

  // 旗（紫と金。風でなびく）
  const bannerMat = windify(new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.85 }), 0.45, 2.2);
  for (const [x, z] of [[21, 21], [-21, -21], [21, -21], [-21, 21]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 7.5, 10), B.mats.gold); pole.position.set(x, 3.75, z); pole.castShadow = true; G.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4.2, 4, 12), bannerMat);
    fl.geometry.translate(0.85, 0, 0);
    // 旗の uv.y は根元（ポール側）ほどゆれないように：uv を横向きに
    const uv = fl.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
    fl.position.set(x, 5, z); fl.rotation.y = Math.atan2(-x, -z) + Math.PI / 2; fl.castShadow = true; G.add(fl);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), glowMat('#FFC53D', 1.5)); cap.position.set(x, 7.6, z); G.add(cap);
  }

  // 真ん中の太陽の結晶（ゆっくり回って光る）
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: 0x2a1a00, emissive: 0xffb43a, emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.2 }));
  crystal.position.set(0, 4.2, 0); crystal.scale.set(1, 1.6, 1); G.add(crystal);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.04, 8, 64), glowMat('#FFD27A', 1.6)); halo.position.copy(crystal.position); G.add(halo);
  const halo2 = halo.clone(); G.add(halo2);
  const cLight = new THREE.PointLight(0xffb45a, 18, 16, 2); cLight.position.set(0, 4.2, 0); G.add(cLight);
  B.updaters.push((dt, t) => {
    crystal.rotation.y = t * 0.6; crystal.position.y = 4.2 + Math.sin(t * 1.3) * 0.18;
    halo.rotation.set(t * 0.7, t * 0.4, 0); halo2.rotation.set(-t * 0.5, 0, t * 0.6);
    halo.position.y = halo2.position.y = crystal.position.y;
    cLight.intensity = 16 + Math.sin(t * 3) * 3;
  });

  // 空に浮かぶ金の石（ゆっくり回る）
  const runeGeo = new THREE.DodecahedronGeometry(0.6, 0);
  const runes = new THREE.InstancedMesh(runeGeo, new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.8, emissive: 0xffa53a, emissiveIntensity: 0.08 }), 24);
  const runeData = [];
  for (let i = 0; i < 24; i++) runeData.push({ a: i / 24 * Math.PI * 2, r: 30 + Math.random() * 10, y: 2 + Math.random() * 10, s: 0.5 + Math.random() * 1.4, sp: 0.02 + Math.random() * 0.03 });
  G.add(runes);
  B.updaters.push((dt, t) => {
    for (let i = 0; i < runeData.length; i++) {
      const d = runeData[i], a = d.a + t * d.sp;
      ps.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.5 + i) * 0.6, Math.sin(a) * d.r); qq.setFromEuler(new THREE.Euler(t * 0.2 + i, t * 0.3, 0)); sc.setScalar(d.s);
      runes.setMatrixAt(i, m4.compose(ps, qq, sc));
    }
    runes.instanceMatrix.needsUpdate = true;
  });

  // 遠くの浮島（木・小さな遺跡・滝）
  const islandMat = stdMat(tRock, { ns: 1 });
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.9 }), trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.9 });
  const fallMat = waterfallMaterial();
  const islands = [[95, 18, -40, 14], [-110, -8, 30, 18], [60, -22, 120, 22], [-70, 30, -130, 16], [160, 6, 60, 26], [-170, -30, -60, 30], [20, 40, -190, 20], [-30, -40, 170, 24]];
  islands.forEach(([x, y, z, r], i) => {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const rk = new THREE.Mesh(floatingRock(r, r * 1.6, i * 2.3 + 0.7, 0), islandMat); g.add(rk);
    const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 32), grassMat); top.rotation.x = -Math.PI / 2; top.position.y = 0.12; g.add(top);
    for (let t = 0; t < 4 + (r / 4 | 0); t++) {
      const a = Math.random() * 6.28, d = Math.random() * r * 0.75, h = 3 + Math.random() * 4;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h * 0.4, 6), trunkMat); tr.position.set(Math.cos(a) * d, h * 0.2, Math.sin(a) * d); g.add(tr);
      const cn = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h, 7), treeMat); cn.position.set(tr.position.x, h * 0.4 + h * 0.5, tr.position.z); g.add(cn);
    }
    if (i % 2 === 0) for (let c = 0; c < 3; c++) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1, 3 + c, 1), B.mats.stone); col.position.set(-r * 0.3 + c * 2, (3 + c) / 2, r * 0.2); g.add(col);
    }
    if (i % 3 !== 2) {
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(r * 0.25, 70, 1, 1), fallMat);
      fall.position.set(0, -35, r * 0.93); g.add(fall);
    }
    G.add(g);
    B.updaters.push((dt, t) => { g.position.y = y + Math.sin(t * 0.15 + i) * 1.5; });
  });

  // 金の光の粒（花粉のようにただよう）
  const motes = ambientMotes({ count: Math.round(700 * q.particles), box: 70, color: '#FFD08A', size: 0.09, fall: -0.05 });
  G.add(motes);

  // ---- 空・光 ----
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(78), THREE.MathUtils.degToRad(115));
  const sky = new Sky(); sky.scale.setScalar(4500);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.2; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.0022; su.mieDirectionalG.value = 0.78; su.sunPosition.value.copy(sunDir);
  if (su.cloudCoverage) { su.cloudCoverage.value = 0.35; su.cloudDensity.value = 0.5; su.cloudElevation.value = 0.5; }
  G.add(sky);
  const sea = cloudSea({ y: -70, lit: '#FFE2C2', shade: '#9C7E9E', fog: '#E8B79A', sunDir, sunCol: '#FFB070', scale: 0.0045 });
  G.add(sea);
  const sun = new THREE.DirectionalLight(0xffc996, 2.6);
  sun.position.copy(sunDir).multiplyScalar(120); sun.target.position.set(0, 0, 0);
  G.add(sun); G.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x8ea4e8, 0x5a3a26, 0.3); G.add(hemi);
  // 太陽：空の太陽の円は明るすぎて画面全体がにじむので消し、明るさを決めた光の円を置く（建物に隠れる）
  if (su.showSunDisc) su.showSunDisc.value = 0;
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow(256, 'rgba(255,236,200,1)', 'rgba(255,180,110,0)'), color: new THREE.Color(5, 3.9, 2.8), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  sunSprite.position.copy(sunDir).multiplyScalar(1500); sunSprite.scale.setScalar(260); sunSprite.renderOrder = -4; G.add(sunSprite);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow(256, 'rgba(255,190,120,1)', 'rgba(255,140,80,0)'), color: new THREE.Color(0.32, 0.2, 0.12), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  sunHalo.position.copy(sunSprite.position); sunHalo.scale.setScalar(900); sunHalo.renderOrder = -5; G.add(sunHalo);
  // 環境マップ用の場面（空と雲の海だけ）
  const env = new THREE.Scene();
  const sky2 = new Sky(); sky2.scale.setScalar(4500); sky2.material.uniforms.sunPosition.value.copy(sunDir); if (sky2.material.uniforms.showSunDisc) sky2.material.uniforms.showSunDisc.value = 0;
  for (const k2 of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k2].value = su[k2].value;
  env.add(sky2);
  const envFloor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: 0x8a6a62 })); envFloor.rotation.x = -Math.PI / 2; envFloor.position.y = -40; env.add(envFloor);

  return {
    id: 'ruins', builder: B, group: G, world: W, spawns: B.spawns, sun, sunExtent: 33, envScene: env,
    fog: new THREE.Fog(0xe6b296, 90, 700), background: null,
    grade: { tint: new THREE.Color(1.04, 1.0, 0.95), sat: 1.12, contrast: 1.08, bloom: 0.24, bloomThreshold: 2.2, bloomRadius: 0.4, exposure: 0.72, vignette: 0.3 }, envIntensity: 0.45,
    dust: 0.7, music: 'battle', ambient: null,
    update(dt, t) { for (const f of B.updaters) f(dt, t); },
    title: { center: new THREE.Vector3(0, 2, 0), radius: 26, height: 9 },
  };
}

function mergeBuf(list) {
  const pos = [], nor = [], uv = [];
  for (const g of list) { const gg = g.index ? g.toNonIndexed() : g; pos.push(...gg.attributes.position.array); nor.push(...gg.attributes.normal.array); uv.push(...gg.attributes.uv.array); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// 草の葉の絵（すきまは透明）
function bladeTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 6 + Math.random() * 116, w = 3 + Math.random() * 4, h = 60 + Math.random() * 66, lean = (Math.random() - 0.5) * 30;
    const gr = g.createLinearGradient(0, 128, 0, 128 - h); gr.addColorStop(0, '#3d5a1c'); gr.addColorStop(1, Math.random() < 0.3 ? '#d8c870' : '#9cc25a');
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); g.quadraticCurveTo(x + lean * 0.3 + 1, 128 - h * 0.6, x + w, 128); g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 旗の模様（GUN DUEL の照準の印）
function bannerTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#4c1d95'); gr.addColorStop(1, '#2e1065');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#E8B730'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 498, 256, 14); g.fillRect(16, 0, 6, 512); g.fillRect(234, 0, 6, 512);
  g.strokeStyle = '#FFC53D'; g.lineWidth = 14; g.lineCap = 'round';
  g.beginPath(); g.arc(128, 220, 62, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#FFC53D'; g.beginPath(); g.arc(128, 220, 18, 0, Math.PI * 2); g.fill();
  for (const [a, b, c, d] of [[128, 120, 128, 160], [128, 280, 128, 320], [28, 220, 68, 220], [188, 220, 228, 220]]) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  g.font = '900 40px "Dela Gothic One",sans-serif'; g.textAlign = 'center'; g.fillText('GUN', 128, 400); g.fillText('DUEL', 128, 446);
  // 下を三角に切る
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(0, 512); g.lineTo(128, 470); g.lineTo(256, 512); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 滝（白いしぶきが下へ流れる）
function waterfallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.time }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){ vec2 p = vec2(vUv.x*6.0, vUv.y*8.0 + uTime*1.8); float s = n(p)*0.6 + n(p*2.3)*0.4;
        float edge = smoothstep(0.0,0.25,vUv.x)*smoothstep(1.0,0.75,vUv.x);
        float a = edge * smoothstep(0.0, 0.5, vUv.y) * (0.35 + s*0.55);
        gl_FragColor = vec4(vec3(0.92,0.95,1.0)*(0.7+s*0.4), a * 0.8);
        #include <colorspace_fragment>
      }`,
  });
}
