'use strict';
// 2v2（チーム戦）の部屋。サーバー権威で、物理・武器・弾は sim.js（ブラウザと同じ）を使う。
// 4人：a と c が左のチーム（0）、b と d が右のチーム（1）。味方には当たらない。
// 人数が足りないとき・途中で抜けた人のところは BOT が入る（BOT は人と同じルールで、考えた操作を入れるだけ）
const G = require('./game');
const { SIM } = G;
const SLOTS = SIM.TEAM_SLOTS;             // ['a', 'b', 'c', 'd']
const teamOf = SIM.teamOf;
const ACTIVE_MIN_INPUTS = G.ACTIVE_MIN_INPUTS;

class TeamRoom {
  // hooks: { onClose(room), onResult(room, winTeam), onLeave(room, player) }
  // opt.private：フレンドと対戦（部屋番号で集まり、部屋を作った人が開始を押す）
  constructor(id, hooks, opt) {
    this.id = id; this.hooks = hooks || {}; this.kind = 'team';
    this.private = !!(opt && opt.private);
    this.players = { a: null, b: null, c: null, d: null };
    this.hostSlot = null;
    this.phase = 'waiting';                 // waiting → lobby → playing ⇄ roundOver/pick → ended
    this.wins = [0, 0];
    this.world = SIM.newTeamWorld(G.STAGE, {});
    this.stage = G.FORCE_STAGE || G.STAGE; this.stagePick = G.FORCE_STAGE ? null : G.twoStages(); this.votes = {};   // ステージ投票
    this.frame = 0; this.timers = new Set(); this.closed = false; this.closeTimer = null;
    this.matchLive = false; this.roundsDone = 0; this.ranked = false; this.rate0 = null;
    this.later(() => {
      if (this.phase !== 'waiting') return;
      this.broadcast({ type: 'error', code: 'room_timeout', msg: '人が集まらなかったため部屋を閉じました' });
      this.close();
    }, G.WAIT_TIMEOUT_MS);
  }
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); if (!this.closed) fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const k of SLOTS) { const p = this.players[k]; if (p && !p.bot) p.ws.send(s); }
  }
  send(p, obj) { if (p && !p.bot) p.ws.send(JSON.stringify(obj)); }
  humans() { return SLOTS.map(k => this.players[k]).filter(p => p && !p.bot); }
  allPlayers() { return SLOTS.map(k => this.players[k]).filter(Boolean); }
  hostUid() { const h = this.hostSlot && this.players[this.hostSlot]; return h ? h.uid : null; }
  hostIp() { const h = this.hostSlot && this.players[this.hostSlot]; return h ? h.ip : ''; }
  isFull() { return SLOTS.every(k => this.players[k]); }
  hasBots() { return SLOTS.some(k => this.players[k] && this.players[k].bot); }

  // 入る（slot を指定しなければ、空いている所を a → b → c → d の順に）
  join(ws, info, slot) {
    if (this.phase !== 'waiting') return null;
    const s = slot && SLOTS.includes(slot) && !this.players[slot] ? slot : SLOTS.find(k => !this.players[k]);
    if (!s) return null;
    const acc = ws.account || null;
    this.players[s] = {
      ws, ip: ws.ip || '', uid: acc ? acc.uid : null, verified: !!acc, dev: !!(acc && acc.dev), slot: s,
      name: G.cleanName(info && info.name), discord: acc ? G.cleanName(acc.name) : '',
      // 2v2 のティアとレートは、ログイン中ならサーバーが持っている本物（ゲストは未ランク）
      tier: acc && acc.tier2Key ? acc.tier2Key : '', rate: acc ? (acc.rate2 || SIM.RATE_START) : SIM.RATE_START,
      loadout: SIM.cleanLoadout(info && info.loadout, false), look: SIM.cleanLook(info && info.look),
      title: G.cleanTitle(info && info.title, acc), bio: G.cleanBio(info && info.bio), bg: G.cleanBg(info && info.bg),
      rec: acc ? { w: G.cleanCount(acc.wins), l: G.cleanCount(acc.losses), kind: 'online' }
               : { w: G.cleanCount(info && info.cpu && info.cpu.w), l: G.cleanCount(info && info.cpu && info.cpu.l), kind: 'cpu' },
      srtt: -1, spingT: 0, rematch: false, acts: 0, suspect: '', left: false, done: false,
      input: { left: false, right: false, duck: false, fire: false, slot: 0 },
      jumpReq: false, shootReq: false, healReq: false, reloadReq: false,
    };
    if (!this.hostSlot) this.hostSlot = s;
    ws.room = this; ws.slot = s;
    return s;
  }
  // BOT を入れる（bots.js が作ったプロフィール）。人と同じ遅れを反応に足す
  joinBot(bot, slot) {
    const s = slot && !this.players[slot] ? slot : SLOTS.find(k => !this.players[k]);
    if (!s) return null;
    const ws = { send() {}, ip: '', account: null };
    const phase = this.phase; this.phase = 'waiting';   // 途中の補充でも入れられるように
    this.join(ws, { name: bot.name, loadout: bot.loadout, look: bot.look, bio: bot.bio, bg: bot.bg }, s);
    this.phase = phase;
    const p = this.players[s];
    this.makeBot(p, bot.cfg);
    p.rate = bot.rate; p.tier = bot.tierKey; p.title = bot.title; p.discord = bot.name; p.verified = true;
    p.rec = { w: bot.rec.w, l: bot.rec.l, kind: 'online' };
    p.srtt = 16 + Math.floor(Math.random() * 46);
    return s;
  }
  makeBot(p, cfg) {
    const lag = 6 + Math.floor(Math.random() * 4);
    p.bot = true; p.brain = SIM.newBrain(Object.assign({}, cfg, { react: cfg.react + lag }));
  }
  // 途中で抜けた人の場所を BOT が引き継ぐ（キャラクターと名前はそのまま、操作だけ BOT に）
  takeOver(slot) {
    const p = this.players[slot];
    if (!p || p.bot) return;
    if (p.ws) p.ws.room = null;
    p.ws = { send() {} }; p.left = true; p.uidLeft = p.uid;
    this.makeBot(p, SIM.aiForRate(p.rate || SIM.RATE_START));
    p.input = { left: false, right: false, duck: false, fire: false, slot: 0 };
    if (this.waitState) this.setReady(slot);
  }
  // 部屋の中の様子（フレンドと対戦：開始前に集まっている人）
  lobbyInfo() {
    const out = {};
    for (const k of SLOTS) {
      const p = this.players[k];
      out[k] = p ? { name: p.name, tier: p.tier, look: p.look, title: p.title, bot: !!p.bot, host: k === this.hostSlot } : null;
    }
    return out;
  }
  sendLobby() { this.broadcast({ type: 'team_lobby', roomId: this.id, host: this.hostSlot, players: this.lobbyInfo() }); }
  // 開始前だけ、空いている場所へ移れる（チームを変える）
  moveSlot(slot, to) {
    if (this.phase !== 'waiting' || !this.players[slot] || !SLOTS.includes(to) || this.players[to]) return false;
    const p = this.players[slot];
    this.players[to] = p; this.players[slot] = null; p.slot = to;
    if (p.ws) p.ws.slot = to;
    if (this.hostSlot === slot) this.hostSlot = to;
    this.send(p, { type: 'team_slot', slot: to });   // 移った本人に、新しい場所を知らせる
    this.sendLobby();
    return true;
  }
  // それぞれに、4人の名前・ティア・武器などを伝えて、試合前の準備へ
  start() {
    this.phase = 'lobby';
    this.rate0 = {};
    for (const k of SLOTS) { const p = this.players[k]; if (p) this.rate0[k] = p.rate || SIM.RATE_START; }
    const info = {};
    for (const k of SLOTS) {
      const p = this.players[k];
      if (p) info[k] = { name: p.name, discord: p.discord, tier: p.tier, rate: p.rate, verified: p.verified, dev: !!p.dev, loadout: p.loadout,
        look: p.look, title: p.title, bio: p.bio, bg: p.bg, rec: p.rec };
    }
    for (const k of SLOTS) { const p = this.players[k]; if (p && !p.bot) this.send(p, { type: 'team_ready', slot: k, ranked: this.ranked, players: info }); }
    this.schedulePing();
    this.stagePick = G.FORCE_STAGE ? null : G.twoStages(); this.votes = {};
    this.beginWait('prep', G.PREP_MS, G.VS_MS);
  }

  // ---- 準備（試合前）と武器の選び直し（ラウンド間）----
  beginWait(kind, ms, minMs) {
    const now = Date.now();
    this.waitState = { kind, earliest: now + (minMs || 0), until: now + (minMs || 0) + ms, ready: {} };
    this.waitTimer = this.later(() => this.endWait(), (minMs || 0) + ms);
    for (const s of SLOTS) {
      const p = this.players[s];
      if (!p || !p.bot) continue;
      if (kind === 'prep' && this.stagePick) this.later(() => this.vote(s, this.stagePick[Math.floor(Math.random() * 2)]), (minMs || 0) + 400 + Math.floor(Math.random() * 900));
      this.later(() => this.setReady(s), (minMs || 0) + 900 + Math.floor(Math.random() * 2200));
    }
    this.sendWait();
  }
  sendWait() {
    const w = this.waitState;
    if (!w) return;
    const now = Date.now(), ready = {}, loads = {};
    for (const s of SLOTS) { const p = this.players[s]; if (p) { ready[s] = !!w.ready[s]; loads[s] = p.loadout; } }
    for (const s of SLOTS) {
      const p = this.players[s];
      if (!p || p.bot) continue;
      this.send(p, { type: 'wait', team: true, kind: w.kind, ms: Math.max(0, w.until - now), vsMs: Math.max(0, w.earliest - now),
        ready, loads, mine: p.loadout,
        stages: w.kind === 'prep' ? this.stagePick : null,
        votes: w.kind === 'prep' ? this.votes : null });
    }
  }
  setReady(slot) {
    const w = this.waitState;
    if (!w || !this.players[slot] || w.ready[slot]) return;
    w.ready[slot] = true;
    this.sendWait();
    if (SLOTS.every(s => !this.players[s] || w.ready[s])) {
      if (this.waitTimer) { clearTimeout(this.waitTimer); this.timers.delete(this.waitTimer); }
      this.waitTimer = this.later(() => this.endWait(), Math.max(0, w.earliest - Date.now()));
    }
  }
  // ステージに1票（準備の間だけ）
  vote(slot, id) {
    const w = this.waitState;
    if (!w || w.kind !== 'prep' || !this.players[slot] || !this.stagePick || this.stagePick.indexOf(id) < 0) return;
    this.votes[slot] = id;
    this.sendWait();
  }
  setLoadout(slot, v) {
    const w = this.waitState, p = this.players[slot];
    if (!w || w.kind !== 'pick' || !p || w.ready[slot]) return;
    p.loadout = SIM.cleanLoadout(v, false);
    this.sendWait();
  }
  endWait() {
    if (!this.waitState || this.closed) return;
    const prep = this.waitState.kind === 'prep';
    this.waitState = null; this.waitTimer = null;
    if (prep) this.stage = G.FORCE_STAGE || G.decideStage(this.stagePick, this.votes);
    this.startRound();
  }

  // ---- 通信の往復時間 ----
  schedulePing() {
    this.later(() => {
      const t = Date.now();
      for (const s of SLOTS) {
        const p = this.players[s];
        if (!p) continue;
        if (p.bot) { p.srtt = Math.max(9, Math.min(90, p.srtt + Math.round((Math.random() - 0.5) * 12))); continue; }
        p.spingT = t; this.send(p, { type: 'sping', t });
      }
      this.schedulePing();
    }, 2000);
  }
  spong(slot, msg) {
    const p = this.players[slot];
    if (p && p.spingT && msg.t === p.spingT) { p.srtt = Math.max(0, Date.now() - p.spingT); p.spingT = 0; }
  }
  ping(slot, msg) {
    const p = this.players[slot]; if (!p) return;
    const pings = {};
    for (const s of SLOTS) { const o = this.players[s]; if (o && s !== slot) pings[s] = o.srtt >= 0 ? o.srtt : -1; }
    this.send(p, { type: 'pong', t: typeof msg.t === 'number' ? msg.t : 0, pings });
  }

  // 今のチーム平均レートの差（2v2 はチームの平均どうしで計算しているので、それに合わせる）
  rateGap() {
    const avg = [0, 1].map(t => {
      const ps = SLOTS.filter(k => this.players[k] && teamOf(k) === t).map(k => this.players[k]);
      return ps.length ? ps.reduce((n, o) => n + (+o.rate || SIM.RATE_START), 0) / ps.length : SIM.RATE_START;
    });
    return Math.abs(avg[0] - avg[1]);
  }
  // ランクマッチは、レートが離れたら再戦できない
  canRematch() { return !this.ranked || this.rateGap() <= G.REMATCH_GAP; }

  // 全員（人だけ）が希望したら、同じ部屋のまま次の試合へ（BOT はいつでも賛成）
  rematch(slot) {
    const p = this.players[slot];
    if (!p || this.phase !== 'ended') return;
    if (!this.canRematch()) return this.send(p, { type: 'rematch_off', gap: G.REMATCH_GAP });
    p.rematch = true;
    const st = {};
    for (const s of SLOTS) { const o = this.players[s]; if (o) st[s] = !!(o.bot || o.rematch); }
    this.broadcast({ type: 'rematch_state', team: true, ready: st });
    if (this.humans().every(h => h.rematch)) {
      for (const s of SLOTS) { const o = this.players[s]; if (o) o.rematch = false; }
      this.wins = [0, 0];
      if (this.closeTimer) { clearTimeout(this.closeTimer); this.timers.delete(this.closeTimer); this.closeTimer = null; }
      this.rate0 = {};
      for (const k of SLOTS) { const o = this.players[k]; if (o) { this.rate0[k] = o.rate || SIM.RATE_START; o.done = false; } }
      this.phase = 'lobby';
      this.later(() => this.startRound(), 1500);
    }
  }
  startRound() {
    if (!this.matchLive) { this.matchLive = true; this.roundsDone = 0; }
    const loads = {};
    for (const s of SLOTS) { const p = this.players[s]; loads[s] = p ? p.loadout : null; }
    this.world = SIM.newTeamWorld(this.stage, loads);
    for (const s of SLOTS) {
      const p = this.players[s];
      if (p) {
        p.jumpReq = false; p.shootReq = false; p.healReq = false; p.reloadReq = false;
        p.input.slot = 0; p.input.fire = false;
        if (p.bot) p.brain = SIM.newBrain(p.brain.cfg);
      } else this.world.chars[s].dead = true;   // 誰もいない場所（ありえないが念のため）は倒れている扱い
    }
    this.phase = 'playing';
    this.broadcast({ type: 'round_start', state: this.state(), stage: this.stage });
  }
  endRound(winTeam, fx) {
    this.phase = 'roundOver';
    this.roundsDone++;
    if (winTeam === 0 || winTeam === 1) this.wins[winTeam]++;
    this.broadcast({ type: 'round_end', winTeam: winTeam === 'draw' ? null : winTeam, wins: this.wins.slice(), state: this.state(), fx: fx || [] });
    const done = (winTeam === 0 || winTeam === 1) && this.wins[winTeam] >= G.WIN_ROUNDS;
    if (done) {
      this.matchLive = false;
      if (this.hooks.onResult) this.hooks.onResult(this, winTeam);
      this.later(() => {
        this.phase = 'ended';
        this.broadcast({ type: 'match_end', winTeam, wins: this.wins.slice(), rematch: this.canRematch(), gap: G.REMATCH_GAP });
        this.closeTimer = this.later(() => this.close(), 90000);
      }, G.MATCH_END_MS);
    } else if (G.PICK_MS > 0) {
      this.later(() => { if (!this.closed) { this.phase = 'pick'; this.beginWait('pick', G.PICK_MS, 0); } }, G.ROUND_GAP_MS);
    } else {
      this.later(() => this.startRound(), G.ROUND_GAP_MS);
    }
  }

  input(slot, i) {
    const p = this.players[slot]; if (!p || p.bot) return;
    const left = !!i.left, right = !!i.right, duck = !!i.duck;
    if (this.phase === 'playing' && (left || right || duck || i.jump || i.shoot || i.heal || i.reload)) p.acts++;
    p.input.left = left; p.input.right = right; p.input.duck = duck; p.input.fire = !!i.fire;
    if (i.slot === 0 || i.slot === 1 || i.slot === 2) p.input.slot = i.slot;
    if (i.jump) p.jumpReq = true;
    if (i.shoot) p.shootReq = true;
    if (i.heal) p.healReq = true;
    if (i.reload) p.reloadReq = true;
  }
  botInput(p, slot) {
    const c = this.world.chars[slot];
    if (!c || c.dead) { p.input = { left: false, right: false, duck: false, fire: false, slot: p.input.slot }; return; }
    const inp = SIM.think(p.brain, this.world, slot);
    p.input = { left: !!inp.left, right: !!inp.right, duck: !!inp.duck, fire: !!inp.fire, slot: inp.slot | 0 };
    if (inp.jump) p.jumpReq = true;
    if (inp.shoot) p.shootReq = true;
    if (inp.heal) p.healReq = true;
    if (inp.reload) p.reloadReq = true;
    p.acts++;
  }

  // 抜けた：開始前（フレンドと対戦の集まり）は席を空けるだけ。始まってからは BOT が引き継ぐ（ランクなら抜けた人は負け）
  leave(slot) {
    const p = this.players[slot];
    if (!p || p.bot) return;
    if (this.phase === 'waiting') {
      this.players[slot] = null;
      if (p.ws) p.ws.room = null;
      if (this.hostSlot === slot) { const h = SLOTS.find(k => this.players[k] && !this.players[k].bot); this.hostSlot = h || null; }
      if (!this.humans().length) return this.close();
      this.sendLobby();
      return;
    }
    if (this.phase !== 'ended' && this.hooks.onLeave) this.hooks.onLeave(this, p);
    this.takeOver(slot);
    this.broadcast({ type: 'player_left', slot, name: p.name, ended: this.phase === 'ended' });
    if (!this.humans().length) this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of SLOTS) { const p = this.players[s]; if (p && p.ws && !p.bot) p.ws.room = null; }
    if (this.hooks.onClose) this.hooks.onClose(this);
  }

  tick() {
    if (this.phase !== 'playing') return;
    this.frame++;
    const w = this.world;
    for (const s of SLOTS) {
      const p = this.players[s], c = w.chars[s];
      if (p) {
        if (p.bot) this.botInput(p, s);
        const inp = p.input;
        SIM.setInput(c, { left: inp.left, right: inp.right, duck: inp.duck, fire: inp.fire, slot: inp.slot,
          jump: p.jumpReq, shoot: p.shootReq, heal: p.healReq, reload: p.reloadReq });
        p.jumpReq = false; p.shootReq = false; p.healReq = false; p.reloadReq = false;
      } else SIM.setInput(c, { left: false, right: false, duck: false, fire: false });
    }
    const ev = [];
    SIM.stepTeam(w, ev);
    const fx = G.packFx(ev);
    const res = SIM.teamResult(w);
    if (res !== null) return this.endRound(res, fx);
    this.broadcast(fx.length ? { type: 'state', state: this.state(), fx } : { type: 'state', state: this.state() });
  }
  state() {
    const w = this.world, chars = {};
    for (const s of SLOTS) chars[s] = SIM.packChar(w.chars[s]);
    return { chars, shots: SIM.packShots(w), wins: this.wins.slice() };
  }
}

module.exports = { TeamRoom, SLOTS, teamOf, ACTIVE_MIN_INPUTS };
