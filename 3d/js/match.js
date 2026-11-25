// 試合のルール：1v1（先に3ラウンド）・2v2（先に3ラウンド）・FFA（6人、先に15キル・5分）
// 流れ：紹介 → カウントダウン → 戦い → ラウンドの終わり（決着の瞬間をスローで）→ 次のラウンド / 試合の終わり
import * as THREE from '../lib/three.js';
import { MODES, TEAM_COLORS, FFA_COLORS, BOT_NAMES, BOT_LOADOUTS, SKILL_IDS, LOOK_SKIN, LOOK_HAIR, LOOK_EYE, LOOK_ACCENT, MAX_HP, shuffle, pick, rand } from './data.js';
import { Game } from './game.js';
import { Bot } from './bot.js';

export class Match {
  constructor(app, o) {
    this.app = app; this.o = o;
    this.mode = MODES[o.mode];
    this.state = 'intro'; this.t = 0; this.round = 1; this.wins = [0, 0]; this.timeLeft = 0;
    this.feed = []; this.ended = false; this.result = null;
    this.killcam = null; this.lastKill = null;
    const teamMode = this.mode.teams;
    const g = this.game = new Game({ gfx: app.gfx, audio: app.audio, fx: app.fx, arena: app.arena, teamMode });
    const names = shuffle(BOT_NAMES.slice()), loads = shuffle(BOT_LOADOUTS.slice());
    const look = o.look || {};
    const meLook = { skin: LOOK_SKIN[look.skin != null ? look.skin : 1] || LOOK_SKIN[1], hair: LOOK_HAIR[look.hairColor != null ? look.hairColor : 1] || LOOK_HAIR[1], eye: LOOK_EYE[look.eyeColor || 0], accent: LOOK_ACCENT[look.accent || 0] };
    const botLook = () => ({ skin: pick(LOOK_SKIN.slice(0, 6)), hair: pick(LOOK_HAIR), eye: pick(LOOK_EYE), accent: pick(LOOK_ACCENT) });
    const botSkill = () => Math.random() < 0.45 ? 'roll' : pick(SKILL_IDS);
    let id = 0;
    const add = (opt) => g.addFighter(Object.assign({ id: id++ }, opt));
    if (o.mode === 'ffa') {
      this.player = add(Object.assign({ name: o.name, team: 0, colors: TEAM_COLORS.me, isPlayer: true, loadout: o.loadout, skill: o.skill }, meLook));
      const cols = shuffle(FFA_COLORS.slice());
      for (let i = 0; i < this.mode.players - 1; i++) {
        const f = add(Object.assign({ name: names[i], team: i + 1, colors: cols[i], loadout: loads[i % loads.length], skill: botSkill() }, botLook()));
        f.bot = new Bot(g, f, o.diff);
      }
    } else {
      const n = this.mode.size[0];
      this.player = add(Object.assign({ name: o.name, team: 0, colors: TEAM_COLORS.me, isPlayer: true, loadout: o.loadout, skill: o.skill }, meLook));
      for (let i = 1; i < n; i++) {
        const f = add(Object.assign({ name: names[10 + i], team: 0, colors: TEAM_COLORS.ally, loadout: loads[5 + i], skill: botSkill() }, botLook()));
        f.bot = new Bot(g, f, o.diff, { ally: this.player });
      }
      for (let i = 0; i < this.mode.size[1]; i++) {
        const f = add(Object.assign({ name: names[i], team: 1, colors: TEAM_COLORS.foe, loadout: loads[i], skill: botSkill() }, botLook()));
        f.bot = new Bot(g, f, o.diff);
      }
    }
    g.on('kill', (d) => this.onKill(d));
    this.spawnAll();
    this.setState('intro');
  }

  spawnAll() {
    const g = this.game, S = this.app.arena.spawns;
    if (this.o.mode === 'ffa') {
      const pts = shuffle(S.ffa.slice());
      g.fighters.forEach((f, i) => { const p = pts[i % pts.length]; f.reset(); f.place(p[0], p[1], p[2], p[3]); });
    } else {
      // ラウンドごとに出る側を入れかえる
      const swap = (this.round % 2 === 0) ? 1 : 0;
      const team = [g.fighters.filter(f => f.team === 0), g.fighters.filter(f => f.team === 1)];
      for (let t = 0; t < 2; t++) {
        const pts = this.o.mode === 'duel' ? [S.duel[(t + swap) % 2]] : S.team[(t + swap) % 2];
        team[t].forEach((f, i) => { const p = pts[i % pts.length]; f.reset(); f.place(p[0], p[1], p[2], p[3]); });
      }
    }
    if (this.app.camCtl) this.app.camCtl.snapTo(this.player);
  }

