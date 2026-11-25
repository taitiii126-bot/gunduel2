// 戦う人（プレイヤーも BOT も同じ）：体力・移動・ジャンプ・しゃがみ・武器（撃つ・近接・リロード・持ち替え）・回復・スキル
import * as THREE from '../lib/three.js';
import { BODY, WEAPONS, SKILLS, MAX_HP, REGEN, SWAP_TIME, clamp, rand } from './data.js';
import { stepCharacter } from './collision.js';
import { FighterModel } from './fighter-model.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export function emptyInput() {
  return { mx: 0, mz: 0, jump: false, fire: false, firePressed: false, fireReleased: false, ads: false, crouch: false, skill: false, heal: false, reload: false, slot: -1, cycle: 0 };
}

export class Fighter {
  constructor(game, o) {
    this.game = game;
    this.id = o.id; this.name = o.name; this.team = o.team; this.colors = o.colors;
    this.isPlayer = !!o.isPlayer; this.bot = null;
    this.loadout = o.loadout.slice(0, 3);
    this.skill = o.skill || 'roll';
    this.pos = [0, 0, 0]; this.vel = [0, 0, 0]; this.onGround = true; this.r = BODY.r; this.h = BODY.h;
    // 描くときの位置：固定の刻みで進めた前と今の位置のあいだを補間する（画面のなめらかさ）
    this.prev = [0, 0, 0]; this.rpos = [0, 0, 0]; this.prevYaw = 0; this.ryaw = 0;
    this.st = { moveLocal: { x: 0, z: 0 }, rollDir: { x: 0, z: 0 }, act: null };
    this.yaw = 0; this.pitch = 0;
    this.input = emptyInput();
    this.aimPoint = new THREE.Vector3(); this.aimDir = new THREE.Vector3(0, 0, 1); this.hasAimPoint = false;
    this.stats = { kills: 0, deaths: 0, dmg: 0, shots: 0, hits: 0, heads: 0, assists: 0, score: 0 };
    this.model = new FighterModel({ colors: o.colors, skin: o.skin, hair: o.hair, eye: o.eye, accent: o.accent, name: o.name, showName: !this.isPlayer });
    this.model.stepCb = () => { if (this.game.audio && this.onGround) this.game.audio.play('step', this.isPlayer ? null : this.center(_w), { k: this.isPlayer ? 0.8 : 1 }); };
    this.dissolve = 0; this.deadT = 0;
    this.reset();
  }

  // ラウンドの始め・生き返り
  reset() {
    this.hp = MAX_HP; this.alive = true; this.healUsed = false; this.idleT = 0; this.regenT = 0;
    this.slot = 0; this.ammo = this.loadout.map(id => WEAPONS[id].mag); this.reloadT = 0; this.coolT = 0; this.swapT = 0;
    this.burstN = 0; this.burstT = 0; this.chargeT = 0; this.focusT = -1; this.focusFull = false; this.meleeT = -1; this.meleeHit = false; this.meleeAlt = false;
    this.bloom = 0; this.recoil = 0; this.adsK = 0;
    this.skillCD = 0; this.rollT = 0; this.rollDir = new THREE.Vector3(); this.iframeT = 0; this.parryT = 0; this.pierceN = 0;
    this.hist = []; this.histT = 0;
    this.padT = 0; this.kbT = 0; this.stunT = 0;
    this.protectT = 0; this.hitK = 0; this.lastHitBy = null; this.lastHitT = -99; this.lastDmgT = -99; this.lastDmgFrom = null;
    this.crouching = false; this.h = BODY.h; this.jumpBuf = 0; this.coyote = 0;
    this.vel[0] = this.vel[1] = this.vel[2] = 0; this.onGround = true;
    this.dissolve = 0; this.deadT = 0; this.deadK = 0; this.victory = false;
    this.model.root.visible = true;
    this.model.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.model.setWeapon(this.loadout[0]);
    this.act = { type: null, k: 0, alt: false };
  }

