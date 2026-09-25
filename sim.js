/* ============================================================
   GUN DUEL 対戦シミュレーション
   ブラウザ（AI対戦・オンラインの先読み・ホームのデモ）とサーバーで同じファイルを使う。
   物理・武器・弾・CPUの思考をここに集めて、どこで動かしても同じ動きになるようにする。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GunDuelSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---- 基本の数値 ----
var VW = 720, VH = 360, WORLD_W = 1440, GND = VH - 60;
var MAX_HP = 100, CHAR_W = 20, CHAR_H = 44, DUCK_H = 28;
var GRAVITY = 0.55, JUMP_F = -13, SPEED = 3.4;
var REGEN_IDLE = 120, REGEN_INT = 120, REGEN_AMT = 20;   // 2秒のあいだ撃たず撃たれずなら、2秒ごとに20回復
var SWAP_FRAMES = 10;      // 持ち替えてから撃てるまで
var BUFFER_FRAMES = 6;     // 押した入力を少しだけ覚えておく（押し損ね・通信のゆらぎの吸収）
var HIT_FRAMES = 14;
var GREN_G = 0.42, GREN_VY = -6.0, GREN_LIFE = 120;   // グレネード：重力を強めて、遠くには届きにくい弧に
var PROTO = 5;             // 通信の形式。変えたら上げる（古いページのまま対戦しないように）。5＝2v2 を追加

// ---- 武器 ----
// kind: melee=近接 / bullet=弾 / pellet=散弾 / grenade=放物線で飛んで爆発 / beam=溜めてから撃つ貫通ビーム
// 近接の wind=振りかぶり（押してから当たるまでのフレーム）、rec=振ったあとの硬直（動けない）、
// kb=当てたときに吹き飛ばす速さ、kbUp=上への浮き、kbT=吹き飛んでいる間の操作不能フレーム
// グレネードの dmg=直撃、sdmg=爆風の最大（中心）、splash=爆風の半径
// range=射程(px) dmg=1発の威力(HP100) rate=次の1発まで(フレーム) mag=弾数(0=無限) reload=リロード(フレーム) spd=弾速(px/フレーム)
// burst=1回で出る弾数 gap=その間隔 / pellets=散弾の粒数（遠いほど威力が下がる） / splash=爆発の半径
// charge=溜め時間（溜め中は遅くなり向きも固定） / move=持っている間の移動速度の倍率 / auto=押しっぱなしで撃ち続ける前提
// band=CPUが保とうとする距離
var WEAPONS = {
  1:  { id: 1,  key: 'knife',    kind: 'melee',   range: 46,  dmg: 40, rate: 26, mag: 0,  reload: 0,   spd: 0,  wind: 0, rec: 0, color: '#D1D5DB', band: [0, 34] },
  2:  { id: 2,  key: 'pistol',   kind: 'bullet',  range: 276, dmg: 20, rate: 0,  mag: 1,  reload: 52,  spd: 10, color: '#FACC15', band: [140, 250] },
  3:  { id: 3,  key: 'sniper',   kind: 'bullet',  range: 558, dmg: 40, rate: 0,  mag: 1,  reload: 115, spd: 18, color: '#60A5FA', band: [300, 520] },
  4:  { id: 4,  key: 'smg',      kind: 'bullet',  range: 190, dmg: 8,  rate: 7,  mag: 15, reload: 130, spd: 11, color: '#F472B6', band: [70, 165], auto: true },
  5:  { id: 5,  key: 'shotgun',  kind: 'pellet',  range: 140, dmg: 7,  rate: 48, mag: 2,  reload: 135, spd: 10, pellets: 5, color: '#FB923C', band: [30, 100] },
  6:  { id: 6,  key: 'ar',       kind: 'bullet',  range: 330, dmg: 11, rate: 11, mag: 10, reload: 125, spd: 12, color: '#34D399', band: [170, 300], auto: true },
  7:  { id: 7,  key: 'burst',    kind: 'bullet',  range: 380, dmg: 10, rate: 42, mag: 9,  reload: 120, spd: 13, burst: 3, gap: 4, color: '#2DD4BF', band: [200, 340] },
  8:  { id: 8,  key: 'revolver', kind: 'bullet',  range: 300, dmg: 22, rate: 40, mag: 5,  reload: 175, spd: 12, color: '#F59E0B', band: [150, 270] },
  9:  { id: 9,  key: 'lmg',      kind: 'bullet',  range: 300, dmg: 7,  rate: 7,  mag: 30, reload: 220, spd: 11, move: 0.75, color: '#A3E635', band: [140, 270], auto: true },
  10: { id: 10, key: 'grenade',  kind: 'grenade', range: 210, dmg: 45, sdmg: 35, rate: 54, mag: 3,  reload: 160, spd: 6.2, splash: 55, color: '#FB7185', band: [130, 215] },
  11: { id: 11, key: 'railgun',  kind: 'beam',    range: 700, dmg: 50, rate: 0,  mag: 1,  reload: 180, spd: 0,  charge: 24, color: '#A78BFA', band: [280, 600] },
  12: { id: 12, key: 'knuckle',  kind: 'melee',   range: 34,  dmg: 13, rate: 9,  mag: 0,  reload: 0,   spd: 0,  wind: 0,  rec: 2,  auto: true, color: '#E5E7EB', band: [0, 24] },
  13: { id: 13, key: 'spear',    kind: 'melee',   range: 96,  dmg: 46, rate: 48, mag: 0,  reload: 0,   spd: 0,  wind: 12, rec: 18, color: '#FCD34D', band: [36, 84] },
  14: { id: 14, key: 'hammer',   kind: 'melee',   range: 54,  dmg: 52, rate: 64, mag: 0,  reload: 0,   spd: 0,  wind: 12, rec: 18, kb: 11, kbUp: 5, kbT: 22, color: '#F87171', band: [0, 42] }
};
var WEAPON_IDS = [2, 3, 1, 12, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11];
var DEFAULT_LOADOUT = [2, 3, 1];

// ---- ステージの地形 ----
// platforms: 上から乗れる足場（ground=地面。弾は地面にだけ当たって消える）
// solids: 遮蔽物（通り抜けできず、弾を止める。上には乗れる）
var STAGES = {
  classic: { platforms: [
    { x: 0, y: GND, w: WORLD_W, h: 60, ground: true },
    { x: 130, y: GND - 80, w: 100, h: 12 }, { x: 290, y: GND - 155, w: 110, h: 12 }, { x: 90, y: GND - 230, w: 90, h: 12 },
    { x: 550, y: GND - 90, w: 130, h: 12 }, { x: 480, y: GND - 180, w: 100, h: 12 }, { x: 660, y: GND - 180, w: 100, h: 12 },
    { x: 570, y: GND - 260, w: 110, h: 12 }, { x: 950, y: GND - 80, w: 110, h: 12 }, { x: 1100, y: GND - 155, w: 100, h: 12 },
    { x: 880, y: GND - 220, w: 90, h: 12 }, { x: 1200, y: GND - 230, w: 100, h: 12 }, { x: 1050, y: GND - 295, w: 120, h: 12 }
  ] },
  flat: { platforms: [
    { x: 0, y: GND, w: WORLD_W, h: 60, ground: true }
  ] },
  tower: { platforms: [
    { x: 0, y: GND, w: WORLD_W, h: 60, ground: true },
    { x: 645, y: GND - 70, w: 150, h: 12 },
    { x: 665, y: GND - 140, w: 110, h: 12 },
    { x: 685, y: GND - 210, w: 70, h: 12 },
    { x: 300, y: GND - 110, w: 110, h: 12 }, { x: 1030, y: GND - 110, w: 110, h: 12 },
    { x: 150, y: GND - 190, w: 90, h: 12 }, { x: 1200, y: GND - 190, w: 90, h: 12 }
  ] },
  // 砂漠の遺跡：石柱（遮蔽物）が弾を止める。隠れて撃ち合う
  ruins: { platforms: [
    { x: 0, y: GND, w: WORLD_W, h: 60, ground: true },
    { x: 470, y: GND - 130, w: 130, h: 12 }, { x: 840, y: GND - 130, w: 130, h: 12 }, { x: 655, y: GND - 196, w: 130, h: 12 },
    { x: 150, y: GND - 110, w: 100, h: 12 }, { x: 1190, y: GND - 110, w: 100, h: 12 }
  ], solids: [
    { x: 300, y: GND - 46, w: 26, h: 46 }, { x: 1114, y: GND - 46, w: 26, h: 46 },
    { x: 520, y: GND - 70, w: 34, h: 70 }, { x: 886, y: GND - 70, w: 34, h: 70 },
    { x: 690, y: GND - 30, w: 60, h: 30 }
  ] },
  // 氷の谷：真ん中は底なし。浮かぶ氷を跳び移る（落ちたらアウト）
  glacier: { platforms: [
    { x: 0, y: GND, w: 540, h: 60, ground: true }, { x: 900, y: GND, w: 540, h: 60, ground: true },
    { x: 585, y: GND - 60, w: 90, h: 12 }, { x: 765, y: GND - 60, w: 90, h: 12 }, { x: 660, y: GND - 150, w: 120, h: 12 },
    { x: 200, y: GND - 110, w: 120, h: 12 }, { x: 1120, y: GND - 110, w: 120, h: 12 },
    { x: 380, y: GND - 190, w: 100, h: 12 }, { x: 960, y: GND - 190, w: 100, h: 12 }
  ] },
  // 密林の神殿：中央に段々の神殿。段差が弾を防ぎ、頂上は見晴らしがいい
  temple: { platforms: [
    { x: 0, y: GND, w: WORLD_W, h: 60, ground: true },
    { x: 660, y: GND - 170, w: 120, h: 12 },
    { x: 250, y: GND - 100, w: 110, h: 12 }, { x: 1080, y: GND - 100, w: 110, h: 12 }
  ], solids: [
    { x: 500, y: GND - 28, w: 440, h: 28 }, { x: 560, y: GND - 56, w: 320, h: 28 }, { x: 620, y: GND - 84, w: 200, h: 28 }
  ] }
};

function deepFreeze(o) {
  Object.getOwnPropertyNames(o).forEach(function (k) { var v = o[k]; if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}
var sign = function (v) { return v > 0 ? 1 : v < 0 ? -1 : 0; };
var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
var r1 = function (v) { return Math.round(v * 10) / 10; };
var other = function (s) { return s === 'a' ? 'b' : 'a'; };

// 3つの武器IDにそろえる。allowDup=false なら同じ武器の重複をなくす（プレイヤーの持ち込み用）
function cleanLoadout(v, allowDup) {
  var out = [];
  if (Array.isArray(v)) {
    for (var i = 0; i < v.length && out.length < 3; i++) {
      var id = +v[i];
      if (WEAPONS[id] && (allowDup || out.indexOf(id) < 0)) out.push(id);
    }
  }
  for (var j = 0; out.length < 3 && j < WEAPON_IDS.length; j++) {
    var d = DEFAULT_LOADOUT[j] || WEAPON_IDS[j];
    if (out.indexOf(d) < 0) out.push(d);
  }
  return out;
}

// ---- 見た目（それぞれ何番目の選択肢か。色や形そのものはブラウザ側で描く）----
// hat=帽子 outfit=服の形 neck=首もと accent=自分の色（帽子のリボンと首もとの色）
// あとから足した4つは 0 が「なし・今までの見た目」。前に保存した見た目は 0 になるので、見た目は変わらない
var LOOK_SIZES = { skin: 8, eyes: 5, eyeColor: 8, brows: 5, hair: 7, hairColor: 8, nose: 5, mouth: 5, hat: 5, outfit: 4, neck: 3, accent: 8 };
var LOOK_KEYS = ['skin', 'eyes', 'eyeColor', 'brows', 'hair', 'hairColor', 'nose', 'mouth', 'hat', 'outfit', 'neck', 'accent'];
var LOOK_GEAR = ['hat', 'outfit', 'neck', 'accent'];
function cleanLook(v) {
  var o = {};
  LOOK_KEYS.forEach(function (k) {
    var n = v && typeof v === 'object' ? Math.floor(+v[k]) : 0;
    o[k] = n >= 0 && n < LOOK_SIZES[k] ? n : 0;
  });
  return o;
}
function randomLook(rnd) {
  var r = rnd || Math.random, o = {};
  LOOK_KEYS.forEach(function (k) { if (LOOK_GEAR.indexOf(k) < 0) o[k] = Math.floor(r() * LOOK_SIZES[k]); });
  if (r() < 0.75) o.skin = Math.floor(r() * 6);   // 青や緑の肌はときどき
  // 身につける物（帽子と首もとは、なしを多めに）
  o.hat = r() < 0.45 ? 0 : 1 + Math.floor(r() * (LOOK_SIZES.hat - 1));
  o.outfit = Math.floor(r() * LOOK_SIZES.outfit);
  o.neck = r() < 0.55 ? 0 : 1 + Math.floor(r() * (LOOK_SIZES.neck - 1));
  o.accent = Math.floor(r() * LOOK_SIZES.accent);
  return o;
}

// ============================================================
// キャラクター
// ============================================================
function newChar(side, x, y, dir, loadout) {
  var load = cleanLoadout(loadout, true);
  return {
    side: side, x: x, y: y, vx: 0, vy: 0, dir: dir,
    hp: MAX_HP, hpFrac: MAX_HP, hit: 0, dead: false, onGround: false, ducking: false,
    load: load, slot: 0, ammo: load.map(function (id) { return WEAPONS[id].mag; }),
    cool: 0, coolMax: 1, rl: 0, rlMax: 1, rlSlot: 0, burst: 0, burstT: 0, chg: 0,
    swT: 0, recT: 0, kbT: 0, bx: 0, by: 0, bdir: 0,
    healUsed: false, idle: 0, regen: 0, groundSince: -1, lastShot: -999,
    inL: false, inR: false, inDuck: false, inFire: false, wantSlot: 0,
    jumpBuf: 0, shootBuf: 0, healReq: false, reloadReq: false
  };
}
function weaponOf(c) { return WEAPONS[c.load[c.slot]]; }
// 入力：left/right/duck/fire は押しっぱなしの状態、jump/shoot/heal/reload は押した瞬間
function setInput(c, i) {
  if (!i) return;
  c.inL = !!i.left; c.inR = !!i.right; c.inDuck = !!i.duck; c.inFire = !!i.fire;
  if (i.slot === 0 || i.slot === 1 || i.slot === 2) c.wantSlot = i.slot;
  if (i.jump) c.jumpBuf = BUFFER_FRAMES;
  if (i.shoot) c.shootBuf = BUFFER_FRAMES;
  if (i.heal) c.healReq = true;
  if (i.reload) c.reloadReq = true;
}
function canFire(c) {
  var W = weaponOf(c);
  return !c.dead && c.cool <= 0 && c.rl <= 0 && c.burst <= 0 && c.chg <= 0 && c.swT <= 0 && c.recT <= 0 && c.kbT <= 0 &&
    (W.mag === 0 || c.ammo[c.slot] > 0);
}
function muzzleY(c) { return c.y + (c.ducking ? CHAR_H - 18 : 22); }
function boxTop(c) { return c.ducking ? c.y + (CHAR_H - DUCK_H) : c.y; }
function inBoxY(y, c) { var top = boxTop(c), h = c.ducking ? DUCK_H : CHAR_H; return y > top - 4 && y < top + h + 4; }
function hits(b, c) { return b.x > c.x - 6 && b.x < c.x + CHAR_W + 6 && inBoxY(b.y, c); }

// ============================================================
// ワールド
// ============================================================
function newWorld(stage, loadA, loadB) {
  var st = (stage && typeof stage === 'object') ? stage : (STAGES[stage] || STAGES.classic);
  var sp = st.spawn || [{ x: 80, y: GND }, { x: WORLD_W - 100, y: GND }];
  var w = { plats: st.platforms, solids: st.solids || [], frame: 0, sid: 0, shots: [], chars: {}, nav: null };
  w.chars.a = newChar('a', sp[0].x, sp[0].y - CHAR_H, 1, loadA);
  w.chars.b = newChar('b', sp[1].x, sp[1].y - CHAR_H, -1, loadB);
  return w;
}
// ---- 射撃場 ----
// 的は人と同じ大きさの箱（倒れない）。当たると 'hit'（who=的のid）が出る。patrol=[左端,右端] なら左右に動く
// 射撃場の世界は、プレイヤー（chars.a）と的だけ。chars.b は置かない
function newTarget(id, x, y, patrol, speed) {
  return { side: id, target: true, x: x, y: y, vx: patrol ? (speed || 1.5) : 0, vy: 0, hp: 1e9, hpFrac: 1e9, hit: 0,
    dead: false, ducking: false, onGround: true, patrol: patrol || null, kbT: 0 };
}
function newRangeWorld(stage, load, targets) {
  var st = (stage && typeof stage === 'object') ? stage : (STAGES[stage] || STAGES.flat);
  var sp = st.spawn || [{ x: 80, y: GND }];
  var w = { plats: st.platforms, solids: st.solids || [], frame: 0, sid: 0, shots: [], chars: {}, nav: null, targets: targets || [] };
  w.chars.a = newChar('a', sp[0].x, sp[0].y - CHAR_H, 1, load);
  return w;
}
function stepRange(w, ev) {
  w.frame++;
  for (var i = 0; i < w.targets.length; i++) {
    var tg = w.targets[i];
    if (tg.hit > 0) tg.hit--;
    tg.hp = 1e9; tg.hpFrac = 1e9;   // 的は壊れない
    if (tg.patrol) { tg.x += tg.vx; if (tg.x <= tg.patrol[0] || tg.x >= tg.patrol[1]) { tg.x = clamp(tg.x, tg.patrol[0], tg.patrol[1]); tg.vx = -tg.vx; } }
  }
  stepChar(w, w.chars.a, null, ev, false);
  stepShots(w, ev, false);
}
// ---- 2v2（チーム戦）----
// 4人：a と c が左のチーム（0）、b と d が右のチーム（1）。味方の弾・近接・爆風は当たらない（すり抜ける）
var TEAM_SLOTS = ['a', 'b', 'c', 'd'];
function teamOf(side) { return side === 'a' || side === 'c' ? 0 : 1; }
function newTeamWorld(stage, loads) {
  var st = (stage && typeof stage === 'object') ? stage : (STAGES[stage] || STAGES.classic);
  var w = { plats: st.platforms, solids: st.solids || [], frame: 0, sid: 0, shots: [], chars: {}, nav: null, teams: true };
  var L = loads || {}, xs = { a: 80, b: WORLD_W - 100, c: 170, d: WORLD_W - 190 };
  for (var i = 0; i < 4; i++) {
    var k = TEAM_SLOTS[i];
    w.chars[k] = newChar(k, xs[k], GND - CHAR_H, teamOf(k) === 0 ? 1 : -1, L[k]);
  }
  return w;
}
function stepTeam(w, ev) {
  w.frame++;
  for (var i = 0; i < 4; i++) { var c = w.chars[TEAM_SLOTS[i]]; if (c) stepChar(w, c, null, ev, false); }
  stepShots(w, ev, false);
}
// その人の敵：射撃場なら全部の的、チーム戦なら相手チームの2人、1対1なら相手ひとり
function foes(w, side) {
  if (w.targets) return w.targets;
  if (w.teams) {
    var out = [];
    for (var i = 0; i < 4; i++) { var k = TEAM_SLOTS[i], c = w.chars[k]; if (c && teamOf(k) !== teamOf(side)) out.push(c); }
    return out;
  }
  var o = w.chars[other(side)];
  return o ? [o] : [];
}
// その弾・攻撃が当たりうる相手（side＝撃った人）。1対1は渡された相手ひとり
function victims(w, t, side) { return w.targets || (w.teams ? foes(w, side) : (t ? [t] : [])); }
// 片方のチームが全員倒れたか（null＝まだ）。両方同時なら 'draw'
function teamResult(w) {
  var dead = [true, true];
  for (var i = 0; i < 4; i++) { var k = TEAM_SLOTS[i], c = w.chars[k]; if (c && !c.dead) dead[teamOf(k)] = false; }
  return dead[0] && dead[1] ? 'draw' : dead[0] ? 1 : dead[1] ? 0 : null;
}

// ---- 書き換えの見張り（w.guardOn が true のときだけ）----
// 1フレームの計算が終わったときの値を控えておき、次のフレームの頭で違っていたら「外から触られた」と判断する。
// ブラウザの開発者ツールで止めて値を入れ替えるチート（弾を増やす・リロードを飛ばす等）が、ここで分かる
function guardSnap(c) {
  return [c.ammo[0] | 0, c.ammo[1] | 0, c.ammo[2] | 0, c.cool | 0, c.rl | 0, c.chg | 0, c.burst | 0,
    Math.round(c.hp * 8), Math.round(c.x * 8), Math.round(c.y * 8), c.slot | 0, c.dead ? 1 : 0];
}
function guardSave(w) {
  if (!w.guardOn) return;
  var g = w.guard || (w.guard = {}), k;
  for (k in w.chars) g[k] = guardSnap(w.chars[k]);
}
function guardCheck(w) {
  if (!w.guardOn || !w.guard) return '';
  var k, i, a, b;
  for (k in w.guard) {
    if (!w.chars[k]) continue;
    a = w.guard[k]; b = guardSnap(w.chars[k]);
    for (i = 0; i < b.length; i++) if (a[i] !== b[i]) return k + '#' + i;
  }
  return '';
}

// 1フレーム進める。ev に起きたこと（発射・命中・爆発など）が入る
function step(w, ev) {
  var tampered = guardCheck(w);
  if (tampered) { w.tamper = (w.tamper || 0) + 1; w.tamperAt = tampered; }
  w.frame++;
  stepChar(w, w.chars.a, w.chars.b, ev, false);
  stepChar(w, w.chars.b, w.chars.a, ev, false);
  stepShots(w, ev, false);
  guardSave(w);
}

// vis=true はオンラインの先読み用：見た目だけ動かし、ダメージは与えない（ダメージはサーバーが決める）
function stepChar(w, c, t, ev, vis) {
  if (c.hit > 0) c.hit--;
  if (c.dead) return;
  if (c.cool > 0) c.cool--;
  if (c.rl > 0 && --c.rl === 0) c.ammo[c.rlSlot] = WEAPONS[c.load[c.rlSlot]].mag;
  var shot = false;
  // 近接武器の振りかぶり → 当たり判定 → 硬直（この間は動けない・撃てない）
  var busy = c.swT > 0 || c.recT > 0;
  if (c.recT > 0) c.recT--;
  if (c.swT > 0 && --c.swT === 0) { meleeHit(w, c, t, weaponOf(c), ev, vis); c.recT = weaponOf(c).rec || 0; shot = true; }
  // 持ち替え（連射の途中や溜めている間・振っている間はできない）
  if (c.wantSlot !== c.slot && c.burst <= 0 && c.chg <= 0 && !busy) {
    c.slot = c.wantSlot;
    if (c.cool < SWAP_FRAMES) { c.cool = SWAP_FRAMES; c.coolMax = SWAP_FRAMES; }
    ev.push({ t: 'swap', who: c.side, wid: c.load[c.slot] });
  }
  if (c.healReq) {
    c.healReq = false;
    if (!c.healUsed) {
      c.healUsed = true; c.hp = MAX_HP; c.hpFrac = MAX_HP; c.idle = 0; c.regen = 0;
      ev.push({ t: 'heal', who: c.side, x: c.x + CHAR_W / 2, y: c.y + CHAR_H / 2 });
    }
  }
  var W = weaponOf(c);
  if (c.reloadReq) {
    c.reloadReq = false;
    if (W.mag > 0 && c.ammo[c.slot] < W.mag && c.rl <= 0 && c.burst <= 0 && c.chg <= 0) startReload(c, ev);
  }
  if (c.jumpBuf > 0) {
    if (c.onGround && !busy && c.kbT <= 0) { c.vy = JUMP_F; c.jumpBuf = 0; ev.push({ t: 'jump', who: c.side }); }
    else c.jumpBuf--;
  }
  // 向きと移動（撃つより先に向きを決めるので、振り向きながら撃てる）
  var sp = SPEED * (W.move || 1) * (c.chg > 0 ? 0.4 : 1);
  if (c.kbT > 0) { c.kbT--; c.vx *= 0.9; }         // 吹き飛ばされている間は操作がきかない
  else if (busy) c.vx *= 0.5;                       // 振りかぶり・硬直の間は止まる
  else if (c.inL) { c.vx = -sp; if (c.chg <= 0) c.dir = -1; }
  else if (c.inR) { c.vx = sp; if (c.chg <= 0) c.dir = 1; }
  else c.vx *= 0.5;
  c.ducking = c.inDuck;
  // 射撃
  if (c.burst > 0 && --c.burstT <= 0) { c.burst--; c.burstT = W.gap; fireRound(w, c, W, ev, t, vis); shot = true; }
  if (c.chg > 0 && --c.chg === 0) { fireBeam(w, c, t, W, ev, vis); shot = true; }
  if ((c.shootBuf > 0 || c.inFire) && canFire(c)) {
    var edge = c.shootBuf > 0;
    c.shootBuf = 0;
    trigger(w, c, t, W, ev, vis, edge);
    shot = true;
  } else if (c.shootBuf > 0) {
    // 弾切れで撃とうとした：「カチッ」と知らせて、R でのリロードを促す
    if (W.mag > 0 && c.ammo[c.slot] <= 0 && c.rl <= 0 && c.cool <= 0 && c.burst <= 0) { c.shootBuf = 0; ev.push({ t: 'dry', who: c.side }); }
    else c.shootBuf--;
  }
  physics(w, c, ev);
  if (c.onGround) { if (c.groundSince < 0) c.groundSince = w.frame; } else c.groundSince = -1;
  // 自然回復
  if (shot || c.hit > 0) { c.idle = 0; c.regen = 0; }
  else if (++c.idle >= REGEN_IDLE && c.hpFrac < MAX_HP && ++c.regen >= REGEN_INT) {
    c.regen = 0; c.hpFrac = Math.min(MAX_HP, c.hpFrac + REGEN_AMT); c.hp = Math.floor(c.hpFrac);
  }
}

function startReload(c, ev) {
  var W = weaponOf(c);
  c.rl = c.rlMax = W.reload; c.rlSlot = c.slot;
  ev.push({ t: 'reload', who: c.side, wid: c.load[c.slot], mag: W.mag });
}
function trigger(w, c, t, W, ev, vis, edge) {
  c.lastShot = w.frame;
  ev.push({ t: 'pull', who: c.side, wid: c.load[c.slot], edge: edge, sid: w.sid + 1 });
  if (W.kind === 'melee') {
    c.cool = c.coolMax = W.rate;
    if (W.wind) { c.swT = W.wind; ev.push({ t: 'windup', who: c.side, wid: c.load[c.slot] }); return; }   // 振りかぶってから当たる
    meleeHit(w, c, t, W, ev, vis);
    c.recT = W.rec || 0;
    return;
  }
  if (W.kind === 'beam') {
    c.chg = W.charge;
    // 撃った瞬間の位置と向きを覚える。溜めている間に動いても、ビームはここから同じ向きに出る
    c.bx = c.x + CHAR_W / 2 + c.dir * 22; c.by = muzzleY(c); c.bdir = c.dir;
    ev.push({ t: 'charge', who: c.side, wid: c.load[c.slot] });
    return;
  }
  c.cool = c.coolMax = Math.max(1, W.rate);
  fireRound(w, c, W, ev, t, vis);
  if (W.burst && c.ammo[c.slot] > 0 && c.rl <= 0) { c.burst = W.burst - 1; c.burstT = W.gap; }
}
function meleeHit(w, c, t, W, ev, vis) {
  var sid = ++w.sid, list = victims(w, t, c.side), got = [];
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (!v.dead && Math.abs(v.x - c.x) <= W.range && Math.abs(v.y - c.y) < 40 && sign(v.x - c.x) === c.dir) got.push(v);
  }
  ev.push({ t: 'melee', who: c.side, wid: c.load[c.slot], x: c.x + CHAR_W / 2 + c.dir * 18, y: c.y + 22, dir: c.dir, hit: got.length > 0, sid: sid, reach: W.range });
  for (var j = 0; j < got.length; j++) {
    var u = got[j];
    damage(w, u, W.dmg, c.side, ev, vis, u.x + CHAR_W / 2 - c.dir * 6, c.y + 22, c.dir, sid);
    if (W.kb && !vis && !u.dead && !u.target) {      // 吹き飛ばす（しばらく操作できない）。射撃場の的は動かない
      u.vx = c.dir * W.kb; u.vy = Math.min(u.vy, -W.kbUp); u.kbT = W.kbT; u.onGround = false;
      u.swT = 0; u.recT = 0; u.chg = 0; u.burst = 0;
    }
  }
}
function fireRound(w, c, W, ev, t, vis) {
  var wid = c.load[c.slot], dir = c.dir, my = muzzleY(c), cx = c.x + CHAR_W / 2, mx = cx + dir * 22, sid = ++w.sid;
  // 銃口より手前（密着）にいる相手には、弾を出さずにその場で当てる（くっつくと撃てない、をなくす）
  var list = victims(w, t, c.side), close = null;
  for (var i0 = 0; i0 < list.length && !close; i0++) {
    var v0 = list[i0];
    if (!v0.dead && v0.x + CHAR_W + 6 > Math.min(cx, mx) && v0.x - 6 < Math.max(cx, mx) && inBoxY(my, v0)) close = v0;
  }
  if (close) {
    ev.push({ t: 'fire', who: c.side, wid: wid, x: mx, y: my, dir: dir, sid: sid });
    if (W.kind === 'grenade') explode(w, { own: c.side, dmg: W.dmg, sdmg: W.sdmg, splash: W.splash, sid: sid }, close, ev, vis, close.x + CHAR_W / 2, my, true);
    else damage(w, close, W.kind === 'pellet' ? W.dmg * W.pellets : W.dmg, c.side, ev, vis, close.x + CHAR_W / 2, my, dir, sid);
  } else if (W.kind === 'bullet') {
    w.shots.push({ k: 'b', w: wid, x: mx, y: my, vx: W.spd * dir, vy: 0, own: c.side, dist: 0, range: W.range, dmg: W.dmg, age: 0, sid: sid });
  } else if (W.kind === 'pellet') {
    for (var i = 0; i < W.pellets; i++) {
      w.shots.push({ k: 'p', w: wid, x: mx, y: my, vx: W.spd * dir, vy: (i - (W.pellets - 1) / 2) * 1.1, own: c.side, dist: 0, range: W.range, dmg: W.dmg, age: 0, sid: sid });
    }
  } else if (W.kind === 'grenade') {
    w.shots.push({ k: 'g', w: wid, x: c.x + CHAR_W / 2 + dir * 14, y: my - 6, vx: W.spd * dir + c.vx * 0.5, vy: GREN_VY, own: c.side, life: GREN_LIFE, dmg: W.dmg, sdmg: W.sdmg, splash: W.splash, age: 0, sid: sid });
  }
  if (!close) ev.push({ t: 'fire', who: c.side, wid: wid, x: mx, y: my, dir: dir, sid: sid });
  if (--c.ammo[c.slot] <= 0) c.burst = 0;   // 弾が切れても自動ではリロードしない（R で）
}
function fireBeam(w, c, t, W, ev, vis) {
  var wid = c.load[c.slot], dir = c.bdir || c.dir, y = c.by || muzzleY(c), x1 = c.bx || (c.x + CHAR_W / 2 + dir * 22), sid = ++w.sid;
  var x2 = clamp(x1 + dir * W.range, 0, WORLD_W), list = victims(w, t, c.side), got = [];
  for (var i = 0; i < list.length; i++) {
    var v = list[i], vc = v.x + CHAR_W / 2;
    if (!v.dead && (vc - x1) * dir >= -10 && Math.abs(vc - x1) <= W.range && inBoxY(y, v)) got.push(v);
  }
  var end = got.length && !w.targets && !w.teams ? got[0].x + CHAR_W / 2 : x2;   // 1対1では相手のところで止めて見せる（射撃場・チーム戦は貫いて見せる）
  ev.push({ t: 'fire', who: c.side, wid: wid, x: x1, y: y, dir: dir, x2: end, beam: true, sid: sid });
  for (var j = 0; j < got.length; j++) damage(w, got[j], W.dmg, c.side, ev, vis, got[j].x + CHAR_W / 2, y, dir, sid);
  --c.ammo[c.slot];   // 自動ではリロードしない
}
function damage(w, t, dmg, by, ev, vis, x, y, kdir, sid) {
  if (vis) { ev.push({ t: 'vhit', who: t.side, x: x, y: y }); return; }
  t.hp = Math.max(0, t.hp - dmg); t.hpFrac = t.hp; t.hit = HIT_FRAMES; t.idle = 0; t.regen = 0;
  ev.push({ t: 'hit', who: t.side, by: by, dmg: dmg, x: x, y: y, sid: sid });
  if (t.hp <= 0 && !t.dead) { t.dead = true; ev.push({ t: 'dead', who: t.side, by: by, x: t.x, y: t.y, dir: kdir || 1, duck: t.ducking }); }
}

// 弾を止めるもの：遮蔽物と地面
function blockAt(w, x, y) {
  var i, s;
  for (i = 0; i < w.solids.length; i++) { s = w.solids[i]; if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true; }
  for (i = 0; i < w.plats.length; i++) { s = w.plats[i]; if (s.ground && x >= s.x && x <= s.x + s.w && y > s.y && y <= s.y + s.h) return true; }
  return false;
}
// 同じ高さの2点のあいだに遮蔽物があるか
function blockedLine(w, x1, x2, y) {
  var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  for (var i = 0; i < w.solids.length; i++) {
    var s = w.solids[i];
    if (s.x <= hi && s.x + s.w >= lo && y >= s.y && y <= s.y + s.h) return true;
  }
  return false;
}
// only: その持ち主の弾だけ進める（オンラインの先読みで自分の弾だけ動かすとき）
function stepShots(w, ev, vis, only) {
  var out = [];
  for (var i = 0; i < w.shots.length; i++) {
    var b = w.shots[i];
    if (only && b.own !== only) { out.push(b); continue; }
    var t = w.targets || w.teams ? null : w.chars[other(b.own)];
    b.age++;
    if (b.k === 'g') { if (stepGrenade(w, b, t, ev, vis)) out.push(b); continue; }
    b.x += b.vx; b.y += b.vy; b.dist += Math.abs(b.vx);
    if (b.dist > b.range || b.x < -20 || b.x > WORLD_W + 20 || b.y < -60 || b.y > VH + 20) continue;
    if (blockAt(w, b.x, b.y)) { ev.push({ t: 'spark', x: b.x, y: b.y, own: b.own }); continue; }
    if (w.targets || w.teams) {                        // 射撃場・チーム戦：いちばん先に触れた相手に当たる（味方はすり抜ける）
      var fl = foes(w, b.own);
      for (var k = 0; k < fl.length && !t; k++) if (!fl[k].dead && hits(b, fl[k])) t = fl[k];
    }
    if (t && !t.dead && hits(b, t)) {
      // オンラインの先読み（w.ghost）：当たったかどうかはサーバーが決めるので、ここでは通り抜けさせる
      // （古い位置の相手に当てて火花を出すと、「当たったのに効かない」ように見えてしまう）
      if (vis && w.ghost) { out.push(b); continue; }
      var d = b.k === 'p' ? Math.max(1, Math.round(b.dmg * (1 - 0.5 * b.dist / b.range))) : b.dmg;
      damage(w, t, d, b.own, ev, vis, b.x, b.y, sign(b.vx), b.sid);
      continue;
    }
    out.push(b);
  }
  w.shots = out;
}
function stepGrenade(w, b, t, ev, vis) {
  var py = b.y;
  b.vy += GREN_G; b.x += b.vx; b.y += b.vy; b.life--;
  if (b.y > VH + 30) return false;                                  // 穴に落ちたら消える
  if (b.x < 0 || b.x > WORLD_W) { explode(w, b, t, ev, vis, clamp(b.x, 0, WORLD_W), b.y); return false; }   // 端の壁で爆発
  var list = victims(w, t, b.own);
  for (var i0 = 0; i0 < list.length; i0++) {
    var v0 = list[i0];
    if (!v0.dead && b.x > v0.x - 4 && b.x < v0.x + CHAR_W + 4 && inBoxY(b.y, v0)) { explode(w, b, v0, ev, vis, b.x, b.y, true); return false; }
  }
  if (b.vy > 0) {
    for (var i = 0; i < w.plats.length; i++) {
      var p = w.plats[i];
      if (b.x >= p.x && b.x <= p.x + p.w && py <= p.y && b.y >= p.y) { explode(w, b, t, ev, vis, b.x, p.y); return false; }
    }
  }
  if (blockAt(w, b.x, b.y)) { explode(w, b, t, ev, vis, b.x, b.y); return false; }
  if (b.life <= 0) { explode(w, b, t, ev, vis, b.x, b.y); return false; }
  return true;
}
// direct=相手に直接当たった（直撃のダメージ）。それ以外は爆風（中心から離れるほど弱い）
function explode(w, b, t, ev, vis, x, y, direct) {
  ev.push({ t: 'boom', who: b.own, x: x, y: y, r: b.splash });
  var list = w.targets || (w.teams ? foes(w, b.own) : [t]);
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (!v || v.dead) continue;
    var top = boxTop(v), bot = v.y + CHAR_H;
    var nx = clamp(x, v.x, v.x + CHAR_W), ny = clamp(y, top, bot), d = Math.sqrt((x - nx) * (x - nx) + (y - ny) * (y - ny));
    var dmg = direct && v === t ? b.dmg : d <= b.splash ? Math.max(1, Math.round((b.sdmg || b.dmg) * (1 - 0.55 * d / b.splash))) : 0;
    if (dmg > 0) damage(w, v, dmg, b.own, ev, vis, nx, ny, sign(v.x + CHAR_W / 2 - x) || 1, b.sid);
  }
}

// ---- 物理（足場は上からだけ乗れる。遮蔽物は横からぶつかる）----
function physics(w, c, ev) {
  var i, s;
  c.vy += GRAVITY;
  c.x += c.vx;
  for (i = 0; i < w.solids.length; i++) {
    s = w.solids[i];
    if (c.x + CHAR_W > s.x && c.x < s.x + s.w && c.y + CHAR_H > s.y && c.y < s.y + s.h) {
      if (c.y + CHAR_H - s.y <= 8 && c.vy >= 0) { c.y = s.y - CHAR_H; }   // 低い段差は乗り上げる
      else if (c.x + CHAR_W / 2 < s.x + s.w / 2) c.x = s.x - CHAR_W;
      else c.x = s.x + s.w;
    }
  }
  c.x = clamp(c.x, 0, WORLD_W - CHAR_W);
  var prevBot = c.y + CHAR_H;
  c.y += c.vy; c.onGround = false;
  var bot = c.y + CHAR_H;
  if (c.vy >= 0) {
    for (i = 0; i < w.plats.length && !c.onGround; i++) {
      s = w.plats[i];
      if (c.x + CHAR_W > s.x && c.x < s.x + s.w && prevBot <= s.y + 2 && bot >= s.y) { c.y = s.y - CHAR_H; c.vy = 0; c.onGround = true; }
    }
    for (i = 0; i < w.solids.length && !c.onGround; i++) {
      s = w.solids[i];
      if (c.x + CHAR_W > s.x && c.x < s.x + s.w && prevBot <= s.y + 2 && bot >= s.y) { c.y = s.y - CHAR_H; c.vy = 0; c.onGround = true; }
    }
  } else {
    for (i = 0; i < w.solids.length; i++) {
      s = w.solids[i];
      if (c.x + CHAR_W > s.x && c.x < s.x + s.w && c.y < s.y + s.h && prevBot - CHAR_H >= s.y + s.h - 1) { c.y = s.y + s.h; c.vy = 0; }
    }
  }
  if (c.y > VH + 50 && !c.dead) {
    c.hp = 0; c.hpFrac = 0; c.dead = true;
    ev.push({ t: 'dead', who: c.side, by: other(c.side), x: c.x, y: c.y, dir: 0, fell: true });
  }
}

// ---- 通信用にまとめる ----
function packChar(c) {
  return { x: r1(c.x), y: r1(c.y), vx: r1(c.vx), vy: r1(c.vy), dir: c.dir, hp: c.hp, hit: c.hit, dead: c.dead,
    ducking: c.ducking, onGround: c.onGround, slot: c.slot, wid: c.load[c.slot], am: c.ammo.slice(),
    cool: c.cool, coolMax: c.coolMax, rl: c.rl, rlMax: c.rlMax, chg: c.chg, heal: c.healUsed,
    sw: c.swT, rc: c.recT, kb: c.kbT, bx: r1(c.bx), by: r1(c.by), bd: c.bdir };
}
function packShots(w) {
  return w.shots.map(function (b) { return { k: b.k, w: b.w, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), own: b.own }; });
}

// ============================================================
// CPUの思考
// プレイヤーと同じ「入力」を作るだけ。移動・ジャンプ・リロードなどの性能は完全に同じで、
// 強さの差は判断の速さと正確さだけでつける。
// ============================================================
// react=弾に反応するまで / see=弾に気づく距離 / mvI=動きを決め直す間隔 / dodge=回避の成功率 / jumpF=無駄跳びの間隔
// wMin,wMax=撃てるようになってから撃つまでの迷い / hTol=撃つのを許す高さのずれ / whiff=ナイフの空振り率
// hpT=回復を使うHP / hCh=1秒あたりの実行率 / strafe=撃ち合い中に左右へ動く頻度 / cover=リロード中に隠れる率 / smart=距離に合う武器を選ぶ率
// melee=近くの相手にナイフで斬りかかる率（空振りは whiff）
var AI_LEVELS = {
  easy:   { react: 20, see: 140, mvI: 20, dodge: 0.15, jumpF: 60,  wMin: 80, wMax: 160, hTol: 40, whiff: 0.42, hpT: 20, hCh: 0.50, strafe: 0.30, cover: 0.20, smart: 0.50, melee: 0.05 },
  normal: { react: 16, see: 175, mvI: 16, dodge: 0.35, jumpF: 80,  wMin: 46, wMax: 96,   hTol: 32, whiff: 0.33, hpT: 40, hCh: 0.55, strafe: 0.50, cover: 0.40, smart: 0.70, melee: 0.12 },
  hard:   { react: 12, see: 215, mvI: 12, dodge: 0.50, jumpF: 100, wMin: 32, wMax: 66,  hTol: 26, whiff: 0.22, hpT: 40, hCh: 0.70, strafe: 0.65, cover: 0.60, smart: 0.85, melee: 0.25 },
  pro:    { react: 9,  see: 255, mvI: 10, dodge: 0.58, jumpF: 130, wMin: 22, wMax: 50,  hTol: 20, whiff: 0.10, hpT: 40, hCh: 0.85, strafe: 0.75, cover: 0.75, smart: 0.95, melee: 0.30 },
  god:    { react: 7,  see: 300, mvI: 7,  dodge: 0.76, jumpF: 170, wMin: 10,  wMax: 24,  hTol: 14, whiff: 0.04, hpT: 40, hCh: 0.95, strafe: 0.85, cover: 0.90, smart: 1.00, melee: 0.45 },
  // 隠しボス「鬼帝」：反応・精度・回避・判断をすべて最高に。体力・無敵・壁抜けなどのルールは人と同じ。
  // boss：弾が届く瞬間を計算してよけ、相手の移動先を読んで撃つ。lapse：ごくまれに判断が遅れる（1フレームあたりの確率と長さ）
  emperor: { react: 3, see: 520, mvI: 5, dodge: 1.00, jumpF: 240, wMin: 2, wMax: 5, hTol: 8, whiff: 0, hpT: 45, hCh: 1.00, strafe: 0.90, cover: 1.00, smart: 1.00, melee: 0.50, boss: true, lapse: 1 / 5400, lapseLen: 36 }
};
// ---- レートに合わせた強さ ----
// 5段階のあいだを、レートで少しずつ変える。下は「よわい」より弱く、上は「鬼神」より強くできる
var AI_ANCHORS = [
  { react: 40, see: 70, mvI: 34, dodge: 0.00, jumpF: 40, wMin: 200, wMax: 340, hTol: 60, whiff: 0.80, hpT: 15, hCh: 0.15, strafe: 0.10, cover: 0.00, smart: 0.15, melee: 0.00 },
  AI_LEVELS.easy, AI_LEVELS.normal, AI_LEVELS.hard, AI_LEVELS.pro, AI_LEVELS.god,
  { react: 5, see: 340, mvI: 6, dodge: 0.92, jumpF: 190, wMin: 6, wMax: 16, hTol: 11, whiff: 0.01, hpT: 40, hCh: 1.00, strafe: 0.90, cover: 0.95, smart: 1.00, melee: 0.50 }
];
// レート → AI_ANCHORS のどこか（0=いちばん弱い … 6=いちばん強い）。
// BOT同士を実際に戦わせて「レート差200＝勝率76%」になるように測った目盛り（scratchpad/calib-bot.js。第4弾Eの新しい思考で測り直し）
var RATE_T = [[841, 0], [917, 0.5], [1200, 1], [1395, 1.5], [1536, 2], [1694, 2.5], [1977, 3], [2022, 3.5], [2281, 4], [2405, 4.5], [2600, 5], [2776, 5.5], [2791, 6]];
var AI_KEYS = ['react', 'see', 'mvI', 'dodge', 'jumpF', 'wMin', 'wMax', 'hTol', 'whiff', 'hpT', 'hCh', 'strafe', 'cover', 'smart', 'melee'];
var AI_INT = { react: 1, see: 1, mvI: 1, jumpF: 1, wMin: 1, wMax: 1, hTol: 1 };   // フレーム数・距離は整数にする
function aiForRate(rate) {
  var r = +rate || RATE_START, t = RATE_T[RATE_T.length - 1][1], i;
  if (r <= RATE_T[0][0]) t = RATE_T[0][1];
  else for (i = 1; i < RATE_T.length; i++) {
    if (r <= RATE_T[i][0]) { var p = RATE_T[i - 1], q = RATE_T[i]; t = p[1] + (q[1] - p[1]) * (r - p[0]) / (q[0] - p[0]); break; }
  }
  var j = Math.min(Math.floor(t), AI_ANCHORS.length - 2), f = t - j, cfg = {};
  for (var k = 0; k < AI_KEYS.length; k++) {
    var key = AI_KEYS[k], v = AI_ANCHORS[j][key] + (AI_ANCHORS[j + 1][key] - AI_ANCHORS[j][key]) * f;
    cfg[key] = AI_INT[key] ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  return cfg;
}
var CPU_LOADOUTS = [[2, 3, 1], [4, 6, 3], [5, 8, 11], [7, 4, 10], [9, 2, 1], [6, 5, 3], [8, 11, 4], [7, 10, 5], [2, 6, 1], [3, 8, 5],
  [6, 3, 12], [7, 2, 13], [4, 8, 14], [9, 11, 12], [2, 5, 13], [3, 6, 14]];
function cpuLoadout(rnd) { var r = rnd || Math.random; return CPU_LOADOUTS[Math.floor(r() * CPU_LOADOUTS.length)].slice(); }
// 鬼帝の武器：どの相手にも強かった組み合わせ（リボルバー・SMG・ナイフ／SMG・ナイフ・レールガン／ピストル・AR・ナイフ）から選ぶ
var EMPEROR_LOADOUTS = [[8, 4, 1], [4, 1, 11], [2, 6, 1]];
function emperorLoadout(rnd) { var r = rnd || Math.random; return EMPEROR_LOADOUTS[Math.floor(r() * EMPEROR_LOADOUTS.length)].slice(); }

// ---- 足場のつながり（どこからどこへ移れるか）----
function buildNav(w) {
  var raw = [], nodes = [], i, j;
  w.plats.forEach(function (p) { raw.push({ x1: p.x, x2: p.x + p.w, y: p.y, solid: false }); });
  w.solids.forEach(function (s) { raw.push({ x1: s.x, x2: s.x + s.w, y: s.y, solid: true }); });
  // 足場の上に背の高い遮蔽物（段差より高いもの）が乗っていたら、その左右で別の足場に分ける。
  // 歩いては通れないので、上に乗って越えるしかないことを CPU が分かるようにする
  raw.forEach(function (r, ri) {
    var cuts = [];
    w.solids.forEach(function (sd) {
      if (Math.abs(sd.y + sd.h - r.y) <= 2 && sd.h > 8 && sd.x < r.x2 && sd.x + sd.w > r.x1) cuts.push([sd.x, sd.x + sd.w]);
    });
    cuts.sort(function (a, b) { return a[0] - b[0]; });
    var x = r.x1, wallL = false;
    var seg = function (a, b, wl, wr) {
      var lo = wl ? a : Math.max(0, a - CHAR_W + 4), hi = wr ? b - CHAR_W : Math.min(WORLD_W - CHAR_W, b - 4);
      if (hi >= lo) nodes.push({ x1: a, x2: b, y: r.y, solid: r.solid, lo: lo, hi: hi, wallL: wl, wallR: wr, from: ri });
    };
    cuts.forEach(function (c) { if (c[0] > x) seg(x, c[0], wallL, true); x = Math.max(x, c[1]); wallL = true; });
    if (x < r.x2) seg(x, r.x2, wallL, false);
  });
  nodes.raw = raw;
  // 立って待つ場所は、下が穴になっている端から少し内側まで（端ぎりぎりに立つと、止まるときのすべりで落ちる）
  var floorAt = function (x, y) { return raw.some(function (r) { return x + CHAR_W > r.x1 && x < r.x2 && r.y >= y - 2; }); };
  nodes.forEach(function (n) {
    var mid = (n.lo + n.hi) / 2;
    n.slo = !n.wallL && !floorAt(n.lo - 8, n.y) ? Math.min(n.lo + 12, mid) : n.lo;
    n.shi = !n.wallR && !floorAt(n.hi + 8, n.y) ? Math.max(n.hi - 12, mid) : n.hi;
  });
  for (i = 0; i < nodes.length; i++) nodes[i].id = i;
  for (i = 0; i < nodes.length; i++) {
    nodes[i].out = [];
    for (j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      if (nodes[i].from === nodes[j].from) continue;   // 同じ床を遮蔽物で分けたもの同士は、上を越えてつながる
      var e = navLink(w, nodes[i], nodes[j]); if (e) nodes[i].out.push(e);
    }
  }
  return nodes;
}
function navLink(w, A, B) {
  var rise = A.y - B.y, gap = Math.max(B.lo - A.hi, A.lo - B.hi, 0), xs = [];
  if (rise > 4) {                                   // 上へ：跳んで乗る
    if (rise > 130 || gap > 60) return null;
    if (B.solid) {                                  // 遮蔽物の上には横から回り込んで乗る
      [B.x1 - CHAR_W - 3, B.x2 + 3].forEach(function (x) { if (x >= A.lo && x <= A.hi) xs.push(x); });
      if (!xs.length) xs.push(clamp((B.x1 + B.x2) / 2 - CHAR_W / 2, A.lo, A.hi));
    } else if (gap === 0) xs.push(clamp((Math.max(A.lo, B.lo) + Math.min(A.hi, B.hi)) / 2, A.lo, A.hi));
    else xs.push(B.lo > A.hi ? A.hi : A.lo);
    return { to: B, type: 'up', xs: xs };
  }
  if (rise < -4) {                                  // 下へ：端から降りる
    // 壁の側からは降りられない。降りる先の床がある側からだけ降りる（反対側へ落ちて、また登り直すのを防ぐ）
    if (!A.wallL && B.x1 < A.x1) xs.push(A.x1 - CHAR_W - 2);
    if (!A.wallR && B.x2 > A.x2) xs.push(A.x2 + 2);
    xs = xs.filter(function (x) { return x >= 0 && x <= WORLD_W - CHAR_W && x >= B.lo - 48 && x <= B.hi + 48; });   // 落ちながら横に寄せられるぶん広めに
    return xs.length ? { to: B, type: 'down', xs: xs } : null;
  }
  if (gap === 0) return { to: B, type: 'walk', xs: [clamp(B.lo > A.lo ? B.lo : B.hi, A.lo, A.hi)] };
  if (gap > 110) return null;                       // 同じ高さの離れた足場：助走して跳び移る
  return { to: B, type: 'leap', xs: [B.lo > A.hi ? A.hi : A.lo] };
}
// そのキャラが立っている（空中なら真下にある）足場
function nodeUnder(nav, c) {
  var best = null, feet = c.y + CHAR_H;
  for (var i = 0; i < nav.length; i++) {
    var n = nav[i];
    if (c.x + CHAR_W > n.x1 && c.x < n.x2 && n.y >= feet - 3 && (!best || n.y < best.y)) best = n;
  }
  return best;
}
// dir の方向に dist 進んだ先の下に、立てる足場があるか（なければ穴）
function pitAhead(nav, c, dir, dist) {
  var x = c.x + dir * dist, feet = c.y + CHAR_H, floors = nav.raw || nav;   // 穴かどうかは、分ける前の床で見る
  for (var i = 0; i < floors.length; i++) {
    var n = floors[i];
    if (x + CHAR_W > n.x1 && x < n.x2 && n.y >= feet - 2) return false;
  }
  return true;
}
function navPath(nav, from, isGoal) {
  if (!from) return null;
  if (isGoal(from)) return [];
  var prev = {}, seen = {}, q = [from];
  seen[from.id] = true;
  while (q.length) {
    var n = q.shift();
    for (var i = 0; i < n.out.length; i++) {
      var e = n.out[i], m = e.to;
      if (seen[m.id]) continue;
      seen[m.id] = true; prev[m.id] = { n: n, e: e };
      if (isGoal(m)) {
        var path = [e], k = n;
        while (k !== from) { var p = prev[k.id]; path.unshift(p.e); k = p.n; }
        return path;
      }
      q.push(m);
    }
  }
  return null;
}

// 空中で、これから d の向き（-1/0/1）に押し続けたら、どの足場に着地するか（physics と同じ当たり方）。null＝穴に落ちる
function landing(w, c, d) {
  var sp = SPEED * (weaponOf(c).move || 1) * (c.chg > 0 ? 0.4 : 1), x = c.x, y = c.y, vx = c.vx, vy = c.vy, i, s;
  for (var k = 0; k < 120; k++) {
    if (c.kbT - k > 0) vx *= 0.9; else if (d) vx = sp * d; else vx *= 0.5;
    vy += GRAVITY; x = clamp(x + vx, 0, WORLD_W - CHAR_W);
    var prevBot = y + CHAR_H; y += vy;
    var bot = y + CHAR_H;
    if (vy >= 0) {
      for (i = 0; i < w.plats.length; i++) { s = w.plats[i]; if (x + CHAR_W > s.x && x < s.x + s.w && prevBot <= s.y + 2 && bot >= s.y) return s; }
      for (i = 0; i < w.solids.length; i++) { s = w.solids[i]; if (x + CHAR_W > s.x && x < s.x + s.w && prevBot <= s.y + 2 && bot >= s.y) return s; }
    }
    if (y > VH + 50) return null;
  }
  return null;
}

// 振りかぶり・硬直のある近接武器やレールガンの溜めは、その間ほとんど動けない。
// 空中なら「何もしなくても足場に着地できる」、地上なら「すべっても端から落ちない」ときだけ使う
function canCommit(w, me) {
  if (!me.onGround) return !!landing(w, me, 0);
  var nav = w.nav || (w.nav = buildNav(w)), sd = me.vx > 0.1 ? 1 : me.vx < -0.1 ? -1 : 0;
  return !(sd && pitAhead(nav, me, sd, Math.abs(me.vx) * 2 + 2));
}

// 跳び移る先（または降りる先）の足場の上で、どこへ寄せるか。
// 足場の外なら内側へ。小さい足場は真ん中へ。大きい足場（地面など）は今の向きのまま少しだけ進む
// （大きい足場の真ん中へ戻ろうとすると、降りたばかりの段にまた戻って往復してしまう）
function airTarget(A, me) {
  var lo = A.lo, hi = A.hi, inset = Math.min(10, (hi - lo) / 2);
  if (me.x < lo + inset) return lo + inset;
  if (me.x > hi - inset) return hi - inset;
  if (hi - lo < 90) return (lo + hi) / 2;
  var d = me.vx > 0.3 ? 1 : me.vx < -0.3 ? -1 : 0;
  return clamp(me.x + d * 12, lo + inset, hi - inset);
}

// level は 'normal' のような段階の名前か、aiForRate が作った数値の組
function newBrain(level, rnd) {
  return { cfg: (level && typeof level === 'object') ? level : (AI_LEVELS[level] || AI_LEVELS.normal), rnd: rnd || Math.random, moveT: 999, jumpT: 0, duckT: 0,
    wait: -1, spray: 0, seen: {}, seenN: 0, seenChg: false, dodgeCd: 0, meleeOk: false, wantSlot: 0, weaponT: 0,
    node: null, edge: null, air: null, goalX: null, strafeT: 0, strafeOff: 0, lastX: -1, stuckT: 0, evadeT: 0, evadeDir: 0, evadeGren: false, evadeJump: 0, mode: 'fight',
    prefer: 0, preferW: 0, preferUntil: 0, coverUntil: 0, rlSeen: false, lowSeen: false, walkDir: 0, holdT: 0,
    tac: 'fight', tacT: 0, tacT0: 20, preferTac: '', blockedT: 0, aggr: false, lapseT: 0, lapses: 0, lastInp: null };
}

// その足場の上で、相手との距離が lo〜hi になる位置（prefer の距離に近いほどよい。自分のいる側を優先）
function standX(node, me, op, lo, hi, prefer) {
  var ox = op.x, mySide = me.x <= ox ? -1 : 1, best = null, bestS = 1e9;
  for (var k = 0; k < 2; k++) {
    var side = k === 0 ? mySide : -mySide;
    var a = side < 0 ? ox - hi : ox + lo, z = side < 0 ? ox - lo : ox + hi;
    a = Math.max(a, node.slo); z = Math.min(z, node.shi);
    if (a > z) continue;
    var x = clamp(ox + side * prefer, a, z);
    var sc = Math.abs(x - me.x) + (k === 0 ? 0 : 220);
    if (sc < bestS) { bestS = sc; best = x; }
  }
  return best;
}
// グレネードが相手の高さに落ちるまでの横の距離（drop = 相手の足場が自分より何px低いか）
function grenadeReach(drop, vx) {
  var y = 0, vy = GREN_VY, x = 14;
  for (var i = 0; i < GREN_LIFE; i++) { vy += GREN_G; x += vx; y += vy; if (vy > 0 && y >= 28 + drop) return x; }
  return null;
}
// その位置と相手のあいだに弾を止める遮蔽物があるか
function coverBetween(w, node, x, op) {
  for (var i = 0; i < w.solids.length; i++) {
    var s = w.solids[i];
    if (s.y + s.h < node.y - 2 || s.y > node.y - 30) continue;   // 同じ地面に立っていて、しゃがまなくても隠れる高さ
    if ((s.x >= x + CHAR_W && s.x + s.w <= op.x) || (s.x + s.w <= x && s.x >= op.x + CHAR_W)) return s;
  }
  return null;
}

function plan(b, w, me, op, W) {
  var nav = w.nav || (w.nav = buildNav(w)), R = b.rnd, cfg = b.cfg;
  var myNode = me.onGround ? nodeUnder(nav, me) : null;
  if (myNode) b.node = myNode;
  if (!b.node) b.node = nodeUnder(nav, me);
  var opNode = nodeUnder(nav, op);
  if (!b.node || !opNode) { b.edge = null; b.goalX = null; return; }
  var band = W.band, goalX = {};
  // リロード中や体力が少ないときは、弾の届かない場所（高さの違う足場・遮蔽物の裏）へ。
  // 隠れるかどうかは、リロードを始めたとき・体力が減ったときに一度だけ決めて、終わるまで変えない
  // （計画のたびにくじを引くと「近づく」「離れる」が交互に選ばれて、その場で往復してしまう）
  if (me.rl > 50 && !b.rlSeen) { b.rlSeen = true; if (R() < cfg.cover) b.coverUntil = w.frame + me.rl; }
  if (me.rl <= 0) b.rlSeen = false;
  if (me.hp <= 40 && me.healUsed && !b.lowSeen) { b.lowSeen = true; if (R() < cfg.cover * 0.5) b.coverUntil = w.frame + 240; }
  var cover = w.frame < b.coverUntil || b.tac === 'retreat' || b.tac === 'reload';
  b.mode = cover ? 'cover' : 'fight';
  band = tacBand(b, W, op);
  var isGoal;
  if (cover) {
    isGoal = function (n) {
      if (Math.abs(n.y - opNode.y) > 40) {
        var x = clamp(me.x, n.slo, n.shi);
        if (Math.abs(x - op.x) > 60) { goalX[n.id] = x; return true; }
        return false;
      }
      if (Math.abs(n.y - opNode.y) > 6) return false;
      for (var i = 0; i < w.solids.length; i++) {
        var s = w.solids[i];
        if (s.y > n.y - 30 || s.y + s.h < n.y - 2) continue;
        var x2 = op.x > s.x ? s.x - CHAR_W - 3 : s.x + s.w + 3;
        if (x2 >= n.slo && x2 <= n.shi && coverBetween(w, n, x2, op)) { goalX[n.id] = x2; return true; }
      }
      return false;
    };
  } else if (W.kind === 'grenade') {
    isGoal = function (n) {                         // 投げた弾が相手の高さに落ちる距離に立つ
      var drop = opNode.y - n.y;
      if (drop < -40) return false;
      var r0 = grenadeReach(drop, W.spd), r1 = grenadeReach(drop, W.spd + SPEED * 0.5);
      if (r0 === null || r1 === null) return false;
      var x = standX(n, me, op, r0 - 26, r1 + 26, (r0 + r1) / 2);
      if (x === null) return false;
      goalX[n.id] = x; return true;
    };
  } else {
    if (b.preferW !== W.id || b.preferTac !== b.tac || w.frame >= b.preferUntil) {   // 立ちたい距離は数秒ごと（か戦術が変わったとき）にだけ選び直す
      b.prefer = band[0] + (band[1] - band[0]) * (0.3 + 0.4 * R());
      b.preferW = W.id; b.preferTac = b.tac; b.preferUntil = w.frame + 150 + Math.floor(R() * 150);
    }
    var prefer = b.prefer;
    var flank = b.tac === 'flank';
    isGoal = function (n) {                         // 同じ高さで、武器に合う距離（回り込むときは、間に遮蔽物がない所）
      if (Math.abs(n.y - opNode.y) > 6) return false;
      var x = standX(n, me, op, band[0], band[1], prefer);
      if (x === null) return false;
      if (flank && coverBetween(w, n, x, op)) return false;
      goalX[n.id] = x; return true;
    };
  }
  var path = navPath(nav, b.node, isGoal);
  if (!path && !cover) {                            // 合う距離がとれない（狭い足場など）：同じ高さなら近くても撃ち合いに行く
    var reach = W.kind === 'melee' ? W.range - 8 : W.kind === 'grenade' ? 240 : W.range * 0.9;
    isGoal = function (n) {
      if (Math.abs(n.y - opNode.y) > 6) return false;
      var x = standX(n, me, op, W.kind === 'melee' ? 0 : 36, reach, Math.min(reach, (band[0] + band[1]) / 2));
      if (x === null) return false;
      goalX[n.id] = x; return true;
    };
    path = navPath(nav, b.node, isGoal);
  }
  if (!path) {                                      // 行ける場所がなければ、今の足場の上で距離だけ合わせる
    b.edge = null;
    var dx = op.x - me.x, dist = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
    var want = dist > band[1] ? me.x + dir * 60 : dist < band[0] ? me.x - dir * 60 : me.x;
    b.goalX = clamp(want, b.node.slo, b.node.shi);
    return;
  }
  if (!path.length) { b.edge = null; b.goalX = goalX[b.node.id]; return; }
  var e = path[0];
  b.edge = e; b.goalX = null;
  b.edgeX = e.xs.reduce(function (a, x) { return Math.abs(x - me.x) < Math.abs(a - me.x) ? x : a; }, e.xs[0]);
}

function predictGrenade(w, me, dir, W, press) {
  var x = me.x + CHAR_W / 2 + dir * 14, y = muzzleY(me) - 6;
  var vx = W.spd * dir + (press ? SPEED * (W.move || 1) * dir : me.vx * 0.5) * 0.5, vy = GREN_VY;
  for (var i = 0; i < GREN_LIFE; i++) {
    var py = y; vy += GREN_G; x += vx; y += vy;
    if (y > VH) return null;
    if (x < 0 || x > WORLD_W) return { x: clamp(x, 0, WORLD_W), y: y, t: i };
    if (blockAt(w, x, y)) return { x: x, y: y, t: i };
    if (vy > 0) {
      for (var j = 0; j < w.plats.length; j++) {
        var p = w.plats[j];
        if (x >= p.x && x <= p.x + p.w && py <= p.y && y >= p.y) return { x: x, y: p.y, t: i };
      }
    }
  }
  return { x: x, y: y, t: GREN_LIFE };
}

// ---- 鬼帝のよけ方 ----
// 自分がこれからどう動くか（jumpAt フレーム後に跳ぶ／跳ばない=-1、しゃがむか）を決めたとき、
// 飛んでくる弾がどれだけ当たるか（ダメージの合計）を、1フレームずつ先まで計算する。当たり方は stepShots と同じ
function bossHits(w, me, side, jumpAt, duck, react) {
  var total = 0, gy = me.onGround ? me.y : null, K = 50;
  for (var i = 0; i < w.shots.length; i++) {
    var sh = w.shots[i];
    if (mine(w, side, sh.own) || sh.k === 'g' || sh.age < react) continue;
    if (sign(sh.vx) !== sign(me.x + CHAR_W / 2 - sh.x) || Math.abs(sh.x - me.x) > 600) continue;
    var y = me.y, vy = me.onGround ? 0 : me.vy, ground = me.onGround, bx = sh.x, by = sh.y, dist = sh.dist;
    for (var k = 1; k <= K; k++) {
      if (k - 1 === jumpAt && ground) { vy = JUMP_F; ground = false; }
      if (!ground) { vy += GRAVITY; y += vy; if (gy !== null && vy > 0 && y >= gy) { y = gy; vy = 0; ground = true; } }
      bx += sh.vx; by += sh.vy; dist += Math.abs(sh.vx);
      if (dist > sh.range || blockAt(w, bx, by)) break;
      var top = duck ? y + (CHAR_H - DUCK_H) : y, h = duck ? DUCK_H : CHAR_H;
      if (bx > me.x - 6 && bx < me.x + CHAR_W + 6 && by > top - 4 && by < top + h + 4) {
        total += sh.k === 'p' ? Math.max(1, Math.round(sh.dmg * (1 - 0.5 * dist / sh.range))) : sh.dmg;
        break;
      }
    }
  }
  return total;
}
// レールガンの溜め：撃たれる瞬間（op.chg フレーム後）に、ビームの高さに自分の体があるか
function beamHitsMe(op, me, jumpNow) {
  if (op.chg <= 0) return false;
  var W = weaponOf(op), x1 = op.bx, dir = op.bdir || op.dir, tc = me.x + CHAR_W / 2;
  if ((tc - x1) * dir < -10 || Math.abs(tc - x1) > W.range) return false;
  var y = me.y, vy = me.onGround ? (jumpNow ? JUMP_F : 0) : me.vy, ground = me.onGround && !jumpNow, gy = me.onGround ? me.y : null;
  for (var k = 0; k < op.chg; k++) if (!ground) { vy += GRAVITY; y += vy; if (gy !== null && vy > 0 && y >= gy) { y = gy; vy = 0; ground = true; } }
  var top = y, h = CHAR_H;
  return op.by > top - 4 && op.by < top + h + 4;
}
// 弾を見てから判断するまでに react フレームかかる（見えていない弾は計算に入れない）。
// 何もしなければ当たるなら、跳ぶ・しゃがむのうち一番当たらない方を選ぶ。跳ぶのは「今跳ばないと間に合わない」瞬間まで待つ
function bossDodge(b, w, me, op, side, inp) {
  if (b.dodgeCd > 0) return;
  var seenAny = false;
  for (var i = 0; i < w.shots.length; i++) { var sh = w.shots[i]; if (!mine(w, side, sh.own) && sh.k !== 'g' && sh.age >= b.cfg.react) { seenAny = true; break; } }
  if (seenAny) {
    var rc = b.cfg.react, base = bossHits(w, me, side, -1, false, rc);
    if (base > 0) {
      var duck = bossHits(w, me, side, -1, true, rc);
      if (me.onGround) {
        var now = bossHits(w, me, side, 0, false, rc), later = bossHits(w, me, side, 3, false, rc);
        if (now < base && now <= duck && now < later) { inp.jump = true; b.duckT = 0; b.dodgeCd = 2; return; }
        if (duck < base && duck <= now) { b.duckT = 6; return; }
      } else if (duck < base) { b.duckT = 4; return; }
    }
  }
  if (op.chg > 0 && me.onGround && beamHitsMe(op, me, false) && !beamHitsMe(op, me, true)) { inp.jump = true; b.dodgeCd = 2; return; }
  // 振りかぶり（槍・ハンマー）：当たる瞬間に高さが 40 以上離れていれば当たらない。4フレームあれば跳んで間に合う
  var mW = weaponOf(op);
  if (op.swT >= 4 && mW.kind === 'melee' && me.onGround && Math.abs(op.y - me.y) < 40 &&
      Math.abs(me.x - op.x) <= mW.range + 10 && sign(me.x - op.x) === op.dir) { inp.jump = true; b.dodgeCd = 2; }
}

// 飛んでいるグレネードが、どこで爆発するかを最後までたどる（当たり方は stepGrenade と同じ）。
// f=何フレーム後か、direct=me に直接ぶつかる。null=穴に落ちて消える
function grenadePath(w, sh, me) {
  var x = sh.x, y = sh.y, vx = sh.vx, vy = sh.vy, life = Math.min(sh.life, 180), i, j, p, py;
  for (i = 1; i <= life; i++) {
    py = y; vy += GREN_G; x += vx; y += vy;
    if (y > VH + 30) return null;
    if (x < 0 || x > WORLD_W) return { x: clamp(x, 0, WORLD_W), y: y, f: i };
    if (me && !me.dead && x > me.x - 4 && x < me.x + CHAR_W + 4 && inBoxY(y, me)) return { x: x, y: y, f: i, direct: true };
    if (vy > 0) {
      for (j = 0; j < w.plats.length; j++) {
        p = w.plats[j];
        if (x >= p.x && x <= p.x + p.w && py <= p.y && y >= p.y) return { x: x, y: p.y, f: i };
      }
    }
    if (blockAt(w, x, y)) return { x: x, y: y, f: i };
  }
  return { x: x, y: y, f: i };
}
// 爆発の中心から、その人の体までの距離（explode と同じ測り方）。これが splash より大きければ無傷
function blastDist(x, y, c) {
  var nx = clamp(x, c.x, c.x + CHAR_W), ny = clamp(y, boxTop(c), c.y + CHAR_H);
  return Math.sqrt((x - nx) * (x - nx) + (y - ny) * (y - ny));
}
// 爆発からの逃げ方を決める：爆風の外まで走る。走っても間に合わない／逃げ場がないときは跳ぶ
// （足元で爆発しても、跳んで体を離せば爆風は届かない）
function evadeBlast(b, w, me, lp, need) {
  var nav = w.nav || (w.nav = buildNav(w)), node = b.node || nodeUnder(nav, me);
  var lo = node ? node.lo : 0, hi = node ? node.hi : WORLD_W - CHAR_W;
  var dir = me.x + CHAR_W / 2 <= lp.x ? -1 : 1;
  var room = function (d) { return d < 0 ? me.x - lo : hi - me.x; };
  if (room(dir) < need && room(-dir) > room(dir) + 20) dir = -dir;   // 逃げ場がない側なら、相手のいる側でも反対へ
  var runT = need / SPEED;                                           // 走って逃げ切るのにかかるフレーム
  b.evadeDir = dir; b.evadeGren = true;
  b.evadeT = clamp(Math.ceil(runT) + 8, 12, 45);
  b.evadeJump = (room(dir) < need || lp.f < runT) ? w.frame + Math.max(0, lp.f - 10) : 0;
}

// ---- 戦術：状況を見て「どう戦うか」を選ぶ（数百ミリ秒ごと。選んだらしばらく続けて、細かく揺れないようにする）----
// 判断の材料：両者の体力、両者の武器の得意な距離、相手のリロード・弾切れ、自分の弾、遮蔽物と高さ
function decideTactic(b, w, me, op, dist, dy) {
  var cfg = b.cfg, R = b.rnd;
  var W = weaponOf(me), opW = WEAPONS[op.load[op.slot]];
  var myEmpty = W.mag > 0 && me.ammo[me.slot] <= 0;
  var myLow = W.mag > 2 && me.ammo[me.slot] <= Math.ceil(W.mag * 0.25);
  var opReloading = op.rl > 20, opEmpty = opW.mag > 0 && op.ammo[op.slot] <= 0 && op.rl <= 0;
  var spare = false;                                   // 弾のある別の武器（ナイフ等も含む）を持っているか
  for (var k = 0; k < 3; k++) if (k !== me.slot) { var Wk = WEAPONS[me.load[k]]; if (Wk.mag === 0 || me.ammo[k] > 0) spare = true; }
  var opShort = opW.kind === 'melee' || opW.kind === 'pellet';
  var myFar = W.kind !== 'melee' && W.kind !== 'pellet' && W.band[1] >= 160;
  var sameLevel = dy < 30, blocked = sameLevel && W.kind !== 'beam' && W.kind !== 'grenade' && blockedLine(w, me.x + CHAR_W / 2, op.x + CHAR_W / 2, muzzleY(me));
  b.blockedT = blocked ? b.blockedT + b.tacT0 : 0;
  var sc = { fight: 1.0, push: 0, kite: 0, retreat: 0, reload: 0, flank: 0 };
  var shortMe = W.kind === 'melee' || W.kind === 'pellet', needClose = dist > W.band[1] + 20;
  // 相手が撃てない間・弱っているときは、迷わず撃つ（攻め気）
  b.aggr = opReloading || opEmpty || op.hp <= 30;
  // 詰めて倒しにいく：自分が近い武器か、今の距離が遠すぎるときだけ（近距離武器の相手に自分から近づかない）
  if (op.hp <= 30 && (shortMe || needClose) && !(opShort && !shortMe)) sc.push += 1.3;
  if ((opReloading || opEmpty) && (shortMe || needClose)) sc.push += 1.6;
  if (me.hp > op.hp + 30 && (shortMe || needClose) && !(opShort && !shortMe)) sc.push += 0.5;
  // 自分の体力が少ない → 下がって隠れる。ただし近距離武器で迫ってくる相手には、背を向けずに撃ち合う
  if (me.hp <= 35 && !(opShort && dist < 240)) sc.retreat += 1.2 + (op.hp > me.hp ? 0.6 : 0) + (me.healUsed ? 0 : 0.4);
  // 弾切れで、持ち替えられる武器もない → 安全な所でリロード。残りわずかで離れているときも
  if (myEmpty && !spare) sc.reload += 2.2;
  else if (myLow && (dist > 260 || dy > 40)) sc.reload += 0.9;
  // 相手が近距離の武器（ナイフ・ショットガン等）で、自分は離れて戦える → 近づかせない
  if (opShort && myFar) sc.kite += 1.3 + (dist < 140 ? 0.5 : 0);
  // 同じ高さなのに遮蔽物で撃てない状態が続いている → 回り込む
  if (b.blockedT > 60) sc.flank += 1.4;
  // 判断の正確さ：賢くないほど、別の手を選んでしまうことがある
  var best = 'fight', bestS = -1e9;
  for (var key in sc) { var v = sc[key] + (1 - cfg.smart) * R() * 1.8; if (v > bestS) { bestS = v; best = key; } }
  b.tac = best;
  b.tacT0 = Math.round(18 + (1 - cfg.smart) * 30 + R() * 12);   // 0.3〜1秒ほど、この戦術を続ける
  b.tacT = b.tacT0;
}
// 相手が持ち替えられる武器（3つ）のうち、近づかれると危ないもの（近接・散弾）が届く距離。なければ 0
function shortThreat(op) {
  var t = 0;
  for (var k = 0; k < 3; k++) { var Wk = WEAPONS[op.load[k]]; if (Wk.kind === 'melee') t = Math.max(t, Wk.range + 64); else if (Wk.kind === 'pellet') t = Math.max(t, Wk.range + 36); }
  return t;
}
// 戦術に合わせて、立ちたい距離の範囲を変える
function tacBand(b, W, op) {
  var lo = W.band[0], hi = W.band[1];
  // 鬼帝：自分が離れて撃てる武器なら、相手の近接・散弾（持ち替え先も含む）が届く距離には入らない
  if (b.cfg.boss && W.kind !== 'melee' && W.kind !== 'pellet') {
    var th = shortThreat(op);
    if (th > lo) { lo = Math.min(th, W.range * 0.8); hi = Math.max(hi, Math.min(lo + 60, W.range * 0.95)); }
  }
  if (b.tac === 'push') { hi = lo + (hi - lo) * 0.45; lo = W.kind === 'melee' ? 0 : Math.max(24, lo * 0.7); }
  else if (b.tac === 'kite') {
    var opW = WEAPONS[op.load[op.slot]], keep = (opW.kind === 'melee' ? opW.range : opW.range * 0.75) + 70;
    lo = Math.max(lo, keep); hi = Math.min(Math.max(hi, lo + 90), W.range * 0.95);
    if (lo > hi) lo = Math.max(W.band[0], hi - 40);
  }
  return [lo, hi];
}
// 相手が今から t フレーム後にいる高さ（空中なら、落ちてくる先まで読む）
function predictTopY(w, c, t) {
  if (c.onGround || t <= 0) return c.y;
  var y = c.y, vy = c.vy, floor = GND;
  for (var i = 0; i < w.plats.length; i++) {
    var p = w.plats[i];
    if (c.x + CHAR_W > p.x && c.x < p.x + p.w && p.y >= c.y + CHAR_H - 2 && p.y < floor) floor = p.y;
  }
  for (var k = 0; k < t && k < 90; k++) { vy += GRAVITY; y += vy; if (vy > 0 && y + CHAR_H >= floor) return floor - CHAR_H; }
  return y;
}

// 今撃てば当たりそうか
function aimOk(b, w, me, op, W, dist, dy, toOp) {
  var cfg = b.cfg;
  if (W.kind === 'melee') {                         // 届く距離でも、低いレベルほど空振りする（タイミングを外す）
    if (dist > W.range + 24 || Math.abs(op.y - me.y) >= 36) return false;
    if (dist > W.range - 6) return b.rnd() < cfg.whiff * 0.15;
    return true;
  }
  if (W.kind === 'grenade') {
    var R = W.splash * 0.7, oc = op.y + CHAR_H / 2;
    for (var k = 0; k < 2; k++) {
      var p = predictGrenade(w, me, toOp, W, k === 1);
      var lead = cfg.boss && p ? clamp(op.vx * p.t * 0.7, -90, 90) : 0;   // 鬼帝：落ちるまでに相手が歩いて動く先を読む
      if (p && Math.abs(p.x - (op.x + CHAR_W / 2 + lead)) < R && Math.abs(p.y - oc) < 40) return k === 1 ? 'press' : true;
    }
    return false;
  }
  if (dist > W.range * (W.kind === 'pellet' ? 0.85 : 0.95)) return false;
  if (cfg.boss && W.kind === 'beam') {
    // 鬼帝のレールガン：溜め終わる瞬間（W.charge フレーム後）に、相手の体がビームの高さにあるかを読む
    var bt = predictTopY(w, op, W.charge), btop = bt + (op.ducking ? CHAR_H - DUCK_H : 0), by0 = muzzleY(me);
    if (by0 < btop - 4 || by0 > bt + CHAR_H + 4) return false;
  } else if (cfg.smart >= 0.85 && W.kind !== 'beam' && W.spd > 0) {
    // 読み撃ち：弾が届くまでの間に相手がどこへ動くか（ジャンプの落ち先）を読んで、届く高さなら撃つ
    var tt = Math.round(dist / W.spd), py = predictTopY(w, op, tt), top = py + (op.ducking ? CHAR_H - DUCK_H : 0);
    var myY = muzzleY(me);
    if (myY < top - 4 || myY > py + CHAR_H + 4) return false;
  } else if (dy > cfg.hTol) return false;
  if (W.kind !== 'beam' && blockedLine(w, me.x + CHAR_W / 2, op.x + CHAR_W / 2, muzzleY(me))) return false;
  return true;
}

// チーム戦：ねらう相手を決める。今の相手より 90 以上近い敵がいるときだけ乗りかえる
function pickFoe(b, w, side, me) {
  var list = foes(w, side), cur = b.foe ? w.chars[b.foe] : null, best = null, bd = 1e9;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c.dead) continue;
    var d = Math.abs(c.x - me.x) + Math.abs(c.y - me.y) * 1.5 - (c === cur ? 90 : 0);
    if (d < bd) { bd = d; best = c; }
  }
  b.foe = best ? best.side : null;
  return best;
}
function mine(w, side, own) { return own === side || (w.teams && teamOf(own) === teamOf(side)); }   // 自分か味方の弾
function think(b, w, side) {
  var cfg = b.cfg, R = b.rnd, me = w.chars[side], op = w.teams ? pickFoe(b, w, side, me) : w.chars[other(side)];
  if (!op) return { left: false, right: false, duck: false, fire: false, slot: b.wantSlot };
  var inp = { left: false, right: false, duck: false, fire: false, slot: b.wantSlot };
  if (me.dead || op.dead) return inp;
  // 鬼帝：ごくまれに判断が遅れる瞬間がある（その間は新しい判断をせず、それまでの歩きを続けるだけ。撃たない・よけない）
  if (cfg.lapse) {
    if (b.lapseT <= 0 && R() < cfg.lapse) { b.lapseT = cfg.lapseLen; b.lapses++; }
    if (b.lapseT > 0) {
      b.lapseT--;
      var li = b.lastInp || inp, nv = w.nav || (w.nav = buildNav(w));
      inp.left = !!li.left; inp.right = !!li.right;
      var d0 = inp.left ? -1 : inp.right ? 1 : 0;
      if (d0 && me.onGround && pitAhead(nv, me, d0, 40)) { inp.left = false; inp.right = false; }   // 穴の近くでは足を止める（落ちるほどの失敗はしない）
      keepFooting(b, w, me, inp);
      return inp;
    }
  }
  var mx = me.x + CHAR_W / 2, ox = op.x + CHAR_W / 2, dx = ox - mx, dist = Math.abs(dx), toOp = dx >= 0 ? 1 : -1;
  var dy = Math.abs((me.y + CHAR_H / 2) - (op.y + CHAR_H / 2));

  // 回復：体力が少なくなってから
  if (!me.healUsed && me.hp <= cfg.hpT && R() < 1 - Math.pow(1 - cfg.hCh, 1 / 60)) inp.heal = true;

  // 武器：距離に合うものへ持ち替える
  if (--b.weaponT <= 0 && me.burst <= 0 && me.chg <= 0 && b.spray <= 0) {
    b.weaponT = 18 + Math.floor(R() * 24);
    b.meleeOk = R() < cfg.melee;
    if (R() < cfg.smart) {
      var best = me.slot, bestS = -1e9;
      for (var s = 0; s < 3; s++) {
        var Ws = WEAPONS[me.load[s]], band = Ws.band, sc;
        sc = dist < band[0] ? -(band[0] - dist) / 60 : dist > band[1] ? -(dist - band[1]) / 100 : 2;
        if (Ws.kind === 'melee' && (dist > Ws.range + 30 || !b.meleeOk)) sc -= 3;
        if (Ws.kind === 'grenade') sc += dy > 40 ? 1.5 : -0.7;   // グレネードは段差ごしに強い。同じ高さなら他の武器を優先
        if (Ws.mag > 0 && me.ammo[s] <= 0) sc -= 1.5;
        if (s === me.slot) sc += 0.3;
        if (sc > bestS) { bestS = sc; best = s; }
      }
      b.wantSlot = best;
    }
    inp.slot = b.wantSlot;
  }
  var W = weaponOf(me), opW = WEAPONS[op.load[op.slot]];
  // 戦術を決め直す（決めたらしばらく続ける）
  if (--b.tacT <= 0) decideTactic(b, w, me, op, dist, dy);
  // リロード：弾が切れたら（撃てないので）すぐ。残りが少ないときは、安全なうちに（賢いCPUほど）
  if (W.mag > 0 && me.ammo[me.slot] < W.mag && me.rl <= 0 && me.burst <= 0 && me.chg <= 0 && b.spray <= 0) {
    var threat = (opW.kind === 'melee' || opW.kind === 'pellet') ? 360 : opW.range + 80;   // 突っ込んでくる武器は遠くても危ない
    var safe = dy > 40 || dist > threat || b.tac === 'reload';
    if (me.ammo[me.slot] <= 0) inp.reload = true;
    else if (safe && W.mag > 2 && me.ammo[me.slot] <= W.mag * 0.5 && R() < cfg.smart * 0.05) inp.reload = true;
  }
  // 下がっているとき：体力が少なく、回復が残っていれば、弾の届かない所で使う
  if (b.tac === 'retreat' && !me.healUsed && me.hp <= 55 && (dy > 40 || dist > 300) && R() < cfg.hCh * 0.08) inp.heal = true;

  // 回避：向かってくる弾・溜め中のレールガン・近くに落ちるグレネード
  if (b.seenN > 60) { b.seen = {}; b.seenN = 0; }
  if (b.dodgeCd > 0) b.dodgeCd--;
  for (var i = 0; i < w.shots.length && b.dodgeCd <= 0; i++) {
    var sh = w.shots[i];
    if (mine(w, side, sh.own) || sh.age < cfg.react || b.seen[sh.sid]) continue;
    if (sh.k === 'g') {
      // グレネードは弧を描いて飛び、落ちた場所で爆発する。上りも下りも含めて最後までたどり、
      // 爆風（splash）が自分に届くかどうかで決める。まだ危なくない弾は覚えず、近づいたらまた見る
      if (Math.abs(sh.x - mx) > 420) continue;
      var lp = grenadePath(w, sh, me);
      if (!lp) continue;
      var sp = sh.splash || 55, need = sp + 14 - blastDist(lp.x, lp.y, me);   // あと何px離れれば爆風の外か
      if (!lp.direct && need <= 0) continue;
      b.seen[sh.sid] = 1; b.seenN++; b.dodgeCd = cfg.react;
      // 爆発は見てすぐ分かるので、弾より少し気づきやすい（レベルの差はそのまま残す）
      if (R() < Math.min(1, cfg.dodge * 1.25 + 0.1)) evadeBlast(b, w, me, lp, Math.max(need, 30));
      continue;
    }
    if (cfg.boss) continue;                          // 鬼帝は下の bossDodge で、届く瞬間を計算してよける
    if (Math.abs(sh.y - (me.y + CHAR_H / 2)) < 30 && Math.abs(sh.x - mx) < cfg.see && sign(sh.vx) === sign(mx - sh.x)) {
      b.seen[sh.sid] = 1; b.seenN++; b.dodgeCd = cfg.react;   // 判断したら、次の判断まで反応時間ぶん空く
      if (R() < cfg.dodge) {
        if (me.onGround) inp.jump = true;
        else if (sh.y < me.y + 12) b.duckT = 14;
      }
    }
  }
  // 撃たれそうな瞬間：同じ高さで相手がこちらを向き、今すぐ撃てる → ときどき跳んで射線を外す（賢いCPUほど）
  if (cfg.boss) bossDodge(b, w, me, op, side, inp);
  var opWn = WEAPONS[op.load[op.slot]];
  if (cfg.smart >= 0.85 && !cfg.boss && me.onGround && dy < 26 && op.dir === -toOp && canFire(op) && opWn.kind !== 'melee' &&
      dist < opWn.range && dist > 60 && b.dodgeCd <= 0 && R() < 0.035 * cfg.dodge) { inp.jump = true; b.dodgeCd = cfg.react; }
  if (op.chg > 0) {
    if (!b.seenChg && !cfg.boss && op.chg <= 14 && dy < 30 && op.dir === -toOp) {
      b.seenChg = true;
      if (R() < cfg.dodge && me.onGround) inp.jump = true;
    }
  } else b.seenChg = false;

  // 動き
  if (++b.moveT >= cfg.mvI || (b.air && me.onGround)) {
    b.moveT = 0;
    if (me.onGround) b.air = null;
    if (!b.air) plan(b, w, me, op, W);
  }
  // 撃ち合いの距離での小さな横移動は、1〜2秒ごとに左右を入れかえるだけ（細かく向きを変えない）
  if (--b.strafeT <= 0) {
    b.strafeT = 60 + Math.floor(R() * 60);
    b.strafeOff = R() < cfg.strafe ? (b.strafeOff > 0 ? -1 : 1) * (14 + R() * 22) : 0;
  }
  var tx = null, jumpNow = false, loose = false;
  if (b.air) {                                      // 跳んだあと：乗りたい足場の上へ寄せる
    tx = airTarget(b.air, me);
  } else if (b.edge) {
    var e = b.edge;
    tx = b.edgeX;
    if (e.type === 'down') {                        // 端から歩いて降りる
      tx = b.edgeX + (b.node && b.edgeX < (b.node.x1 + b.node.x2) / 2 ? -8 : 8);
      if (!me.onGround) b.air = e.to;
    } else if (Math.abs(me.x - tx) <= 4 && me.onGround) {
      if (e.type === 'up' || e.type === 'leap') { jumpNow = true; b.air = e.to; }
      else { b.edge = null; b.moveT = 999; }
    }
  } else if (b.goalX !== null && b.goalX !== undefined) {
    tx = clamp(b.goalX + (b.mode === 'fight' ? b.strafeOff : 0), b.node ? b.node.slo : 0, b.node ? b.node.shi : WORLD_W - CHAR_W);
    loose = true;
  }
  if (b.evadeT > 0) { if (--b.evadeT <= 0) b.evadeGren = false; tx = me.x + b.evadeDir * 40; if (b.node) tx = clamp(tx, b.node.lo, b.node.hi); loose = false; }
  // 撃った直後は少しその場で構える（撃つ→背を向けて離れる→また振り向く、の往復を防ぐ）
  if (b.holdT > 0) { b.holdT--; if (loose && tx !== null && Math.abs(tx - me.x) < 70) tx = null; }
  if (tx !== null) {
    var off = tx - me.x;
    if (!loose) b.walkDir = off < -3 ? -1 : off > 3 ? 1 : 0;            // 足場の端・よける：ぴったり合わせる
    else if (b.walkDir === 0) { if (Math.abs(off) > 12) b.walkDir = off > 0 ? 1 : -1; }   // 立ち止まっていたら、少し離れてから歩き出す
    else if (off * b.walkDir <= 2) b.walkDir = off * b.walkDir < -28 ? -b.walkDir : 0;   // 行き過ぎたら止まる（大きくずれたときだけ引き返す）
    if (b.walkDir < 0) inp.left = true; else if (b.walkDir > 0) inp.right = true;
  } else b.walkDir = 0;
  if (jumpNow) inp.jump = true;
  // 爆発の少し前に踏み切る（跳び上がっていれば、足元で爆発しても爆風が届かない）
  if (b.evadeJump) {
    if (w.frame >= b.evadeJump) { if (me.onGround) { inp.jump = true; b.evadeJump = 0; } else if (w.frame > b.evadeJump + 24) b.evadeJump = 0; }
  }
  // 壁に引っかかったら跳ぶ
  var moving = inp.left || inp.right;
  if (moving && me.onGround && Math.abs(me.x - b.lastX) < 0.2) { if (++b.stuckT > 8) { inp.jump = true; b.stuckT = 0; } }
  else b.stuckT = 0;
  b.lastX = me.x;
  // たまに跳ぶ
  if (++b.jumpT > cfg.jumpF && me.onGround && b.spray <= 0) { if (R() < 0.4) inp.jump = true; b.jumpT = 0; }
  if (b.duckT > 0) { b.duckT--; inp.duck = true; }

  // 射撃
  var ready = canFire(me) && !b.evadeGren, faceOp = false, press = false;   // 爆風から逃げている間は撃たない（撃つと足が止まる）
  if (!ready) { if (me.cool > 0 || me.rl > 0 || me.chg > 0) b.wait = -1; }
  else if (b.wait < 0) b.wait = Math.round((cfg.wMin + Math.floor(R() * (cfg.wMax - cfg.wMin))) * (b.tac === 'push' || b.aggr ? 0.55 : 1));   // 詰めるとき・相手が撃てないときは、撃つまでの迷いが少ない
  if (b.spray > 0) {                                // 連射武器は少しのあいだ押し続ける
    if (me.rl <= 0 && !b.evadeGren && dy <= cfg.hTol && dist <= W.range) { b.spray--; inp.fire = true; faceOp = true; }
    else b.spray = 0;
  }
  // ナイフで詰めてくる相手には迷わず撃つ
  if (ready && b.wait > 3 && WEAPONS[op.load[op.slot]].kind === 'melee' && dist < 160) b.wait = 3;
  if (ready && b.wait >= 0) {
    if (b.wait > 0) b.wait--;
    else {
      var ok = aimOk(b, w, me, op, W, dist, dy, toOp);
      if (ok && (W.wind || W.rec || W.charge) && !canCommit(w, me)) ok = false;
      if (ok) {
        inp.shoot = true; b.wait = -1; faceOp = true; press = ok === 'press'; b.holdT = 12 + Math.floor(R() * 14);
        if (W.kind === 'melee' && R() < cfg.whiff) { inp.shoot = false; b.wait = 6 + Math.floor(R() * 10); }   // 振るタイミングを迷う
        if (W.auto) b.spray = 10 + Math.floor(R() * 26);
      }
    }
  }
  if (W.kind === 'melee' && !b.evadeGren && dist < Math.max(90, W.range + 40) && dy < 40 && b.meleeOk) {
    if (dist > W.range * 0.55) press = true;                                       // 届く距離まで詰める
    else { inp.left = false; inp.right = false; if (me.dir !== toOp) faceOp = true; }   // 届いたら止まって相手の方を向く（走り抜けない）
  }
  // 端に追い詰められてナイフで迫られたら、相手の頭上を跳び越えて逃げる
  if (W.kind !== 'melee' && WEAPONS[op.load[op.slot]].kind === 'melee' && dist < 70 && me.onGround &&
      (me.x < 40 || me.x > WORLD_W - CHAR_W - 40 || b.stuckT > 3) && R() < cfg.dodge) { inp.jump = true; b.evadeT = 30; b.evadeDir = toOp; b.evadeGren = false; b.evadeJump = 0; }
  if (me.burst > 0) faceOp = true;                  // 3連射の途中で振り向かない
  if (b.evadeGren) { /* 爆風から逃げている間は、向きを合わせるより逃げるのが先 */ }
  else if (Math.abs(dx) < 8 && dy < 40) {          // 相手と重なっている：向きを毎フレーム入れかえず、今向いている方へ抜けてから振り向く
    inp.left = me.dir < 0; inp.right = me.dir > 0;
  }
  else if (press || (faceOp && me.dir !== toOp)) { inp.left = toOp < 0; inp.right = toOp > 0; }   // 相手の方を向く
  else if (faceOp && ((inp.left && toOp > 0) || (inp.right && toOp < 0))) { inp.left = false; inp.right = false; }   // 背を向けずに止まって撃つ
  keepFooting(b, w, me, inp);
  b.lastInp = inp;
  return inp;
}

