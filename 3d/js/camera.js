// カメラ：一人称（FPS・目の位置）と肩ごし（TPS）。覗き込み（ズーム）・スナイパーのスコープ・ゆれ・反動・着地・やられたあとの見せ方
import * as THREE from '../lib/three.js';
import { BODY, WEAPONS, clamp, damp } from './data.js';
import { rayCapsule, raySphere } from './collision.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();

export class TPSCamera {
  constructor(cam, settings) {
    this.cam = cam; this.settings = settings;
    this.yaw = 0; this.pitch = 0;
    this.pivot = new THREE.Vector3(); this.dist = 3.2; this.fov = 75; this.scoped = false;
    this.mode = 'follow';    // follow / orbit / death / spectate / free
    this.orbitT = 0; this.orbitCenter = new THREE.Vector3(); this.orbitR = 25; this.orbitH = 8;
    this.target = null; this.lookAtTarget = new THREE.Vector3(); this.aimEnemy = null;
    this.kick = 0; this.shakeT = 0;
    // 一人称のばね（反動・着地・ゆれ）
    this.sp = { p: sp(260, 26), y: sp(260, 26), land: sp(130, 14), roll: sp(90, 14) };
    this.eyeH = BODY.eye; this.smoothY = null; this.bob = 0; this.bobK = 0;
  }

  onShot(W) { const k = W.recoil || 1; this.sp.p.v += 0.05 + k * 0.03; this.sp.y.v += (Math.random() - 0.5) * k * 0.025; }
  onLand(k) { this.sp.land.v -= 1.1 * Math.min(1.5, k); }
  onHurt(amt) { this.sp.p.v -= Math.min(0.25, amt * 0.004); this.sp.roll.v += (Math.random() - 0.5) * Math.min(0.4, amt * 0.008); }

  // 一人称：目の位置から見る。段差や坂ではなめらかに上下し、着地で沈み、歩くと少しゆれる
  fps(dt, f, game) {
    const W = f.W, ads = f.adsK;
    const scopeW = !!W.scope && ads > 0.8;
    this.scoped = scopeW;
    for (const k in this.sp) stepSp(this.sp[k], dt);
    // しゃがみの高さはばねで
    const eyeT = f.crouching ? BODY.crouchEye : BODY.eye;
    this.eyeH = damp(this.eyeH, eyeT, 14, dt);
    const rp = f.rpos || f.pos;
    const footY = rp[1];
    if (this.smoothY == null || !f.onGround || Math.abs(footY - this.smoothY) > 0.7) this.smoothY = footY;
    else this.smoothY += (footY - this.smoothY) * (1 - Math.exp(-30 * dt));
    // 歩くゆれ
    const vx = f.vel[0], vz = f.vel[2], spd = Math.hypot(vx, vz);
    const bobOn = this.settings.bob !== false;
    this.bobK = damp(this.bobK, f.onGround && spd > 0.5 ? Math.min(1, spd / 6.6) : 0, 8, dt);
    this.bob += dt * spd / 1.3 * Math.PI;
    const bk = this.bobK * (1 - ads * 0.85) * (bobOn ? 1 : 0);
    // 横に動くと少し傾く
    const right = -vx * Math.cos(this.yaw) + vz * Math.sin(this.yaw);
    this.sp.roll.t = bobOn ? clamp(-right * 0.0035, -0.03, 0.03) : 0;
    let y = this.smoothY + this.eyeH + this.sp.land.x * 0.06 - Math.abs(Math.cos(this.bob)) * 0.022 * bk;
    if (f.rollT > 0) y -= Math.sin((1 - f.rollT / 0.32) * Math.PI) * 0.55;
    _r.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.cam.position.set(rp[0], y, rp[2]).addScaledVector(_r, Math.sin(this.bob) * 0.012 * bk);
    // 画角
    const base = this.settings.fov || 82;
    let fov = base + (W.ads ? (W.ads - base) : -8) * ads;
    if (f.rollT > 0) fov += 5;
    if (!f.onGround && f.padT > 0) fov += 7;
    this.fov = damp(this.fov, fov, 14, dt);
    this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
    // 向き（反動のはね上がり・傾き・ゆれを足す）
    let p = this.pitch + this.sp.p.x, yw = this.yaw + this.sp.y.x;
    const s = (game ? game.shakeAmt : 0) * (this.settings.shake === false ? 0.25 : 1);
    if (s > 0.001) { this.shakeT += dt * 38; p += Math.sin(this.shakeT * 1.3) * 0.009 * s * s * 3; yw += Math.cos(this.shakeT * 0.9) * 0.009 * s * s * 3; }
    const roll = this.sp.roll.x + Math.sin(this.bob) * 0.003 * bk + (f.rollT > 0 ? Math.sin((1 - f.rollT / 0.32) * Math.PI) * 0.12 : 0);
    this.cam.rotation.set(p, yw + Math.PI, roll, 'YXZ');
    this.cam.updateMatrixWorld();
    this.aim(f, game);
  }