  get W() { return WEAPONS[this.loadout[this.slot]]; }
  center(out) { return out.set(this.pos[0], this.pos[1] + this.h * 0.55, this.pos[2]); }
  eye(out) { return out.set(this.pos[0], this.pos[1] + (this.crouching ? BODY.crouchEye : BODY.eye), this.pos[2]); }
  headPos(out) { return out.set(this.pos[0], this.pos[1] + this.h - 0.2, this.pos[2]); }
  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  lookDir(out) { const c = Math.cos(this.pitch); return out.set(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c); }

  place(x, y, z, yaw) {
    this.pos[0] = x; this.pos[1] = y; this.pos[2] = z; this.yaw = yaw || 0; this.pitch = 0;
    this.vel[0] = this.vel[1] = this.vel[2] = 0; this.onGround = true;
    this.hist = [];
    this.snap();
  }
  // 瞬間移動したとき：補間しない
  snap() { for (let i = 0; i < 3; i++) this.prev[i] = this.rpos[i] = this.pos[i]; this.prevYaw = this.ryaw = this.yaw; }

  update(dt) {
    const g = this.game, inp = this.input;
    if (!this.alive) { this.updateDead(dt); return; }
    // タイマー
    this.coolT -= dt; this.swapT -= dt; this.skillCD -= dt; this.iframeT -= dt; this.parryT -= dt; this.padT -= dt; this.kbT -= dt; this.stunT -= dt; this.protectT -= dt;
    this.hitK = Math.max(0, this.hitK - dt * 4); this.recoil = Math.max(0, this.recoil - dt * 9); this.bloom = Math.max(0, this.bloom - dt * 3.2);
    this.idleT += dt;
    const W = this.W;
    // 回復（自然回復と、1回だけの全回復）
    if (this.idleT >= REGEN.idle && this.hp < MAX_HP) { this.regenT += dt; if (this.regenT >= REGEN.every) { this.regenT = 0; this.hp = Math.min(MAX_HP, this.hp + REGEN.amt); g.emit('regen', { f: this }); } }
    if (inp.heal && !this.healUsed && this.hp < MAX_HP && this.stunT <= 0) {
      this.healUsed = true; this.hp = MAX_HP; this.idleT = 0; this.regenT = 0;
      this.act = { type: 'heal', k: 0 }; this.actT = 0.5; this.actDur = 0.5;
      g.emit('heal', { f: this });
    }
    // しゃがみ（立てる場所なら立つ）
    const wantCrouch = inp.crouch && this.onGround && this.rollT <= 0;
    if (wantCrouch !== this.crouching) {
      if (wantCrouch) { this.crouching = true; this.h = BODY.crouchH; }
      else if (g.world.fits(this.pos[0], this.pos[1], this.pos[2], this.r * 0.95, BODY.h)) { this.crouching = false; this.h = BODY.h; }
    }
    // スキル
    if (inp.skill && this.skillCD <= 0 && this.stunT <= 0) this.useSkill();
    // 移動
    this.move(dt);
    // 武器
    this.weapon(dt, W);
    // 巻き戻し用の位置の記録
    this.histT += dt;
    if (this.histT >= 0.05) { this.histT = 0; this.hist.push([this.pos[0], this.pos[1], this.pos[2]]); if (this.hist.length > 46) this.hist.shift(); }
    // していることの進み
    if (this.act.type) {
      this.actT -= dt;
      this.act.k = clamp(1 - this.actT / this.actDur, 0, 1);
      if (this.actT <= 0) this.act = { type: null, k: 0 };
    }
    if (this.reloadT > 0) this.act = { type: 'reload', k: clamp(1 - this.reloadT / W.reload, 0, 1) };
    else if (this.swapT > 0) this.act = { type: 'swap', k: clamp(1 - this.swapT / SWAP_TIME, 0, 1) };
    // 落ちた
    if (this.pos[1] < g.world.killY) g.kill(this, this.lastHitT > g.time - 6 ? this.lastHitBy : null, { fall: true, weapon: this.lastHitBy && this.lastHitT > g.time - 6 ? this.lastHitBy.lastWeapon : 0 });
  }

