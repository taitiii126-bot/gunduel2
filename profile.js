'use strict';
// プロフィール（名前・ひとこと・称号・見た目・背景・CPU戦の成績とティア）をサーバーに保存するための整形
// 中身はブラウザからの自己申告なので、形と長さだけ整えて保存する（オンライン戦績だけはサーバーが数える）
const { SIM } = require('./game');

const DIFFS = ['easy', 'normal', 'hard', 'pro', 'god'];
const TIER_KEYS = ['', 'LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1'];
const MAX_TIER = TIER_KEYS.length - 1;
// Discord に出すときのティアの色（ゲームのティアの色と同じ）
const TIER_COLORS = { LT5: 0x8A919B, HT5: 0xC07A45, LT4: 0xB8C2CE, HT4: 0xE3E8EE, LT3: 0xD9A331,
  HT3: 0xF5C84C, LT2: 0xC81E3A, HT2: 0xE0314B, LT1: 0xE8C66A, HT1: 0xFFF4D6 };

// 見えない制御文字を落として、文字数（絵文字も1文字）で切る
function text(v, max) {
  let n = '';
  for (const ch of String(v == null ? '' : v)) { const c = ch.codePointAt(0); if (c >= 32 && c !== 127) n += ch; }
  return Array.from(n.trim()).slice(0, max).join('').trim();
}
const int = (v, lo, hi, d) => { const n = Math.floor(+v); return n >= lo && n <= hi ? n : d; };

// ティア＝倒したCPUの強さ（ブラウザの computeTierIndex と同じ）
function tierIndex(prog) {
  let idx = 0;
  DIFFS.forEach((d, i) => { const p = prog && prog[d]; if (p && p.beat) idx = 1 + i * 2 + (p.straight ? 1 : 0); });
  return idx;
}

// 称号のための記録：獲得済みの称号・武器ごとのとどめの数・ステージごとの勝利数・連勝
const TITLE_IDS = SIM.TITLES.map(t => t.id);
const STAGE_IDS = Object.keys(SIM.STAGES);
function cleanAch(a) {
  a = a && typeof a === 'object' ? a : {};
  const got = {}, kills = {}, stages = {};
  if (a.got && typeof a.got === 'object') for (const id of Object.keys(a.got).slice(0, 100)) if (TITLE_IDS.includes(id) && a.got[id]) got[id] = 1;
  for (const wid of SIM.WEAPON_IDS) kills[wid] = int(a.kills && a.kills[wid], 0, 999999, 0);
  for (const sid of STAGE_IDS) stages[sid] = int(a.stages && a.stages[sid], 0, 999999, 0);
  return { got, kills, stages, streak: int(a.streak, 0, 999999, 0), best: int(a.best, 0, 999999, 0) };
}
// 使えない称号（オンライン戦績などが足りない）は初期の称号に戻す
const validTitle = (id, ctx) => (typeof id === 'string' && SIM.titleOk(id, ctx) ? id : 'rookie');

// ctx：称号の確認に使う本人の情報（オンライン戦績・フレンド数・開拓者か）
function clean(v, ctx) {
  v = v && typeof v === 'object' ? v : {};
  const stats = {}, prog = {};
  for (const d of DIFFS) {
    const s = (v.stats && v.stats[d]) || {}, p = (v.tierProgress && v.tierProgress[d]) || {};
    stats[d] = { w: int(s.w, 0, 999999, 0), l: int(s.l, 0, 999999, 0) };
    prog[d] = { beat: p.beat === true, straight: p.beat === true && p.straight === true };
  }
  const best = Math.max(tierIndex(prog), int(v.bestTier, 0, MAX_TIER, 0));
  return {
    name: text(v.name, 12) || 'プレイヤー',
    bio: text(v.bio, 40),
    title: validTitle(v.title, ctx),
    look: SIM.cleanLook(v.look),
    loadout: SIM.cleanLoadout(v.loadout, false),         // フレンドのカードに出す武器（3つ）
    bg: v.bg == null ? null : int(v.bg, 0, best, null),   // 解放していない背景は選べない
    bestTier: best,
    stats, tierProgress: prog,
    ach: cleanAch(v.ach),
  };
}

// 別の端末で先に保存されていたとき：名前や見た目は今回の内容、戦績と進み具合は大きい方を残す
function merge(old, inc) {
  const out = Object.assign({}, inc, { stats: {}, tierProgress: {} });
  for (const d of DIFFS) {
    const a = old.stats[d], b = inc.stats[d], pa = old.tierProgress[d], pb = inc.tierProgress[d];
    out.stats[d] = { w: Math.max(a.w, b.w), l: Math.max(a.l, b.l) };
    const beat = pa.beat || pb.beat;
    out.tierProgress[d] = { beat, straight: beat && (pa.straight || pb.straight) };
  }
  out.bestTier = Math.max(old.bestTier, inc.bestTier, tierIndex(out.tierProgress));
  // 称号の記録：獲得済みは合わせ、数は大きい方
  const oa = old.ach, ia = inc.ach, got = Object.assign({}, oa.got, ia.got), kills = {}, stages = {};
  for (const k of Object.keys(ia.kills)) kills[k] = Math.max(oa.kills[k] || 0, ia.kills[k]);
  for (const k of Object.keys(ia.stages)) stages[k] = Math.max(oa.stages[k] || 0, ia.stages[k]);
  out.ach = { got, kills, stages, streak: ia.streak, best: Math.max(oa.best, ia.best) };
  return out;
}

function cpuTotals(p) {
  let w = 0, l = 0;
  if (p) for (const d of DIFFS) { w += p.stats[d].w; l += p.stats[d].l; }
  return { w, l };
}

module.exports = { DIFFS, TIER_KEYS, TIER_COLORS, text, tierIndex, clean, merge, cpuTotals, validTitle };
