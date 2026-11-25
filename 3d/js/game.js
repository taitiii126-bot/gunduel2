// 試合の世界：人・弾・グレネード・分身・当たり判定・ダメージ・やられ。音とエフェクトもここで鳴らす
import * as THREE from '../lib/three.js';
import { BODY, WEAPONS, SKILLS, clamp, angDiff } from './data.js';
import { rayCapsule, raySphere, stepCharacter } from './collision.js';
import { Fighter } from './fighter.js';
import { FighterModel } from './fighter-model.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor(o) {
    this.gfx = o.gfx; this.audio = o.audio; this.fx = o.fx; this.arena = o.arena; this.world = o.arena.world; this.scene = o.gfx.scene;
    this.teamMode = o.teamMode;
    this.fighters = []; this.projectiles = []; this.decoys = [];
    this.time = 0; this.listeners = {}; this.player = null;
    this.shakeAmt = 0; this.whizT = 0;
    this.grenadeGeo = new THREE.SphereGeometry(0.11, 12, 10);
  }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, d) { this.react(ev, d); const L = this.listeners[ev]; if (L) for (const fn of L) fn(d); }

  addFighter(o) {
    const f = new Fighter(this, o);
    this.fighters.push(f);
    this.scene.add(f.model.root);
    if (f.isPlayer) this.player = f;
    return f;
  }
  removeAll() {
    for (const f of this.fighters) { this.scene.remove(f.model.root); f.model.dispose(); }
    for (const d of this.decoys) this.removeDecoy(d);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.fighters = []; this.decoys = []; this.projectiles = [];
  }

  // 固定の刻みの始め：前の位置を覚える（描くときに前と今のあいだを補間する）
  beginTick() {
    for (const f of this.fighters) { f.prev[0] = f.pos[0]; f.prev[1] = f.pos[1]; f.prev[2] = f.pos[2]; f.prevYaw = f.yaw; }
    for (const d of this.decoys) { d.prev[0] = d.pos[0]; d.prev[1] = d.pos[1]; d.prev[2] = d.pos[2]; }
    for (const p of this.projectiles) p.prev.copy(p.pos);
  }
  interpolate(a) {
    for (const f of this.fighters) {
      for (let i = 0; i < 3; i++) f.rpos[i] = f.prev[i] + (f.pos[i] - f.prev[i]) * a;
      f.ryaw = f.prevYaw + angDiff(f.prevYaw, f.yaw) * a;
    }
    for (const d of this.decoys) for (let i = 0; i < 3; i++) d.rpos[i] = d.prev[i] + (d.pos[i] - d.prev[i]) * a;
    for (const p of this.projectiles) p.mesh.position.lerpVectors(p.prev, p.pos, a);
  }

  isEnemy(a, b) { return a !== b && (!this.teamMode || a.team !== b.team); }
  enemiesOf(f) { return this.fighters.filter(o => o.alive && this.isEnemy(f, o)); }

  // a の目から b の体が見えるか
  sees(a, b) {
    a.eye(_e); b.center(_c);
    if (this.world.clear(_e.x, _e.y, _e.z, _c.x, _c.y, _c.z)) return true;
    b.headPos(_c);
    return this.world.clear(_e.x, _e.y, _e.z, _c.x, _c.y, _c.z);
  }

  shake(k) { this.shakeAmt = Math.min(1.2, this.shakeAmt + k); }
  nearPlayer(pos, r) { const p = this.player; if (!p) return 0; const d = Math.hypot(p.pos[0] - pos.x, p.pos[1] + 1 - pos.y, p.pos[2] - pos.z); return Math.max(0, 1 - d / r); }

  update(dt) {
    this.time += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    this.whizT -= dt;
    for (const f of this.fighters) { if (f.bot) f.bot.think(dt); }
    for (const f of this.fighters) {
      if (!this.frozen || !f.alive) f.update(dt);
      else { f.adsK = 0; f.hitK = Math.max(0, f.hitK - dt * 4); f.vel[0] = f.vel[2] = 0; }
    }
    this.updateProjectiles(dt);
    this.updateDecoys(dt);
    // 入力の「押した瞬間」を消す
    for (const f of this.fighters) { const i = f.input; i.jump = i.firePressed = i.fireReleased = i.skill = i.heal = i.reload = false; i.slot = -1; i.cycle = 0; }
  }

  updateModels(dt, cam) {
    for (const f of this.fighters) {
      let show = false;
      if (!f.isPlayer && f.alive) {
        const p = this.player;
        if (p && !this.isEnemy(p, f)) show = true;
        else if (cam) { f.headPos(_c); const d = cam.position.distanceTo(_c); show = d < 45 && this.world.clear(cam.position.x, cam.position.y, cam.position.z, _c.x, _c.y + 0.3, _c.z); }
      }
      f.updateModel(dt, show);
    }
    for (const d of this.decoys) d.updateModel(dt);
  }

  // ---------------- 撃つ ----------------
  fire(f, W, o) {
    const fx = this.fx, au = this.audio;
    f.eye(_o);
    // 狙う向き：カメラの狙いの点があれば、目からそこへ（撃つ瞬間の向きで測り直す。1コマ前の向きを使わない）
    if (f.refreshAim) f.refreshAim();
    if (f.hasAimPoint && f.aimPoint.distanceToSquared(_o) > 2.5) _d.subVectors(f.aimPoint, _o).normalize();
    else f.lookDir(_d);
    // 一人称の自分は、手元の銃口が画面に見える場所から
    const muzzle = f.muzzleOverride ? f.muzzleOverride(new THREE.Vector3()) : f.model.muzzleWorld(new THREE.Vector3());
    if (muzzle.distanceToSquared(_o) > 4) muzzle.copy(_o);
    const spread = f.spread(W);
    const big = W.id === 3 || W.id === 5 || W.id === 11 || W.id === 10 || W.id === 8;
    fx.muzzle(muzzle, _d, W.color, big);
    if (f.isPlayer) this.shake(0.04 + (W.recoil || 1) * 0.025);
    if (W.kind === 'proj') {
      au.play('grenadeFire', f.isPlayer ? null : muzzle);
      this.spawnGrenade(f, muzzle, this.spreadDir(_d, spread), W);
      return;
    }
    if (W.kind === 'beam') {
      au.play('rail', f.isPlayer ? null : muzzle);
      const end = this.hitscan(f, _o, _d, W, W.dmg, { beam: true, pierce: o.pierce });
      fx.tracer(muzzle, end, W.color, 0.16, 0, 0, 0.55);
      fx.tracer(muzzle, end, '#ffffff', 0.05, 0, 0, 0.3);
      // らせんの光の粒
      _u.subVectors(end, muzzle); const L = _u.length(); _u.normalize();
      const side = new THREE.Vector3().crossVectors(_u, UPV).normalize(), up2 = new THREE.Vector3().crossVectors(side, _u);
      const col = new THREE.Color(W.color);
      for (let i = 0; i < Math.min(80, L * 2.2) * fx.mult; i++) {
        const s = i / 2.2, a = s * 2.4;
        _p.copy(muzzle).addScaledVector(_u, s).addScaledVector(side, Math.cos(a) * 0.12).addScaledVector(up2, Math.sin(a) * 0.12);
        fx.add.emit(fx.time + i * 0.002, _p.x, _p.y, _p.z, side.x * Math.cos(a) * 0.6, side.y * Math.cos(a) * 0.6 + 0.2, side.z * Math.cos(a) * 0.6, 0.5, 0.09, 0.01, col.r * 1.5, col.g * 1.5, col.b * 1.5, 1.4, 0, 1.5, 0);
      }
      if (f.isPlayer) this.shake(0.25);
      return;
    }
    if (W.kind === 'focus') {
      au.gun('focus', f.isPlayer ? null : muzzle, f.isPlayer);
      if (o.perfect) au.play('focusPerfect', f.isPlayer ? null : muzzle);
      const dir = this.spreadDir(_d, o.perfect ? 0 : spread);
      const end = this.hitscan(f, _o, dir, W, o.dmg, { pierce: o.pierce, perfect: o.perfect });
      fx.tracer(muzzle, end, o.perfect ? '#ffffff' : W.color, o.perfect ? 0.1 : 0.05, o.perfect ? 0 : 260, 12, o.perfect ? 0.35 : 0.4);
      if (o.perfect) fx.tracer(muzzle, end, W.color, 0.22, 0, 0, 0.3);
      this.emit('shot', { f, W, perfect: o.perfect });
      return;
    }
    au.gun(W.key, f.isPlayer ? null : muzzle, f.isPlayer);
    if (o.pierce) au.play('pierceShot', f.isPlayer ? null : muzzle);
    const n = W.kind === 'pellet' ? W.pellets : 1;
    let anyHit = false;
    for (let i = 0; i < n; i++) {
      const dir = this.spreadDir(_d, spread);
      const r = this.hitscan(f, _o, dir, W, W.dmg, { pierce: o.pierce, quiet: n > 1 });
      anyHit = anyHit || r.hit;
      const tc = o.pierce ? '#FF9F43' : W.color;
      fx.tracer(muzzle, r, tc, W.id === 3 ? 0.07 : n > 1 ? 0.025 : 0.035, W.id === 3 ? 0 : 320, W.id === 3 ? 0 : 7, W.id === 3 ? 0.45 : 0.32);
    }
    if (n > 1 && anyHit && f.isPlayer) au.play('hitmark');
    this.emit('shot', { f, W });
  }

  spreadDir(dir, deg) {
    const out = new THREE.Vector3().copy(dir);
    if (deg <= 0.001) return out;
    const r = THREE.MathUtils.degToRad(deg) * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
    _u.set(0, 1, 0); if (Math.abs(dir.y) > 0.95) _u.set(1, 0, 0);
    const a = new THREE.Vector3().crossVectors(dir, _u).normalize(), b = new THREE.Vector3().crossVectors(a, dir);
    const t = Math.tan(r);
    out.addScaledVector(a, Math.cos(th) * t).addScaledVector(b, Math.sin(th) * t).normalize();
    return out;
  }

  // 即着弾の弾。当たった場所を返す（.hit＝人に当たった）
  hitscan(f, origin, dir, W, baseDmg, o = {}) {
    const fx = this.fx, range = W.kind === 'pellet' ? 70 : 220;
    const wall = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, o.pierce ? { pierce: true } : null);
    const wallT = o.pierce ? range : (wall ? wall.t : range);
    // 人と分身
    const hits = [];
    for (const t of this.fighters) {
      if (!t.alive || !this.isEnemy(f, t)) continue;
      const crouch = t.crouching, y0 = t.pos[1], y1 = t.pos[1] + (crouch ? 0.98 : 1.42);
      const tb = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, t.pos[0], y0, y1, t.pos[2], 0.36);
      const hy = t.pos[1] + t.h - 0.2;
      const th = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, t.pos[0], hy, t.pos[2], BODY.headR);
      const best = Math.min(tb, th);
      if (best < wallT) hits.push({ t: best, f: t, head: th <= tb });
    }
    for (const d of this.decoys) {
      if (!this.isEnemy(f, d.owner)) continue;
      const tb = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, d.pos[0], d.pos[1], d.pos[1] + 1.6, d.pos[2], 0.38);
      if (tb < wallT) hits.push({ t: tb, decoy: d });
    }
    hits.sort((a, b) => a.t - b.t);
    const multi = o.pierce || o.beam;
    let endT = wallT, hitAny = false, reflected = false;
    for (const h of hits) {
      const point = _p.copy(origin).addScaledVector(dir, h.t);
      if (h.decoy) { this.popDecoy(h.decoy, point); hitAny = true; if (!multi) { endT = h.t; break; } continue; }
      const t = h.f;
      if (t.iframeT > 0) continue;   // ロールの無敵：すり抜ける
      if (t.parryT > 0) {
        // 反射：前から来た弾をはね返す
        t.forward(_w);
        if (-(_w.x * dir.x + _w.z * dir.z) > -0.2) {
          this.reflect(t, f, W, baseDmg, point.clone(), h.head);
          endT = h.t; reflected = true; break;
        }
      }
      const dist = h.t;
      let dmg = baseDmg * this.falloff(W, dist);
      if (h.head && W.head) dmg *= W.head;
      dmg = Math.round(dmg * 10) / 10;
      t.damage(dmg, f, { head: h.head, weapon: W.id, point: point.clone(), origin: origin.clone() });
      f.stats.hits++; if (h.head) f.stats.heads++; f.stats.dmg += dmg;
      fx.hit(point, dir, t.colors.glow, h.head);
      hitAny = true;
      if (f.isPlayer && !o.quiet) this.audio.play(h.head ? 'headshot' : 'hitmark');
      if (f.isPlayer && o.quiet && h.head) this.audio.play('headshot');
      if (!multi) { endT = h.t; break; }
    }
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, endT);
    if (!hitAny && !reflected && wall && !o.pierce) {
      _c.set(wall.n[0], wall.n[1], wall.n[2]);
      fx.impact(end, _c, W.color, { big: W.id === 3 || W.kind === 'beam', dust: this.arena.dust });
    } else if (o.pierce && wall) {
      // 貫通：壁にも跡を残す
      const wp = new THREE.Vector3().copy(origin).addScaledVector(dir, wall.t);
      fx.impact(wp, _c.set(wall.n[0], wall.n[1], wall.n[2]), '#FF9F43', { dust: this.arena.dust });
    } else if (multi && wall && !reflected) {
      fx.impact(end, _c.set(wall.n[0], wall.n[1], wall.n[2]), W.color, { big: true, dust: this.arena.dust });
    }
    // 弾が耳もとをかすめた音
    const p = this.player;
    if (p && p !== f && p.alive && this.whizT <= 0 && !hitAny) {
      p.headPos(_c);
      _u.subVectors(_c, origin); const s = clamp(_u.dot(dir), 0, endT);
      _w.copy(origin).addScaledVector(dir, s);
      const dd = _w.distanceTo(_c);
      if (dd < 1.6 && s > 2) { this.audio.play('whiz', _w); this.whizT = 0.12; }
    }
    end.hit = hitAny;
    return end;
  }

  falloff(W, dist) {
    const R = W.range || 30;
    if (dist <= R) return 1;
    return Math.max(W.falloff != null ? W.falloff : 0.5, 1 - (1 - (W.falloff != null ? W.falloff : 0.5)) * (dist - R) / R);
  }

  // 反射：はね返した弾が撃った人に当たる
  reflect(t, shooter, W, dmg, point, head) {
    const fx = this.fx;
    fx.burst(point, '#FDE047', 26, 7, 0.35, 0.12);
    fx.ring(point, '#FDE047', 0.1, 1.4, 0.25);
    this.audio.play('parryHit', t.isPlayer ? null : point);
    shooter.eye(_c);
    fx.tracer(point, _c, '#FDE047', 0.06, 0, 0, 0.35);
    if (shooter.alive && shooter.protectT <= 0) {
      const amt = dmg * (head && W.head ? W.head : 1);
      shooter.damage(amt, t, { weapon: W.id, reflect: true, point: _c.clone(), origin: point.clone() });
      t.stats.dmg += amt;
    }
    this.emit('parried', { by: t, shooter });
  }

  // ---------------- 近接 ----------------
  melee(f, W) {
    f.eye(_o); f.forward(_d);
    const arc = Math.cos(THREE.MathUtils.degToRad(W.arc / 2));
    let hitAny = false;
    const cands = [];
    for (const t of this.fighters) {
      if (!t.alive || !this.isEnemy(f, t)) continue;
      const dx = t.pos[0] - f.pos[0], dz = t.pos[2] - f.pos[2], dy = t.pos[1] - f.pos[1];
      const d = Math.hypot(dx, dz);
      if (d - t.r > W.reach || Math.abs(dy) > 1.7) continue;
      const cos = d > 0.01 ? (dx * _d.x + dz * _d.z) / d : 1;
      if (cos < arc && d > 0.9) continue;
      t.center(_c);
      if (!this.world.clear(_o.x, _o.y, _o.z, _c.x, _c.y, _c.z)) continue;
      cands.push({ t, d });
    }
    for (const d of this.decoys) {
      if (!this.isEnemy(f, d.owner)) continue;
      const dx = d.pos[0] - f.pos[0], dz = d.pos[2] - f.pos[2], dist = Math.hypot(dx, dz);
      if (dist < W.reach + 0.4 && (dx * _d.x + dz * _d.z) / Math.max(0.01, dist) > arc) { this.popDecoy(d, new THREE.Vector3(d.pos[0], d.pos[1] + 1, d.pos[2])); hitAny = true; }
    }
    cands.sort((a, b) => a.d - b.d);
    const many = W.id === 14 || W.id === 13;
    for (const { t } of (many ? cands : cands.slice(0, 1))) {
      t.center(_c);
      if (t.iframeT > 0) continue;
      if (t.parryT > 0) {
        // 近接を受け止められた：しばらく動けない
        f.stunT = 0.9; f.meleeT = -1;
        this.fx.burst(_c, '#FDE047', 30, 6, 0.4, 0.14); this.audio.play('parryHit', t.isPlayer ? null : _c);
        this.emit('parried', { by: t, shooter: f });
        continue;
      }
      let dmg = W.dmg;
      // ナイフ：背中から刺すと強い
      if (W.id === 1) { t.forward(_w); if (_w.x * _d.x + _w.z * _d.z > 0.5) dmg *= 1.6; }
      t.damage(dmg, f, { weapon: W.id, point: _c.clone(), origin: _o.clone(), melee: true });
      f.stats.hits++; f.stats.dmg += dmg;
      this.fx.hit(_c, _d, t.colors.glow, false);
      if (W.kb && t.alive) {
        const dx = t.pos[0] - f.pos[0], dz = t.pos[2] - f.pos[2], L = Math.hypot(dx, dz) || 1;
        t.vel[0] = dx / L * W.kb; t.vel[2] = dz / L * W.kb; t.vel[1] = W.kbUp; t.onGround = false; t.kbT = 0.5; t.padT = 0;
        this.fx.burst(_c, W.color, 24, 8, 0.4, 0.15);
        this.shake(0.3 * (t.isPlayer || f.isPlayer ? 1 : this.nearPlayer(_c, 20)));
      }
      hitAny = true;
    }
    if (hitAny) { this.audio.play('meleeHit', f.isPlayer ? null : _c, { heavy: W.id === 14 }); if (f.isPlayer) { this.audio.play('hitmark'); this.shake(0.12); } }
    this.emit('meleeDone', { f, hit: hitAny });
  }

  // ---------------- グレネード ----------------
  spawnGrenade(f, pos, dir, W) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(W.color), emissiveIntensity: 2.5, metalness: 0.5, roughness: 0.3 });
    const mesh = new THREE.Mesh(this.grenadeGeo, mat);
    mesh.position.copy(pos); this.scene.add(mesh);
    const v = new THREE.Vector3().copy(dir).multiplyScalar(W.speed);
    v.y += 2.2;
    this.projectiles.push({ pos: pos.clone(), prev: pos.clone(), vel: v, owner: f, W, life: W.fuse, mesh, age: 0 });
  }
  updateProjectiles(dt) {
    const fx = this.fx;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt; p.life -= dt;
      p.vel.y -= p.W.grav * dt;
      const step = p.vel.length() * dt;
      _d.copy(p.vel).normalize();
      let boom = null, direct = null;
      const hit = this.world.raycast(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, step);
      // 人に直接
      for (const t of this.fighters) {
        if (!t.alive || (t === p.owner && p.age < 0.25) || (!this.isEnemy(p.owner, t) && t !== p.owner)) continue;
        const tb = rayCapsule(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, t.pos[0], t.pos[1], t.pos[1] + t.h, t.pos[2], 0.45);
        if (tb <= step && (!hit || tb < hit.t)) { boom = p.pos.clone().addScaledVector(_d, tb); direct = t; }
      }
      for (const d of this.decoys) {
        if (!this.isEnemy(p.owner, d.owner)) continue;
        const tb = rayCapsule(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, d.pos[0], d.pos[1], d.pos[1] + 1.6, d.pos[2], 0.45);
        if (tb <= step) { boom = p.pos.clone().addScaledVector(_d, tb); this.popDecoy(d, boom); }
      }
      if (!boom && hit) boom = p.pos.clone().addScaledVector(_d, Math.max(0, hit.t - 0.05)).add(new THREE.Vector3(hit.n[0], hit.n[1], hit.n[2]).multiplyScalar(0.12));
      if (!boom && (p.life <= 0 || p.pos.y < this.world.killY)) boom = p.pos.clone();
      if (boom) {
        if (p.pos.y >= this.world.killY) this.explode(boom, p.owner, p.W, direct);
        this.scene.remove(p.mesh); p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      // 光の尾
      const c = new THREE.Color(p.W.color);
      fx.add.emit(fx.time, p.pos.x, p.pos.y, p.pos.z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0.3, 0.22, 0.02, c.r * 1.4, c.g * 1.4, c.b * 1.4, 1.3, 0, 1, 0);
      if (Math.random() < 0.5) fx.smoke.emit(fx.time, p.pos.x, p.pos.y, p.pos.z, 0, 0.3, 0, 0.7, 0.12, 0.5, 0.6, 0.6, 0.62, 0.3, 1, 1, -0.02);
    }
  }

  explode(pos, owner, W, direct) {
    this.fx.explosion(pos, W.color, W.splash);
    this.audio.play('explosion', pos);
    this.shake(0.9 * this.nearPlayer(pos, 22));
    for (const t of this.fighters) {
      if (!t.alive) continue;
      if (t !== owner && !this.isEnemy(owner, t)) continue;
      t.center(_c);
      const d = _c.distanceTo(pos);
      let dmg = 0;
      if (t === direct) dmg = Math.max(W.dmg, W.sdmg);
      else if (d < W.splash && this.world.clear(pos.x, pos.y + 0.1, pos.z, _c.x, _c.y, _c.z)) dmg = W.sdmg * Math.pow(1 - d / W.splash, 0.75);
      if (dmg <= 0) continue;
      if (t === owner) dmg *= W.self;
      t.damage(dmg, owner, { weapon: W.id, point: _c.clone(), origin: pos.clone(), splash: true });
      if (t !== owner) { owner.stats.hits++; owner.stats.dmg += dmg; if (owner.isPlayer) this.audio.play('hitmark'); }
      // 爆風で飛ばす
      if (t.alive && W.kb) {
        const k = Math.max(0.2, 1 - d / W.splash);
        _u.subVectors(_c, pos); _u.y = Math.max(0.3, _u.y + 0.6); _u.normalize();
        t.vel[0] += _u.x * W.kb * k; t.vel[1] = Math.max(t.vel[1], _u.y * W.kb * k * 0.8); t.vel[2] += _u.z * W.kb * k;
        t.onGround = false; t.kbT = 0.3 * k;
      }
    }
  }

  // ---------------- 分身 ----------------
  spawnDecoy(f) {
    const d = new Decoy(this, f);
    this.decoys.push(d);
    this.scene.add(d.model.root);
  }
  updateDecoys(dt) {
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const d = this.decoys[i];
      d.update(dt);
      if (d.life <= 0 || !d.owner.alive || d.pos[1] < this.world.killY) { this.popDecoy(d, new THREE.Vector3(d.pos[0], d.pos[1] + 1, d.pos[2])); }
    }
  }
  popDecoy(d, at) {
    const i = this.decoys.indexOf(d);
    if (i < 0) return;
    this.decoys.splice(i, 1);
    this.fx.burst(at, SKILLS.decoy.color, 40, 5, 0.5, 0.14);
    this.audio.play('decoy', at);
    this.removeDecoy(d);
  }
  removeDecoy(d) { this.scene.remove(d.model.root); d.model.dispose(); }

  // ---------------- やられ ----------------
  kill(victim, killer, info = {}) {
    if (!victim.alive) return;
    victim.die();
    const fall = !!info.fall;
    if (killer === victim) killer = null;
    if (killer) { killer.stats.kills++; killer.stats.score++; }
    else if (!this.teamMode) victim.stats.score = Math.max(0, victim.stats.score - 1);
    // アシスト（5秒以内にダメージを与えていた人）
    if (victim.dmgBy) for (const [id, rec] of victim.dmgBy) {
      const a = this.fighters.find(x => x.id === id);
      if (a && a !== killer && a !== victim && this.time - rec.t < 5) a.stats.assists++;
    }
    victim.dmgBy = null;
    victim.center(_c);
    this.fx.dissolve(new THREE.Vector3(victim.pos[0], victim.pos[1], victim.pos[2]), victim.colors.glow);
    this.audio.play(fall ? 'fall' : 'death', victim.isPlayer ? null : _c);
    if (killer && killer.isPlayer) this.audio.play('kill');
    this.emit('kill', { victim, killer, weapon: info.weapon || (killer && killer.lastWeapon) || 0, head: !!info.head, fall });
  }

  // ---------------- 音とエフェクト ----------------
  react(ev, d) {
    const au = this.audio, fx = this.fx, f = d && d.f;
    const pos = f ? f.center(new THREE.Vector3()) : null;
    const me = f && f.isPlayer;
    switch (ev) {
      case 'jump': au.play('jump', me ? null : pos); break;
      case 'land': au.play('land', me ? null : pos, { k: d.k }); fx.dust(new THREE.Vector3(f.pos[0], f.pos[1], f.pos[2]), 4 + d.k * 6, this.arena.dust); if (me) this.shake(0.06 * d.k); break;
      case 'pad': au.play('pad', me ? null : pos); fx.burst(new THREE.Vector3(f.pos[0], f.pos[1] + 0.3, f.pos[2]), d.pad ? '#FFE08A' : '#fff', 24, 5, 0.5, 0.12); break;
      case 'swap': if (me) au.play('swap'); break;
      case 'reload': if (me || this.nearPlayer(pos, 10) > 0) au.play('reload', me ? null : pos, { dur: d.w.reload }); break;
      case 'swing': au.play('swing', me ? null : pos, { dur: d.w.wind + 0.15 }); break;
      case 'charge': au.play('railCharge', me ? null : pos, { dur: d.w.charge }); break;
      case 'focusFull': au.play('focusFull', me ? null : pos); break;
      case 'heal': au.play('heal', me ? null : pos); fx.heal(new THREE.Vector3(f.pos[0], f.pos[1], f.pos[2])); break;
      case 'damage': {
        if (!d.f.dmgBy) d.f.dmgBy = new Map();
        if (d.from) d.f.dmgBy.set(d.from.id, { t: this.time });
        if (me) { au.play('hurt'); this.shake(0.12 + Math.min(0.4, d.amt / 80)); }
        break;
      }
      case 'skill': {
        const S = SKILLS[d.skill];
        if (d.skill === 'roll') { au.play('roll', me ? null : pos); fx.dust(new THREE.Vector3(f.pos[0], f.pos[1], f.pos[2]), 6, this.arena.dust); }
        else if (d.skill === 'pierce') { au.play('pierce', me ? null : pos); fx.burst(pos, S.color, 30, 3, 0.5, 0.12); fx.ring(new THREE.Vector3(f.pos[0], f.pos[1] + 0.1, f.pos[2]), S.color, 0.3, 1.5, 0.4); }
        else if (d.skill === 'decoy') { au.play('decoy', me ? null : pos); fx.burst(pos, S.color, 36, 4, 0.5, 0.12); }
        else if (d.skill === 'parry') { au.play('parry', me ? null : pos); fx.ring(pos, S.color, 0.4, 1.3, 0.25); fx.burst(pos, S.color, 20, 3, 0.3, 0.1); }
        break;
      }
      case 'rewind': {
        au.play('rewind', me ? null : pos);
        fx.burst(d.from, SKILLS.rewind.color, 40, 4, 0.6, 0.13);
        fx.burst(pos, SKILLS.rewind.color, 40, 4, 0.6, 0.13);
        fx.tracer(d.from, pos, SKILLS.rewind.color, 0.1, 0, 0, 0.45);
        break;
      }
    }
  }
}