  move(dt) {
    const g = this.game, inp = this.input, W = this.W;
    let mx = inp.mx, mz = inp.mz;
    const L = Math.hypot(mx, mz); if (L > 1) { mx /= L; mz /= L; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // 前＝(sin, cos)、右＝(-cos, sin)
    let wx = sy * mz - cy * mx, wz = cy * mz + sy * mx;
    let max = BODY.run * (W.move || 1);
    if (this.crouching) max = BODY.crouch;
    if (this.focusT >= 0) max *= W.slow || 0.55;
    if (this.chargeT > 0) max *= 0.7;
    if (this.adsK > 0.5 && W.kind !== 'melee') max *= 0.72;
    if (this.meleeT >= 0 && W.wind > 0.15) max *= 0.6;
    const v = this.vel;
    if (this.stunT > 0) { wx = wz = 0; }
    if (this.rollT > 0) {
      this.rollT -= dt;
      const S = SKILLS.roll;
      const k = this.rollT / S.dur;
      v[0] = this.rollDir.x * S.speed * (0.45 + 0.55 * k); v[2] = this.rollDir.z * S.speed * (0.45 + 0.55 * k);
    } else if (this.kbT > 0) {
      v[0] *= Math.exp(-dt * 1.2); v[2] *= Math.exp(-dt * 1.2);
    } else if (this.onGround) {
      const tx = wx * max, tz = wz * max;
      let dx = tx - v[0], dz = tz - v[2];
      // 走り出しは速く、止まるときは少しだけすべる（ぴたっと止まりすぎない）
      const d = Math.hypot(dx, dz), acc = (L > 0.01 ? BODY.accel : BODY.friction) * dt;
      if (d > acc) { dx *= acc / d; dz *= acc / d; }
      v[0] += dx; v[2] += dz;
    } else if (this.padT <= 0) {
      // 空中は少しだけ向きを変えられる
      const tx = wx * max, tz = wz * max;
      v[0] += clamp(tx - v[0], -BODY.airAccel * dt, BODY.airAccel * dt) * (L > 0.01 ? 1 : 0.2);
      v[2] += clamp(tz - v[2], -BODY.airAccel * dt, BODY.airAccel * dt) * (L > 0.01 ? 1 : 0.2);
    }
    // ジャンプ（押した瞬間を少し覚えておく・崖から出た直後も跳べる）
    if (inp.jump) this.jumpBuf = 0.13;
    this.jumpBuf -= dt;
    if (this.onGround) this.coyote = 0.1; else this.coyote -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0 && this.stunT <= 0 && this.rollT <= 0) {
      v[1] = BODY.jump; this.onGround = false; this.jumpBuf = 0; this.coyote = 0;
      if (this.crouching) { this.crouching = false; this.h = BODY.h; }
      g.emit('jump', { f: this });
    }
    // 体を動かす（速いときは細かく分けて）
    const sp = Math.hypot(v[0], v[1], v[2]);
    const n = Math.min(8, Math.max(1, Math.ceil(sp * dt / 0.18), Math.ceil(dt / (1 / 90))));
    for (let i = 0; i < n; i++) {
      const res = stepCharacter(g.world, this, dt / n);
      if (res.landed) {
        if (res.fallSpeed > 4) g.emit('land', { f: this, k: Math.min(1.5, res.fallSpeed / 10) });
        this.padT = 0;
      }
      if (res.pad && this.padT <= 0) {
        v[0] = res.pad.v[0]; v[1] = res.pad.v[1]; v[2] = res.pad.v[2]; this.onGround = false;
        const T = 2 * res.pad.v[1] / BODY.gravity; this.padT = T * 0.9;
        g.emit('pad', { f: this, pad: res.pad });
        break;
      }
    }
    // ほかの人とぶつからない
    for (const o of g.fighters) {
      if (o === this || !o.alive) continue;
      const dx = this.pos[0] - o.pos[0], dz = this.pos[2] - o.pos[2], d2 = dx * dx + dz * dz, R = this.r + o.r;
      if (d2 < R * R && d2 > 1e-6 && Math.abs(this.pos[1] - o.pos[1]) < 1.5) {
        const d = Math.sqrt(d2), push = (R - d) * 0.5;
        this.pos[0] += dx / d * push; this.pos[2] += dz / d * push;
      }
    }
  }

