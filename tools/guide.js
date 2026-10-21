// 攻略ガイド（/guide/）を作る。数字はゲームの計算（sim.js）と言語ファイル（lang.js）から入れ、文章は guide/text.js から。
// 武器の「届く距離」「倒すまでの時間」は、sim.js で実際に撃って測る（ゲームの調整を変えると、ガイドの数字も自動で変わる）
// 使い方：node tools/guide.js [出力先]（省略すると dist）。dist/guide/ にページと絵ができる。tools/build.js からも呼ぶ
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const SIM = require('../sim.js');
const LANG = require('../lang.js').GunDuelLang;
const TXT = require('../guide/text.js');
const SITE = 'https://taitiii126-bot.github.io/gunduel2/';   // 公式サイト（publish/itch の GAME_URL と同じ）
const PX_M = 25;   // 1m＝25px（リザルト画面の「最長ヒット」と同じ。キャラの背 44px ≒ 1.8m）

const ja = LANG.ja, en = LANG.en;
function t(k, v) {
  let s = ja[k];
  if (s == null) throw new Error('lang.js にない文字: ' + k);
  return v ? s.replace(/\{(\w+)\}/g, (m, x) => v[x] != null ? v[x] : m) : s;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const m1 = px => +(px / PX_M).toFixed(1);
const sec = f => +(f / 60).toFixed(2);
const fix1 = v => (+v).toFixed(1);
// ソースに書いてある定数（sim.js が外に出していないもの）
function srcConst(file, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(\\d+(?:\\.\\d+)?)').exec(fs.readFileSync(path.join(root, file), 'utf8'));
  if (!m) throw new Error(file + ' に ' + name + ' が見つかりません');
  return +m[1];
}

// ============================================================
// 測る（止まっている相手を、平らなステージで撃つ）
// ============================================================
function settled(stage, la, lb) {
  const w = SIM.newWorld(stage || 'flat', la, lb || [2, 3, 1]);
  for (let i = 0; i < 30; i++) { SIM.setInput(w.chars.a, {}); SIM.setInput(w.chars.b, {}); SIM.step(w, []); }
  return w;
}
// 撃ち続けて（弾が切れたら R）、相手が倒れるまでのフレーム。dist＝2人の横の距離（px）
function killTime(wid, dist, limit) {
  const w = settled('flat', [wid, 2, 3]), a = w.chars.a, b = w.chars.b, W = SIM.WEAPONS[wid];
  a.x = 400; a.dir = 1; b.x = a.x + dist; b.dir = -1;
  let first = -1, hits = 0;
  for (let f = 0; f < (limit || 1800); f++) {
    const empty = W.mag > 0 && a.ammo[a.slot] <= 0 && a.rl <= 0;
    SIM.setInput(a, { fire: !empty, shoot: !empty, reload: empty }); SIM.setInput(b, {});
    const ev = []; SIM.step(w, ev); b.x = a.x + dist;
    for (const e of ev) { if (e.t === 'pull' && e.who === 'a' && first < 0) first = w.frame; if (e.t === 'hit' && e.by === 'a') hits++; }
    if (b.dead) return { frames: w.frame - first + 1, hits };
  }
  return null;
}
// その距離で、3秒以内に1回でも当たるか
function reaches(wid, dist) {
  const w = settled('flat', [wid, 2, 3]), a = w.chars.a, b = w.chars.b, W = SIM.WEAPONS[wid];
  a.x = 300; a.dir = 1; b.x = a.x + dist; b.dir = -1;
  for (let f = 0; f < 180; f++) {
    const empty = W.mag > 0 && a.ammo[a.slot] <= 0 && a.rl <= 0;
    SIM.setInput(a, { fire: !empty, shoot: !empty, reload: empty }); SIM.setInput(b, {});
    const ev = []; SIM.step(w, ev); b.x = a.x + dist;
    if (ev.some(e => e.t === 'hit' && e.by === 'a')) return true;
  }
  return false;
}
// 当たる距離のまとまり（[[近い, 遠い], ...] px）。グレネードは近すぎると頭の上を越えるので、2つに分かれる
function reachSegs(wid) {
  const seg = []; let s = null, p = null;
  for (let d = 0; d <= 1000; d += 5) {
    if (!reaches(wid, d)) continue;
    if (s == null) s = d; else if (d !== p + 5) { seg.push([s, p]); s = d; }
    p = d;
  }
  if (s != null) seg.push([s, p]);
  return seg;
}
// ハンマーで吹き飛ばしたときに、相手が動く距離（px）
function knockDist() {
  const w = settled('flat', [14, 2, 3]), a = w.chars.a, b = w.chars.b;
  a.x = 300; b.x = 330; a.dir = 1; b.dir = -1;
  const x0 = b.x; let mx = x0;
  for (let f = 0; f < 120; f++) { SIM.setInput(a, { fire: f === 0, shoot: f === 0 }); SIM.setInput(b, {}); SIM.step(w, []); mx = Math.max(mx, b.x); }
  return mx - x0;
}
// レールガンを溜めている間の移動の速さ（ふだんの何%か）
function chargeMove() {
  const w = settled('flat', [11, 2, 3]), a = w.chars.a;
  let base = 0, chg = 0;
  for (let f = 0; f < 40; f++) { SIM.setInput(a, { right: true }); SIM.setInput(w.chars.b, {}); SIM.step(w, []); base = Math.abs(a.vx); }
  for (let f = 0; f < 10; f++) { SIM.setInput(a, { right: true, fire: f === 0, shoot: f === 0 }); SIM.setInput(w.chars.b, {}); SIM.step(w, []); if (a.chg > 0) chg = Math.abs(a.vx); }
  return Math.round(chg / base * 100);
}
// 撃たれてから、最初に自然回復するまで（秒）
function regenFirst() {
  const w = settled('flat', [2, 3, 1]), a = w.chars.a, b = w.chars.b;
  a.x = 300; b.x = 500; a.dir = 1; let hit = -1;
  for (let f = 0; f < 60 * 12; f++) {
    SIM.setInput(a, { fire: f === 0, shoot: f === 0 }); SIM.setInput(b, {});
    const hp = b.hp, ev = []; SIM.step(w, ev);
    if (ev.some(e => e.t === 'hit')) hit = w.frame;
    if (b.hp > hp) return sec(w.frame - hit);
  }
  throw new Error('自然回復が測れません');
}

// ============================================================
// 数字をまとめる
// ============================================================
const W_IDS = SIM.WEAPON_IDS.slice();
const DISTS = [30, 80, 150, 250, 350, 500];   // 距離ごとの表（px）
const G = (() => {
  const g = {
    maxHp: SIM.MAX_HP, charH: SIM.CHAR_H, duckH: SIM.DUCK_H,
    regenIdleS: sec(srcConst('sim.js', 'REGEN_IDLE')), regenIntS: sec(srcConst('sim.js', 'REGEN_INT')), regenAmt: srcConst('sim.js', 'REGEN_AMT'),
    regenFirstS: Math.round(regenFirst()),
    rollS: fix1(sec(SIM.ROLL_T)), rollIfS: sec(SIM.ROLL_IF), rollEveryS: fix1(sec(SIM.ROLL_T + SIM.ROLL_CD)),
    swapS: sec(SIM.SWAP_FRAMES), landLagS: sec(SIM.LAND_LAG), landSoftS: fix1(sec(SIM.LAND_LAG_SOFT)),
    winRounds: srcConst('game.js', 'WIN_ROUNDS'),
    pellets: SIM.WEAPONS[5].pellets, balls: SIM.WEAPONS[15].balls, pointBlank: SIM.WEAPONS[5].dmg * SIM.WEAPONS[5].pellets,
    windS: sec(SIM.WEAPONS[14].wind), kbM: m1(knockDist()), kbS: sec(SIM.WEAPONS[14].kbT),
    chargeMoveP: chargeMove(), monthStartJst: (24 - SIM.SEASON_TZ_MIN / 60 + 9) % 24
  };
  const tw = SIM.STAGES.tower.platforms.filter(p => !p.ground).sort((a, b) => a.y - b.y)[0];
  g.towerTopM = m1(tw.w);
  return g;
})();

function hitsText(W) {
  if (W.kind === 'pellet') return { n: Math.ceil(G.maxHp / (W.dmg * W.pellets)), u: '発', note: '密着' };
  if (W.kind === 'bounce') return { n: Math.ceil(G.maxHp / W.dmg), u: '玉', note: '約' + Math.ceil(G.maxHp / (W.dmg * W.balls)) + '回' };
  if (W.burst) return { n: Math.ceil(G.maxHp / W.dmg), u: '発', note: Math.ceil(Math.ceil(G.maxHp / W.dmg) / W.burst) + '回' };
  return { n: Math.ceil(G.maxHp / W.dmg), u: W.kind === 'melee' ? '回' : '発' };
}
const WEP = W_IDS.map(id => {
  const W = SIM.WEAPONS[id], segs = reachSegs(id), far = segs.length ? segs[segs.length - 1][1] : 0;
  // 倒すまでの時間は、CPU が保とうとする距離で測る（散弾は「密着で何発」と合わせて、密着で測る）
  const band = W.kind === 'pellet' ? DISTS[0] : Math.round((W.band[0] + W.band[1]) / 2), kt = killTime(id, band), ht = hitsText(W);
  const m = Object.assign({}, G, {
    id, key: W.key, W, kind: W.kind, cat: (TXT.weapons[W.key] || {}).cat || 'mid',
    name: t('w.' + id + '.name'), en: en['w.' + id + '.name'] || '', desc: t('w.' + id + '.desc'),
    dmg: W.dmg, sdmg: W.sdmg, mag: W.mag, rateS: sec(W.rate), reloadS: fix1(sec(W.reload)), reachM: m1(far),
    perSec: W.rate ? fix1(60 / W.rate) : null, windS: sec(W.wind || 0), recS: sec(W.rec || 0),
    hits: ht.n, hitsU: ht.u, hitsNote: ht.note || '', ttk: kt ? fix1(sec(kt.frames)) : null, bandM: m1(band),
    burstN: W.burst || 0, bounces: W.bounces || 0, moveP: Math.round((W.move || 1) * 100),
    chargeS: sec(W.charge || 0), splashM: m1(W.splash || 0),
    row: DISTS.map(d => { const r = killTime(id, d); return r ? sec(r.frames) : null; })
  });
  if (W.kind === 'grenade') {   // 近すぎると頭の上を越える
    const a = segs[0], b = segs[segs.length - 1];
    Object.assign(m, { gNear: m1(a[1]), gGapLo: m1(a[1] + 5), gGapHi: m1(b[0] - 5), gMin: m1(b[0]), gMax: m1(b[1]) });
  }
  if (!TXT.weapons[W.key]) throw new Error('guide/text.js に武器の説明がありません: ' + W.key);
  m.tip = TXT.weapons[W.key].tip(m);
  return m;
});
const WBY = {}; WEP.forEach(m => { WBY[m.key] = m; });
Object.assign(G, { gNear: WBY.grenade.gNear, gGapLo: WBY.grenade.gGapLo, gGapHi: WBY.grenade.gGapHi, gMin: WBY.grenade.gMin, gMax: WBY.grenade.gMax });

// ============================================================
// 部品
// ============================================================
const CAT = { melee: '近接', close: '近距離', mid: '中距離', far: '遠距離', arc: '弧を描く' };
const KICK = { start: 'BASICS', controls: 'CONTROLS', rules: 'RULES', weapons: 'WEAPONS', ttk: 'TIME TO KILL', loadout: 'LOADOUT', tactics: 'TACTICS', stages: 'STAGES', cpu: 'VS CPU', online: 'ONLINE', rewards: 'REWARDS', titles: 'TITLES', events: 'EVENTS', faq: 'FAQ' };
function sectionHead(id, title, lead) {
  return `<div class="sec-head"><p class="kicker">${KICK[id]}</p><h2>${esc(title)}</h2>${lead ? `<p class="lead">${lead}</p>` : ''}</div>`;
}
const img = (src, alt, w, h, cls) => `<img src="img/${src}" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"${cls ? ` class="${cls}"` : ''}>`;
function keyName(k) {
  if (!k) return '–';
  if (k === ' ') return 'Space';
  if (/^arrow/.test(k)) return { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' }[k];
  return k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1);
}
function defaultKeys() {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), m = /var DEFAULT_KB=(\{[^}]*\});/.exec(src);
  if (!m) throw new Error('index.html に DEFAULT_KB が見つかりません');
  return Function('return ' + m[1])();
}
function rewardText(r) {
  const out = [];
  if (r.xp) out.push(r.xp + ' XP');
  if (r.coins) out.push('コイン ' + r.coins);
  if (r.lucky) out.push(t('eco.lucky') + (r.lucky > 1 ? ' ×' + r.lucky : ''));
  if (r.chaos) out.push(t('eco.chaos') + (r.chaos > 1 ? ' ×' + r.chaos : ''));
  if (r.item) out.push('スキン');
  return out.join('＋');
}
// 距離ごとの表の色（明るいほど早く倒せる）。guide/style.css の --h1〜--h6 と同じ段
const HEAT = [[1.0, 1], [1.5, 2], [2.0, 3], [3.0, 4], [4.5, 5], [Infinity, 6]];
const heatStep = v => HEAT.find(h => v <= h[0])[1];