  setState(s) {
    this.state = s; this.t = 0;
    const g = this.game, ui = this.app.ui;
    if (s === 'intro') {
      g.frozen = true;
      ui.banner(this.o.mode === 'ffa' ? ui.t('mode.ffa') : ui.t('round.n', { n: this.round }), this.o.mode === 'ffa' ? ui.t('ffa.goal', { n: this.mode.killGoal }) : ui.t('mode.' + this.o.mode) + ' · ' + ui.t('map.' + this.o.map), 'intro');
    } else if (s === 'count') {
      g.frozen = true;
    } else if (s === 'fight') {
      g.frozen = false;
      if (this.o.mode === 'ffa') { if (!this.timeLeft) this.timeLeft = this.mode.time; } else this.timeLeft = this.mode.roundTime;
      ui.banner(ui.t('fight'), '', 'go');
      this.app.audio.play('go');
    }
  }

  onKill(d) {
    const ui = this.app.ui;
    this.feed.push({ t: this.game.time, ...d });
    ui.killfeed(d, this.player, this.game);
    this.lastKill = { at: new THREE.Vector3(d.victim.pos[0], d.victim.pos[1], d.victim.pos[2]), victim: d.victim, killer: d.killer };
    if (d.victim === this.player) { this.player.killedBy = d.killer; this.deadT = 0; }
    if (this.o.mode === 'ffa') { d.victim.respawnT = this.mode.respawn; return; }
  }

