'use strict';
// 対戦ロジック（サーバー権威）。定数と物理はクライアント(index.html)と同じ値にそろえること
const VH = 360, WORLD_W = 1440, GND = VH - 60;
const MAX_HP = 5, CHAR_W = 20, CHAR_H = 44, DUCK_H = 28;
const GRAVITY = 0.55, JUMP_F = -13, SPEED = 3.4;
const REGEN_IDLE = 120, REGEN_INT = 120;
const WIN_ROUNDS = 3;
const TICK_MS = 1000 / 60;
const LOBBY_MS = +process.env.LOBBY_MS || 10500;   // クライアントの10秒カウントダウン＋画面切替0.5秒
const ROUND_GAP_MS = 2000, MATCH_END_MS = 1800;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;            // 相手が来ないまま10分で部屋を閉じる
const BUFFER_FRAMES = 6;                            // 通信のゆらぎ吸収用の先行入力受付（約0.1秒）
const WEAPONS = {
  1: { type: 'melee', range: 46, reload: 26, dmg: 2, spd: 0 },
  2: { type: 'ranged', range: 240, reload: 40, dmg: 1, spd: 10 },
  3: { type: 'ranged', range: 620, reload: 115, dmg: 2, spd: 18 },
};
// オンライン対戦はクラシックステージ固定（クライアントと同じ）
const PLATFORMS = [
  { x: 0, y: GND, w: WORLD_W, h: 60 },
  { x: 130, y: GND - 80, w: 100, h: 12 }, { x: 290, y: GND - 155, w: 110, h: 12 }, { x: 90, y: GND - 230, w: 90, h: 12 },
  { x: 550, y: GND - 90, w: 130, h: 12 }, { x: 480, y: GND - 180, w: 100, h: 12 }, { x: 660, y: GND - 180, w: 100, h: 12 },
  { x: 570, y: GND - 260, w: 110, h: 12 }, { x: 950, y: GND - 80, w: 110, h: 12 }, { x: 1100, y: GND - 155, w: 100, h: 12 },
  { x: 880, y: GND - 220, w: 90, h: 12 }, { x: 1200, y: GND - 230, w: 100, h: 12 }, { x: 1050, y: GND - 295, w: 120, h: 12 },
];

// ---- 自動操作（BOT・マクロ）の検知基準 ----
// どれも「人間には続けて出せない数字」を、十分な回数そろったときだけ疑う（誤検知を避けるため厳しめ）
const BOT_MIN_SHOTS = +process.env.BOT_MIN_SHOTS || 20;   // これだけ撃つまでは判定しない
const BOT_ALIGNED_RATIO = 0.9;     // 撃った弾のうち、狙いが合っている瞬間に撃った割合
const BOT_INSTANT_RATIO = 0.8;     // 狙いが合った（かつ撃てる）瞬間から2フレーム以内に撃った割合
const BOT_INSTANT_FRAMES = 2;      // 2フレーム ≒ 0.033秒（人間の反応は速くても0.15秒前後）
const MACRO_TOGGLES_PER_SEC = 30;  // 左右・しゃがみの切り替えが1秒にこれ以上
const MACRO_SECONDS = 3;           // それが連続でこの秒数続いたら疑う
const ACTIVE_MIN_INPUTS = 10;      // 1試合でこれ未満しか操作していなければ「放置」
const DODGE_INSTANT_FRAMES = 6;    // 自分を狙った弾が出てから6フレーム（0.1秒）以内に跳んだら「瞬間回避」
const DODGE_GROUNDED_FRAMES = 15;  // 直前まで15フレーム以上地面にいたときだけ数える（連続ジャンプは対象外）
const DODGE_MIN_THREATS = +process.env.DODGE_MIN_THREATS || 8;   // 狙われた回数がこれ未満なら判定しない
const DODGE_MIN_COUNT = 6;         // 瞬間回避がこの回数以上
const DODGE_RATIO = 0.6;           // かつ、狙われた弾の6割以上を瞬間回避