// ============================================================
// ページの各部分
// ============================================================
function secStart() {
  const cards = TXT.basics.map((b, i) => `<div class="card basic"><span class="num">${i + 1}</span><h3>${esc(b.h)}</h3><p>${b.p(G)}</p></div>`).join('');
  return `<section id="start">${sectionHead('start', 'はじめに', `GUN DUEL は、ブラウザですぐ遊べる 2D の西部劇ガンアクション。1対1（と2対2）で撃ち合い、先に${G.winRounds}ラウンド取ったほうの勝ち。試合の前に武器を3つ選び、試合中に持ち替えて戦う。`)}
<h3 class="sub">まず覚えたい5つのこと</h3><div class="grid g-basic">${cards}</div></section>`;
}

function secControls() {
  const kb = defaultKeys();
  const rows = [['移動', [kb.left, kb.right].map(keyName)], ['ジャンプ', keyName(kb.jump)], ['しゃがむ', keyName(kb.duck)],
    [t('kb.attack'), keyName(kb.attack)], ['リロード', keyName(kb.reload)], ['武器の持ち替え', [kb.w1, kb.w2, kb.w3].map(keyName)],
    [t('kb.heal'), keyName(kb.heal)], ['回避ロール', keyName(kb.roll)], ['エモート', [kb.e1, kb.e2, kb.e3, kb.e4].map(keyName)],
    ['エモートとチャットのメニュー', 'T'], ['メニューに戻る', 'Esc'], ['試合のあと：もう一度', 'R']];
  const pad = [['移動', ['左スティック', '十字キー']], ['しゃがむ', ['スティック下', '十字キー下', 'B（○）']], ['ジャンプ', ['A（×）', '十字キー上']], ['攻撃', ['RT（R2）']],
    ['リロード', ['X（□）']], ['回復', ['Y（△）']], ['回避ロール', ['LT（L2）']], ['武器の持ち替え', ['LB（L1）', 'RB（R1）']],
    ['エモート①②③', ['ビュー（クリエイト）', '左スティック押しこみ', '右スティック押しこみ']], ['開始・再戦・演出をとばす', ['メニュー（オプション）']]];
  const tb = list => `<table class="tbl keys"><tbody>${list.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${[].concat(r[1]).map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</td></tr>`).join('')}</tbody></table>`;
  return `<section id="controls">${sectionHead('controls', '操作方法', '初期設定のキー。設定の「キーバインド」で、全部の操作を好きなキーやマウスのボタンに変えられる。')}