// ---- 落ちないための最後の確認（入力を直す）----
function keepFooting(b, w, me, inp) {
  var nav = w.nav || (w.nav = buildNav(w));
  if (b.air && !me.onGround) {               // 跳び移っている途中は、着地したい足場へ寄せることだけする
    var ax = airTarget(b.air, me);
    inp.left = ax < me.x - 2; inp.right = ax > me.x + 2;
  } else if (!me.onGround) {                 // よけたジャンプなどで空中：進む先の下に足場がなければ元の足場へ戻る
    var md = me.vx > 0.5 ? 1 : me.vx < -0.5 ? -1 : 0;
    if (md && b.node && pitAhead(nav, me, md, 30)) {
      var bx = clamp(me.x, b.node.lo, b.node.hi);
      inp.left = bx < me.x - 2; inp.right = bx > me.x + 2;
    }
  } else {                                   // 地上：穴に向かって歩いたり跳んだりしない（跳び移る予定のときを除く）
    var d2 = inp.left ? -1 : inp.right ? 1 : 0;
    var toTakeoff = !inp.jump && b.edge && (d2 < 0) === (b.edgeX < me.x);   // 跳び移る場所へ歩いているところ
    // 止まってもすぐには止まれない（1歩＋すべり）。そのぶん先まで見る
    if (d2 && !(inp.jump && b.air) && !toTakeoff && pitAhead(nav, me, d2, inp.jump ? 80 : SPEED * 2 + 2)) { inp.left = false; inp.right = false; d2 = 0; }
    // 止まったあとのすべりで端から落ちそうなら、反対へ一歩もどす
    var sd = me.vx > 0.1 ? 1 : me.vx < -0.1 ? -1 : 0;
    if (!d2 && sd && !toTakeoff && pitAhead(nav, me, sd, Math.abs(me.vx) * 2 + 1)) { inp.left = sd > 0; inp.right = sd < 0; }
  }
  // 空中：このまま落ちると穴なら、着地できる向きへ寄せる（予定の足場に届かないときも、まず落ちないことを優先）
  if (!me.onGround && !me.dead) {
    var cur = inp.left ? -1 : inp.right ? 1 : 0;
    if (!landing(w, me, cur)) {
      var alt = [-cur || -1, cur ? 0 : 1, cur || 1];
      for (var ai = 0; ai < alt.length; ai++) {
        if (alt[ai] !== cur && landing(w, me, alt[ai])) { inp.left = alt[ai] < 0; inp.right = alt[ai] > 0; break; }
      }
    }
  }
}

