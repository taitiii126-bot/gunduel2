// 画面（メニュー・装備・設定・試合の表示・結果）
import * as THREE from '../lib/three.js';
import { t, lang, setLang } from './i18n.js';
import { WEAPONS, WEAPON_IDS, SKILLS, SKILL_IDS, MAP_IDS, DIFF_IDS, MODES, MAX_HP } from './data.js';
import { QUALITY_IDS } from './gfx.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const SKILL_SVG = {
  roll: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  pierce: '<path d="M3 12h15M14 7l5 5-5 5"/><path d="M9 4v16" stroke-dasharray="2 2.2"/>',
  rewind: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 8v4l3 2"/>',
  decoy: '<circle cx="9" cy="7" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="16.5" cy="8" r="2.5" stroke-dasharray="2 1.6"/><path d="M15 14.4a5 5 0 0 1 6.5 5.6" stroke-dasharray="2 1.6"/>',
  parry: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
};
const MODE_SVG = {
  duel: '<path d="M4 20 17 7M13.5 5H19v5.5M20 20 7 7M10.5 5H5v5.5"/>',
  team: '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="8" r="3"/><path d="M2 20a6 6 0 0 1 12 0M10.5 20a6 6 0 0 1 12 0"/>',
  ffa: '<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.t = t;
    this.nums = [];
    this.feedEls = [];
    this.streak = 0; this.streakT = 0;
    this.bindActions();
  }

  // ---------- 共通 ----------
  apply() {
    document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
    document.querySelectorAll('[data-tt]').forEach(e => { e.title = t(e.dataset.tt); e.setAttribute('aria-label', t(e.dataset.tt)); });
    const go = $('#title-go span'); if (go) go.textContent = t(this.app.input.isTouch ? 'title.startTouch' : 'title.start');
  }
  show(id) { $('#' + id).classList.remove('hide'); }
  hide(id) { $('#' + id).classList.add('hide'); }
  isOpen(id) { return !$('#' + id).classList.contains('hide'); }
  click(f) { this.app.audio.play('ui'); if (f) f(); }

  bindActions() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const a = el.dataset.act, app = this.app;
      this.app.audio.unlock();
      if (a === 'settings') { this.click(); this.hide('pause'); this.openSettings(); }
      else if (a === 'howto') { this.click(); this.hide('pause'); this.openHowto(); }
      else if (a === 'stats') { this.click(); this.openStats(); }
      else if (a === 'loadout') { this.click(); this.openLoadout(); }
      else if (a === 'loBack' || a === 'loDone') { if (this.loPick.length === 3) { this.click(); this.closeLoadout(); } else $('#lo-warn').textContent = t('lo.need3'); }
      else if (a === 'closeModal') { this.click(); el.closest('.layer').classList.add('hide'); if (app.state === 'match' && app.paused) this.show('pause'); }
      else if (a === 'resume') { this.click(); app.resume(); }
      else if (a === 'quit') { this.click(); app.quitMatch(); }
      else if (a === 'again') { this.click(); app.startMatch(); }
      else if (a === 'menu') { this.click(); app.toMenu(); }
    });
  }

  setBoot(p, key) { $('#boot-fill').style.width = Math.round(p * 100) + '%'; if (key) $('#boot-msg').textContent = t(key); }

  // ---------- メニュー ----------
  buildMenu() {
    const app = this.app, s = app.sel;
    $('#mn-modes').innerHTML = ['duel', 'team', 'ffa'].map(m => `<button class="mode-card${s.mode === m ? ' sel' : ''}" data-mode="${m}">
      <span class="mc-ic"><svg viewBox="0 0 24 24">${MODE_SVG[m]}</svg></span><span class="mc-tag">${m === 'duel' ? '1 vs 1' : m === 'team' ? '2 vs 2' : '6 FFA'}</span>
      <b>${t('mode.' + m)}</b><small>${t('mode.' + m + '.d')}</small></button>`).join('');
    $('#mn-modes').onclick = (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; s.mode = b.dataset.mode; app.audio.play('ui', null, { f: 1500 }); app.saveSel(); this.buildMenu(); };
    $('#mn-maps').innerHTML = MAP_IDS.concat(['random']).map(m => `<button class="map-card${s.map === m ? ' sel' : ''}" data-map="${m}" title="${esc(m === 'random' ? t('menu.random') : t('map.' + m + '.d'))}"><span class="art ${m}"></span><span>${t(m === 'random' ? 'menu.random' : 'map.' + m)}</span></button>`).join('');
    $('#mn-maps').onclick = (e) => { const b = e.target.closest('[data-map]'); if (!b) return; s.map = b.dataset.map; app.audio.play('ui'); app.saveSel(); this.buildMenu(); if (s.map !== 'random') app.previewArena(s.map); };
    $('#mn-diff').innerHTML = DIFF_IDS.map(d => `<button class="${s.diff === d ? 'sel' : ''} ${d}" data-diff="${d}">${t('diff.' + d)}</button>`).join('');
    $('#mn-diff').onclick = (e) => { const b = e.target.closest('[data-diff]'); if (!b) return; s.diff = b.dataset.diff; app.audio.play('ui'); app.saveSel(); this.buildMenu(); };
    $('#mn-lo').innerHTML = s.loadout.map(id => `<div class="lo-chip"><img src="${app.icons[id] || ''}" alt=""><span>${t('w.' + id)}</span></div>`).join('') +
      `<div class="lo-chip sk"><svg viewBox="0 0 24 24" style="color:${SKILLS[s.skill].color}">${SKILL_SVG[s.skill]}</svg><span>${t('sk.' + s.skill)}</span></div>`;
    $('#mn-start').onclick = () => { app.audio.unlock(); app.audio.play('uiBig'); app.startMatch(); };
  }

  // ---------- 装備 ----------
  openLoadout() {
    const app = this.app;
    this.loPick = app.sel.loadout.slice();
    this.loSkill = app.sel.skill;
    this.show('loadout');
    this.renderLoadout();
  }
  renderLoadout() {
    const app = this.app, P = this.loPick;
    $('#lo-warn').textContent = '';
    $('#lo-slots').innerHTML = [0, 1, 2].map(i => {
      const id = P[i];
      return id ? `<div class="lo-slot on"><span class="n">${i + 1}</span><img src="${app.icons[id]}" alt=""><div><b>${t('w.' + id)}</b><small>${t('w.' + id + '.d')}</small></div></div>`
        : `<div class="lo-slot"><span class="n">${i + 1}</span></div>`;
    }).join('');
    const stat = (W) => {
      const dps = W.kind === 'melee' ? W.dmg / W.rate : (W.kind === 'pellet' ? W.dmg * W.pellets : W.dmg) * (W.burst || 1) / Math.max(W.rate, 0.05);
      return { d: Math.min(1, (W.kind === 'pellet' ? W.dmg * W.pellets * 0.7 : W.dmg) / 75), r: Math.min(1, dps / 160), g: Math.min(1, (W.kind === 'melee' ? W.reach * 3 : W.range || 30) / 70) };
    };
    $('#lo-grid').innerHTML = WEAPON_IDS.map(id => {
      const W = WEAPONS[id], k = P.indexOf(id), s = stat(W);
      return `<button class="wcard${k >= 0 ? ' on' : ''}" data-w="${id}" title="${esc(t('w.' + id + '.d'))}">${k >= 0 ? `<span class="num">${k + 1}</span>` : ''}<img src="${app.icons[id]}" alt=""><b>${t('w.' + id)}</b>
        <div class="bars" style="--c:${W.color}"><i style="--v:${s.d * 100}%" title="${t('lo.dmg')}"></i><i style="--v:${s.r * 100}%" title="${t('lo.rate')}"></i><i style="--v:${s.g * 100}%" title="${t('lo.range')}"></i></div></button>`;
    }).join('');
    $('#lo-grid').onclick = (e) => {
      const b = e.target.closest('[data-w]'); if (!b) return;
      const id = +b.dataset.w, k = P.indexOf(id);
      if (k >= 0) P.splice(k, 1); else if (P.length < 3) P.push(id); else { P.shift(); P.push(id); }
      app.audio.play('swap'); this.renderLoadout();
    };
    const own = app.ownedSkills();
    $('#lo-skills').innerHTML = SKILL_IDS.map(sk => {
      const lock = !own.includes(sk);
      return `<button class="skcard${this.loSkill === sk ? ' on' : ''}${lock ? ' lock' : ''}" data-sk="${sk}" style="--c:${SKILLS[sk].color}" title="${esc(lock ? t('lo.locked') : t('sk.' + sk + '.d'))}"><svg viewBox="0 0 24 24">${SKILL_SVG[sk]}</svg><b>${t('sk.' + sk)}</b><small>${lock ? t('lo.locked') : t('sk.' + sk + '.d')}</small></button>`;
    }).join('');
    $('#lo-skills').onclick = (e) => { const b = e.target.closest('[data-sk]'); if (!b || b.classList.contains('lock')) return; this.loSkill = b.dataset.sk; app.audio.play('ui', null, { f: 1600 }); this.renderLoadout(); };
  }
  closeLoadout() {
    const app = this.app;
    app.sel.loadout = this.loPick.slice(); app.sel.skill = this.loSkill;
    app.saveSel(); this.hide('loadout'); this.buildMenu();
  }

  // ---------- 設定 ----------
  openSettings() {
    const app = this.app, S = app.settings;
    const range = (k, min, max, step, fmt) => `<div class="set-row"><label>${t('set.' + k)}</label><span style="display:flex;align-items:center;gap:10px"><input type="range" data-s="${k}" min="${min}" max="${max}" step="${step}" value="${S[k]}"><span class="val" data-v="${k}">${fmt(S[k])}</span></span></div>`;
    const tog = (k, key) => `<div class="set-row"><label>${t(key)}</label><button class="tog${S[k] ? ' on' : ''}" data-tog="${k}"></button></div>`;
    const pct = (v) => Math.round(v * 100) + '%';
    $('#set-panel').innerHTML = `<header class="pn-head"><div><h2>${t('set.title')}</h2></div></header>
      <div class="set-sec"><h3>${t('set.graphics')}</h3>
        <div class="set-row"><label>${t('set.quality')}</label><div class="seg" id="set-q">${QUALITY_IDS.map(q => `<button class="${S.quality === q ? 'sel' : ''}" data-q="${q}">${t('set.q.' + q)}</button>`).join('')}</div></div>
        <div class="set-row"><label>${t('set.gpu')}</label><span class="gpu-line">${esc(app.gfx.gpu)}</span></div>
        ${range('resScale', 0.5, 1, 0.05, pct)}${tog('dynRes', 'set.dyn')}${range('fov', 60, 100, 1, v => v + '°')}</div>
      <div class="set-sec"><h3>${t('set.view')}</h3>
        <div class="set-row"><label>${t('set.view')}</label><div class="seg two wide" id="set-view"><button class="${S.view !== 'tps' ? 'sel' : ''}" data-view="fps">${t('set.view.fps')}</button><button class="${S.view === 'tps' ? 'sel' : ''}" data-view="tps">${t('set.view.tps')}</button></div></div>
        ${tog('bob', 'set.bob')}</div>
      <div class="set-sec"><h3>${t('set.controls')}</h3>${range('sens', 0.2, 3, 0.05, v => (+v).toFixed(2))}${range('adsSens', 0.2, 1.5, 0.05, v => (+v).toFixed(2))}${range('touchSens', 0.3, 3, 0.05, v => (+v).toFixed(2))}
        ${tog('invertY', 'set.invert')}${tog('leftShoulder', 'set.shoulder')}</div>
      <div class="set-sec"><h3>${t('set.audio')}</h3>${range('master', 0, 1, 0.05, pct)}${range('sfx', 0, 1, 0.05, pct)}${range('music', 0, 1, 0.05, pct)}</div>
      <div class="set-sec"><h3>${t('set.other')}</h3>${tog('shake', 'set.shake')}${tog('dmgNum', 'set.dmgNum')}${tog('showFps', 'set.fps')}
        <div class="set-row"><label>${t('set.lang')}</label><div class="seg two" id="set-lang"><button class="${lang() === 'ja' ? 'sel' : ''}" data-l="ja">日本語</button><button class="${lang() === 'en' ? 'sel' : ''}" data-l="en">English</button></div></div></div>
      <div class="panel-foot"><button class="start-btn sm" data-act="closeModal"><span>${t('set.close')}</span></button></div>`;
    const P = $('#set-panel');
    P.oninput = (e) => {
      const k = e.target.dataset.s; if (!k) return;
      S[k] = +e.target.value; const v = P.querySelector(`[data-v="${k}"]`);
      if (v) v.textContent = ['resScale', 'master', 'sfx', 'music'].includes(k) ? Math.round(S[k] * 100) + '%' : k === 'fov' ? S[k] + '°' : S[k].toFixed(2);
      app.applySettings(k);
    };
    P.onclick = (e) => {
      const q = e.target.closest('[data-q]'), tg = e.target.closest('[data-tog]'), l = e.target.closest('[data-l]'), vw = e.target.closest('[data-view]');
      if (vw) { S.view = vw.dataset.view; app.applySettings('view'); this.openSettings(); return; }
      if (q) { S.quality = q.dataset.q; app.applySettings('quality'); this.openSettings(); }
      if (tg) { const k = tg.dataset.tog; S[k] = !S[k]; tg.classList.toggle('on', S[k]); app.applySettings(k); }
      if (l) { S.lang = l.dataset.l; setLang(S.lang); app.applySettings('lang'); this.apply(); this.buildMenu(); this.openSettings(); }
    };
    this.show('settings');
  }

  openHowto() {
    const k = (...a) => a.map(x => `<kbd>${x}</kbd>`).join('');
    $('#howto-panel').innerHTML = `<header class="pn-head"><div><h2>${t('howto.title')}</h2></div></header>
      <dl class="keys">
        <dt>${k('W', 'A', 'S', 'D')}</dt><dd>${t('howto.move')}</dd><dt>${k('Mouse')}</dt><dd>${t('howto.look')}</dd>
        <dt>${k('Left click')}</dt><dd>${t('howto.fire')}</dd><dt>${k('Right click')}</dt><dd>${t('howto.ads')}</dd>
        <dt>${k('Space')}</dt><dd>${t('howto.jump')}</dd><dt>${k('Ctrl', 'C')}</dt><dd>${t('howto.crouch')}</dd>
        <dt>${k('Shift')}</dt><dd>${t('howto.skill')}</dd><dt>${k('E')}</dt><dd>${t('howto.heal')}</dd><dt>${k('R')}</dt><dd>${t('howto.reload')}</dd>
        <dt>${k('1', '2', '3', 'Q', 'Wheel')}</dt><dd>${t('howto.swap')}</dd><dt>${k('V')}</dt><dd>${t('howto.view')}</dd><dt>${k('Tab')}</dt><dd>${t('howto.board')}</dd><dt>${k('Esc', 'P')}</dt><dd>${t('howto.pause')}</dd>
      </dl>
      <p class="tipbox">${t('howto.tip')}</p>
      <div class="panel-foot"><button class="start-btn sm" data-act="closeModal"><span>${t('set.close')}</span></button></div>`;
    this.show('howto');
  }

  openStats() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('gd3d_stats') || '{}'); } catch (e) { s = {}; }
    const kd = (s.kills || 0) / Math.max(1, s.deaths || 0);
    const row = (m) => { const x = s[m] || { played: 0, wins: 0 }; return `<div><b>${x.wins}/${x.played}</b><small>${t('mode.' + m)}</small></div>`; };
    $('#stats-panel').innerHTML = `<header class="pn-head"><div><h2>${t('stats.title')}</h2><p>${t('stats.note')}</p></div></header>
      <div class="stat-grid"><div><b>${s.played || 0}</b><small>${t('stats.played')}</small></div><div><b>${s.wins || 0}</b><small>${t('stats.wins')}</small></div><div><b>${s.kills || 0}</b><small>${t('stats.kills')}</small></div><div><b>${kd.toFixed(2)}</b><small>${t('stats.kd')}</small></div></div>
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">${row('duel')}${row('team')}${row('ffa')}</div>
      <div class="panel-foot"><button class="start-btn sm" data-act="closeModal"><span>${t('set.close')}</span></button></div>`;
    this.show('stats');
  }

  // ---------- 試合の表示 ----------
  startHud(match) {
    this.m = match;
    this.show('hud');
    this.feedEls = []; $('#feed').innerHTML = ''; $('#popup').innerHTML = ''; $('#nums').innerHTML = ''; $('#dmgdir').innerHTML = '';
    this.nums = [];
    const f = match.player;
    $('#wpn').innerHTML = f.loadout.map((id, i) => `<div class="wslot" data-slot="${i}"><kbd>${i + 1}</kbd><div><img src="${this.app.icons[id]}" alt=""><div class="wname">${t('w.' + id)}</div><div class="rl"><i></i></div></div><span class="am"></span></div>`).join('');
    $('#wpn').onclick = (e) => { const s = e.target.closest('[data-slot]'); if (s) f.input.slot = +s.dataset.slot; };
    $('#wpn').ontouchstart = (e) => { const s = e.target.closest('[data-slot]'); if (s) { f.input.slot = +s.dataset.slot; e.preventDefault(); } };
    $('#hud-sk-ic').innerHTML = SKILL_SVG[f.skill];
    $('#hud-skill').style.setProperty('--sc', SKILLS[f.skill].color);
    $('#hud-skill span').textContent = t('sk.' + f.skill);
    $('#hud-heal span').textContent = t('hud.heal');
    this.lastHp = -1; this.streak = 0;
    $('#fps').classList.toggle('hide', !this.app.settings.showFps);
    this.updateScore(true);
  }

  banner(title, sub, kind) {
    const b = $('#banner');
    b.className = 'banner';
    b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub || '';
    void b.offsetWidth;
    b.className = 'banner show ' + (kind || '');
  }
  count(n) {
    const c = $('#count');
    c.className = 'count'; c.textContent = n > 0 ? n : '';
    void c.offsetWidth;
    if (n > 0) c.className = 'count show';
  }
  score(w) { return `${w[0]} - ${w[1]}`; }
  popup(text, cls) {
    const p = $('#popup'), d = document.createElement('div');
    d.className = cls || ''; d.textContent = text; p.prepend(d);
    setTimeout(() => d.remove(), 1650);
    while (p.children.length > 4) p.lastChild.remove();
  }

  killfeed(d, me, game) {
    const col = (f) => f ? (f.isPlayer ? '#C4A8FF' : f.colors.glow) : '#aaa';
    const nm = (f) => f ? `<span style="color:${col(f)}">${esc(f.name)}</span>` : '';
    const icon = d.fall ? `<svg viewBox="0 0 24 24" style="width:16px;height:16px;color:#aaa"><path d="M12 4v13M6 12l6 6 6-6"/></svg>` : (d.weapon ? `<img src="${this.app.icons[d.weapon]}" alt="">` : '');
    const el = document.createElement('div');
    if (d.killer === me || d.victim === me) el.className = 'mine';
    el.innerHTML = (d.killer ? nm(d.killer) : '') + icon + (d.head ? `<span class="hs">◎</span>` : '') + nm(d.victim);
    const F = $('#feed'); F.prepend(el);
    setTimeout(() => el.classList.add('gone'), 5200); setTimeout(() => el.remove(), 5800);
    while (F.children.length > 6) F.lastChild.remove();
    // 自分がたおした
    if (d.killer === me && d.victim !== me) {
      this.hitmark('kill');
      const now = game.time;
      this.streak = now - this.streakT < 4 ? this.streak + 1 : 1; this.streakT = now;
      this.popup(`${t('hud.kill')}  ${d.victim.name}`, 'k');
      if (d.head) this.popup(t('hud.head'), 'h');
      if (this.streak === 2) this.popup(t('hud.double'), 's'); else if (this.streak === 3) this.popup(t('hud.triple'), 's'); else if (this.streak > 3) this.popup(t('hud.multi', { n: this.streak }), 's');
    }
    if (d.victim === me) $('#center-msg').textContent = d.killer ? t('hud.killedBy', { n: d.killer.name }) : t('hud.fall');
  }

  hitmark(kind) {
    const h = $('#hitm');
    h.className = 'hitm'; void h.offsetWidth; h.className = 'hitm show ' + (kind || '');
  }

  dmgNumber(pos, amt, head) {
    if (!this.app.settings.dmgNum) return;
    let el = this.nums.find(n => !n.on);
    if (!el) { if (this.nums.length > 24) return; const s = document.createElement('span'); $('#nums').appendChild(s); el = { s, on: false }; this.nums.push(el); }
    el.on = true; el.t = 0; el.p = pos.clone(); el.p.x += (Math.random() - 0.5) * 0.4; el.p.y += 0.3;
    el.s.textContent = Math.round(amt); el.s.className = head ? 'h' : ''; el.s.style.display = '';
  }

  dmgDir(origin) {
    const app = this.app, cam = app.camCtl, f = this.m.player;
    const dx = origin.x - f.pos[0], dz = origin.z - f.pos[2];
    const a = Math.atan2(dx, dz) - cam.yaw;
    const i = document.createElement('i');
    i.style.transform = `rotate(${-a}rad)`;
    $('#dmgdir').appendChild(i);
    setTimeout(() => i.remove(), 1200);
  }

  updateScore(force) {
    const m = this.m; if (!m) return;
    const el = $('#score'), tl = Math.max(0, Math.ceil(m.timeLeft || 0));
    const time = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
    const key = m.o.mode === 'ffa' ? [time, m.game.fighters.map(f => f.stats.score).join()] : [time, m.wins.join()];
    const sig = key.join('|');
    if (!force && sig === this.scoreSig) return;
    this.scoreSig = sig;
    const low = m.state === 'fight' && tl <= 10 ? ' low' : '';
    if (m.o.mode === 'ffa') {
      const st = m.standings(), me = m.player, rank = st.indexOf(me) + 1, top = st[0];
      el.innerHTML = `<div class="sc-ffa"><span>#<b>${rank}</b></span><span>${me.stats.score} / ${m.mode.killGoal}</span></div><div class="sc-time${low}">${time}</div>
        <div class="sc-ffa"><span>${t('hud.leader')}</span><span style="color:${top.isPlayer ? '#C4A8FF' : top.colors.glow}">${esc(top.name)}</span><b>${top.stats.score}</b></div>`;
    } else {
      const pip = (n) => Array.from({ length: m.mode.rounds }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
      el.innerHTML = `<div class="sc-side me"><span>${t('hud.you')}</span><span class="pips">${pip(m.wins[0])}</span></div><div class="sc-time${low}">${time}</div><div class="sc-side foe"><span class="pips">${pip(m.wins[1])}</span><span>${t('hud.enemy')}</span></div>`;
    }
  }

  // 毎フレーム
  hud(dt) {
    const app = this.app, m = this.m, f = m.player, W = f.W, cam = app.camCtl;
    this.updateScore();
    // 体力
    const hp = Math.ceil(f.hp);
    if (hp !== this.lastHp) {
      this.lastHp = hp;
      $('#hp-n').textContent = hp;
      $('#hp-fill').style.width = (f.hp / MAX_HP * 100) + '%';
      $('.hp-bar').className = 'hp-bar' + (f.hp <= 30 ? ' low' : f.hp <= 60 ? ' mid' : '');
    }
    $('#hud-heal').classList.toggle('used', f.healUsed);
    const S = SKILLS[f.skill], cdk = Math.max(0, f.skillCD / S.cd);
    $('#hud-sk-cd').style.setProperty('--p', (cdk * 100) + '%');
    $('#hud-skill').classList.toggle('armed', f.pierceN !== 0 || f.parryT > 0);
    if (this.tcSkill === undefined) this.tcSkill = document.querySelector('.tc-skill .tc-cd');
    if (this.tcSkill) this.tcSkill.style.setProperty('--p', (cdk * 100) + '%');
    // 武器
    const slots = document.querySelectorAll('.wslot');
    slots.forEach((el, i) => {
      const w = WEAPONS[f.loadout[i]], cur = i === f.slot;
      el.classList.toggle('cur', cur);
      const am = el.querySelector('.am');
      const txt = w.mag ? (cur ? `${f.ammo[i]}<small>/${w.mag}</small>` : `${f.ammo[i]}`) : '∞';
      if (am.innerHTML !== txt) am.innerHTML = txt;
      am.classList.toggle('empty', w.mag && f.ammo[i] === 0);
      el.querySelector('.rl i').style.width = cur && f.reloadT > 0 ? ((1 - f.reloadT / w.reload) * 100) + '%' : '0%';
    });
    // 照準
    const cr = $('#cross');
    const spread = W.kind === 'melee' ? 2 : f.spread(W);
    const px = Math.tan(THREE.MathUtils.degToRad(spread)) / Math.tan(THREE.MathUtils.degToRad(app.gfx.camera.fov / 2)) * (innerHeight / 2);
    cr.style.setProperty('--gap', (5 + px) + 'px');
    cr.classList.toggle('foe', !!cam.aimEnemy && (W.kind !== 'melee' || cam.aimDist < W.reach + 2.5));
    cr.classList.toggle('melee', W.kind === 'melee');
    cr.classList.toggle('scoped', !!cam.scoped);
    // 一人称で覗いているときは、銃の照準を使うので十字を消す（中心の点だけ残す）
    cr.classList.toggle('ads', this.app.isFps() && W.kind !== 'melee' && f.adsK > 0.6);
    cr.classList.toggle('optic', !!(this.app.vm && this.app.vm.cur && this.app.vm.cur.optic && f.adsK > 0.85));
    cr.style.display = f.alive && m.state !== 'end' ? '' : 'none';
    $('#scope').classList.toggle('on', !!(cam.scoped && f.alive));
    // 溜め・しぼり
    const ring = cr.querySelector('.ring');
    let k = -1, full = false;
    if (f.chargeT > 0) k = 1 - f.chargeT / W.charge;
    else if (f.focusT >= 0) { k = Math.min(1, f.focusT / W.full); full = f.focusT >= W.full && f.focusT <= W.full + W.win; }
    ring.classList.toggle('on', k >= 0);
    ring.classList.toggle('full', full);
    if (k >= 0) { $('#ring-fg').style.strokeDashoffset = 251.3 * (1 - k); cr.style.setProperty('--rc', W.color); }
    // 生き返り・観戦
    let msg = '';
    if (!f.alive) {
      if (m.o.mode === 'ffa' && f.respawnT != null) msg = (f.killedBy ? t('hud.killedBy', { n: f.killedBy.name }) + '\n' : '') + t('hud.respawn', { s: Math.ceil(f.respawnT) });
      else if (m.o.mode === 'team' && app.spectating) msg = t('hud.spectate');
      else msg = $('#center-msg').textContent;
    }
    if ($('#center-msg').textContent !== msg) $('#center-msg').textContent = msg;
    // ダメージの数字
    const v = new THREE.Vector3();
    for (const n of this.nums) {
      if (!n.on) continue;
      n.t += dt;
      if (n.t > 0.9) { n.on = false; n.s.style.display = 'none'; continue; }
      v.copy(n.p); v.y += n.t * 0.8; v.project(app.gfx.camera);
      if (v.z > 1) { n.s.style.display = 'none'; continue; }
      n.s.style.display = '';
      n.s.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; n.s.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
      n.s.style.opacity = String(1 - Math.max(0, n.t - 0.5) / 0.4);
    }
    // スコア表
    const bd = $('#board');
    const showBoard = app.input.board() && m.state !== 'end';
    bd.classList.toggle('hide', !showBoard);
    if (showBoard) this.renderBoard(bd);
    this.radar();
  }

  renderBoard(el) {
    const m = this.m;
    const rows = (m.o.mode === 'ffa' ? m.standings() : m.game.fighters.slice().sort((a, b) => a.team - b.team || b.stats.kills - a.stats.kills));
    el.innerHTML = `<table><tr><th>${t('board.name')}</th><th>${t('board.k')}</th><th>${t('board.d')}</th><th>${t('board.a')}</th><th>${t('board.dmg')}</th></tr>` +
      rows.map(f => `<tr class="${f.isPlayer ? 'me' : ''}"><td><i class="dot" style="background:${f.isPlayer ? '#9D74FF' : f.colors.glow}"></i>${esc(f.name)}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${f.stats.assists}</td><td>${Math.round(f.stats.dmg)}</td></tr>`).join('') + '</table>';
  }

  // 小さなレーダー：味方はいつも、敵は見えているか撃ったときだけ
  radar() {
    const cv = $('#radar'), g = cv.getContext('2d'), m = this.m, me = m.player, game = m.game, cam = this.app.camCtl;
    const W = 160, R = 74, scale = R / 34;
    g.clearRect(0, 0, W, W);
    g.save(); g.translate(80, 80);
    g.fillStyle = 'rgba(8,10,16,.55)'; g.beginPath(); g.arc(0, 0, R + 4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1;
    for (const r of [R * 0.5, R]) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    // 見えている向き
    g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); g.fill();
    const yaw = cam.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const plot = (x, z, col, big, tri) => {
      const dx = x - me.pos[0], dz = z - me.pos[2];
      // 画面の上＝前
      let rx = -(dx * c - dz * s), rz = dx * s + dz * c;
      let px = rx * scale, py = -rz * scale;
      const L = Math.hypot(px, py); if (L > R) { px *= R / L; py *= R / L; }
      g.fillStyle = col; g.beginPath(); g.arc(px, py, big ? 4.5 : 3.5, 0, 7); g.fill();
    };
    for (const f of game.fighters) {
      if (!f.alive || f === me) continue;
      const enemy = game.isEnemy(me, f);
      if (enemy) {
        const seen = (f.lastShotT != null && game.time - f.lastShotT < 1.2) || (cam.aimEnemy === f);
        if (!seen) continue;
        plot(f.pos[0], f.pos[2], '#FF4D5E', false);
      } else plot(f.pos[0], f.pos[2], '#22D3EE', true);
    }
    g.fillStyle = '#FFC53D'; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
  }

  // ---------- 結果 ----------
  results(m) {
    const me = m.player, r = m.result;
    const acc = (f) => f.stats.shots ? Math.round(f.stats.hits / f.stats.shots * 100) + '%' : '-';
    const rows = m.o.mode === 'ffa' ? m.standings() : m.game.fighters.slice().sort((a, b) => a.team - b.team || b.stats.kills - a.stats.kills);
    const mvp = m.game.fighters.slice().sort((a, b) => (b.stats.kills * 100 + b.stats.dmg) - (a.stats.kills * 100 + a.stats.dmg))[0];
    const title = r.win ? t('res.title.win') : t('res.title.lose');
    const sub = m.o.mode === 'ffa' ? `${t('res.place')} ${r.place} / ${m.game.fighters.length}` : `${r.wins[0]} - ${r.wins[1]}  ·  ${t('mode.' + m.o.mode)}`;
    $('#res-in').innerHTML = `<div class="res-title ${r.win ? 'win' : 'lose'}">${title}</div><div class="res-sub">${esc(sub)} · ${t('map.' + m.o.map)}</div>
      <div class="res-mine"><div><b>${me.stats.kills}</b><small>${t('res.kills')}</small></div><div><b>${me.stats.deaths}</b><small>${t('res.deaths')}</small></div><div><b>${Math.round(me.stats.dmg)}</b><small>${t('res.dmg')}</small></div><div><b>${acc(me)}</b><small>${t('res.acc')}</small></div><div><b>${me.stats.heads}</b><small>${t('res.heads')}</small></div></div>
      <div class="res-card"><table class="res-table"><tr><th>${t('board.name')}</th><th>${t('board.k')}</th><th>${t('board.d')}</th><th>${t('board.a')}</th><th>${t('board.dmg')}</th><th>${t('board.acc')}</th></tr>
      ${rows.map(f => `<tr class="${f.isPlayer ? 'me' : ''}"><td><i class="dot" style="background:${f.isPlayer ? '#9D74FF' : f.colors.glow}"></i>${esc(f.name)}${f === mvp ? `<span class="mvp">${t('res.mvp')}</span>` : ''}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${f.stats.assists}</td><td>${Math.round(f.stats.dmg)}</td><td>${acc(f)}</td></tr>`).join('')}</table></div>
      <div class="res-btns"><button class="start-btn sm" data-act="again"><span>${t('res.again')}</span></button><button class="ghost-btn" data-act="menu">${t('res.menu')}</button></div>`;
    this.show('results');
  }
}