const SLOTS = ['a', 'b'];
// 相手に見せる名前とティアは、そのまま信用せず長さと文字種を落とす
function cleanName(v) {
  const n = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 12);
  return n || 'プレイヤー';
}
function cleanTier(v) {
  return String(v == null ? '' : v).replace(/[^A-Za-z0-9ぁ-んァ-ヶ一-龠]/g, '').slice(0, 5);
}
const other = s => (s === 'a' ? 'b' : 'a');
const r1 = v => Math.round(v * 10) / 10;

function mkChar(x, dir) {
  return { x, y: GND - CHAR_H, vx: 0, vy: 0, dir, hp: MAX_HP, hpFrac: MAX_HP, hit: 0, dead: false,
    ducking: false, onGround: false, weapon: 2, shootCool: 0, idle: 0, regen: 0, healUsed: false };
}
function hits(b, c) {
  const ph = c.ducking ? DUCK_H : CHAR_H, top = c.ducking ? c.y + (CHAR_H - DUCK_H) : c.y;
  return b.x > c.x - 6 && b.x < c.x + CHAR_W + 6 && b.y > top - 4 && b.y < top + ph + 4;
}
function damage(c, dmg) {
  c.hp = Math.max(0, c.hp - dmg); c.hpFrac = c.hp; c.hit = 14; c.idle = 0; c.regen = 0;
  if (c.hp <= 0) c.dead = true;
}