<div class="grid g-2"><div class="card"><h3>キーボード</h3>${tb(rows)}</div>
<div class="card"><h3>ゲームパッド</h3>${tb(pad)}<p class="note">つなぐだけで使える（ボタンの変更はできない）。かっこの中は PlayStation のボタン。</p>
<h3 class="mt">スマホ</h3><p>横向きで遊ぶ。画面のボタンで、左右の移動・ジャンプ・しゃがむ・攻撃・リロード・回復・ロール・エモート・武器の持ち替えができる。設定の「スマホの操作」→「ボタンの配置」で、ボタンの位置と大きさを変えられる。</p></div></div></section>`;
}

function secRules() {
  const rows = TXT.rules(G).map(r => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td></tr>`).join('');
  return `<section id="rules">${sectionHead('rules', 'ルールとしくみ', '試合の決まりと、知っていると差がつく細かいしくみ。数字はゲームの計算そのまま（1秒＝60コマ）。')}
<div class="card flush"><table class="tbl rules"><tbody>${rows}</tbody></table></div></section>`;
}

function statCells(m) {
  const W = m.W;
  const pow = W.kind === 'pellet' ? `${W.dmg}<small>×${W.pellets}粒</small>` : W.kind === 'bounce' ? `${W.dmg}<small>×${W.balls}玉</small>` : W.burst ? `${W.dmg}<small>×${W.burst}連射</small>` : W.kind === 'grenade' ? `${W.dmg}<small>爆風${W.sdmg}</small>` : String(W.dmg);
  const gap = W.kind === 'beam' ? `<small>溜め</small>${m.chargeS}<small>秒</small>` : W.rate ? `${m.rateS}<small>秒</small>` : '<small>1発ずつ</small>';
  const mag = W.mag === 0 ? '∞' : W.burst ? `${W.mag}<small>（${W.mag / W.burst}回）</small>` : W.kind === 'bounce' ? `${W.mag}<small>回分</small>` : String(W.mag);
  const rl = W.reload ? `${m.reloadS}<small>秒</small>` : '<small>なし</small>';
  const reach = W.kind === 'grenade' ? `${m.gMax}<small>m</small>` : `${m.reachM}<small>m</small>`;
  return [['威力', pow], ['撃つ間隔', gap], ['弾数', mag], ['リロード', rl], ['届く距離', reach]]
    .map(c => `<div class="stat"><span>${c[0]}</span><b>${c[1]}</b></div>`).join('');
}
function traits(m) {
  const W = m.W, out = [];
  if (W.auto && W.kind !== 'melee') out.push('押しっぱなしで撃ち続ける');
  if (W.kind === 'melee') out.push(W.wind ? `振りかぶり${m.windS}秒・振ったあと${m.recS}秒動けない` : (W.auto ? `押しっぱなしで${m.rateS}秒ごとに連続` : '振りかぶりなし（押した瞬間に当たる）'));
  if (W.kb) out.push(`当てると約${G.kbM}m吹き飛ばし、${G.kbS}秒動けなくする`);
  if (W.kind === 'pellet') out.push('遠いほど1粒の威力が下がる（届く距離のぎりぎりで半分）');
  if (W.kind === 'beam') out.push(`遮蔽物を貫通。溜め中は移動${m.chargeMoveP}%・向き固定`);
  if (W.move) out.push(`持っている間は移動${m.moveP}%`);
  if (W.kind === 'bounce') out.push(`床や壁で${W.bounces}回まで跳ねる`);
  if (W.kind === 'grenade') out.push(`爆風は半径約${m.splashM}m`, `約${m.gGapLo}〜${m.gGapHi}mの相手には当たらない（頭の上を越える）`);
  if (W.mag === 1) out.push('撃つたびに R でリロード');
  return out;
}
function secWeapons() {
  const chips = [['all', 'すべて']].concat(Object.keys(CAT).map(k => [k, CAT[k]]))
    .map((c, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-cat="${c[0]}" aria-pressed="${i ? 'false' : 'true'}">${esc(c[1])}</button>`).join('');
  const cards = WEP.map(m => {
    const kill = m.ttk ? `<b>${m.hits}${m.hitsU}</b>${m.hitsNote ? `<small>（${esc(m.hitsNote)}）</small>` : ''}・約<b>${m.ttk}</b>秒` : `<b>${m.hits}${m.hitsU}</b>`;
    return `<article class="card weapon" data-cat="${m.cat}" id="w-${m.key}">
<div class="w-top"><div class="w-icon">${img('w-' + m.key + '.png', m.name, 360, 150)}</div><div><h3>${esc(m.name)}</h3><p class="en">${esc(m.en)}</p><span class="tag c-${m.cat}">${CAT[m.cat]}</span></div></div>
<p class="w-desc">${esc(m.desc)}</p>
<div class="stats">${statCells(m)}</div>
<p class="kill"><span>倒すまで</span>${kill}<small class="muted">（約${m.bandM}m・止まっている相手に全部当てたとき）</small></p>
<ul class="traits">${traits(m).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
<p class="tip"><span>コツ</span>${m.tip}</p></article>`;
  }).join('');
  return `<section id="weapons">${sectionHead('weapons', '武器図鑑', `全${WEP.length}種類。距離はリザルト画面と同じく、キャラの背の高さ＝約1.8mとして計算（画面の横幅は約${m1(SIM.VW)}m）。「届く距離」と「倒すまで」は、ゲームの中で実際に撃って測った値。`)}
<div class="chips" role="group" aria-label="武器の種類でしぼりこむ">${chips}</div>
<div class="grid g-weapons">${cards}</div></section>`;
}

function secTtk() {
  const head = DISTS.map((d, i) => `<th scope="col"><button type="button" class="sort" data-col="${i}" aria-label="${m1(d)}mで並べかえ">${m1(d)}m</button></th>`).join('');
  const rows = WEP.map(m => `<tr><th scope="row"><a href="#w-${m.key}">${esc(m.name)}</a></th>${m.row.map((v, i) => v == null
    ? `<td class="na" data-tip="${esc(m.name)}・${m1(DISTS[i])}m：届かない">–</td>`
    : `<td class="h${heatStep(v)}" data-v="${v}" data-tip="${esc(m.name)}・${m1(DISTS[i])}m：約${fix1(v)}秒">${fix1(v)}</td>`).join('')}</tr>`).join('');
  const legend = HEAT.map((h, i) => `<span class="lg"><i class="h${h[1]}"></i>${i === HEAT.length - 1 ? HEAT[i - 1][0] + '秒より長い' : '〜' + h[0] + '秒'}</span>`).join('') + '<span class="lg"><i class="na"></i>届かない</span>';
  return `<section id="ttk">${sectionHead('ttk', '距離ごとの、倒すまでの時間', '止まっている相手（体力100）に、届く限り全部当てたときの秒数。リロードの時間も入っている。実際の試合では外したりよけられたりするので、もっとかかる。見出しを押すと、その距離で早い順に並べかえる。')}
<figure class="card flush heat-wrap"><p class="scroll-hint" hidden>表は横にスクロールできます</p><div class="heat-scroll"><table class="heat"><thead><tr><th scope="col">武器 ＼ 相手との距離</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
<figcaption class="legend">明るいほど早く倒せる：${legend}</figcaption></figure><div class="tt" role="status" aria-live="polite" hidden></div></section>`;
}

function secLoadout() {
  return `<section id="loadout">${sectionHead('loadout', '武器の組み合わせ')}
<div class="grid g-3">${TXT.loadout.map(c => `<div class="card"><h3>${esc(c.h)}</h3><p>${c.p}</p></div>`).join('')}</div></section>`;
}

function secTactics() {
  return `<section id="tactics">${sectionHead('tactics', '立ち回りのコツ', 'どれもゲームの中で確かめたしくみ。')}
<div class="grid g-2">${TXT.tactics(G).map((c, i) => `<div class="card tactic"><span class="num">${i + 1}</span><h3>${esc(c.h)}</h3><p>${c.p}</p></div>`).join('')}</div></section>`;
}

function secStages() {
  const ids = Object.keys(SIM.STAGES);
  const cards = ids.map(id => {
    const S = TXT.stages[id];
    if (!S) throw new Error('guide/text.js にステージの説明がありません: ' + id);
    const tags = t('stage.' + id + '.tags').split(',').map(x => `<span class="tag">${esc(x)}</span>`).join('');
    const pts = S.points.map(p => `<li>${typeof p === 'function' ? p(G) : esc(p)}</li>`).join('');
    const ws = S.weapons.length ? `<p class="fit"><span>向いている武器の例</span>${S.weapons.map(k => `<a href="#w-${k}">${esc(WBY[k].name)}</a>`).join('・')}</p>` : '';
    return `<article class="card stage">${img('st-' + id + '.webp', t('stage.' + id + '.name') + 'のステージ', 1152, 576, 'st-img')}
<div class="st-body"><p class="theme">${esc(t('stage.' + id + '.theme'))}</p><h3>${esc(t('stage.' + id + '.name'))}</h3><p class="st-desc">${esc(t('stage.' + id + '.desc'))}</p><div class="tags">${tags}</div><ul>${pts}</ul>${ws}</div></article>`;
  }).join('');
  return `<section id="stages">${sectionHead('stages', 'ステージ', `全${ids.length}ステージ。CPU戦では自分で選べ、オンライン対戦では対戦する人どうしの投票で決まる。`)}
<div class="grid g-2">${cards}</div></section>`;
}

function secCpu() {
  const order = ['easy', 'normal', 'hard', 'pro', 'god'];
  const rows = order.map(d => `<tr><th scope="row">${esc(t('diff.' + d))}</th><td class="c">約${(SIM.AI_LEVELS[d].react / 60).toFixed(2)}秒</td><td>${esc(TXT.cpu[d])}</td></tr>`).join('');
  return `<section id="cpu">${sectionHead('cpu', 'CPU戦', `5段階の強さから選べる。CPU戦の勝ち負けではレートは動かない。勝つと称号がもらえる強さもある。`)}
<div class="card flush"><table class="tbl cpu"><thead><tr><th scope="col">強さ</th><th scope="col">弾に気づくまで</th><th scope="col">特ちょう</th></tr></thead><tbody>${rows}</tbody></table></div>
<details class="spoiler"><summary>ネタバレ注意：鬼神のその先</summary><p>${esc(TXT.emperor)}</p></details></section>`;
}

const TIER_KEYS = ['', 'LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1'];   // index.html の TIER_LADDER と同じ順
function secOnline() {
  if (TIER_KEYS.length !== SIM.TIER_MIN.length) throw new Error('ティアの数が sim.js の TIER_MIN と合いません');
  const tiers = SIM.TIER_MIN.map((lo, i) => {
    if (i === 0) return '';
    const hi = SIM.TIER_MIN[i + 1];
    return `<div class="tier">${img('tier-' + i + '.webp', TIER_KEYS[i] + 'の紋章', 144, 144)}<b>${TIER_KEYS[i]}</b><span>${hi ? `${lo}〜${hi - 1}` : `${lo}〜`}</span></div>`;
  }).join('');
  const tz = G.monthStartJst;
  return `<section id="online">${sectionHead('online', 'オンライン対戦', 'ほかのプレイヤーとの対戦。1対1と2対2があり、フレンドと部屋を作って遊ぶこともできる。')}
<div class="grid g-2"><div class="card"><h3>${esc(t('mm.ranked'))}</h3><p>${esc(t('mm.rankedSub'))}。Discord でのログインが必要。</p></div>
<div class="card"><h3>${esc(t('mm.casual'))}</h3><p>${esc(t('mm.casualSub'))}。ログインしなくても遊べる。</p></div></div>
<h3 class="sub">ティア（ランク）</h3><p>ティアはレートの数字だけで決まり、レートはランクマッチの結果でだけ上下する。最初はレート${SIM.RATE_START}（LT5）から始まり、${SIM.RATE_FLOOR}より下には下がらない（${SIM.TIER_MIN[1]}未満は「未ランク」の表示）。</p>
<div class="card tiers">${tiers}</div>
<h3 class="sub">レートの上がり方</h3><ul class="dots"><li>勝てば必ず上がり、負ければ必ず下がる。</li><li>格上に勝つほど大きく上がる。連勝しているうちは、上がり方がさらに大きくなる。</li><li>始めのうち（ランクマッチの最初の数十戦）は、大きく動いて早く実力の位置へ近づく。</li><li>格下に続けて負けると、下がり方が大きくなる。上のティアほど、負けたときに下がりやすい。</li></ul>
<h3 class="sub">シーズン</h3><ul class="dots"><li>1か月で1シーズン。毎月1日の午前${tz}時（日本時間）に新しいシーズンが始まる。</li><li>シーズンが終わると、ティアが${SIM.SEASON_DROP}つ下がったところから次のシーズンが始まる（例：HT1 → LT3）。</li><li>シーズン中にログインした人全員に、そのシーズンの記念バッジが配られる。</li></ul></section>`;
}

function secRewards() {
  const lv = n => SIM.xpToNext(n);
  const xpBase = SIM.matchXp(false, 0, false), xpWin = SIM.matchXp(true, 0, false) - xpBase, xpRound = SIM.matchXp(false, 1, false) - xpBase;
  const xpOnline = SIM.matchXp(true, 3, true) / SIM.matchXp(true, 3, false);
  const ex = [['CPU戦で 3-0 の勝ち', SIM.matchXp(true, 3, false)], ['CPU戦で 1-3 の負け', SIM.matchXp(false, 1, false)], ['オンラインで 3-1 の勝ち', SIM.matchXp(true, 3, true)]];
  const login = SIM.LOGIN_REWARDS.map((r, i) => `<li><b>${i + 1}日目</b>${esc(rewardText(r))}</li>`).join('');
  const streak = Object.keys(SIM.STREAK_MS).map(d => `<li><b>${d}日連続</b>${esc(rewardText(SIM.STREAK_MS[d]))}</li>`).join('');
  let passTotal = 0; for (let k = 0; k < SIM.PASS_TIERS; k++) passTotal += SIM.passCost(k);
  const skinTiers = Object.keys(SIM.PASS_ITEMS).map(Number), chaosTiers = [];
  for (let k = 1; k <= SIM.PASS_TIERS; k++) { const r = SIM.passReward(k); if (r.chaos && !r.item) chaosTiers.push(k); }
  const rar = r => t('rar.' + r);
  // ショップのおすすめ：中身の数とセールの値引き（11月のセールではない日で見る）
  const offers = SIM.shopOffers('2026-01-15', 'guest'), cnt = {};
  offers.forEach(o => { cnt[o.r] = (cnt[o.r] || 0) + 1; });
  let saleOff = 0; for (let d = 1; d <= 28 && !saleOff; d++) { const o = SIM.shopOffers('2026-01-' + String(d).padStart(2, '0'), 'guest').find(x => x.sale && x.r >= 2); if (o) saleOff = Math.round((1 - o.price / SIM.SHOP_PRICE[o.r]) * 100); }
  const offerTxt = Object.keys(cnt).map(r => rar(r) + cnt[r]).join('・');
  const reset = (24 - SIM.DAY_SHIFT_MS / 3600000 + 9) % 24;
  return `<section id="rewards">${sectionHead('rewards', '報酬と成長', '試合をするほど経験値とコインがたまり、見た目のアイテムが手に入る。')}
<div class="grid g-2">
<div class="card"><h3>経験値とレベル</h3><p>1試合で ${xpBase} XP、勝つと +${xpWin}、取ったラウンド1つにつき +${xpRound}。オンライン対戦は${xpOnline}倍。</p>
<table class="tbl mini"><tbody>${ex.map(e => `<tr><th scope="row">${esc(e[0])}</th><td>${e[1]} XP</td></tr>`).join('')}</tbody></table>
<p>次のレベルまでに要る経験値は、Lv.1 で ${lv(1)}、そこから1レベルごとに +${lv(2) - lv(1)}（最大 Lv.${SIM.LEVEL_MAX}）。レベルが上がるたびに${esc(t('eco.lucky'))}が1つ、5の倍数のレベルでは${esc(t('eco.chaos'))}ももらえる。</p></div>
<div class="card"><h3>ミッション</h3><p><b>${esc(t('eco.missions'))}</b>：毎日3つ（全員同じ）。日本時間の朝${reset}時に入れかわる。1つ終えるごとに${esc(t('eco.lucky'))}・${SIM.MISSION_XP} XP・コイン${SIM.MIS_COINS}・パスXP ${SIM.DAILY_PXP}。3つ全部で${esc(t('eco.chaos'))}も。</p>
<p><b>${esc(t('pass.missions'))}</b>：全${SIM.SEASON_MISSIONS.length}個。最初は${SIM.SEASON_FIRST}つで、1つ終えるごとに次の日からもう1つ増える。1つでパスXP ${SIM.SEASON_MIS_PXP}・コイン${SIM.SEA_COINS}。</p></div>
<div class="card"><h3>シーズンパス</h3><p>全${SIM.PASS_TIERS}段。パスXPで段が上がる（1段目は${SIM.passCost(0)}、1段ごとに +${SIM.passCost(1) - SIM.passCost(0)}。最後まで合計 ${passTotal}）。</p>
<ul class="dots"><li>スキン：${skinTiers.join('・')}段目（${skinTiers[skinTiers.length - 1]}段目は${esc(t('eco.chaos'))}×${SIM.passReward(SIM.PASS_TIERS).chaos}つき）</li><li>${esc(t('eco.chaos'))}：${chaosTiers.join('・')}段目</li><li>ほかの段：奇数は${esc(t('eco.lucky'))}、偶数はコイン${SIM.passReward(2).coins}</li></ul></div>
<div class="card"><h3>ログインボーナス</h3><p>7日で1周。</p><ul class="days">${login}</ul><p>連続ログインの記念：</p><ul class="days">${streak}</ul><p class="note">保安官の盾：7日連続ごとに1枚（最大${SIM.SHIELD_MAX}枚）。休んだ日に自動で使って、連続記録を守る。</p></div>
<div class="card"><h3>ショップ</h3><p>毎日入れかわる。無料ギフト1つと、おすすめ${offers.length}つ（${offerTxt}）。おすすめのうち1つはセールで約${saleOff}%オフ。</p>
<table class="tbl mini"><tbody>${[0, 1, 2, 3].map(r => `<tr><th scope="row">${esc(rar(r))}</th><td>コイン ${SIM.SHOP_PRICE[r]}</td></tr>`).join('')}<tr><th scope="row">${esc(t('eco.lucky'))}</th><td>コイン ${SIM.SHOP_BADGE.lucky}</td></tr><tr><th scope="row">${esc(t('eco.chaos'))}</th><td>コイン ${SIM.SHOP_BADGE.chaos}</td></tr></tbody></table>
<p class="note">11月はセール。11月11日は全部半額で、特別なギフトもある。</p></div>
<div class="card"><h3>バッジ（アイテムの入手）</h3><p><b>${esc(t('eco.lucky'))}</b>　${esc(t('eco.odds'))}。${SIM.PITY_AT}回以内にレジェンダリー以上が確定。</p><p><b>${esc(t('eco.chaos'))}</b>　${esc(t('eco.oddsChaos'))}。${esc(t('eco.chaosNote'))}。</p>
<p>持っているアイテムがかぶったときは、経験値とコインに変わる（${rar(0)} ${SIM.DUP_XP[0]} XP・コイン${SIM.DUP_COINS[0]} 〜 ${rar(4)} ${SIM.DUP_XP[4]} XP・コイン${SIM.DUP_COINS[4]}）。</p></div>
</div></section>`;
}

// 称号：ゲームでは取るまで名前も条件も見えないので、ガイドでも閉じておく。
// コンソールのわなで付く称号・運営から贈る称号は載せない。鬼帝の称号は CPU戦のネタバレ欄に書いてある
const TITLE_HIDE = ['rule_breaker', 'no_skill', 'liar', 'trusted_hacker', 'dev_tears', 'world_author', 'emperor_slayer'];
const TITLE_GROUPS = [
  ['最初から', ['rookie']],
  ['CPU戦', ['regular', 'bodyguard', 'demon_hunter', 'godslayer', 'legend', 'first_steps', 'one_pistol', 'wanderer']],
  ['勝ち数・負け数', ['veteran10', 'veteran50', 'veteran100', 'fall30', 'fall100']],
  ['オンライン対戦', ['debut', 'wanted', 'bounty_hunter', 'duel_king', 'unbeaten']],
  ['連勝', ['streak3', 'unstoppable', 'streak10', 'streak20', 'streak30', 'streak100']],
  ['試合の中で', ['untouched', 'close_call', 'precision', 'pit_drop', 'short_sleeper']],
  ['フレンド', ['partner', 'magnificent7']],
  ['シーズン・イベント', ['unrivaled', 'twin_unrivaled', 'pumpkin_king', 'snow_king']],
  ['はじめのころのプレイヤー', ['pioneer', 'first_ten']]
];
function secTitles() {
  const used = {}; TITLE_HIDE.forEach(id => { used[id] = 1; });
  const def = id => SIM.TITLES.find(d => d.id === id);
  const list = ids => ids.filter(def).map(id => { used[id] = 1; return `<tr><th scope="row"><span class="tt-name${def(id).rare ? ' rare' : ''}">${esc(t('title.' + id))}</span></th><td>${esc(t('tcond.' + id))}</td></tr>`; }).join('');
  let groups = TITLE_GROUPS.map(g => `<details class="spoiler"><summary>${esc(g[0])}</summary><table class="tbl titles"><tbody>${list(g[1])}</tbody></table></details>`).join('');
  // 武器ごと（とどめの回数）
  const kills = SIM.TITLES.filter(d => d.kill), steps = [...new Set(kills.map(d => d.kill.n))].sort((a, b) => a - b);
  const krows = W_IDS.map(w => `<tr><th scope="row">${esc(t('w.' + w + '.name'))}</th>${steps.map(n => { const d = kills.find(k => k.kill.w === w && k.kill.n === n); if (d) used[d.id] = 1; return `<td>${d ? `<span class="tt-name${d.rare ? ' rare' : ''}">${esc(t('title.' + d.id))}</span>` : '–'}</td>`; }).join('')}</tr>`).join('');
  groups += `<details class="spoiler"><summary>武器（その武器でとどめを決めた回数）</summary><div class="heat-scroll"><table class="tbl titles kills"><thead><tr><th scope="col">武器</th>${steps.map(n => `<th scope="col">${n}回</th>`).join('')}</tr></thead><tbody>${krows}</tbody></table></div></details>`;
  const rest = SIM.TITLES.filter(d => !used[d.id] && !d.award);
  if (rest.length) groups += `<details class="spoiler"><summary>そのほか</summary><table class="tbl titles"><tbody>${list(rest.map(d => d.id))}</tbody></table></details>`;
  return `<section id="titles">${sectionHead('titles', '称号', 'プロフィールの名前の上に付けられる二つ名。ゲームの中では、取るまで名前も条件も見えない。知りたい人だけ開いてください。')}
<div class="card">${groups}<p class="note">青く光る名前はレアな称号。</p></div></section>`;
}

function secEvents() {
  const evs = Object.keys(SIM.EVENTS).map(k => {
    const E = SIM.EVENTS[k], c = E.candy, pre = k === 'halloween' ? 'ev.' : 'ev.' + k + '.';
    const name = t(pre + 'title'), candy = t(pre + 'candy');
    return [E.month, `<div class="card event" data-month="${E.month}"><p class="theme">${E.month + 1}月</p><h3>${esc(name)} <span class="live" hidden>開催中</span></h3><p>${esc(t(pre + 'desc'))}。</p>
<ul class="dots"><li>1試合 +${c.match}、勝つと +${c.win}、倒した数×${c.kill}（1試合${c.killMax}回まで）、その日の最初の勝ち +${c.firstWin}。1日の上限は${c.dayMax}個。</li>
<li>毎日の${esc(t(pre + 'mis'))}（3つ）でも${esc(candy)}がもらえ、3つ全部で +${E.misBonus}。</li>
<li>イベント中に合計${E.title.need}個集めると、限定の称号（交換で使った分も数える）。</li>
<li>${esc(candy)}を集めるには Discord でのログインが必要。</li></ul></div>`];
  });
  const S = SIM.SALE;
  evs.push([10, `<div class="card event" data-month="10"><p class="theme">11月</p><h3>11.11 セール <span class="live" hidden>開催中</span></h3><ul class="dots"><li>11月のあいだ、ショップのアイテムが約${Math.round(S.itemOff * 100)}%オフ、バッジが${Math.round(S.badgeOff * 100)}%オフ。</li><li>11月11日は全部半額で、特別なギフト（${esc(rewardText(S.peakGift))}）。</li><li>「11」のチャレンジ：${S.goals.map(g => g.k === 'w' ? g.n + '勝' : g.k === 'k' ? g.n + '回倒す' : g.n + '日遊ぶ').join('・')}。達成すると報酬がもらえる。</li></ul></div>`]);
  evs.sort((a, b) => a[0] - b[0]);
  return `<section id="events">${sectionHead('events', 'イベント', `イベントはその月のあいだずっと開かれる（日本時間では毎月1日の午前${G.monthStartJst}時から）。`)}
<div class="grid g-3">${evs.map(e => e[1]).join('')}</div></section>`;
}

function secFaq() {
  return `<section id="faq">${sectionHead('faq', 'よくある質問')}
<div class="card">${TXT.faq.map(f => `<details class="qa"><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join('')}</div></section>`;
}

// ============================================================
// ページ全体
// ============================================================
const NAV = [['start', 'はじめに'], ['controls', '操作'], ['rules', 'ルール'], ['weapons', '武器'], ['ttk', '距離別'], ['tactics', '立ち回り'], ['stages', 'ステージ'], ['cpu', 'CPU戦'], ['online', 'オンライン'], ['rewards', '報酬'], ['titles', '称号'], ['events', 'イベント'], ['faq', 'Q&A']];
const SCRIPT = `
(function(){
  // 見ている場所の目次を光らせる
  var links={};document.querySelectorAll('.nav a').forEach(function(a){links[a.getAttribute('href').slice(1)]=a;});
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var a=links[e.target.id];if(!a)return;document.querySelectorAll('.nav a.on').forEach(function(x){x.classList.remove('on');});a.classList.add('on');try{a.scrollIntoView({block:'nearest',inline:'center'});}catch(_){}}});},{rootMargin:'-45% 0px -50% 0px'});
    Object.keys(links).forEach(function(id){var s=document.getElementById(id);if(s)io.observe(s);});}
  // 武器を種類でしぼりこむ
  document.querySelectorAll('.chips .chip').forEach(function(b){b.addEventListener('click',function(){
    var c=b.getAttribute('data-cat');document.querySelectorAll('.chips .chip').forEach(function(x){var on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on?'true':'false');});
    document.querySelectorAll('.weapon').forEach(function(w){w.hidden=!(c==='all'||w.getAttribute('data-cat')===c);});});});
  // 距離ごとの表：並べかえと、なぞったときの説明
  var tb=document.querySelector('.heat tbody'),orig=tb?Array.prototype.slice.call(tb.rows):[],cur=-1;
  document.querySelectorAll('.heat .sort').forEach(function(b){b.addEventListener('click',function(){
    var i=+b.getAttribute('data-col');document.querySelectorAll('.heat .sort').forEach(function(x){x.classList.remove('on');x.removeAttribute('aria-sort');});
    if(cur===i){cur=-1;orig.forEach(function(r){tb.appendChild(r);});return;}
    cur=i;b.classList.add('on');b.parentNode.setAttribute('aria-sort','ascending');
    orig.slice().sort(function(a,c){var x=a.cells[i+1].getAttribute('data-v'),y=c.cells[i+1].getAttribute('data-v');return(x==null?1e9:+x)-(y==null?1e9:+y);}).forEach(function(r){tb.appendChild(r);});});});
  // 表が画面に入りきらないときだけ、横にスクロールできることを知らせる
  var hs=document.querySelector('.heat-wrap .heat-scroll'),hint=document.querySelector('.scroll-hint');
  function fitHint(){if(hs&&hint)hint.hidden=hs.scrollWidth<=hs.clientWidth+1;}
  fitHint();window.addEventListener('resize',fitHint);
  var tt=document.querySelector('.tt');
  function show(td){if(!tt||!td.getAttribute('data-tip'))return;tt.textContent=td.getAttribute('data-tip');tt.hidden=false;var r=td.getBoundingClientRect();
    tt.style.left=Math.max(8,Math.min(window.innerWidth-tt.offsetWidth-8,r.left+r.width/2-tt.offsetWidth/2))+'px';tt.style.top=(r.top+window.scrollY-tt.offsetHeight-8)+'px';}
  function hide(){if(tt)tt.hidden=true;}
  document.querySelectorAll('.heat td').forEach(function(td){td.addEventListener('pointerenter',function(){show(td);});td.addEventListener('pointerleave',hide);});
  // 開催中のイベント（シンガポール時間の月）
  var m=new Date(Date.now()+8*3600000).getUTCMonth();
  document.querySelectorAll('.event').forEach(function(e){if(+e.getAttribute('data-month')===m){var l=e.querySelector('.live');if(l)l.hidden=false;e.classList.add('now');}});
})();`;

function page() {
  const built = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const desc = 'GUN DUEL の攻略ガイド。全' + WEP.length + '武器の性能と距離ごとの倒すまでの時間、ステージの特ちょう、立ち回りのコツ、ランクと報酬のしくみ。数字はゲームの計算そのまま。';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GUN DUEL 攻略ガイド｜武器・ステージ・立ち回り</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="GUN DUEL 攻略ガイド">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}guide/">
<meta property="og:image" content="${SITE}guide/img/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#07080C">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23FFC53D' stroke-width='3'/%3E%3Cpath d='M16 2v8M16 22v8M2 16h8M22 16h8' stroke='%23FFC53D' stroke-width='3'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,600;0,700;1,700&family=Dela+Gothic+One&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top"><div class="wrap bar"><a class="logo" href="#top" aria-label="ページの先頭へ"><span>GUN DUEL</span><small>攻略ガイド</small></a><a class="play" href="../">ゲームで遊ぶ</a></div>
<nav class="nav" aria-label="目次"><div class="wrap">${NAV.map(n => `<a href="#${n[0]}">${esc(n[1])}</a>`).join('')}</div></nav></header>
<main id="top">
<div class="hero"><div class="wrap"><p class="kicker">STRATEGY GUIDE</p><h1><span class="lg-logo">GUN DUEL</span><br><span class="lg-sub">攻略ガイド</span></h1><p>武器の性能・ステージ・立ち回り。数字はすべて、ゲームの中の計算からそのまま作っています。</p></div></div>
<div class="wrap">
${secStart()}
${secControls()}
${secRules()}
${secWeapons()}
${secTtk()}
${secLoadout()}
${secTactics()}
${secStages()}
${secCpu()}
${secOnline()}
${secRewards()}
${secTitles()}
${secEvents()}
${secFaq()}
</div></main>
<footer class="foot"><div class="wrap"><a class="play" href="../">ゲームで遊ぶ</a><p>このページは、ゲームが更新されるたびに自動で作り直されます（最終更新：${built}）。</p></div></footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

function build(outRoot) {
  const out = path.join(outRoot, 'guide'), src = path.join(root, 'guide');
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), page());
  fs.copyFileSync(path.join(src, 'style.css'), path.join(out, 'style.css'));
  for (const f of fs.readdirSync(path.join(src, 'img'))) fs.copyFileSync(path.join(src, 'img', f), path.join(out, 'img', f));
  return out;
}
module.exports = { build };
if (require.main === module) {
  const out = build(path.resolve(process.argv[2] || path.join(root, 'dist')));
  console.log('攻略ガイドを作りました：', out);
}