// ---- レート ----
// ティアはレートの数値で決まる。TIER_MIN[i] = そのティアになる最低レート（0番は「まだティアなし」）
// 下から：（なし）<LT5<HT5<LT4<HT4<LT3<HT3<LT2<HT2<LT1<HT1
var RATE_START = 1000;            // 始まりのレート（＝LT5）
var RATE_FLOOR = 800;             // これより下がらない
var TIER_MIN = [0, 1000, 1100, 1200, 1350, 1500, 1650, 1800, 2000, 2250, 2550];
var BOT_TIER_CAP = 9;             // BOT戦だけで行けるのは LT1 の下限（2250）まで。HT1 は本物に勝った人だけ
// レートからティアを出す（レートの数値だけで決まる。猶予や飛び級はない）
// ---- シーズン（シンガポール時間 UTC+8 の1か月ごと）----
// 月の初め（1日 0:00）に新しいシーズンが始まり、月末で終わる
var SEASON_TZ_MIN = 8 * 60;
var SEASON_ORIGIN = { y: 2026, m: 8 };          // 2026年9月 ＝ シーズン1（m は 0 から数える）
var SEASON_DROP = 5;                            // 次のシーズンは、ティアをこれだけ下げたところから（HT1 → LT3）
function seasonMonthOf(ms) {
  var d = new Date((ms == null ? Date.now() : ms) + SEASON_TZ_MIN * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
function seasonNo(ms) {                          // 表示するシーズン番号（1から）
  var o = seasonMonthOf(ms);
  return (o.y - SEASON_ORIGIN.y) * 12 + (o.m - SEASON_ORIGIN.m) + 1;
}
function seasonStart(ms) { var o = seasonMonthOf(ms); return Date.UTC(o.y, o.m, 1) - SEASON_TZ_MIN * 60000; }
function seasonEnd(ms) { var o = seasonMonthOf(ms); return Date.UTC(o.y, o.m + 1, 1) - SEASON_TZ_MIN * 60000; }
function seasonLeftMs(ms) { return Math.max(0, seasonEnd(ms) - (ms == null ? Date.now() : ms)); }
function seasonLeftDays(ms) { return Math.ceil(seasonLeftMs(ms) / 86400000); }
// シーズンが終わったときの次のレート（今のティアから SEASON_DROP 下のティアの下限。上がることはない）
function seasonNextRate(rate) {
  var t = tierOfRate(rate), nt = Math.max(1, t - SEASON_DROP);
  return Math.min(+rate || RATE_START, TIER_MIN[nt]);
}

function tierOfRate(rate) {
  for (var k = TIER_MIN.length - 1; k >= 1; k--) if (rate >= TIER_MIN[k]) return k;
  return 0;
}
// Elo の期待勝率（相手より 400 高ければ 10回中9回勝つ見込み）
function rateExpect(mine, theirs) { return 1 / (1 + Math.pow(10, (theirs - mine) / 400)); }
// 1試合ぶんのレートの増減。
// o = { mine, theirs, win, games(これまでのランクマッチ数), streak(格下に連敗した数), wstreak(連勝数) }
function rateChange(o) {
  var mine = +o.mine || RATE_START, theirs = +o.theirs || RATE_START, win = !!o.win, g = +o.games || 0;
  var K = g < 10 ? 48 : g < 30 ? 32 : 24;                    // 始めのうちは大きく動かして、早く実力の位置へ
  var d = K * ((win ? 1 : 0) - rateExpect(mine, theirs));
  if (win) {
    // 格上に勝つほど大きく上がる：相手が上の分だけ倍率をかける（400上で2倍、800上で3倍）
    d *= 1 + Math.max(0, theirs - mine) / 400;
    // 連勝しているうちは上がり方を速くする（実力よりレートが低い人が、早く自分の位置まで上がれるように）
    var ws = (+o.wstreak || 0) + 1;
    d *= ws >= 8 ? 2 : ws >= 5 ? 1.6 : ws >= 3 ? 1.3 : 1;
  } else {
    if (theirs < mine) {                                     // 格下に連敗したら、2敗目から下がり幅を増やす
      var st = (+o.streak || 0) + 1;
      d *= st >= 4 ? 1.7 : st === 3 ? 1.5 : st === 2 ? 1.2 : 1;
    }
    d *= mine >= 2250 ? 1.45 : mine >= 2000 ? 1.3 : mine >= 1800 ? 1.15 : 1;   // 上位ほど落ちやすい
  }
  var v = Math.round(d);
  return win ? Math.max(1, v) : Math.min(-1, v);             // 勝てば必ず上がり、負ければ必ず下がる
}
// 1試合ぶんを当てはめた結果（レート・ティア・連敗数の新しい値）
// cap を渡すと、そのティアの下限までしか上がらない（BOT戦の上限に使う）
function applyRate(st, o) {
  var rate = +st.rate || RATE_START, games = +st.games || 0;
  var streak = +st.streak || 0, wstreak = +st.wstreak || 0;
  var base = o.mine != null ? +o.mine : rate;   // 2v2：チームの平均
  var d = rateChange({ mine: base, theirs: o.theirs, win: o.win, games: games, streak: streak, wstreak: wstreak });
  var next = Math.max(RATE_FLOOR, rate + d);
  if (o.cap != null && next > rate) next = Math.max(rate, Math.min(next, TIER_MIN[o.cap] || next));
  d = next - rate;
  return {
    rate: next, delta: d, before: rate,
    tier: tierOfRate(next), tierBefore: tierOfRate(rate),
    games: games + 1,
    streak: (!o.win && +o.theirs < base) ? streak + 1 : 0,  // 格下に負けた連続回数（勝つか、格上に負ければ 0 に戻る）
    wstreak: o.win ? wstreak + 1 : 0                        // 連勝数（負けたら 0 に戻る）
  };
}

// ---- 称号（二つ名） ----
// id と、見た目（rare＝青いネオン／gift＝緑のネオン／prism＝明朝の白銀＋プリズム／mythic＝黒と金）。
// gate はサーバーが確かめる条件（オンライン戦績・フレンド数・開拓者・贈られた人）。
// gate のない称号は CPU 戦などの手元の記録で決まる。名前と取り方の説明は lang.js の title.〇〇 / tcond.〇〇
var TITLES = [
  { id: 'rookie' },
  { id: 'regular' }, { id: 'bodyguard' }, { id: 'demon_hunter' }, { id: 'godslayer', rare: true }, { id: 'legend', rare: true },
  { id: 'veteran10' }, { id: 'veteran50' }, { id: 'veteran100', rare: true }, { id: 'fall30' }, { id: 'fall100', rare: true },
  { id: 'debut', gate: { w: 1 } }, { id: 'wanted', gate: { w: 10 } }, { id: 'bounty_hunter', gate: { w: 50 } },
  { id: 'duel_king', rare: true, gate: { w: 100 } }, { id: 'unbeaten', rare: true, gate: { n: 30, rate: 0.7 } },
  { id: 'partner', gate: { friends: 1 } }, { id: 'magnificent7', gate: { friends: 7 } },
  { id: 'one_pistol', rare: true },
  { id: 'untouched' }, { id: 'close_call' },
  // 連勝（ach.best を見る）。100連勝は黒と金
  { id: 'streak3' }, { id: 'unstoppable' }, { id: 'streak10' }, { id: 'streak20' },
  { id: 'streak30', rare: true }, { id: 'streak100', rare: true, mythic: true }, { id: 'precision' }, { id: 'pit_drop' }, { id: 'wanderer', rare: true },
  { id: 'short_sleeper', rare: true }, { id: 'first_steps' }, { id: 'pioneer', rare: true, gate: { pioneer: true } }, { id: 'first_ten', rare: true, gate: { pioneer10: true } }, { id: 'rule_breaker' },
  { id: 'emperor_slayer', rare: true, mythic: true },   // 隠しボス「鬼帝」に勝つ（mythic：黒と金の特別な見た目）
  // 運営から配る称号（award：届いたときにお祝いの演出が出る）。サーバーが認めた人だけ使える。自力では取れない
  { id: 'trusted_hacker', gift: true, award: true, gate: { hacker: true } },   // gift：緑のネオン
  { id: 'dev_tears', glitch: true, award: true, gate: { tears: true } },       // glitch：赤と水色にズレた「壊れた画面」の文字
  { id: 'world_author', prism: true, award: true, gate: { dev: true } },       // prism：明朝の白銀にプリズムの光
  // シーズンの最終1位（crown：赤と金）。一度もらったら、また1位になっても増えない
  { id: 'unrivaled', crown: true, award: true, gate: { champion: true } }
];
// 武器ごとの称号：その武器でとどめを 10・50・100 回（100 回はすべてレア）。kill = { w: 武器id, n: 回数 }
// 前からある6つ（影の刃・千里眼・至近距離の鬼・蜂の巣職人・爆弾魔・電磁砲の申し子）は id をそのまま使う
var KILL_STEPS = [10, 50, 100];
var KILL_TITLE_OLD = { knife50: 'shadow_blade', sniper50: 'far_sight', shotgun50: 'point_blank', smg50: 'hive_maker', grenade10: 'bomber', railgun10: 'railgun_child' };
WEAPON_IDS.forEach(function (wid) {
  var key = WEAPONS[wid].key;
  KILL_STEPS.forEach(function (n) { TITLES.push({ id: KILL_TITLE_OLD[key + n] || 'kill_' + key + '_' + n, kill: { w: wid, n: n }, rare: n >= 100 }); });
});
// その称号を使ってよいか。ctx = { w, l, friends, pioneer, pioneer10, hacker, tears, dev }
// （オンライン戦績・フレンド数・開拓者か・最初の10人か・贈られた人か・運営か。ログインしていなければ null）
// ---- プロフィールのやり直し（epoch）----
// CPUの強さを変えたときは、CPU戦で取れる称号を全員から外して取り直してもらう。
// ブラウザにも同じ記録が残っているので、サーバーと手元の両方でこれを通す（片方だけだと次の保存で戻ってしまう）
var PROFILE_EPOCH = 1;
function resetCpuTitles(p, tier) {
  if (!p || typeof p !== 'object') return p;
  // サーバーが確かめる称号（オンライン戦績・フレンド数・開拓者・運営から配ったもの）だけ残す
  var got = (p.ach && typeof p.ach.got === 'object' && p.ach.got) || {}, keep = { rookie: 1 };
  for (var i = 0; i < TITLES.length; i++) if (TITLES[i].gate && got[TITLES[i].id]) keep[TITLES[i].id] = 1;
  if (!p.ach || typeof p.ach !== 'object') p.ach = {};
  p.ach.got = keep;
  p.ach.kills = {};              // 武器ごとのとどめの数（ここを0にしないと、次に開いた瞬間に称号が戻る）
  p.ach.stages = {};             // ステージごとの勝利数
  p.ach.evt = {};                // 試合中の出来事（称号の裏づけ）
  p.ach.streak = 0; p.ach.best = 0;
  p.tierProgress = {};           // 難度をクリアした記録
  p.emperor = { w: 0, l: 0, beat: false, seen: false };   // 隠しボス
  // 背景は今のティアのものまで
  var t = Math.max(0, Math.min(TIER_MIN.length - 1, Math.floor(+tier || 0)));
  p.bestTier = t;
  if (p.bg === 'emperor' || (typeof p.bg === 'number' && p.bg > t)) p.bg = null;
  // サーバーが確かめる称号（開拓者・オンライン戦績・運営から配ったもの）は、そのまま着けていられる
  var gated = false;
  for (var j = 0; j < TITLES.length; j++) if (TITLES[j].id === p.title && TITLES[j].gate) gated = true;
  if (p.title && !keep[p.title] && !gated) p.title = 'rookie';   // 使えなくなった称号を選んでいたら戻す
  p.epoch = PROFILE_EPOCH;
  return p;
}

// 試合の中の一瞬の出来事で取る称号（あとから確かめられる記録が残らないので、起きた回数を数えておく）
var EVENT_TITLES = ['one_pistol', 'untouched', 'close_call', 'precision', 'pit_drop', 'short_sleeper', 'first_steps', 'rule_breaker'];
// その称号を本当に取れているか、その人の記録から確かめる。
// CPU戦の記録はブラウザからの自己申告だが、「称号だけ書き換える」チートはこれで弾ける
// p = プロフィール（stats / tierProgress / ach / emperor）、ctx = サーバーが持っている情報
function titleProof(id, p, ctx) {
  var d = null, i;
  for (i = 0; i < TITLES.length; i++) if (TITLES[i].id === id) { d = TITLES[i]; break; }
  if (!d) return false;
  if (d.gate) return titleOk(id, ctx);                  // サーバーが確かめる称号
  p = p || {};
  var ach = p.ach || {}, kills = ach.kills || {}, stages = ach.stages || {}, evt = ach.evt || {};
  var prog = p.tierProgress || {}, stats = p.stats || {}, emp = p.emperor || {};
  if (d.kill) return (+kills[d.kill.w] || 0) >= d.kill.n;
  var beat = function (k) { return !!(prog[k] && prog[k].beat); };
  var totW = (+emp.w || 0) + ((ctx && +ctx.w) || 0), totL = (+emp.l || 0) + ((ctx && +ctx.l) || 0), k;
  for (k in stats) { totW += (stats[k] && +stats[k].w) || 0; totL += (stats[k] && +stats[k].l) || 0; }
  switch (id) {
    case 'rookie': return true;
    case 'regular': return beat('normal');
    case 'bodyguard': return beat('hard');
    case 'demon_hunter': return beat('pro');
    case 'godslayer': return beat('god');
    case 'legend': return !!(prog.god && prog.god.straight);
    case 'veteran10': return totW >= 10;
    case 'veteran50': return totW >= 50;
    case 'veteran100': return totW >= 100;
    case 'fall30': return totL >= 30;
    case 'fall100': return totL >= 100;
    case 'streak3': return (+ach.best || 0) >= 3;
    case 'unstoppable': return (+ach.best || 0) >= 5;
    case 'streak10': return (+ach.best || 0) >= 10;
    case 'streak20': return (+ach.best || 0) >= 20;
    case 'streak30': return (+ach.best || 0) >= 30;
    case 'streak100': return (+ach.best || 0) >= 100;
    case 'wanderer': { var n = 0, sk; for (sk in STAGES) if ((+stages[sk] || 0) > 0) n++; return n >= Object.keys(STAGES).length; }
    case 'emperor_slayer': return emp.beat === true;
    default: return (+evt[id] || 0) > 0;                // 出来事の称号：起きた回数が要る
  }
}

function titleOk(id, ctx) {
  for (var i = 0; i < TITLES.length; i++) {
    if (TITLES[i].id !== id) continue;
    var g = TITLES[i].gate;
    if (!g) return true;
    if (!ctx) return false;
    var w = ctx.w || 0, n = w + (ctx.l || 0);
    if (g.w && w < g.w) return false;
    if (g.n && (n < g.n || w / n < g.rate)) return false;
    if (g.friends && (ctx.friends || 0) < g.friends) return false;
    if (g.pioneer && !ctx.pioneer) return false;
    if (g.pioneer10 && !ctx.pioneer10) return false;
    if (g.hacker && !ctx.hacker) return false;
    if (g.tears && !ctx.tears) return false;
    if (g.dev && !ctx.dev) return false;
    if (g.champion && !ctx.champion) return false;
    return true;
  }
  return false;
}

var api = {
  VW: VW, VH: VH, WORLD_W: WORLD_W, GND: GND, MAX_HP: MAX_HP, CHAR_W: CHAR_W, CHAR_H: CHAR_H, DUCK_H: DUCK_H, HIT_FRAMES: HIT_FRAMES,
  GRAVITY: GRAVITY, JUMP_F: JUMP_F, SPEED: SPEED, SWAP_FRAMES: SWAP_FRAMES, PROTO: PROTO, GREN_G: GREN_G,
  WEAPONS: deepFreeze(WEAPONS), WEAPON_IDS: deepFreeze(WEAPON_IDS), DEFAULT_LOADOUT: deepFreeze(DEFAULT_LOADOUT),
  STAGES: deepFreeze(STAGES), AI_LEVELS: deepFreeze(AI_LEVELS),
  LOOK_SIZES: deepFreeze(LOOK_SIZES), LOOK_KEYS: deepFreeze(LOOK_KEYS), cleanLook: cleanLook, randomLook: randomLook,
  cleanLoadout: cleanLoadout, newWorld: newWorld, newRangeWorld: newRangeWorld,
  TEAM_SLOTS: deepFreeze(TEAM_SLOTS.slice()), teamOf: teamOf, newTeamWorld: newTeamWorld, stepTeam: stepTeam, teamResult: teamResult, foes: foes, newTarget: newTarget, stepRange: stepRange, newChar: newChar, setInput: setInput, step: step,
  stepChar: stepChar, stepShots: stepShots, physics: physics, canFire: canFire, weaponOf: weaponOf, muzzleY: muzzleY,
  packChar: packChar, packShots: packShots, blockAt: blockAt,
  newBrain: newBrain, think: think, cpuLoadout: cpuLoadout, emperorLoadout: emperorLoadout, aiForRate: aiForRate, decideTactic: decideTactic,
  RATE_START: RATE_START, RATE_FLOOR: RATE_FLOOR, TIER_MIN: deepFreeze(TIER_MIN), BOT_TIER_CAP: BOT_TIER_CAP,
  tierOfRate: tierOfRate, rateExpect: rateExpect, rateChange: rateChange, applyRate: applyRate,
  TITLES: deepFreeze(TITLES), titleOk: titleOk,
  guardSnap: guardSnap, guardCheck: guardCheck, guardSave: guardSave,
  SEASON_TZ_MIN: SEASON_TZ_MIN, SEASON_DROP: SEASON_DROP, seasonNo: seasonNo, seasonStart: seasonStart, seasonEnd: seasonEnd,
  seasonLeftMs: seasonLeftMs, seasonLeftDays: seasonLeftDays, seasonNextRate: seasonNextRate,
  PROFILE_EPOCH: PROFILE_EPOCH, resetCpuTitles: resetCpuTitles,
  EVENT_TITLES: deepFreeze(EVENT_TITLES), titleProof: titleProof
};
return Object.freeze(api);
});
