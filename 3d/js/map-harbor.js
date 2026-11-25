// ステージ2「ネオン・ハーバー」：雨の夜、港町の高いビルの屋上2つ。真ん中の路地の上に大きな広告の台。落ちたら下の通りまで真っ逆さま
import * as THREE from '../lib/three.js';
import { ArenaBuilder, stdMat, glowMat, ambientMotes, rain, U, TEX } from './arena-common.js';

export function buildHarbor(q) {
  const B = new ArenaBuilder(q), W = B.world;
  const sz = q.id === 'low' ? 256 : 512;
  const tRoof = TEX.concrete({ size: sz, wet: true, base: [0.3, 0.31, 0.35], seed: 11 });
  const tMetal = TEX.metalPanels({ size: sz, base: [0.42, 0.44, 0.48], seed: 5 });
  const tRed = TEX.corrugated({ size: 256, base: [0.62, 0.14, 0.12], seed: 13 });
  const tBlue = TEX.corrugated({ size: 256, base: [0.12, 0.28, 0.55], seed: 31 });
  const tYel = TEX.corrugated({ size: 256, base: [0.75, 0.55, 0.1], seed: 37 });
  const tWall = TEX.concrete({ size: sz, base: [0.45, 0.44, 0.47], seed: 41 });
  B.addMat('roof', stdMat(tRoof, { ns: 0.35, env: 0.9 }), 7);
  B.addMat('metal', stdMat(tMetal, { metalMap: true, metalness: 1, env: 1.2 }), 3);
  B.addMat('red', stdMat(tRed, { metalMap: true, metalness: 1 }), 2.5);
  B.addMat('blue', stdMat(tBlue, { metalMap: true, metalness: 1 }), 2.5);
  B.addMat('yel', stdMat(tYel, { metalMap: true, metalness: 1 }), 2.5);
  B.addMat('wall', stdMat(tWall, { ns: 1 }), 3);
  B.addMat('hazard', new THREE.MeshStandardMaterial({ map: (() => { const t = TEX.hazard(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })(), roughness: 0.6 }), 1.2);
  B.addMat('cyan', glowMat('#22E5FF', 1.6), 2);
  B.addMat('pink', glowMat('#FF3DB8', 1.3), 2);
  B.addMat('dark', new THREE.MeshStandardMaterial({ color: 0x15171d, metalness: 0.8, roughness: 0.4 }), 2);
  B.mats.padBase = new THREE.MeshStandardMaterial({ color: 0x1a1c24, metalness: 0.9, roughness: 0.3 });

  // ---- 屋上2つ（間の路地は落ちる）----
  B.box(0, -2, 13.5, 48, 2, 19, 'roof');
  B.box(0, -2, -13.5, 48, 2, 19, 'roof');
  // 屋上の縁（注意の帯）
  for (const s of [-1, 1]) B.box(0, 0, 4.15 * s, 48, 0.06, 0.3, 'hazard', { collide: false, cast: false });
  // ---- 橋（手すりは弾が抜ける）----
  for (const x of [-11, 11]) {
    B.box(x, -0.35, 0, 3, 0.35, 8.4, 'metal');
    for (const s of [-1, 1]) {
      B.box(x + s * 1.45, 0, 0, 0.08, 1.05, 8.4, 'dark', { shoot: false });
      B.box(x + s * 1.45, 1.05, 0, 0.14, 0.06, 8.4, 'cyan', { collide: false, cast: false });
    }
  }
  // ---- 真ん中の広告の台（坂2つ・ジャンプ台2つ）----
  B.box(0, 2.6, 0, 10, 0.6, 11, 'metal');
  B.box(0, 2.78, 0, 10.05, 0.05, 11.05, 'cyan', { collide: false, cast: false });
  for (const [x, z] of [[-4.4, 4.9], [4.4, 4.9], [-4.4, -4.9], [4.4, -4.9]]) B.box(x, -0.05, z, 0.7, 2.66, 0.7, 'dark');
  B.ramp(-1.6, 5.5, 1.6, 11.5, 0, 3.2, 'z', -1, 'metal');
  B.ramp(-1.6, -11.5, 1.6, -5.5, 0, 3.2, 'z', 1, 'metal');
  for (const s of [-1, 1]) { B.box(-1.7, 0, 8.5 * s, 0.1, 0.05, 6, 'pink', { collide: false, cast: false }); B.box(1.7, 0, 8.5 * s, 0.1, 0.05, 6, 'pink', { collide: false, cast: false }); }
  // 台の上の手すり（外側だけ。弾は抜ける）
  for (const s of [-1, 1]) B.box(4.95 * s, 3.2, 0, 0.1, 1.0, 11, 'dark', { shoot: false });
  // 広告の板（台の上の遮蔽物）
  B.box(0, 3.2, 0, 6.6, 3.0, 0.4, 'dark');

  // ---- 屋上のまわりの壁（すきまから落ちる）----
  const wall = (x, z, w, d) => { B.box(x, 0, z, w, 1.1, d, 'wall'); B.box(x, 0.9, z, w + 0.04, 0.05, d + 0.04, 'pink', { collide: false, cast: false }); };
  const segX = (z, list) => list.forEach(([a, b]) => wall((a + b) / 2, z, b - a, 0.5));
  const segZ = (x, list) => list.forEach(([a, b]) => wall(x, (a + b) / 2, 0.5, b - a));
  segX(22.75, [[-24, 24]]); segX(-22.75, [[-24, 24]]);
  segX(4.25, [[-24, -14], [-8, -3], [3, 8], [14, 24]]); segX(-4.25, [[-24, -14], [-8, -3], [3, 8], [14, 24]]);
  segZ(23.75, [[4, 10], [16, 23]]); segZ(-23.75, [[4, 9], [15, 23]]);
  segZ(-23.75, [[-10, -4], [-23, -16]]); segZ(23.75, [[-9, -4], [-23, -15]]);

  // ---- 遮蔽物（点対称）----
  const both = (fn) => { fn(1); fn(-1); };
  both(s => { B.box(-16 * s, 0, 14 * s, 2.5, 2.7, 6.5, s > 0 ? 'red' : 'blue'); B.box(-14.2 * s, 0, 10.6 * s, 1.4, 1.3, 1.4, 'yel'); });
  both(s => { B.box(14 * s, 0, 18 * s, 6.5, 2.7, 2.5, s > 0 ? 'blue' : 'red'); });
  both(s => { B.box(6 * s, 0, 15 * s, 2.2, 1.5, 1.6, 'metal'); B.box(-6 * s, 0, 9 * s, 1.6, 1.5, 2.2, 'metal'); });
  both(s => { B.box(-20 * s, 0, 18 * s, 3, 1.0, 1.2, 'metal'); B.box(3 * s, 0, 14.5 * s, 1.2, 0.95, 1.2, 'metal'); });
  // 水のタンク（当たり判定は箱、見た目は円柱）
  both(s => {
    W.addBox(19 * s - 1.5, 0, 8 * s - 1.5, 19 * s + 1.5, 3.6, 8 * s + 1.5);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 2.6, 28), B.mats.metal); tank.position.set(19 * s, 2.3, 8 * s); tank.castShadow = tank.receiveShadow = true; B.group.add(tank);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.65, 0.6, 28), B.mats.dark); roof.position.set(19 * s, 3.9, 8 * s); roof.castShadow = true; B.group.add(roof);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), B.mats.dark); leg.position.set(19 * s + ox, 0.5, 8 * s + oz); leg.castShadow = true; B.group.add(leg); }
  });
  // ジャンプ台
  B.pad(-9, 0, 9.5, [-3.4, 3.2, 3.2], '#22E5FF');
  B.pad(9, 0, -9.5, [3.4, 3.2, -3.2], '#22E5FF');

  B.spawns.duel = [[0, 0, 19, Math.PI], [0, 0, -19, 0]];
  B.spawns.team = [[[-3, 0, 19, Math.PI], [3, 0, 19, Math.PI]], [[3, 0, -19, 0], [-3, 0, -19, 0]]];
  B.spawns.ffa = [[0, 0, 19, Math.PI], [0, 0, -19, 0], [21, 0, 20, Math.PI], [-21, 0, -20, 0], [20, 0, 12.5, -Math.PI / 2], [-20, 0, -12.5, Math.PI / 2], [9, 0, 20.5, Math.PI], [-9, 0, -20.5, 0]];
  W.bounds = { minX: -25, maxX: 25, minZ: -24, maxZ: 24 };
  W.killY = -14;
  B.finish();
  B.checkSpawns();

  const G = B.group;
  // ---- ビルの壁（屋上の下・まわりの街）：窓の明かりを GPU で描く ----
  const winMat = buildingMaterial();
  const facade = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), winMat, 2 + 160);
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
  let k = 0;
  facade.setMatrixAt(k++, m4.compose(ps.set(0, -62, 13.5), qq, sc.set(48, 120, 19)));
  facade.setMatrixAt(k++, m4.compose(ps.set(0, -62, -13.5), qq, sc.set(48, 120, 19)));
  const rnd = mulberry(7);
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, r = 55 + Math.pow(rnd(), 0.8) * 340;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(z) < 40 && Math.abs(x) < 45) continue;
    const w = 12 + rnd() * 26, d = 12 + rnd() * 26, h = 60 + rnd() * rnd() * 240;
    facade.setMatrixAt(k++, m4.compose(ps.set(x, h / 2 - 120, z), qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rnd() - 0.5) * 0.3), sc.set(w, h, d)));
  }
  facade.count = k; facade.frustumCulled = false;
  G.add(facade);
  // 屋上の赤い点滅灯
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2) });
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.6, 8, 6), beaconMat, 60);
  let bk = 0;
  for (let i = 2; i < k && bk < 60; i++) {
    facade.getMatrixAt(i, m4); m4.decompose(ps, qq, sc);
    if (sc.y < 140) continue;
    beacons.setMatrixAt(bk++, new THREE.Matrix4().makeTranslation(ps.x, ps.y + sc.y / 2 + 1, ps.z));
  }
  beacons.count = bk; G.add(beacons);
  B.updaters.push((dt, t) => { beaconMat.color.setRGB(Math.sin(t * 3) > 0.3 ? 3.5 : 0.25, 0.1, 0.1); });

  // ---- ネオンの看板 ----
  const signs = [
    ['GUN DUEL', '#FF3DB8', [0, 14, -46], 0, 26, 6.5], ['決闘', '#22E5FF', [-52, 10, 6], Math.PI / 2, 14, 7], ['NEON HARBOR', '#FFD23D', [52, 18, -8], -Math.PI / 2, 26, 5.5],
    ['24H', '#7CFF6B', [-34, 2, -46], 0, 8, 4], ['ネオン港', '#FF6A3D', [34, 7, 46], Math.PI, 16, 5.5], ['ラーメン', '#FF3D5E', [-30, 4, 46], Math.PI, 12, 4], ['BAR', '#B06BFF', [30, -6, -46], 0, 8, 3.5],
    ['DUEL ARENA', '#22E5FF', [0, -14, 46], Math.PI, 22, 4.5],
  ];
  const flick = [];
  for (const [txt, col, p, ry, w, h] of signs) {
    const tex = TEX.neon(txt, col, 1024, Math.round(1024 * h / w));
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.8, 1.8, 1.8) });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(...p); m.rotation.y = ry; G.add(m);
    flick.push({ mat, seed: Math.random() * 100 });
  }
  B.updaters.push((dt, t) => {
    for (const f of flick) { const n = Math.sin(t * 13 + f.seed) * Math.sin(t * 7.3 + f.seed * 2); f.mat.color.setScalar(n > 0.92 ? 0.3 : 1.8); }
  });
  // 路地の壁の小さな看板
  for (const [txt, col, x, z, ry] of [['カラオケ', '#FF3DB8', -20, 4.05, Math.PI], ['HOTEL', '#22E5FF', 18, -4.05, 0], ['薬', '#7CFF6B', 0, 4.05, Math.PI], ['DUEL', '#FFD23D', -2, -4.05, 0]]) {
    const tex = TEX.neon(txt, col, 512, 192);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
    m.position.set(x, -4, z); m.rotation.y = ry; G.add(m);
  }

  // ---- 真ん中の大きな広告（動くホログラム）----
  const holo = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uTex: { value: TEX.neon('GUN DUEL 3D', '#FF3DB8', 1024, 384) } }, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uTime; uniform sampler2D uTex; varying vec2 vUv;
      float h(float x){ return fract(sin(x*91.7)*43758.5); }
      void main(){
        vec2 uv = vUv; float band = step(0.985, h(floor(uv.y*40.0) + floor(uTime*8.0)));
        uv.x += band * (h(uTime) - 0.5) * 0.08;
        vec3 t = texture2D(uTex, uv).rgb;
        vec3 bg = mix(vec3(0.05,0.0,0.12), vec3(0.0,0.15,0.25), uv.y + 0.2*sin(uTime*0.7));
        float grid = step(0.94, fract(uv.x*60.0)) + step(0.9, fract(uv.y*24.0 - uTime*0.5));
        vec3 col = bg + t*2.2 + grid*vec3(0.05,0.12,0.2);
        col *= 0.85 + 0.15*sin(uv.y*400.0 + uTime*20.0);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.6), holo); screen.position.set(0, 4.75, 0.21); G.add(screen);
  const screen2 = screen.clone(); screen2.position.z = -0.21; screen2.rotation.y = Math.PI; G.add(screen2);

  // 遠くを飛ぶ車（光の粒）
  const cars = [];
  const carMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.2, 1.6) }), carMat2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.3, 0.3) });
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.6, 4, 8), i % 3 ? carMat : carMat2); m.rotation.z = Math.PI / 2; G.add(m);
    cars.push({ m, r: 80 + Math.random() * 200, y: 10 + Math.random() * 50, sp: (0.05 + Math.random() * 0.08) * (i % 2 ? 1 : -1), a: Math.random() * 6.28 });
  }
  B.updaters.push((dt, t) => { for (const c of cars) { const a = c.a + t * c.sp; c.m.position.set(Math.cos(a) * c.r, c.y, Math.sin(a) * c.r); c.m.rotation.y = -a; } });

  // サーチライト（空をなでる光の柱）
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.16 * smoothstep(0.0,0.5,vUv.x)*smoothstep(1.0,0.5,vUv.x); gl_FragColor = vec4(vec3(0.6,0.7,1.0)*a, 1.0); }',
  });
  const lights = [];
  for (const [x, z] of [[-90, -120], [140, 60], [-160, 150]]) {
    const g = new THREE.ConeGeometry(14, 260, 24, 1, true); g.translate(0, -130, 0); g.rotateX(Math.PI);
    const m = new THREE.Mesh(g, beamMat); m.position.set(x, -20, z); G.add(m); lights.push(m);
  }
  B.updaters.push((dt, t) => { lights.forEach((m, i) => { m.rotation.set(Math.sin(t * 0.21 + i * 2) * 0.5, 0, Math.cos(t * 0.17 + i) * 0.5); }); });

  // 雨・湯気の粒
  if (q.id !== 'low' || true) G.add(rain({ count: Math.round(5000 * q.particles), box: 46, color: '#8fa8d8', speed: 26, len: 0.65 }));
  G.add(ambientMotes({ count: Math.round(260 * q.particles), box: 60, color: '#FF7AD9', size: 0.07, fall: 0.1 }));

  // ---- 光 ----
  const moonDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
  const moon = new THREE.DirectionalLight(0x9db0ff, 1.25); moon.position.copy(moonDir).multiplyScalar(100); G.add(moon); G.add(moon.target);
  const hemi = new THREE.HemisphereLight(0x5a3a9a, 0x0a0a14, 0.9); G.add(hemi);
  const pinkL = new THREE.PointLight(0xff3db8, 45, 28, 1.6); pinkL.position.set(0, 7, 6); G.add(pinkL);
  const cyanL = new THREE.PointLight(0x22e5ff, 45, 28, 1.6); cyanL.position.set(0, 7, -6); G.add(cyanL);
  // 空（グラデーション）
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uFlash: { value: 0 } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform float uFlash; varying vec3 vP; void main(){ float y = vP.y;
      vec3 col = mix(vec3(0.24,0.08,0.3), vec3(0.03,0.02,0.08), smoothstep(-0.05, 0.6, y));
      col += vec3(0.5,0.12,0.4) * exp(-abs(y+0.02)*9.0) * 0.6;
      col += vec3(0.7,0.75,1.0) * uFlash * smoothstep(-0.2, 0.8, y);
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
  });
  const skyM = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat); G.add(skyM);
  // 雷
  let nextBolt = 6 + Math.random() * 10, bolt = 0;
  const api = { onThunder: null };
  B.updaters.push((dt, t) => {
    nextBolt -= dt;
    if (nextBolt <= 0) { nextBolt = 9 + Math.random() * 14; bolt = 1; if (api.onThunder) setTimeout(() => api.onThunder(), 400 + Math.random() * 900); }
    if (bolt > 0) {
      bolt = Math.max(0, bolt - dt * 3.2);
      const f = bolt > 0.6 ? 1 : bolt > 0.4 ? 0.2 : bolt > 0.25 ? 0.8 : bolt * 0.5;
      skyMat.uniforms.uFlash.value = f * 0.8; moon.intensity = 1.25 + f * 7; hemi.intensity = 0.9 + f * 1.5;
    }
  });
  // 環境マップ（ネオンの色が床に映る）
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(500, 16, 8), new THREE.MeshBasicMaterial({ color: 0x150a22, side: THREE.BackSide })));
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, col = ['#FF3DB8', '#22E5FF', '#FFD23D', '#B06BFF', '#FF6A3D'][i % 5];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(30 + Math.random() * 40, 6 + Math.random() * 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.5), side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * 120, 5 + Math.random() * 60, Math.sin(a) * 120); m.lookAt(0, m.position.y, 0); env.add(m);
  }
  env.add(new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2).translate(0, -30, 0), new THREE.MeshBasicMaterial({ color: 0x0a0812 })));

  return {
    id: 'harbor', builder: B, group: G, world: W, spawns: B.spawns, sun: moon, sunExtent: 32, envScene: env, api,
    fog: new THREE.FogExp2(0x1d1030, 0.0085), background: null,
    grade: { tint: new THREE.Color(0.98, 0.96, 1.06), sat: 1.12, contrast: 1.08, bloom: 0.55, bloomThreshold: 0.9, bloomRadius: 0.5, exposure: 1.05, vignette: 0.38 }, envIntensity: 0.55,
    dust: 0.35, music: 'battle',
    update(dt, t) { for (const f of B.updaters) f(dt, t); },
    title: { center: new THREE.Vector3(0, 3, 0), radius: 24, height: 8 },
  };
}

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ビルの壁：窓の明かり（GPU で計算。窓ごとに点いたり消えたり）
function buildingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uFogCol: { value: new THREE.Color(0x1d1030) }, uFogD: { value: 0.0085 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying float vId;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
          vId = instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.71;
        #else
          vId = 0.0;
        #endif
        vec4 w = m * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uFogCol; uniform float uFogD; varying vec3 vW; varying vec3 vN; varying float vId;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + vId) * 43758.5453); }
      void main(){
        vec3 n = abs(vN); vec2 p = n.x > 0.5 ? vW.zy : (n.z > 0.5 ? vW.xy : vW.xz);
        vec3 base = vec3(0.05,0.05,0.08) + vec3(0.02,0.01,0.04) * (n.y > 0.5 ? 0.0 : 1.0);
        vec3 col = base;
        if (n.y < 0.5) {
          vec2 cell = floor(p / vec2(2.2, 3.2)); vec2 f = fract(p / vec2(2.2, 3.2));
          float win = step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.8);
          float r = h(cell); float on = step(0.55, r);
          float flick = step(0.995, h(cell + floor(uTime*0.5)));
          vec3 wc = r > 0.9 ? vec3(1.0,0.3,0.7) : r > 0.8 ? vec3(0.3,0.9,1.0) : vec3(1.0,0.82,0.55);
          col += win * on * (1.0 - flick) * wc * (0.6 + 0.6*h(cell*1.7));
          col += win * (1.0 - on) * vec3(0.02,0.03,0.05);
        }
        float d = length(vW - cameraPosition);
        float fog = 1.0 - exp(-uFogD * uFogD * d * d);
        col = mix(col, uFogCol, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
