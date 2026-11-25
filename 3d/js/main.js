// GUN DUEL 3D：はじまり。読み込み → タイトル → メニュー → 試合 → 結果
import * as THREE from '../lib/three.js';
import { Gfx, QUALITY } from './gfx.js';
import { Fx } from './fx.js';
import { Sound } from './audio.js';
import { loadArena, unloadArena, tickArena } from './arenas.js';
import { TPSCamera } from './camera.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Match } from './match.js';
import { setLang, t } from './i18n.js';
import { WEAPONS, WEAPON_IDS, DEFAULT_LOADOUT, SKILL_IDS, MAP_IDS, DIFF_IDS, MODES, clamp, pick } from './data.js';
import { weaponIconScene } from './weapons3d.js';
import { Bot } from './bot.js';

const QS = new URLSearchParams(location.search);

const SKEY = 'gd3d_settings', SELKEY = 'gd3d_sel';

function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : d; } catch (e) { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても遊べる */ } }

// 2D版のプロフィール（名前・見た目・持っているスキル・装備）を読む。書きかえはしない
function read2D() {
  try {
    const sy = JSON.parse(localStorage.getItem('gunduel_sync') || 'null'), acc = sy && sy.acc;
    const raw = (acc && localStorage.getItem('gunduel_profile@' + acc)) || localStorage.getItem('gunduel_profile');
    const lo = (acc && localStorage.getItem('gunduel_loadout@' + acc)) || localStorage.getItem('gunduel_loadout');
    const st = JSON.parse(localStorage.getItem('gunduel_settings') || 'null');
    return { p: raw ? JSON.parse(raw) : null, loadout: lo ? JSON.parse(lo) : null, lang: st && st.lang };
  } catch (e) { return { p: null }; }
}

class App {
  constructor() {
    this.state = 'boot';
    const two = this.two = read2D();
    const nav = (navigator.language || 'ja').toLowerCase();
    this.settings = Object.assign({ quality: null, resScale: 1, dynRes: true, fov: 78, sens: 1, adsSens: 0.75, touchSens: 1, invertY: false, leftShoulder: false,
      master: 0.8, sfx: 0.9, music: 0.45, shake: true, dmgNum: true, showFps: false, lang: two.lang || (nav.startsWith('ja') ? 'ja' : 'en') }, loadJSON(SKEY, {}));
    setLang(this.settings.lang);
    const p = two.p || {};
    this.profile = { name: String(p.name || '').trim().slice(0, 16) || (this.settings.lang === 'ja' ? 'プレイヤー' : 'Player'), look: p.look || {}, sk: p.sk || null };
    let lo = Array.isArray(two.loadout) ? two.loadout.filter(id => WEAPONS[id]) : null;
    if (!lo || lo.length !== 3 || new Set(lo).size !== 3) lo = DEFAULT_LOADOUT.slice();
    this.sel = Object.assign({ mode: 'duel', map: 'ruins', diff: 'normal', loadout: lo, skill: (p.sk && p.sk.sel) || 'roll' }, loadJSON(SELKEY, {}));
    if (!Array.isArray(this.sel.loadout) || this.sel.loadout.length !== 3 || this.sel.loadout.some(id => !WEAPONS[id])) this.sel.loadout = lo;
    if (!this.ownedSkills().includes(this.sel.skill)) this.sel.skill = 'roll';
    if (!MODES[this.sel.mode]) this.sel.mode = 'duel';
    if (!DIFF_IDS.includes(this.sel.diff)) this.sel.diff = 'normal';
    this.canvas = document.getElementById('gl');
    this.timeScale = 1; this.paused = false; this.icons = {};
    this.lastNow = performance.now(); this.noRender = !!QS.get('norender');
    this.fpsT = 0; this.fpsN = 0;
  }

  ownedSkills() {
    const sk = this.profile.sk;
    const own = sk && Array.isArray(sk.own) ? sk.own.filter(s => SKILL_IDS.includes(s)) : [];
    if (!own.includes('roll')) own.unshift('roll');
    return own;
  }
  saveSel() { saveJSON(SELKEY, this.sel); }