  useSkill() {
    const g = this.game, S = SKILLS[this.skill], inp = this.input;
    if (!S) return;
    switch (this.skill) {
      case 'roll': {
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        let mx = inp.mx, mz = inp.mz;
        if (Math.hypot(mx, mz) < 0.1) { mx = 0; mz = 1; }
        const L = Math.hypot(mx, mz);
        this.rollDir.set((sy * mz - cy * mx) / L, 0, (cy * mz + sy * mx) / L);
        this.rollT = S.dur; this.iframeT = S.iframe;
        if (this.crouching) { this.crouching = false; this.h = BODY.h; }
        this.cancelActions();
        break;
      }
      case 'pierce': if (this.pierceN) return; this.pierceN = -1; break;
      case 'rewind': {
        if (this.hist.length < 4) return;
        const back = Math.round(S.back / 0.05);
        const p = this.hist[Math.max(0, this.hist.length - back)];
        const from = this.center(new THREE.Vector3());
        this.pos[0] = p[0]; this.pos[1] = p[1]; this.pos[2] = p[2]; this.snap();
        this.vel[0] = this.vel[1] = this.vel[2] = 0; this.onGround = false; this.padT = 0; this.kbT = 0;
        this.hist = [];
        g.emit('rewind', { f: this, from });
        break;
      }
      case 'decoy': g.spawnDecoy(this); break;
      case 'parry': this.parryT = S.win; break;
    }
    this.skillCD = S.cd;
    g.emit('skill', { f: this, skill: this.skill });
  }

  cancelActions() { this.chargeT = 0; this.focusT = -1; this.burstN = 0; if (this.meleeT >= 0 && !this.meleeHit) this.meleeT = -1; }