class Room {
  // hooks: { onClose(room), onResult(winner, loser, reason), onSuspect(player, reason) }
  constructor(id, hooks) {
    this.id = id; this.hooks = hooks || {};
    this.players = { a: null, b: null };
    this.phase = 'waiting';                 // waiting → lobby → playing ⇄ roundOver → ended
    this.wins = { a: 0, b: 0 };
    this.chars = { a: mkChar(80, 1), b: mkChar(WORLD_W - 100, -1) };
    this.bullets = []; this.frame = 0; this.timers = new Set(); this.closed = false; this.closeTimer = null;
    this.matchLive = false; this.roundsDone = 0;
    this.later(() => {
      if (this.phase !== 'waiting') return;
      this.broadcast({ type: 'error', msg: '相手が来なかったため部屋を閉じました' });
      this.close();
    }, WAIT_TIMEOUT_MS);
  }
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.closed) fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const k of SLOTS) if (this.players[k]) this.players[k].ws.send(s);
  }
  send(p, obj) { if (p) p.ws.send(JSON.stringify(obj)); }

  join(ws, info) {
    if (this.phase !== 'waiting') return null;
    const slot = !this.players.a ? 'a' : !this.players.b ? 'b' : null;
    if (!slot) return null;
    // ログイン済みならDiscordの名前を使う（本人確認済み）。未ログインは自己申告の名前
    const acc = ws.account || null;
    this.players[slot] = {
      ws, ip: ws.ip || '', uid: acc ? acc.uid : null, verified: !!acc,
      name: acc ? cleanName(acc.name) : cleanName(info && info.name), tier: cleanTier(info && info.tier),
      srtt: -1, spingT: 0, rematch: false,
      input: { left: false, right: false, duck: false, weapon: 2 }, jumpBuf: 0, shootBuf: 0, healReq: false,
      alignedFrame: -1, readyFrame: -1, groundSince: -1,
    };
    this.resetStats(this.players[slot]);
    ws.room = this; ws.slot = slot;
    return slot;
  }
  resetStats(p) {
    Object.assign(p, { acts: 0, shots: 0, alignedShots: 0, instantShots: 0, togSec: 0, togN: 0, fastSecs: 0,
      threats: 0, instantDodges: 0, suspect: '' });
  }
  hostIp() { return this.players.a ? this.players.a.ip : ''; }

  start() {
    this.phase = 'lobby';
    // それぞれに相手の名前とティアを伝える
    for (const k of SLOTS) {
      const p = this.players[k], o = this.players[other(k)];
      if (p && o) this.send(p, { type: 'both_ready', opp: { name: o.name, tier: o.tier, verified: o.verified } });
    }
    this.schedulePing();
    this.later(() => this.startRound(), LOBBY_MS);
  }

  // ---- 通信の往復時間 ----
  // 相手に見せるPINGは、サーバーが自分で測った値だけを使う（本人の自己申告は信用しない）
  schedulePing() {
    this.later(() => {
      const t = Date.now();
      for (const s of SLOTS) { const p = this.players[s]; if (p) { p.spingT = t; this.send(p, { type: 'sping', t }); } }
      this.schedulePing();
    }, 2000);
  }
  spong(slot, msg) {
    const p = this.players[slot];
    if (p && p.spingT && msg.t === p.spingT) { p.srtt = Math.max(0, Date.now() - p.spingT); p.spingT = 0; }
  }
  ping(slot, msg) {
    const p = this.players[slot]; if (!p) return;
    const o = this.players[other(slot)];
    this.send(p, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0, opp: o && o.srtt >= 0 ? o.srtt : -1 });
  }

  // 両者が希望したら、同じ部屋のまま次の試合へ
  rematch(slot) {
    const p = this.players[slot];
    if (!p || this.phase !== 'ended') return;
    p.rematch = true;
    const a = this.players.a, b = this.players.b;
    this.broadcast({ type: 'rematch_state', a: !!(a && a.rematch), b: !!(b && b.rematch) });
    if (a && b && a.rematch && b.rematch) {
      a.rematch = false; b.rematch = false;
      this.wins = { a: 0, b: 0 };
      if (this.closeTimer) { clearTimeout(this.closeTimer); this.timers.delete(this.closeTimer); this.closeTimer = null; }
      this.phase = 'lobby';
      this.later(() => this.startRound(), 1500);
    }
  }
  startRound() {
    if (!this.matchLive) {                  // 新しい試合の1ラウンド目：試合単位の記録をリセット
      this.matchLive = true; this.roundsDone = 0;
      for (const s of SLOTS) if (this.players[s]) this.resetStats(this.players[s]);
    }
    this.chars = { a: mkChar(80, 1), b: mkChar(WORLD_W - 100, -1) };
    for (const s of SLOTS) {
      const p = this.players[s];
      if (p) { p.jumpBuf = 0; p.shootBuf = 0; p.healReq = false; p.alignedFrame = -1; p.readyFrame = -1; }
    }
    this.bullets = []; this.phase = 'playing';
    this.broadcast({ type: 'round_start', state: this.state() });
  }
  endRound(winner) {
    this.phase = 'roundOver';
    this.roundsDone++;
    if (winner) this.wins[winner]++;
    this.broadcast({ type: 'round_end', winner, wins: { ...this.wins }, state: this.state() });
    if (winner && this.wins[winner] >= WIN_ROUNDS) {
      // 決着した瞬間に記録する（この後の演出中に抜けても結果は変わらない）
      this.matchLive = false;
      if (this.hooks.onResult) this.hooks.onResult(this.players[winner], this.players[other(winner)], 'match');
      this.later(() => {
        this.phase = 'ended';
        this.broadcast({ type: 'match_end', winner, wins: { ...this.wins } });
        this.closeTimer = this.later(() => this.close(), 90000);   // 再戦の相談を待つ
      }, MATCH_END_MS);
    } else {
      this.later(() => this.startRound(), ROUND_GAP_MS);
    }
  }

  input(slot, i) {
    const p = this.players[slot]; if (!p) return;
    const left = !!i.left, right = !!i.right, duck = !!i.duck;
    if (this.phase === 'playing') {
      if (left || right || duck || i.jump || i.shoot || i.heal) p.acts++;
      // 切り替えの速さを数える（マクロ検知）
      const changes = (left !== p.input.left) + (right !== p.input.right) + (duck !== p.input.duck);
      if (changes) {
        const sec = Math.floor(Date.now() / 1000);
        if (sec !== p.togSec) {
          p.fastSecs = (sec === p.togSec + 1 && p.togN > MACRO_TOGGLES_PER_SEC) ? p.fastSecs + 1 : 0;
          p.togSec = sec; p.togN = 0;
        }
        p.togN += changes;
        if (p.togN > MACRO_TOGGLES_PER_SEC && p.fastSecs + 1 >= MACRO_SECONDS) this.flag(p, '入力の切り替えが人間離れした速さ（マクロの疑い）');
      }
    }
    p.input.left = left; p.input.right = right; p.input.duck = duck;
    if (i.weapon === 1 || i.weapon === 2 || i.weapon === 3) p.input.weapon = i.weapon;
    if (i.jump) p.jumpBuf = BUFFER_FRAMES;
    if (i.shoot) p.shootBuf = BUFFER_FRAMES;
    if (i.heal) p.healReq = true;
  }
  flag(p, reason) {
    if (!p || p.suspect) return;
    p.suspect = reason;
    if (this.hooks.onSuspect) this.hooks.onSuspect(p, reason);
  }

  leave(slot) {
    const leaver = this.players[slot];
    if (!leaver) return;
    const o = this.players[other(slot)];
    // 対戦の途中で抜けたら負け扱い（1ラウンド以上終わっている場合だけ）
    if (this.matchLive && this.roundsDone >= 1 && o && this.hooks.onResult) this.hooks.onResult(o, leaver, 'forfeit');
    this.players[slot] = null;
    const wasEnded = this.phase === 'ended';
    if (o) this.send(o, { type: 'opponent_left', after: wasEnded });
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of SLOTS) if (this.players[s]) this.players[s].ws.room = null;
    if (this.hooks.onClose) this.hooks.onClose(this);
  }

  // 相手を撃てる位置か（高さが合っていて、射程内で、相手の方を向いている）
  aimedAt(c, t) {
    const w = WEAPONS[c.weapon];
    return !t.dead && Math.abs(t.y - c.y) < 24 && Math.abs(t.x - c.x) <= w.range && Math.sign(t.x - c.x) === c.dir;
  }
  fire(slot) {
    const p = this.players[slot], c = this.chars[slot], t = this.chars[other(slot)], w = WEAPONS[c.weapon];
    // BOT検知：狙いが合った瞬間（かつ撃てるようになった瞬間）から撃つまでのフレーム数
    if (p) {
      p.shots++;
      if (this.aimedAt(c, t) && p.alignedFrame >= 0) {
        p.alignedShots++;
        if (this.frame - Math.max(p.alignedFrame, p.readyFrame) <= BOT_INSTANT_FRAMES) p.instantShots++;
      }
      p.readyFrame = -1;
      if (p.shots >= BOT_MIN_SHOTS && p.alignedShots / p.shots >= BOT_ALIGNED_RATIO &&
          p.alignedShots > 0 && p.instantShots / p.alignedShots >= BOT_INSTANT_RATIO) {
        this.flag(p, '狙いが合った瞬間に撃ち続けている（自動射撃の疑い）');
      }
    }
    c.shootCool = w.reload;
    if (w.type === 'melee') {
      if (!t.dead && Math.abs(t.x - c.x) <= w.range && Math.abs(t.y - c.y) < 40 && Math.sign(t.x - c.x) === c.dir) damage(t, w.dmg);
    } else {
      // 相手が地上にいて、このままなら当たる弾は「狙われた弾」として数える（自動回避の検知用）
      const threat = this.aimedAt(c, t) && t.onGround;
      const tp = this.players[other(slot)];
      if (threat && tp) tp.threats++;
      this.bullets.push({ x: c.x + CHAR_W / 2 + c.dir * 22, y: c.y + (c.ducking ? CHAR_H - 18 : 22),
        vx: w.spd * c.dir, own: slot, dist: 0, dmg: w.dmg, range: w.range,
        spawn: this.frame, threat, target: other(slot), dodgeChecked: false });
    }
  }
  // 弾が出た瞬間に跳んで避けるのを、人間には無理な割合で続けていないか
  checkDodge(slot, p) {
    if (p.groundSince < 0 || this.frame - p.groundSince < DODGE_GROUNDED_FRAMES) return;
    for (const b of this.bullets) {
      if (b.threat && b.target === slot && !b.dodgeChecked && this.frame - b.spawn <= DODGE_INSTANT_FRAMES) {
        b.dodgeChecked = true;
        p.instantDodges++;
        if (p.threats >= DODGE_MIN_THREATS && p.instantDodges >= DODGE_MIN_COUNT && p.instantDodges / p.threats >= DODGE_RATIO) {
          this.flag(p, '撃たれた瞬間に避け続けている（自動回避の疑い）');
        }
        break;
      }
    }
  }
  stepChar(slot) {
    const p = this.players[slot], c = this.chars[slot];
    if (c.shootCool > 0) c.shootCool--;
    if (c.hit > 0) c.hit--;
    if (c.dead || !p) return;
    // BOT検知用：狙いが合い始めたフレームと、撃てるようになったフレームを覚える
    if (this.aimedAt(c, this.chars[other(slot)])) { if (p.alignedFrame < 0) p.alignedFrame = this.frame; }
    else p.alignedFrame = -1;
    if (c.shootCool <= 0 && p.readyFrame < 0) p.readyFrame = this.frame;
    const inp = p.input;
    let shot = false;
    c.weapon = inp.weapon;
    if (p.healReq) {
      p.healReq = false;
      if (!c.healUsed) { c.healUsed = true; c.hp = MAX_HP; c.hpFrac = MAX_HP; c.idle = 0; c.regen = 0; }
    }
    if (p.jumpBuf > 0) { if (c.onGround) { c.vy = JUMP_F; p.jumpBuf = 0; this.checkDodge(slot, p); } else p.jumpBuf--; }
    if (p.shootBuf > 0) { if (c.shootCool <= 0) { this.fire(slot); shot = true; p.shootBuf = 0; } else p.shootBuf--; }
    if (inp.left) { c.vx = -SPEED; c.dir = -1; } else if (inp.right) { c.vx = SPEED; c.dir = 1; } else c.vx *= 0.5;
    c.ducking = inp.duck;
    // 物理（クライアントの applyPhys と同じ）
    c.vy += GRAVITY; c.y += c.vy; c.x += c.vx; c.onGround = false;
    const ph = c.ducking ? DUCK_H : CHAR_H;
    for (const pf of PLATFORMS) {
      const top = c.ducking ? c.y + (CHAR_H - DUCK_H) : c.y, bot = top + ph, prevBot = bot - c.vy;
      if (c.x + CHAR_W > pf.x && c.x < pf.x + pf.w && prevBot <= pf.y + 2 && bot >= pf.y && c.vy >= 0) {
        c.y = pf.y - CHAR_H; c.vy = 0; c.onGround = true; break;
      }
    }
    c.x = Math.max(0, Math.min(WORLD_W - CHAR_W, c.x));
    if (c.onGround) { if (p.groundSince < 0) p.groundSince = this.frame; } else p.groundSince = -1;
    if (c.y > VH + 50) { c.hp = 0; c.dead = true; }
    // 自然回復（クライアントの updateRegen と同じ）
    if (shot || c.hit > 0) { c.idle = 0; c.regen = 0; }
    else if (++c.idle >= REGEN_IDLE && c.hpFrac < MAX_HP && ++c.regen >= REGEN_INT) {
      c.regen = 0; c.hpFrac = Math.min(MAX_HP, c.hpFrac + 1); c.hp = Math.floor(c.hpFrac);
    }
  }
  tick() {
    if (this.phase !== 'playing') return;
    this.frame++;
    this.stepChar('a'); this.stepChar('b');
    this.bullets = this.bullets.filter(b => {
      b.x += b.vx; b.dist += Math.abs(b.vx);
      if (b.dist > b.range || b.x < -20 || b.x > WORLD_W + 20) return false;
      const t = this.chars[other(b.own)];
      if (!t.dead && hits(b, t)) { damage(t, b.dmg); return false; }
      return true;
    });
    const ad = this.chars.a.dead, bd = this.chars.b.dead;
    if (ad || bd) return this.endRound(ad && bd ? null : ad ? 'b' : 'a');
    this.broadcast({ type: 'state', state: this.state() });   // 60Hz で配信（相手の動きの遅れを減らす）
  }
  state() {
    const ch = c => ({ x: r1(c.x), y: r1(c.y), vx: r1(c.vx), vy: r1(c.vy), dir: c.dir, hp: c.hp, hit: c.hit,
      dead: c.dead, ducking: c.ducking, onGround: c.onGround, weapon: c.weapon, shootCool: c.shootCool });
    return {
      chars: { a: ch(this.chars.a), b: ch(this.chars.b) },
      bullets: this.bullets.map(b => ({ x: r1(b.x), y: b.y, vx: b.vx, own: b.own, dmg: b.dmg })),
      wins: { ...this.wins },
    };
  }
}

module.exports = { Room, TICK_MS, ACTIVE_MIN_INPUTS };