  async boot() {
    try {
      this.gfx = new Gfx(this.canvas, this.settings);
    } catch (e) {
      console.error(e);
      document.getElementById('boot').classList.add('hide');
      document.getElementById('nogl').classList.remove('hide');
      document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
      return;
    }
    if (!this.settings.quality) this.settings.quality = this.gfx.qid;
    this.audio = new Sound();
    this.applyVolume();
    this.input = new Input(this.canvas, this.settings);
    this.ui = new UI(this);
    this.ui.apply();
    if (this.input.isTouch) document.body.classList.add('touch');
    this.camCtl = new TPSCamera(this.gfx.camera, this.settings);
    this.input.onPause = () => { if (this.state === 'match' && !this.paused) this.pause(); else if (this.state === 'match' && this.paused && !this.input.isTouch) { /* Esc で閉じない（クリックで戻る） */ } };
    const step = (p, key) => new Promise(r => { this.ui.setBoot(p, key); setTimeout(r, 30); });
    await step(0.1, 'boot.icons');
    this.makeIcons();
    await step(0.35, 'boot.world');
    this.fx = new Fx(this.gfx.scene, this.gfx.q);
    this.previewArena(this.sel.map === 'random' ? 'ruins' : this.sel.map, true);
    await step(0.75, 'boot.shaders');
    try { this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera); } catch (e) { /* 古いブラウザ */ }
    await step(1, 'boot.loading');
    document.getElementById('boot').classList.add('hide');
    this.toTitle();
    this.loop();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'match' && !this.paused) this.pause(); });
    window.addEventListener('resize', () => this.checkRotate());
    window.__gd3d = this;   // テスト用
  }

  makeIcons() {
    for (const id of WEAPON_IDS) {
      const { sc, cam } = weaponIconScene(id, WEAPONS[id].color);
      this.icons[id] = this.gfx.snapshot(sc, cam, 256, 96);
      sc.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
  }

  previewArena(id, now) {
    if (this.arena && this.arena.id === id) return;
    if (this.arena) unloadArena(this.arena, this.gfx);
    this.arena = loadArena(id, this.gfx);
    if (this.arena.api) this.arena.api.onThunder = () => this.audio.play('thunder');
    this.camCtl.orbitT = Math.random() * 6;
  }

  toTitle() {
    this.state = 'title';
    this.ui.show('title');
    document.getElementById('title-gpu').textContent = 'GPU: ' + this.gfx.gpu + ' · ' + t('set.q.' + this.gfx.qid);
    const go = () => {
      this.audio.unlock(); this.audio.startMusic('menu'); this.audio.play('uiBig');
      document.getElementById('title').onclick = null;
      this.toMenu();
    };
    document.getElementById('title').onclick = go;
  }

  toMenu() {
    if (this.match) { this.match.dispose(); this.match = null; }
    this.state = 'menu'; this.paused = false; this.timeScale = 1;
    this.input.enabled = false; this.input.unlock();
    ['title', 'hud', 'results', 'pause', 'touch', 'rotate'].forEach(id => this.ui.hide(id));
    this.ui.show('menu');
    this.ui.buildMenu();
    this.audio.startMusic('menu'); this.audio.kind = 'menu';
    if (this.sel.map !== 'random') this.previewArena(this.sel.map);
  }

  startMatch() {
    const s = this.sel;
    const map = s.map === 'random' ? pick(MAP_IDS) : s.map;
    ['menu', 'results', 'pause', 'loadout', 'settings', 'howto', 'stats'].forEach(id => this.ui.hide(id));
    if (this.match) { this.match.dispose(); this.match = null; }
    this.previewArena(map);
    this.fx.mult = this.gfx.q.particles;
    this.match = new Match(this, { mode: s.mode, map, diff: s.diff, loadout: s.loadout, skill: s.skill, name: this.profile.name, look: this.profile.look });
    this.state = 'match'; this.paused = false; this.timeScale = 1; this.spectating = false;
    this.camCtl.snapTo(this.match.player);
    this.ui.startHud(this.match);
    this.input.enabled = true;
    if (this.input.isTouch) {
      const tr = document.getElementById('touch');
      if (!tr.children.length) this.input.buildTouch(tr);
      this.ui.show('touch');
      try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* 全画面にできなくても遊べる */ }
      try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* 向きを固定できない端末 */ }
    } else this.input.lock();
    this.audio.unlock(); this.audio.kind = 'battle';
    const g = this.match.game;
    g.on('damage', (d) => {
      const me = this.match.player;
      if (d.from === me && d.f !== me && d.point) { this.ui.dmgNumber(d.point, d.amt, d.head); this.ui.hitmark(d.head ? 'head' : ''); }
      if (d.f === me) { this.dmgFlash = Math.min(1, (this.dmgFlash || 0) + 0.35 + d.amt / 60); if (d.origin) this.ui.dmgDir(d.origin); }
    });
    g.on('heal', (d) => { if (d.f === this.match.player) this.healFlash = 1; });
    g.on('shot', (d) => { if (d.f === this.match.player && d.perfect) this.ui.popup(t('hud.just'), 'j'); });
    g.on('parried', (d) => { if (d.by === this.match.player) this.ui.popup(t('hud.parry'), 'p'); });
    // テスト用：自分も BOT に動かしてもらう（?auto=1）
    if (QS.get('auto')) { const me = this.match.player; me.bot = new Bot(g, me, QS.get('autoDiff') || 'hard', {}); this.auto = true; this.input.enabled = false; }
    this.checkRotate();
  }

  pause() {
    if (this.state !== 'match' || this.match.ended) return;
    this.paused = true; this.input.unlock();
    this.ui.show('pause');
  }
  resume() {
    ['pause', 'settings', 'howto'].forEach(id => this.ui.hide(id));
    this.paused = false; this.lastNow = performance.now();
    if (!this.input.isTouch) this.input.lock();
  }
  quitMatch() { this.toMenu(); }
  showResults(m) {
    if (this.match !== m) return;
    this.input.unlock(); this.input.enabled = false;
    this.ui.hide('touch'); this.ui.hide('hud');
    this.ui.results(m);
    this.state = 'results';
  }

  checkRotate() {
    const portrait = innerHeight > innerWidth * 1.05;
    const need = this.input && this.input.isTouch && this.state === 'match' && portrait;
    document.getElementById('rotate').classList.toggle('hide', !need);
  }

  applyVolume() { this.audio.vol = { master: this.settings.master, sfx: this.settings.sfx, music: this.settings.music }; this.audio.applyVolume(); }
  applySettings(k) {
    const S = this.settings;
    saveJSON(SKEY, S);
    if (k === 'quality') { this.gfx.setQuality(S.quality); this.fx.mult = this.gfx.q.particles; }
    if (k === 'resScale' || k === 'dynRes') this.gfx.resize();
    if (k === 'master' || k === 'sfx' || k === 'music') this.applyVolume();
    if (k === 'showFps') document.getElementById('fps').classList.toggle('hide', !S.showFps);
  }

  // ---------------- 毎フレーム ----------------
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now(); let rdt = Math.min(0.05, (now - this.lastNow) / 1000); this.lastNow = now;
    if (QS.get('fixedDt')) rdt = +QS.get('fixedDt');
    if (this.state === 'boot') return;
    this.gfx.adapt(rdt);
    const gfx = this.gfx, cam = gfx.camera;
    let post = { time: this.fx.time, chroma: 0, damage: 0, low: 0, flash: 0, heal: 0 };
    this.time = (this.time || 0) + rdt;
    if (this.state === 'match' && this.match) post = this.tickMatch(rdt);
    else {
      // タイトル・メニュー・結果：闘技場をゆっくり回って見せる
      const tc = this.arena.title;
      if (this.state !== 'results' || !this.match) this.camCtl.orbit(rdt, tc.center, tc.radius, tc.height, 0.06);
      else { const m = this.match; m.game.updateModels(rdt, cam); this.camCtl.orbit(rdt, tc.center, tc.radius * 0.8, tc.height, 0.05); }
      tickArena(this.arena, rdt, this.time);
      this.fx.update(rdt, cam, gfx.renderer.domElement.height);
    }
    const G = this.arena.grade;
    Object.assign(post, { time: this.time, vignette: G.vignette, sat: G.sat, contrast: G.contrast, tint: G.tint, bloom: G.bloom, bloomThreshold: G.bloomThreshold, bloomRadius: G.bloomRadius });
    if (this.audio.ctx) this.audio.listen(cam);
    if (!this.noRender) gfx.render(post);
    // FPS
    this.fpsT += rdt; this.fpsN++;
    if (this.fpsT >= 0.5) { if (this.settings.showFps) document.getElementById('fps').textContent = Math.round(this.fpsN / this.fpsT) + ' FPS · ' + Math.round(gfx.pr * 100) / 100 + 'x · ' + gfx.renderer.info.render.calls + ' draws'; this.fpsT = 0; this.fpsN = 0; }
  }

  tickMatch(rdt) {
    const m = this.match, g = m.game, me = m.player, cc = this.camCtl, cam = this.gfx.camera;
    const post = { chroma: 0, damage: 0, low: 0, flash: 0, heal: 0 };
    if (this.paused) {
      this.input.clearFrame();
      g.updateModels(0, cam);
      tickArena(this.arena, 0, this.time);
      this.fx.update(0, cam, this.gfx.renderer.domElement.height);
      return post;
    }
    // 決着の瞬間はスロー
    let dt = rdt;
    if (m.killcam) {
      m.killcam.t += rdt;
      if (m.killcam.t < 1.5) dt = rdt * 0.22; else m.killcam = null;
    }
    if (this.auto) { cc.yaw = me.yaw; cc.pitch = me.pitch; this.input.clearFrame(); }
    else if (me.alive && m.state !== 'end') this.input.poll(me, cc, dt > 0 ? rdt : 0);
    else this.input.clearFrame();
    const reps = this.auto ? Math.max(1, +(QS.get('speed') || 1)) : 1;
    for (let i = 0; i < reps; i++) m.update(dt);
    // カメラ
    this.spectating = false;
    if (m.killcam) cc.killcam(rdt, m.killcam.at, m.killcam.t);
    else if (m.state === 'intro') {
      const tc = this.arena.title;
      cc.orbit(rdt, tc.center, tc.radius * 0.9, tc.height * 0.8, 0.12);
      if (m.t > 2.2) cc.snapTo(me);
    }
    else if (me.alive) cc.follow(dt, me, g);
    else {
      const ally = m.o.mode === 'team' ? g.fighters.find(f => f.team === me.team && f !== me && f.alive) : null;
      if (ally && m.deadT > 2.2) { cc.spectate(rdt, ally, g); this.spectating = true; }
      else cc.deathView(rdt, me, me.killedBy, g);
    }
    g.updateModels(dt, cam);
    tickArena(this.arena, dt, this.time);
    this.fx.update(dt, cam, this.gfx.renderer.domElement.height);
    this.audio.intensity = clamp(g.fighters.filter(f => f.alive && g.time - (f.lastShotT || -9) < 1).length / 3, 0, 1);
    this.ui.hud(rdt);
    // 画面の効果
    this.dmgFlash = Math.max(0, (this.dmgFlash || 0) - rdt * 2.2);
    this.healFlash = Math.max(0, (this.healFlash || 0) - rdt * 1.6);
    post.damage = this.dmgFlash;
    post.low = me.alive ? clamp((40 - me.hp) / 40, 0, 1) : 0;
    post.heal = this.healFlash;
    post.chroma = (me.rollT > 0 ? 0.012 : 0) + this.dmgFlash * 0.008 + (m.killcam ? 0.01 : 0) + (me.padT > 0 && !me.onGround ? 0.006 : 0);
    post.flash = me.parryT > 0 ? 0.05 : 0;
    return post;
  }
}

const app = new App();
app.boot();
