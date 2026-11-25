// 肩ごしのカメラ（TPS）：壁にめりこまない・覗き込み（ズーム）・スナイパーのスコープ・ゆれ・やられたあとの見せ方
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
  }

  forward(out) { const c = Math.cos(this.pitch); return out.set(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c); }

  snapTo(f) { this.yaw = f.yaw; this.pitch = 0; f.eye(this.pivot); this.dist = 3.2; }

  // 自分のキャラクターを追う
  follow(dt, f, game) {
    const W = f.W, ads = f.adsK;
    const scopeW = !!W.scope && ads > 0.8;
    this.scoped = scopeW;
    // 体の目の高さ（跳んだときは少し遅れてついてくる）
    f.eye(_t);
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

function angle(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