  forward(out) { const c = Math.cos(this.pitch); return out.set(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c); }

  snapTo(f) { this.yaw = f.yaw; this.pitch = 0; f.eye(this.pivot); this.dist = 3.2; this.smoothY = null; this.eyeH = BODY.eye; for (const k in this.sp) { this.sp[k].x = this.sp[k].v = 0; } }

  // 自分のキャラクターを追う
  follow(dt, f, game) {
    const W = f.W, ads = f.adsK;
    const scopeW = !!W.scope && ads > 0.8;
    this.scoped = scopeW;
    // 体の目の高さ（跳んだときは少し遅れてついてくる）
    const rp = f.rpos || f.pos;
    _t.set(rp[0], rp[1] + (f.crouching ? BODY.crouchEye : BODY.eye), rp[2]);
    this.pivot.x = _t.x; this.pivot.z = _t.z;
    this.pivot.y = damp(this.pivot.y, _t.y, f.onGround ? 18 : 9, dt);
    const shoulder = (this.settings.leftShoulder ? -1 : 1) * (0.62 - ads * 0.18);
    const want = scopeW ? 0.0 : 3.25 - ads * 1.55;
    this.forward(_f);
    _r.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));   // 画面の右
    _p.copy(this.pivot).addScaledVector(_r, scopeW ? 0 : shoulder);
    _p.y += scopeW ? 0 : 0.18;
    // 壁に当たったら近づける
    const from = _c.copy(this.pivot).addScaledVector(_r, shoulder * 0.3);
    _t.copy(_p).addScaledVector(_f, -want).sub(from);
    const L = _t.length();
    let d = want;
    if (L > 0.01) {
      _t.divideScalar(L);
      const hit = game.world.raycast(from.x, from.y, from.z, _t.x, _t.y, _t.z, L + 0.3);
      if (hit) d = Math.max(0.2, Math.min(want, want * (hit.t - 0.3) / L));
    }
    this.dist = d < this.dist ? d : damp(this.dist, d, 6, dt);
    const pos = this.cam.position.copy(_p).addScaledVector(_f, -this.dist);
    // 画角
    const base = this.settings.fov || 78;
    let fov = base + (W.ads ? (W.ads - base) : -10) * ads;
    if (f.rollT > 0) fov += 6;
    if (!f.onGround && f.padT > 0) fov += 8;
    this.fov = damp(this.fov, fov, 12, dt);
    this.applyRot(dt, game);
    this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
    // 自分が近すぎるときは見えなくする
    if (f.alive) f.model.root.visible = this.dist > 0.6 && !scopeW;
    // 狙いの点：カメラの真ん中から
    this.aim(f, game);
    return pos;
  }

  applyRot(dt, game) {
    let p = this.pitch, y = this.yaw;
    const s = (game ? game.shakeAmt : 0) * (this.settings.shake === false ? 0.25 : 1);
    if (s > 0.001) { this.shakeT += dt * 38; p += Math.sin(this.shakeT * 1.3) * 0.012 * s * s * 3; y += Math.cos(this.shakeT * 0.9) * 0.012 * s * s * 3; }
    this.cam.rotation.set(p, y + Math.PI, 0, 'YXZ');
  }

  // 画面の真ん中の先にある物（壁か敵）を探す
  aim(f, game) {
    const o = this.cam.position, d = this.forward(_f);
    const wall = game.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 250);
    let best = wall ? wall.t : 250, enemy = null;
    for (const t of game.fighters) {
      if (!t.alive || t === f) continue;
      const tb = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, t.pos[0], t.pos[1], t.pos[1] + (t.crouching ? 0.98 : 1.42), t.pos[2], 0.36);
      const th = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, t.pos[0], t.pos[1] + t.h - 0.2, t.pos[2], BODY.headR);
      const m = Math.min(tb, th);
      if (m < best) { best = m; enemy = game.isEnemy(f, t) ? t : null; }
    }
    for (const dc of game.decoys) {
      const tb = rayCapsule(o.x, o.y, o.z, d.x, d.y, d.z, dc.pos[0], dc.pos[1], dc.pos[1] + 1.6, dc.pos[2], 0.38);
      if (tb < best) { best = tb; enemy = game.isEnemy(f, dc.owner) ? dc : null; }
    }
    f.aimPoint.copy(o).addScaledVector(d, best);
    f.hasAimPoint = true;
    this.aimEnemy = enemy;
    this.aimDist = best;
  }

  // 闘技場のまわりをゆっくり回る（タイトル・試合の前）
  orbit(dt, center, r, h, speed = 0.08) {
    this.orbitT += dt * speed;
    const a = this.orbitT;
    this.cam.position.set(center.x + Math.cos(a) * r, center.y + h + Math.sin(a * 0.7) * 1.5, center.z + Math.sin(a) * r);
    this.cam.lookAt(center);
    this.cam.fov = damp(this.cam.fov, 60, 3, dt); this.cam.updateProjectionMatrix();
  }

  // やられたとき：自分の倒れた場所から、倒した相手を見る
  deathView(dt, me, killer, game) {
    const c = _c.set(me.pos[0], me.pos[1] + 1.2, me.pos[2]);
    let look = c;
    if (killer && killer.alive) look = killer.center(_t);
    this.lookAtTarget.lerp(look, 1 - Math.exp(-dt * 4));
    const dir = _f.subVectors(this.cam.position, c);
    const L = dir.length() || 1;
    dir.y = 0; dir.normalize();
    const want = _p.copy(c).addScaledVector(dir, Math.min(6, L + dt * 2)).add(new THREE.Vector3(0, 2.6, 0));
    const hit = game.world.raycast(c.x, c.y, c.z, want.x - c.x, want.y - c.y, want.z - c.z, 1);
    this.cam.position.lerp(want, 1 - Math.exp(-dt * 2));
    if (hit) this.cam.position.lerp(c, 0.3);
    this.cam.lookAt(this.lookAtTarget);
    this.cam.fov = damp(this.cam.fov, 62, 3, dt); this.cam.updateProjectionMatrix();
  }

  // 味方を後ろから見る（2v2 でやられたあと）
  spectate(dt, f, game) {
    this.yaw += clamp(angle(this.yaw, f.yaw), -3, 3) * Math.min(1, dt * 5);
    this.pitch = damp(this.pitch, f.pitch * 0.6, 5, dt);
    f.eye(_t);
    this.pivot.lerp(_t, 1 - Math.exp(-dt * 10));
    this.forward(_f);
    _r.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const want = _p.copy(this.pivot).addScaledVector(_r, 0.6).addScaledVector(_f, -3.4); want.y += 0.3;
    const hit = game.world.raycast(this.pivot.x, this.pivot.y, this.pivot.z, want.x - this.pivot.x, want.y - this.pivot.y, want.z - this.pivot.z, 1);
    if (hit) want.lerpVectors(this.pivot, want, Math.max(0.1, hit.t - 0.1));
    this.cam.position.copy(want);
    this.applyRot(dt, game);
    this.cam.fov = damp(this.cam.fov, 74, 4, dt); this.cam.updateProjectionMatrix();
  }

  // 決着の瞬間：倒れた人のまわりをスローで回る
  killcam(dt, at, t) {
    const a = t * 0.9 + 0.6, r = 4.5;
    this.cam.position.set(at.x + Math.cos(a) * r, at.y + 1.6 + t * 0.4, at.z + Math.sin(a) * r);
    this.cam.lookAt(at.x, at.y + 1.0, at.z);
    this.cam.fov = damp(this.cam.fov, 55, 3, dt); this.cam.updateProjectionMatrix();
  }
}

function sp(k, c) { return { x: 0, v: 0, t: 0, k, c }; }
function stepSp(s, dt) { const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n; for (let i = 0; i < n; i++) { s.v += (-s.k * (s.x - s.t) - s.c * s.v) * h; s.x += s.v * h; } }
function angle(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