  update(dt) {
    const g = this.game, ui = this.app.ui;
    this.t += dt;
    if (this.state === 'intro') { if (this.t > 2.6) this.setState('count'); }
    else if (this.state === 'count') {
      const n = 3 - Math.floor(this.t);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; ui.count(n); this.app.audio.play('beep', null, { f: 660 }); }
      if (this.t >= 3) { this.lastCount = 0; ui.count(0); this.setState('fight'); }
    } else if (this.state === 'fight') {
      this.timeLeft -= dt;
      if (this.o.mode === 'ffa') this.updateFFA(dt);
      else this.checkRound();
    } else if (this.state === 'roundEnd') {
      if (this.t > 3.4) {
        if (this.wins[0] >= this.mode.rounds || this.wins[1] >= this.mode.rounds) this.finish();
        else { this.round++; this.spawnAll(); this.setState('intro'); }
      }
    }
    g.update(dt);
    // FFA：生き返り
    if (this.o.mode === 'ffa' && this.state === 'fight') {
      for (const f of g.fighters) {
        if (f.alive || f.respawnT == null) continue;
        f.respawnT -= dt;
        if (f.respawnT <= 0) { f.respawnT = null; this.respawn(f); }
      }
    }
    // 2v2 で自分がやられたら味方を見る
    if (!this.player.alive) this.deadT = (this.deadT || 0) + dt;
  }

  respawn(f) {
    const g = this.game, S = this.app.arena.spawns.ffa;
    let best = S[0], bs = -1;
    for (const p of S) {
      let md = Infinity;
      for (const o of g.fighters) if (o !== f && o.alive) md = Math.min(md, Math.hypot(o.pos[0] - p[0], o.pos[2] - p[2]));
      md += Math.random() * 4;
      if (md > bs) { bs = md; best = p; }
    }
    f.reset(); f.place(best[0], best[1], best[2], best[3]); f.protectT = this.mode.protect;
    if (f.isPlayer) this.app.camCtl.snapTo(f);
    this.app.audio.play('spawn', f.isPlayer ? null : f.center(new THREE.Vector3()));
    this.app.fx.ring(new THREE.Vector3(best[0], best[1] + 0.05, best[2]), f.colors.glow, 0.2, 1.8, 0.6);
  }

  checkRound() {
    const g = this.game;
    const alive = [0, 1].map(t => g.fighters.filter(f => f.team === t && f.alive).length);
    let winner = -2;
    if (alive[0] === 0 && alive[1] === 0) winner = -1;
    else if (alive[1] === 0) winner = 0;
    else if (alive[0] === 0) winner = 1;
    else if (this.timeLeft <= 0) {
      const hp = [0, 1].map(t => g.fighters.filter(f => f.team === t && f.alive).reduce((s, f) => s + f.hp, 0) / this.mode.size[t]);
      winner = Math.abs(hp[0] - hp[1]) < 0.5 ? -1 : hp[0] > hp[1] ? 0 : 1;
    }
    if (winner === -2) return;
    if (winner >= 0) this.wins[winner]++;
    const ui = this.app.ui;
    const over = this.wins[0] >= this.mode.rounds || this.wins[1] >= this.mode.rounds;
    if (winner === 0) { ui.banner(over ? ui.t('match.win') : ui.t('round.win'), ui.score(this.wins), 'win'); this.app.audio.play('win'); for (const f of g.fighters) if (f.team === 0 && f.alive) f.victory = true; }
    else if (winner === 1) { ui.banner(over ? ui.t('match.lose') : ui.t('round.lose'), ui.score(this.wins), 'lose'); this.app.audio.play('lose'); for (const f of g.fighters) if (f.team === 1 && f.alive) f.victory = true; }
    else ui.banner(ui.t('round.draw'), ui.score(this.wins), 'draw');
    // 決着の瞬間（最後のキルがついさっきなら、スローで見せる）
    if (this.lastKill && g.time - this.feed[this.feed.length - 1].t < 0.2) this.killcam = { at: this.lastKill.at.clone(), t: 0 };
    this.state = 'roundEnd'; this.t = 0;
    g.frozen = false;
    this.roundWinner = winner;
  }

  updateFFA(dt) {
    const g = this.game;
    const top = g.fighters.reduce((a, b) => (b.stats.score > a.stats.score ? b : a));
    if (top.stats.score >= this.mode.killGoal || this.timeLeft <= 0) {
      if (this.lastKill && g.time - this.feed[this.feed.length - 1].t < 0.2) this.killcam = { at: this.lastKill.at.clone(), t: 0 };
      this.finish();
    }
  }

  // 順位（FFA：スコア、同じならキル・デスの少なさ）
  standings() {
    const L = this.game.fighters.slice();
    L.sort((a, b) => b.stats.score - a.stats.score || b.stats.kills - a.stats.kills || a.stats.deaths - b.stats.deaths || b.stats.dmg - a.stats.dmg);
    return L;
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    const g = this.game, ui = this.app.ui, me = this.player;
    let win;
    if (this.o.mode === 'ffa') { const st = this.standings(); this.place = st.indexOf(me) + 1; win = this.place === 1; }
    else win = this.wins[0] > this.wins[1];
    this.result = { win, place: this.place, wins: this.wins.slice(), mode: this.o.mode };
    this.state = 'end'; this.t = 0;
    setTimeout(() => { if (this.state === 'end') g.frozen = true; }, 900);
    if (this.o.mode === 'ffa') { ui.banner(win ? ui.t('ffa.win') : ui.t('ffa.place', { n: this.place }), '', win ? 'win' : 'lose'); this.app.audio.play(win ? 'win' : 'lose'); for (const f of g.fighters) f.victory = f === this.standings()[0]; }
    // 成績を残す（この端末だけ）
    try {
      const k = 'gd3d_stats', s = JSON.parse(localStorage.getItem(k) || '{}');
      s.played = (s.played || 0) + 1; s.wins = (s.wins || 0) + (win ? 1 : 0); s.kills = (s.kills || 0) + me.stats.kills; s.deaths = (s.deaths || 0) + me.stats.deaths;
      s[this.o.mode] = s[this.o.mode] || { played: 0, wins: 0 }; s[this.o.mode].played++; if (win) s[this.o.mode].wins++;
      localStorage.setItem(k, JSON.stringify(s));
    } catch (e) { /* 保存できなくても遊べる */ }
    setTimeout(() => this.app.showResults(this), 3200);
  }

  dispose() { this.game.removeAll(); }
}
