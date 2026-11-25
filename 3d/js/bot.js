// BOT：見える範囲（視野と遮蔽物）・反応の遅れ・狙いのずれがある、ずるをしない相手。
// 道は格子の道案内（A*）で探し、落ちる場所をさける。武器は距離で持ち替え、スキル・回復も使う
import * as THREE from '../lib/three.js';
import { BODY, WEAPONS, SKILLS, DIFFS, clamp, rand, angDiff } from './data.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Bot {
  constructor(game, f, diffId, o = {}) {
    this.game = game; this.f = f; this.D = DIFFS[diffId] || DIFFS.normal;
    this.ally = o.ally || null;           // 2v2 の味方の BOT はプレイヤーについていく
    this.target = null; this.mem = new Map();   // 敵 → { x,y,z, t（最後に見た時刻）}
    this.seeT = 0; this.reactT = 0; this.trackT = 0;
    this.path = null; this.pathI = 0; this.repathT = 0; this.goal = null; this.stuckT = 0; this.lastPos = [0, 0, 0];
    this.strafe = Math.random() < 0.5 ? 1 : -1; this.strafeT = 0; this.jumpT = rand(1, 3); this.crouchT = 0;
    this.err = new THREE.Vector2(); this.errV = new THREE.Vector2();
    this.swapT = 0; this.fireHold = 0; this.semiT = 0; this.healT = rand(0.3, 1.2); this.skillT = rand(1, 3);
    this.aimHead = Math.random() < this.D.head;
    this.wanderT = 0; this.percT = 0; this.visible = [];
  }

  nav() { return this.game.arena.getNav(); }

  think(dt) {
    const f = this.f, g = this.game, inp = f.input, D = this.D;
    if (!f.alive || g.frozen) { inp.mx = inp.mz = 0; inp.fire = false; return; }
    this.swapT -= dt; this.semiT -= dt; this.repathT -= dt; this.strafeT -= dt; this.jumpT -= dt; this.healT -= dt; this.skillT -= dt; this.percT -= dt;
    // ---- 見る（0.12秒ごと）----
    if (this.percT <= 0) { this.percT = 0.12; this.perceive(); }
    const T = this.target;
    let tpos = null, dist = 99, visible = false;
    if (T) {
      visible = this.visible.includes(T);
      if (visible) { tpos = T.center ? T.center(_a) : _a.set(T.pos[0], T.pos[1] + 1, T.pos[2]); }
      else { const m = this.mem.get(T); if (m) tpos = _a.set(m.x, m.y + 1, m.z); }
      if (tpos) dist = Math.hypot(tpos.x - f.pos[0], tpos.z - f.pos[2]);
    }
    if (visible) { this.seeT += dt; this.trackT += dt; } else { this.seeT = 0; this.trackT = Math.max(0, this.trackT - dt * 2); }
    // ---- 武器を選ぶ ----
    if (this.swapT <= 0 && f.reloadT <= 0 && f.meleeT < 0 && f.chargeT <= 0 && f.focusT < 0) {
      const best = this.pickSlot(tpos ? dist : 18);
      if (best !== f.slot) { inp.slot = best; this.swapT = rand(1.2, 2.2); }
    }
    const W = f.W;
    // ---- 動く ----
    this.move(dt, T, tpos, visible, dist, W);
    // ---- 狙って撃つ ----
    inp.fire = false; inp.ads = false;
    if (T && tpos) this.aimAndShoot(dt, T, tpos, visible, dist, W);
    else { this.lookAlong(dt); if (f.focusT >= 0) inp.fire = false; }
    // ---- リロード・回復・スキル ----
    if (W.mag && f.ammo[f.slot] < W.mag * 0.35 && (!visible || f.ammo[f.slot] === 0) && f.reloadT <= 0) inp.reload = true;
    if (!f.healUsed && f.hp <= D.heal && this.healT <= 0 && (!visible || f.hp < D.heal * 0.6 || g.time - f.lastDmgT > 1.2)) { inp.heal = true; this.healT = 1; }
    this.useSkill(dt, T, visible, dist);
    // 引っかかり
    const moved = Math.hypot(f.pos[0] - this.lastPos[0], f.pos[2] - this.lastPos[2]);
    this.lastPos = f.pos.slice();
    if ((inp.mx || inp.mz) && moved < 0.4 * dt && f.onGround) { this.stuckT += dt; if (this.stuckT > 0.6) { inp.jump = true; this.strafe *= -1; this.repathT = 0; this.stuckT = 0; } }
    else this.stuckT = 0;
  }

  // 見える敵と、音で気づいた敵を覚える
  perceive() {
    const f = this.f, g = this.game, D = this.D;
    this.visible = [];
    const cands = g.fighters.filter(o => o.alive && g.isEnemy(f, o)).concat(g.decoys.filter(d => g.isEnemy(f, d.owner)).map(d => d.proxy || (d.proxy = decoyProxy(d))));
    f.eye(_b);
    const fwdX = Math.sin(f.yaw), fwdZ = Math.cos(f.yaw), half = Math.cos(THREE.MathUtils.degToRad(D.fov / 2));
    for (const o of cands) {
      const dx = o.pos[0] - f.pos[0], dz = o.pos[2] - f.pos[2], d = Math.hypot(dx, dz);
      if (d > 70) continue;
      const inFov = d < 5 || (dx * fwdX + dz * fwdZ) / Math.max(0.01, d) > half;
      // 撃った音・近くの足音
      const heard = (o.lastShotT != null && g.time - o.lastShotT < 0.5 && d < 40) || (d < 9 && Math.hypot(o.vel[0], o.vel[2]) > 3);
      if (!inFov && !heard) continue;
      o.center(_c);
      const vis = g.world.clear(_b.x, _b.y, _b.z, _c.x, _c.y, _c.z) || g.world.clear(_b.x, _b.y, _b.z, o.pos[0], o.pos[1] + o.h - 0.15, o.pos[2]);
      if (vis && inFov) this.visible.push(o);
      if (vis || heard) this.mem.set(o, { x: o.pos[0], y: o.pos[1], z: o.pos[2], t: g.time });
    }
    // 忘れる
    for (const [o, m] of this.mem) if (!o.alive && !o.isProxy || g.time - m.t > 5 || (o.isProxy && !o.decoy.alive())) this.mem.delete(o);
    // 狙う相手：見えている中で近い・弱っている・今の相手は少し優先
    let best = null, bs = Infinity;
    for (const o of this.visible) {
      const d = Math.hypot(o.pos[0] - f.pos[0], o.pos[2] - f.pos[2]);
      let s = d - (100 - o.hp) * 0.06 - (o === this.target ? 6 : 0);
      if (o.isPlayer && !g.teamMode) s += 3;   // FFA でプレイヤーばかり狙わない
      if (s < bs) { bs = s; best = o; }
    }
    if (!best) {
      // 見えていなければ、覚えている中でいちばん新しい相手
      let bt = -1;
      for (const [o, m] of this.mem) if (m.t > bt) { bt = m.t; best = o; }
    }
    if (best !== this.target) {
      this.target = best; this.reactT = D.react * rand(0.8, 1.35); this.trackT = 0; this.aimHead = Math.random() < D.head;
      this.err.set(rand(-1, 1), rand(-1, 1)).multiplyScalar(D.aim * 1.6);
    } else if (best && this.visible.includes(best) && this.seeT === 0) {
      this.reactT = D.react * rand(0.6, 1.0);   // また見えた：少しだけ早く反応
    }
  }

  pickSlot(dist) {
    const f = this.f;
    let best = f.slot, bs = Infinity;
    for (let i = 0; i < 3; i++) {
      const W = WEAPONS[f.loadout[i]];
      const [a, b] = W.band;
      let s = dist < a ? (a - dist) * 1.4 : dist > b ? (dist - b) : 0;
      if (W.mag && f.ammo[i] === 0) s += 6;
      if (i === f.slot) s -= 2.5;   // すぐ持ち替えない
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }

  // 動き：道を進む・間合いを保つ・横に動く・跳ぶ。落ちる場所はさける
  move(dt, T, tpos, visible, dist, W) {
    const f = this.f, g = this.game, inp = f.input, D = this.D;
    let wx = 0, wz = 0;
    const [bandA, bandB] = W.band;
    const melee = W.kind === 'melee';
    let goal = null;
    if (T && tpos) {
      if (!visible) goal = tpos;                                    // 最後に見た場所へ
      else if (dist > bandB + 1.5 || melee) goal = tpos;            // 近づく
    } else if (this.ally && this.ally.alive) {
      const ad = Math.hypot(this.ally.pos[0] - f.pos[0], this.ally.pos[2] - f.pos[2]);
      if (ad > 7) goal = _b.set(this.ally.pos[0], this.ally.pos[1], this.ally.pos[2]);
    }
    if (!goal && (!T || !tpos)) {
      // うろうろ：真ん中寄りの場所を見て回る
      if (!this.goal || this.wanderT <= 0 || Math.hypot(this.goal.x - f.pos[0], this.goal.z - f.pos[2]) < 2) {
        const n = this.nav().randomNode(nd => Math.hypot(nd.x, nd.z) < 18);
        this.goal = n ? new THREE.Vector3(n.x, n.y, n.z) : null; this.wanderT = rand(4, 8);
      }
      this.wanderT -= dt;
      goal = this.goal;
    }
    if (goal) {
      const dir = this.followPath(goal, dt);
      if (dir) { wx = dir.x; wz = dir.z; }
    }
    if (T && tpos && visible) {
      // 間合い
      const dx = tpos.x - f.pos[0], dz = tpos.z - f.pos[2], L = Math.max(0.01, Math.hypot(dx, dz));
      const ux = dx / L, uz = dz / L;
      if (!melee && dist < bandA) { wx -= ux * 0.9; wz -= uz * 0.9; }
      else if (!melee && dist <= bandB + 1.5) { wx += ux * 0.15; wz += uz * 0.15; }
      // 横に動く
      if (this.strafeT <= 0) { this.strafeT = rand(0.5, 1.6) / (0.4 + D.strafe); if (Math.random() < 0.35 + D.strafe * 0.4) this.strafe *= -1; }
      const sk = melee ? 0.35 : (f.focusT >= 0 || f.chargeT > 0 ? 0.25 : 0.55 + D.strafe * 0.45);
      wx += -uz * this.strafe * sk; wz += ux * this.strafe * sk;
      // ときどき跳ぶ・しゃがむ
      if (this.jumpT <= 0) {
        this.jumpT = rand(1.2, 3.5) / (0.5 + D.strafe);
        // 着地する場所に床があるときだけ跳ぶ
        const lx = f.pos[0] + f.vel[0] * 0.8, lz = f.pos[2] + f.vel[2] * 0.8;
        if (Math.random() < 0.25 + D.strafe * 0.3 && !melee && this.safe(lx, lz, f.pos[1])) inp.jump = true;
      }
      if (W.id === 3 || W.id === 11 || W.id === 16) { this.crouchT -= dt; if (this.crouchT <= 0) { this.crouchT = rand(1, 3); this.crouching = Math.random() < 0.5; } }
      else this.crouching = false;
    } else this.crouching = false;
    inp.crouch = !!this.crouching && f.onGround;
    // 落ちない：進む先に床が無ければ、その向きをやめる
    const L = Math.hypot(wx, wz);
    if (L > 0.01) {
      wx /= L; wz /= L;
      if (!this.safe(f.pos[0] + wx * 1.3, f.pos[2] + wz * 1.3, f.pos[1])) {
        if (this.safe(f.pos[0] - wz * 1.3 * this.strafe, f.pos[2] + wx * 1.3 * this.strafe, f.pos[1])) { const t = wx; wx = -wz * this.strafe; wz = t * this.strafe; }
        else { wx = -wx; wz = -wz; }
        this.strafe *= -1;
      }
    }
    // 世界の向き → 体の向き（前＝(sin,cos)、右＝(-cos,sin)）
    const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
    inp.mz = wx * sy + wz * cy; inp.mx = -(wx * cy) + wz * sy;
    const M = Math.hypot(inp.mx, inp.mz); if (M > 1) { inp.mx /= M; inp.mz /= M; }
  }

  // その先に床があるか（落ちる場所に行かない）
  safe(x, z, y) {
    const W = this.game.world, f = this.f;
    const dx = x - f.pos[0], dz = z - f.pos[2];
    for (const k of [0.7, 1.4]) {
      const g = W.groundAt(f.pos[0] + dx * k, f.pos[2] + dz * k, 0.2, y + 0.6, 0.7);
      if (!g || g.y < y - 3.2) return false;
    }
    return true;
  }

  // 道を進む。次に向かう向き（長さ1）を返す
  followPath(goal, dt) {
    const f = this.f, nav = this.nav();
    if (!this.path || this.repathT <= 0 || (this.pathGoal && this.pathGoal.distanceToSquared(goal) > 9)) {
      this.repathT = rand(0.8, 1.6);
      const a = nav.nearest(f.pos[0], f.pos[1], f.pos[2], 3), b = nav.nearest(goal.x, goal.y, goal.z, 4);
      this.path = a && b ? nav.path(a, b) : null; this.pathI = 1; this.pathGoal = goal.clone();
      if (!this.path) { const dx = goal.x - f.pos[0], dz = goal.z - f.pos[2], L = Math.hypot(dx, dz) || 1; return new THREE.Vector3(dx / L, 0, dz / L); }
    }
    const P = this.path;
    while (this.pathI < P.length) {
      const n = P[this.pathI];
      const d = Math.hypot(n.x - f.pos[0], n.z - f.pos[2]);
      if (d < 0.8 && Math.abs(n.y - f.pos[1]) < 1.2) { this.pathI++; continue; }
      // 先の点がまっすぐ行けるなら飛ばす（同じ高さ）
      if (this.pathI + 1 < P.length) {
        const m = P[this.pathI + 1];
        if (Math.abs(m.y - f.pos[1]) < 0.3 && Math.abs(n.y - f.pos[1]) < 0.3 && this.game.world.clear(f.pos[0], f.pos[1] + 0.5, f.pos[2], m.x, m.y + 0.5, m.z) && this.safe((f.pos[0] + m.x) / 2, (f.pos[2] + m.z) / 2, f.pos[1])) { this.pathI++; continue; }
      }
      const prev = P[this.pathI - 1], e = prev ? nav.edgeType(prev, n) : null;
      if (e && e.type === 'jump' && d < 1.8 && f.onGround) f.input.jump = true;
      const dx = n.x - f.pos[0], dz = n.z - f.pos[2], L = Math.hypot(dx, dz) || 1;
      return new THREE.Vector3(dx / L, 0, dz / L);
    }
    const dx = goal.x - f.pos[0], dz = goal.z - f.pos[2], L = Math.hypot(dx, dz);
    return L > 0.5 ? new THREE.Vector3(dx / L, 0, dz / L) : null;
  }

  lookAlong(dt) {
    const f = this.f;
    const v = Math.hypot(f.vel[0], f.vel[2]);
    if (v > 1) this.turnTo(Math.atan2(f.vel[0], f.vel[2]), 0, dt, 5);
    else this.turnTo(f.yaw, 0, dt, 2);
  }

  turnTo(yaw, pitch, dt, k) {
    const f = this.f;
    const dy = angDiff(f.yaw, yaw), dp = pitch - f.pitch;
    const maxT = 7 * dt;
    f.yaw += clamp(dy * Math.min(1, k * dt), -maxT, maxT);
    f.pitch += clamp(dp * Math.min(1, k * dt), -maxT, maxT);
    f.pitch = clamp(f.pitch, -1.3, 1.2);
  }

  aimAndShoot(dt, T, tpos, visible, dist, W) {
    const f = this.f, g = this.game, D = this.D, inp = f.input;
    f.eye(_b);
    // 狙う点：体か頭。グレネードは放物線、動く相手は少し先を狙う（弾の速い武器は不要）
    const aim = _c.copy(tpos);
    if (visible && this.aimHead && T.headPos && W.kind !== 'proj' && W.kind !== 'melee') T.headPos(aim);
    let pitchAdd = 0;
    if (W.kind === 'proj' && visible) {
      const flight = dist / W.speed;
      aim.x += T.vel[0] * flight * 0.6; aim.z += T.vel[2] * flight * 0.6;
      pitchAdd = solveArc(dist, aim.y - 0.6 - _b.y, W.speed, W.grav) ;
    }
    // ずれ：時間とともに小さくなり、ゆっくりさまよう
    const k = Math.exp(-this.trackT * 1.1);
    const moveErr = (Math.hypot(f.vel[0], f.vel[2]) > 3 ? 1.4 : 1) * (f.onGround ? 1 : 1.8) * (Math.hypot(T.vel[0], T.vel[2]) > 4 ? 1.25 : 1);
    this.errV.x += (Math.random() - 0.5) * 18 * dt; this.errV.y += (Math.random() - 0.5) * 18 * dt;
    this.errV.multiplyScalar(Math.exp(-dt * 3));
    this.err.addScaledVector(this.errV, dt * D.aim);
    this.err.multiplyScalar(Math.exp(-dt * 0.8));
    const amp = THREE.MathUtils.degToRad(D.aim * (0.35 + 1.4 * k) * moveErr);
    const dx = aim.x - _b.x, dy = aim.y - _b.y, dz = aim.z - _b.z, hd = Math.hypot(dx, dz);
    let yaw = Math.atan2(dx, dz) + this.err.x / Math.max(1, D.aim) * amp;
    let pitch = Math.atan2(dy, hd) + this.err.y / Math.max(1, D.aim) * amp * 0.7;
    if (pitchAdd) pitch = pitchAdd + this.err.y / Math.max(1, D.aim) * amp * 0.5;
    this.turnTo(yaw, pitch, dt, D.track);
    if (!visible) { if (f.focusT >= 0) inp.fire = false; return; }
    if (this.seeT < this.reactT) return;
    const yawErr = Math.abs(angDiff(f.yaw, Math.atan2(dx, dz))), pErr = Math.abs((pitchAdd || Math.atan2(dy, hd)) - f.pitch);
    const tol = W.kind === 'melee' ? 0.6 : W.kind === 'pellet' ? 0.11 : W.kind === 'proj' ? 0.09 : Math.max(0.018, Math.atan2(0.45, dist));
    const onTarget = yawErr < tol + 0.03 && pErr < tol + 0.05;
    if (W.kind === 'melee') { if (dist < W.reach + 0.4 && onTarget) { inp.fire = true; inp.firePressed = true; } return; }
    if (dist > (W.kind === 'pellet' ? 16 : 95)) return;
    inp.ads = (W.ads && W.ads < 50 && dist > 14) || (W.scope && dist > 12);
    if (W.kind === 'focus') {
      if (f.focusT < 0) { if (onTarget && f.coolT <= 0) inp.fire = true; }
      else {
        // ジャストのタイミングで離す（難しさで成功率が変わる）
        const want = W.full + W.win * (Math.random() < 0.3 + D.burst * 0.55 ? 0.5 : 2.2);
        inp.fire = f.focusT < (this.focusWant || (this.focusWant = want));
        if (!inp.fire) this.focusWant = 0;
      }
      return;
    }
    if (W.kind === 'beam') { if (onTarget && f.chargeT <= 0 && f.coolT <= 0) inp.firePressed = true; return; }
    if (!onTarget) { this.fireHold = 0; return; }
    if (W.auto) {
      // 押しっぱなし（少しずつ区切る）
      this.fireHold += dt;
      if (this.fireHold < 0.4 + D.burst * 0.8) inp.fire = true;
      else if (this.fireHold > 0.55 + D.burst * 0.8 + (1 - D.burst) * 0.4) this.fireHold = 0;
    } else if (this.semiT <= 0) {
      inp.firePressed = true; this.semiT = W.rate + rand(0.05, 0.25) * (1.3 - D.burst);
    }
  }

  useSkill(dt, T, visible, dist) {
    const f = this.f, g = this.game, D = this.D, inp = f.input;
    if (f.skillCD > 0 || this.skillT > 0) return;
    const hurt = g.time - f.lastDmgT < 0.35;
    let use = false;
    switch (f.skill) {
      case 'roll': use = hurt && Math.random() < D.dodge * 3 * dt * 10; break;
      case 'parry': use = visible && T && T.lastShotT != null && g.time - T.lastShotT < 0.15 && Math.random() < D.dodge * 0.4; break;
      case 'decoy': use = visible && dist > 6 && dist < 35 && Math.random() < 0.25 * dt * 10; break;
      case 'pierce': use = !!T && !visible && this.mem.has(T) && g.time - this.mem.get(T).t < 1.5 && Math.random() < 0.3; break;
      case 'rewind': use = (f.vel[1] < -12 && !f.onGround) || (hurt && f.hp < 35 && Math.random() < 0.3); break;
    }
    this.skillT = 0.25;
    if (use) { inp.skill = true; this.skillT = rand(0.5, 1.5); }
  }
}

// グレネードの角度：距離 d・高さの差 h・速さ v・重さ gr で届く低い角度
function solveArc(d, h, v, gr) {
  const v2 = v * v, root = v2 * v2 - gr * (gr * d * d + 2 * h * v2);
  if (root < 0) return Math.PI / 4;
  return Math.atan2(v2 - Math.sqrt(root), gr * d);
}

// 分身を、BOT からは「人」と同じように見せる
function decoyProxy(d) {
  return {
    isProxy: true, decoy: { alive: () => d.life > 0 && d.game.decoys.includes(d) }, get pos() { return d.pos; }, get vel() { return d.vel; }, h: BODY.h, hp: d.owner.hp, alive: true, team: d.owner.team,
    center: (o) => o.set(d.pos[0], d.pos[1] + 0.95, d.pos[2]), headPos: (o) => o.set(d.pos[0], d.pos[1] + 1.55, d.pos[2]), lastShotT: null, isPlayer: false,
  };
}