  weapon(dt, W) {
    const g = this.game, inp = this.input;
    // 持ち替え
    let want = this.slot;
    if (inp.slot >= 0 && inp.slot < 3) want = inp.slot;
    if (inp.cycle) want = (this.slot + (inp.cycle > 0 ? 1 : 2)) % 3;
    if (want !== this.slot && this.meleeT < 0 && this.rollT <= 0) {
      this.slot = want; this.swapT = SWAP_TIME; this.reloadT = 0; this.cancelActions(); this.bloom = 0;
      this.model.setWeapon(this.loadout[this.slot]);
      g.emit('swap', { f: this });
      return;
    }
    // 覗く
    const canAds = W.kind !== 'melee' && this.rollT <= 0 && this.swapT <= 0;
    this.adsK += ((inp.ads && canAds ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    if (this.stunT > 0 || this.rollT > 0) { if (this.focusT >= 0) this.focusT = -1; return; }
    // リロード
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.ammo[this.slot] = W.mag; g.emit('reloaded', { f: this }); }
      if (inp.firePressed && this.ammo[this.slot] > 0 && W.kind !== 'beam') { this.reloadT = 0; } // 残っていれば撃って中断
      else return;
    }
    const mag = W.mag, ammo = this.ammo[this.slot];
    if (inp.reload && mag && ammo < mag && this.swapT <= 0) { this.startReload(W); return; }
    if (this.swapT > 0) return;
    // 近接
    if (W.kind === 'melee') {
      if (this.meleeT >= 0) {
        this.meleeT += dt;
        if (!this.meleeHit && this.meleeT >= W.wind) { this.meleeHit = true; g.melee(this, W); }
        if (this.meleeT >= Math.max(W.rate, W.wind + 0.12)) this.meleeT = -1;
      }
      if ((W.auto ? inp.fire : inp.firePressed) && this.coolT <= 0 && this.meleeT < 0) {
        this.meleeT = 0; this.meleeHit = false; this.meleeAlt = !this.meleeAlt; this.coolT = W.rate; this.idleT = 0;
        this.act = { type: 'melee', k: 0, alt: this.meleeAlt }; this.actT = Math.max(W.rate, W.wind + 0.15); this.actDur = this.actT;
        if (W.lunge && this.onGround) { const f = this.forward(_v); this.vel[0] += f.x * W.lunge; this.vel[2] += f.z * W.lunge; }
        this.lastWeapon = W.id; this.lastShotT = g.time;
        g.emit('swing', { f: this, w: W });
      }
      return;
    }
    // 弾切れ
    if (mag && ammo <= 0) {
      if (inp.firePressed || inp.fire) this.startReload(W);
      return;
    }
    // レールガン：押したら溜めて、溜まったら撃つ
    if (W.kind === 'beam') {
      if (this.chargeT > 0) {
        this.chargeT -= dt;
        this.act = { type: 'charge', k: 1 - this.chargeT / W.charge };
        if (this.chargeT <= 0) { this.chargeT = 0; this.fire(W); }
        return;
      }
      if (inp.firePressed && this.coolT <= 0) { this.chargeT = W.charge; g.emit('charge', { f: this, w: W }); }
      return;
    }
    // フォーカスライフル：押している間しぼり、離した瞬間に撃つ
    if (W.kind === 'focus') {
      if (this.focusT >= 0) {
        this.focusT += dt;
        if (!this.focusFull && this.focusT >= W.full) { this.focusFull = true; g.emit('focusFull', { f: this }); }
        this.act = { type: 'charge', k: Math.min(1, this.focusT / W.full) };
        if (!inp.fire) {
          const t = this.focusT;
          let dmg, perfect = false;
          if (t < W.full) dmg = W.lo + (W.hi - W.lo) * (t / W.full);
          else if (t <= W.full + W.win) { dmg = W.dmg; perfect = true; }
          else dmg = W.late;
          this.focusT = -1; this.focusFull = false;
          this.fire(W, { dmg, perfect });
        }
        return;
      }
      if (inp.fire && this.coolT <= 0) { this.focusT = 0; this.focusFull = false; }
      return;
    }
    // バーストの続き
    if (this.burstN > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) { this.fire(W); this.burstN--; this.burstT = W.gap; }
      return;
    }
    const want2 = W.auto ? inp.fire : inp.firePressed;
    if (want2 && this.coolT <= 0) {
      if (W.burst) { this.burstN = W.burst - 1; this.burstT = W.gap; this.coolT = W.rate; this.fire(W, { noCool: true }); }
      else this.fire(W);
    }
  }

  startReload(W) {
    if (!W.mag || this.ammo[this.slot] >= W.mag || this.reloadT > 0) return;
    this.reloadT = W.reload; this.cancelActions();
    this.game.emit('reload', { f: this, w: W });
  }

  fire(W, o = {}) {
    const g = this.game;
    if (W.mag) { if (this.ammo[this.slot] <= 0) return; this.ammo[this.slot]--; }
    if (!o.noCool) this.coolT = W.rate;
    this.idleT = 0; this.regenT = 0;
    this.recoil = Math.min(1.6, this.recoil + (W.recoil || 1) * 0.35);
    this.stats.shots++;
    this.lastWeapon = W.id; this.lastShotT = g.time;
    g.emit('fired', { f: this, W });
    // 貫通弾：構えていれば、この武器で何発ぶん抜けるか決める
    let pierce = false;
    if (this.pierceN && (W.kind === 'hitscan' || W.kind === 'pellet' || W.kind === 'focus')) {
      if (this.pierceN < 0) this.pierceN = W.auto ? SKILLS.pierce.n : (W.burst || 1);
      pierce = true; this.pierceN--;
    }
    g.fire(this, W, Object.assign({ pierce }, o));
    // 撃つたびに少しずつばらつく
    this.bloom = Math.min(3, this.bloom + (W.bloom || 0.15));
    if (W.mag && this.ammo[this.slot] <= 0) this.startReload(W);
  }

  // 今のばらつき（度）
  spread(W) {
    let s = W.spread || 0;
    if (this.adsK > 0.5 && W.adsSpread != null) s = s + (W.adsSpread - s) * this.adsK;
    s += this.bloom * (W.auto ? 1 : 0.5);
    const sp = Math.hypot(this.vel[0], this.vel[2]);
    if (!this.onGround) s *= 1.8;
    else if (sp > 2) s *= 1 + Math.min(0.5, sp * 0.06);
    if (this.crouching) s *= 0.75;
    return s;
  }

  // ダメージを受ける。dir は弾の向き（撃たれた方向の表示に使う）
  damage(amt, from, info = {}) {
    if (!this.alive || this.protectT > 0) return 0;
    const g = this.game;
    amt = Math.max(0, amt);
    this.hp -= amt; this.hitK = 1; this.idleT = 0; this.regenT = 0;
    if (from && from !== this) { this.lastHitBy = from; this.lastHitT = g.time; }
    this.lastDmgT = g.time; this.lastDmgFrom = info.origin ? info.origin.clone() : null;
    if (this.focusT >= 0 && amt > 15) this.focusT = Math.max(0, this.focusT - 0.15);
    g.emit('damage', { f: this, from, amt, head: info.head, weapon: info.weapon, point: info.point });
    if (this.hp <= 0) { this.hp = 0; g.kill(this, from, info); }
    return amt;
  }

  die() {
    this.alive = false; this.deadT = 0; this.stats.deaths++;
    this.model.root.traverse(o => { if (o.isMesh) o.castShadow = false; });
    this.cancelActions(); this.reloadT = 0; this.rollT = 0;
  }

  updateDead(dt) {
    this.deadT += dt;
    this.deadK = Math.min(1, this.deadT / 0.5);
    this.dissolve = Math.min(1.05, Math.max(0, (this.deadT - 0.25) / 1.1));
    if (this.dissolve >= 1.05) this.model.root.visible = false;
    if (!this.onGround && this.pos[1] > this.game.world.killY - 20) stepCharacter(this.game.world, this, dt);
  }

  // 見た目を動かす（補間した位置・向きで。毎フレーム同じ入れ物を使い回す）
  updateModel(dt, showTag) {
    const m = this.model, yaw = this.ryaw, sy = Math.sin(yaw), cy = Math.cos(yaw);   // 世界の向き → 体の向き（-yaw 回す）
    const vx = this.vel[0], vz = this.vel[2];
    const W = this.W, st = this.st;
    let act = this.act;
    if (this.meleeT >= 0) { st.mact = st.mact || { type: 'melee', k: 0, alt: false }; st.mact.k = clamp(this.meleeT / Math.max(W.rate, W.wind + 0.12), 0, 1); st.mact.alt = this.meleeAlt; act = st.mact; }
    st.x = this.rpos[0]; st.y = this.rpos[1]; st.z = this.rpos[2]; st.yaw = yaw; st.pitch = this.pitch;
    st.speed = Math.hypot(vx, vz); st.moveLocal.x = vx * cy - vz * sy; st.moveLocal.z = vx * sy + vz * cy;
    st.onGround = this.onGround; st.vy = this.vel[1]; st.crouch = this.crouching; st.act = act; st.recoil = this.recoil; st.hitK = this.hitK;
    st.rollK = this.rollT > 0 ? 1 - this.rollT / SKILLS.roll.dur : 0;
    st.rollDir.x = this.rollDir.x * cy - this.rollDir.z * sy; st.rollDir.z = this.rollDir.x * sy + this.rollDir.z * cy;
    st.deadK = this.alive ? 0 : this.deadK; st.dissolve = this.alive ? 0 : this.dissolve; st.victory = this.victory;
    st.charge = this.chargeT > 0 ? 1 - this.chargeT / (W.charge || 1) : (this.focusT >= 0 ? Math.min(1, this.focusT / (W.full || 1)) : 0);
    st.showTag = showTag && this.alive; st.hp = this.hp; st.maxHp = MAX_HP;
    st.ghost = this.protectT > 0 ? 0.35 + 0.25 * Math.sin(this.game.time * 20) : 0;
    st.rim = this.parryT > 0 ? 2.5 : this.iframeT > 0 ? 0.9 : undefined;
    m.update(dt, st);
  }
}