// 分身：持ち主と同じ見た目で、決めた向きに走る。1発当たると消える
class Decoy {
  constructor(game, owner) {
    this.game = game; this.owner = owner;
    this.model = new FighterModel({ colors: owner.colors, skin: owner.model.o.skin, hair: owner.model.o.hair, eye: owner.model.o.eye, accent: owner.model.o.accent, name: owner.name, showName: !owner.isPlayer });
    this.model.setWeapon(owner.loadout[owner.slot]);
    this.pos = owner.pos.slice(); this.vel = [0, 0, 0]; this.onGround = owner.onGround; this.r = BODY.r; this.h = BODY.h;
    this.prev = this.pos.slice(); this.rpos = this.pos.slice();
    this.yaw = owner.yaw; this.pitch = owner.pitch;
    const inp = owner.input; let mx = inp.mx, mz = inp.mz;
    if (Math.hypot(mx, mz) < 0.1) { mx = Math.random() < 0.5 ? -1 : 1; mz = 0.4; }
    const L = Math.hypot(mx, mz), sy = Math.sin(owner.yaw), cy = Math.cos(owner.yaw);
    this.dir = new THREE.Vector3((sy * mz - cy * mx) / L, 0, (cy * mz + sy * mx) / L);
    this.life = SKILLS.decoy.life;
    this.jumpT = 0.6 + Math.random();
  }
  update(dt) {
    this.life -= dt;
    const sp = BODY.run * 0.95;
    this.vel[0] = this.dir.x * sp; this.vel[2] = this.dir.z * sp;
    this.jumpT -= dt;
    if (this.jumpT <= 0 && this.onGround) { this.vel[1] = BODY.jump * 0.9; this.onGround = false; this.jumpT = 0.9 + Math.random() * 1.2; }
    for (let i = 0; i < 2; i++) {
      const r = stepCharacter(this.game.world, this, dt / 2);
      if (r.wall) { const a = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2; const x = this.dir.x * Math.cos(a) - this.dir.z * Math.sin(a), z = this.dir.x * Math.sin(a) + this.dir.z * Math.cos(a); this.dir.set(x, 0, z); }
    }
    // 落ちそうなら向きを変える
    const g = this.game.world.groundAt(this.pos[0] + this.dir.x * 1.2, this.pos[2] + this.dir.z * 1.2, 0.2, this.pos[1] + 0.5, 0.6);
    if (this.onGround && (!g || g.y < this.pos[1] - 2)) this.dir.multiplyScalar(-1);
  }
  updateModel(dt) {
    const o = this.owner;
    this.model.update(dt, { x: this.rpos[0], y: this.rpos[1], z: this.rpos[2], yaw: this.yaw, pitch: o.pitch, speed: BODY.run, moveLocal: { x: this.dir.x * Math.cos(this.yaw) - this.dir.z * Math.sin(this.yaw), z: this.dir.x * Math.sin(this.yaw) + this.dir.z * Math.cos(this.yaw) },
      onGround: this.onGround, vy: this.vel[1], crouch: false, act: null, recoil: 0, hitK: 0, showTag: !o.isPlayer && this.game.player && this.game.isEnemy(this.game.player, o), hp: o.hp, maxHp: 100, ghost: o.isPlayer ? 0.25 : 0 });
  }
}
