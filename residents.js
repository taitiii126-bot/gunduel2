'use strict';
// 住人：サーバーの中で暮らすプレイヤー
// 名簿（residents.json）の人を、ほかの人と同じアカウントとして持つ。ランキング・プレイヤー検索・クラン・フレンドに、人と同じように出る
//   ・毎日、その人の時間帯（日本時間の夕方〜夜が多い）にオンラインになり、ランクマッチ・カジュアル・2v2・CPU戦をする（結果はサーバーの中で決める）
//   ・列で待っている人の相手がいないときは、名前のないBOTの代わりに、近いレートの住人が相手になる（結果は住人の記録にも残る）
//   ・フレンド申請は、しばらくしてから受ける（受けない人もいる）。住人のクランへの参加の申請も、しばらくしてから受ける・断る
//   ・ときどき、人が作ったクランに入る（めったに抜けない）
//   ・レートはチャンピオンⅠ（1990）の手前まで。シーズン1位の「天下無双」と、開拓者（最初の100人）には数えない
// 環境変数 RESIDENT_BOTS=0 で、全員を消す（アカウント・クラン・フレンドから）。名簿から消した人も、次に起動したときに消える
const fs = require('fs');
const path = require('path');
const G = require('./game');
const { SIM } = G;
const P = require('./profile');
const bots = require('./bots');
const auth = require('./auth');
const clans = require('./clans');
const presence = require('./presence');

const ON = process.env.RESIDENT_BOTS !== '0';
const RATE_MAX = SIM.TIER_MIN[19] - 1;          // チャンピオンⅠ（1990）の手前まで
const TICK_MS = 15000;
const MIN = 60e3, DAY = 864e5, JST = 9 * 3600e3;
// 落ち着くレート（ランクごとの範囲から、人ごとに決まる）
const RANGE = { bronze: [1030, 1085], iron: [1095, 1170], gold: [1190, 1350], platinum: [1370, 1530], legend: [1555, 1680], master: [1730, 1960] };
const RANK_TOP = { bronze: SIM.TIER_MIN[4] - 1, iron: SIM.TIER_MIN[7] - 1, gold: SIM.TIER_MIN[10] - 1, platinum: SIM.TIER_MIN[13] - 1, legend: SIM.TIER_MIN[16] - 1, master: RATE_MAX };   // 名簿のランクより上には行かない
const CLIMB_FROM = [1190, 1290], CLIMB_DAYS = 10;   // climb の人：はじめて動いた日はこのあたり（ゴールド）から、10日かけて上がる
const ROLE_OF = { coleader: 3, officer: 2, member: 1, recruit: 0 };
const FRIEND_YES = 0.85, CLAN_YES = 0.8;            // フレンド申請を受ける割合・クランの申請を受ける割合
const JOIN_HUMAN_EVERY = 2.5 * DAY;                 // 人のクランに入る（住人みんなで、だいたいこの間に1人）
const LEAVE_HUMAN_PER_DAY = 0.007;                  // 人のクランから抜ける（1人・1日あたり）
// 遊ぶ量：その日に遊ぶ割合・1回の長さ（分）・1日に2回遊ぶ割合
const ACT = {
  heavy: { pDay: 0.88, len: [60, 170], multi: 0.55 },
  regular: { pDay: 0.62, len: [35, 100], multi: 0.25 },
  casual: { pDay: 0.36, len: [15, 50], multi: 0.08 },
  login: { pDay: 0.92, len: [4, 14], multi: 0 },
};
// 遊び始める時刻（日本時間・時。24 より大きいのは夜中）。wd＝平日、we＝土日
const TIME = {
  evening: { wd: [[18.5, 22.5]], we: [[13, 17], [19, 22.5]] },
  night: { wd: [[21.5, 25]], we: [[20, 25.5]] },
  student: { wd: [[16.3, 18], [20, 22]], we: [[10, 12.5], [14, 21]] },
  afternoon: { wd: [[12, 15.5]], we: [[11, 16]] },
};
const STAGE_IDS = Object.keys(SIM.STAGES);
const DIFFS = P.DIFFS;

// ---- 決まった乱数（同じ人・同じ日なら、いつ計算しても同じ）----
function hash(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const U = (r, a, b) => a + (b - a) * r();
const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function pickW(r, list) { const s = list.reduce((a, x) => a + x[1], 0); let v = r() * s; for (const x of list) { v -= x[1]; if (v <= 0) return x[0]; } return list[list.length - 1][0]; }
const unit = s => (hash(s) % 100000) / 100000;   // 0〜1（文字から決まる）

let roster = { clans: [], people: [] };
const specs = new Map();     // key → 名簿の1人
const plans = new Map();     // uid → その人の決まり（強さ・時間帯など）
const live = new Map();      // uid → { on, act, next, extra }（今の様子。保存しない）
const busy = new Map();      // uid → 部屋の番号（人との試合中）
let hooks = { pushTo() {}, cardOf() { return null; }, log() {} };
let timer = null;
let seeding = null;          // 前の試合をまとめて行っている間：クランのポイントをためておく（[uid, 勝ち, 時刻]）

function loadRoster() {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'residents.json'), 'utf8'));
    const people = (Array.isArray(r.people) ? r.people : []).filter(p => {
      const okp = p && /^[A-Za-z0-9_]{1,16}$/.test(String(p.key || '')) && P.clean({ name: p.name }).name === String(p.name || '').trim();
      if (!okp) hooks.log('residents.json: 使えない人（key か名前。名前は12文字まで・禁止ワードなし）', JSON.stringify(p && { key: p.key, name: p.name }));
      return okp;
    });
    return { clans: Array.isArray(r.clans) ? r.clans.filter(c => c && c.key && c.name && c.tag) : [], people };
  } catch (e) { hooks.log('residents.json を読めません:', e.message); return null; }
}

// ---- その人の決まり（名簿と key から決まる。保存しない）----
function planOf(spec) {
  const r = rng(hash('plan:' + spec.key));
  const rank = RANGE[spec.rank] ? spec.rank : 'gold', rg = RANGE[rank];
  const skill = Math.round(U(r, rg[0], rg[1]));
  const play = ACT[spec.play] ? spec.play : pickW(r, rank === 'master' || rank === 'legend' ? [['heavy', 6], ['regular', 3]]
    : rank === 'platinum' ? [['heavy', 3], ['regular', 5], ['casual', 1]] : rank === 'gold' ? [['heavy', 2], ['regular', 5], ['casual', 3]] : [['regular', 4], ['casual', 6]]);
  const time = TIME[spec.time] ? spec.time : pickW(r, [['evening', 6], ['night', 3], ['student', 2]]);
  return {
    key: spec.key, rank, skill, play, time, A: ACT[play], T: TIME[time],
    climb: !!spec.climb, from: Math.round(U(r, CLIMB_FROM[0], CLIMB_FROM[1])),
    wr: 0.42 + 0.14 * (skill - 1000) / 1000 + U(r, -0.03, 0.03),   // ふだんの勝率
    p2: U(r, 0.05, 0.3),                                            // 2v2 をする割合
    cpu: U(r, 0.04, 0.18),                                          // 合間に CPU 戦をする割合
    sk: clamp((skill - 1000) / 900, 0, 1),
  };
}
// 今の強さ（climb の人は、はじめて動いた日から少しずつ上がる）
function skillAt(pl, u, t) {
  if (!pl.climb) return pl.skill;
  const t0 = (u.npc && u.npc.t0) || t, f = clamp((t - t0) / (CLIMB_DAYS * DAY), 0, 1);
  return Math.round(pl.from + (pl.skill - pl.from) * f);
}

// ---- 1日の予定（日本時間の日ごと）----
const jstDay = t => Math.floor((t + JST) / DAY);
function sessionsOn(pl, d) {
  const r = rng(hash(pl.key + ':' + d)), dow = (d + 4) % 7, we = dow === 0 || dow === 6;   // 1970-01-01 は木曜
  if (r() > Math.min(0.97, pl.A.pDay + (we ? 0.1 : 0))) return [];
  const wins = we ? pl.T.we : pl.T.wd, n = r() < pl.A.multi * (we ? 1 : 0.6) ? 2 : 1, out = [];
  for (let i = 0; i < n; i++) {
    const w = n === 2 ? wins[Math.min(i, wins.length - 1)] : pick(r, wins);
    const h = U(r, w[0], w[1]), len = pl.A.len[0] + (pl.A.len[1] - pl.A.len[0]) * Math.pow(r(), 1.4);
    const from = d * DAY - JST + Math.round(h * 3600e3), to = from + Math.round(len * MIN);
    if (out.length && from < out[out.length - 1][1] + 20 * MIN) continue;   // 続けて遊ぶ分は、前のにまとめる
    out.push([from, to]);
  }
  return out;
}
function sessionAt(pl, t) {
  const d = jstDay(t);
  for (const dd of [d - 1, d]) for (const s of sessionsOn(pl, dd)) if (t >= s[0] && t < s[1]) return s;
  return null;
}
// t より前で、最後に遊び終えた時刻（最後にオンラインだった時刻に使う）
function lastOff(pl, t, floor) {
  for (let d = jstDay(t); d > jstDay(t) - 30; d--) {
    const L = sessionsOn(pl, d).filter(s => s[1] <= t);
    if (L.length) return Math.max(floor || 0, L[L.length - 1][1]);
  }
  return floor || 0;
}

// ---- 試合（サーバーの中で決める）----
function loadoutOf(u) { const l = u.profile && Array.isArray(u.profile.loadout) && u.profile.loadout.length === 3 ? u.profile.loadout : SIM.DEFAULT_LOADOUT; return l.slice(); }
// 1試合ぶんの記録（称号・ミッション・武器ごとの戦績のもと）。rw＝取ったラウンド、rl＝取られたラウンド
function fakeTally(pl, u, o, r) {
  const T = SIM.newTally(), load = loadoutOf(u), share = [0.55, 0.3, 0.15];
  T.rounds = o.rw + o.rl; T.roundsWon = o.rw;
  const useW = () => { let v = r(); for (let i = 0; i < 3; i++) { v -= share[i]; if (v <= 0) return load[i]; } return load[0]; };
  const kills = o.two ? Math.round(U(r, 0, o.rw + 1.6)) : o.rw;   // 1v1：取ったラウンド＝倒した数。2v2 は人によって
  for (let i = 0; i < kills; i++) { const w = useW(); T.kills[w] = (T.kills[w] || 0) + 1; T.killList.push(w); }
  const acc = 0.26 + 0.26 * pl.sk + U(r, -0.06, 0.06);
  load.forEach((w, i) => {
    if (!SIM.WEAPONS[w]) return;
    const shots = Math.round(T.rounds * U(r, 3, 10) * share[i]);
    if (!shots && !T.kills[w]) return;
    const hits = Math.min(shots, Math.round(shots * acc * U(r, 0.8, 1.2)));
    T.ws[w] = [shots, hits]; T.shots += shots; T.hits += hits;
  });
  for (let i = 0; i < o.rw; i++) { if (r() < 0.05 + 0.1 * pl.sk) T.nodmg++; if (r() < 0.12) T.closeCall++; }
  T.rolls = Math.round(T.rounds * U(r, 0.3, 3)); T.rolldodges = T.rolls && r() < 0.25 ? 1 : 0;
  return T;
}
// オンラインの1試合を終える（ランクかどうか・勝ち負けは、今のレートと強さで決める）
// rateOnly：ランクのレートだけを動かす（今のシーズンのランクの記録を作り直すとき。ほかの記録は足さない）
function playOnline(u, pl, act, t, r, rateOnly) {
  const two = !!act.two, st = two ? auth.rating2(u.id) : auth.rating(u.id), R = st.rate, S = skillAt(pl, u, t) - (two ? 40 : 0);
  // 強さに届いていないうちは、ランクマッチを多く。届いたら、たまにだけ（少しずつ上がる）。名簿のランクのいちばん上の近くまで来たら、ランクはしない
  let pr = R < S - 30 ? 0.8 : R < S + 20 ? 0.4 : 0.06;
  if (SIM.RATE_LOSS[SIM.tierOfRate(R)] === 0 && R >= S) pr = 0.06;           // 負けても減らない段では、届いたらたまにだけ
  if (R >= RANK_TOP[pl.rank] - 18) pr = 0;
  const ranked = r() < pr;
  const win = r() < clamp(pl.wr + (ranked ? 0.12 * (S - R) / 100 : 0), 0.1, 0.82);
  const lost = pickW(r, [[0, 0.4], [1, 0.35], [2, 0.25]]), N = G.WIN_ROUNDS;
  const rw = win ? N : lost, rl = win ? lost : N;
  const theirs = Math.round(R + U(r, -45, 45));
  if (rateOnly) return ranked ? auth.npcMatch(u.id, { mode: 'online', rateOnly: true, win, two, ranked, mine: R, theirs, rw, rl, max: RATE_MAX }) : null;
  const res = auth.npcMatch(u.id, { mode: 'online', win, two, ranked, mine: R, theirs, rw, rl, max: RATE_MAX,
    stage: pick(r, STAGE_IDS), tally: fakeTally(pl, u, { win, rw, rl, two }, r) });
  if (seeding) seeding.push([u.id, win, t]); else clans.addMatch(u.id, win);
  return res;
}
// CPU戦（難しさは強さに合わせて選ぶ）
function playCpu(u, pl, t, r) {
  const sk = clamp((skillAt(pl, u, t) - 1000) / 900, 0, 1);
  const diff = pickW(r, [['easy', 0.4 + 2 * (1 - sk)], ['normal', 1.6], ['hard', 1 + 1.5 * sk], ['pro', 2.5 * sk], ['god', 1.6 * sk * sk]]);
  const di = DIFFS.indexOf(diff), win = r() < clamp(0.62 + (sk * 4 - di) * 0.17, 0.05, 0.95);
  const lost = pickW(r, [[0, 0.45], [1, 0.33], [2, 0.22]]), N = G.WIN_ROUNDS, rw = win ? N : lost, rl = win ? lost : N;
  return auth.npcMatch(u.id, { mode: 'cpu', diff, win, straight: win && rl === 0, stage: pick(r, STAGE_IDS), tally: fakeTally(pl, u, { win, rw, rl }, r) });
}
function newAct(pl, t, r) {
  if (r() < pl.cpu) return { kind: 'cpu', end: t + Math.round(U(r, 90, 200) * 1000) };
  const two = r() < pl.p2;
  return { kind: 'online', two, end: t + Math.round(U(r, two ? 140 : 100, two ? 300 : 230) * 1000) };
}
const gap = r => Math.round((r() < 0.12 ? U(r, 180, 540) : U(r, 20, 120)) * 1000);   // 試合と試合の間（ときどき長め）
function finish(u, pl, act, t, r) { return act.kind === 'cpu' ? playCpu(u, pl, t, r) : playOnline(u, pl, act, t, r); }

// ---- 住人を作る ----
function discordName(name, r) {
  const x = r(), base = name.normalize('NFKC').replace(/[^A-Za-z0-9_.]/g, '').toLowerCase();
  if (x < 0.35) return name;                                                           // ゲームと同じ名前
  if (base.length >= 3 && x < 0.75) return (base + (r() < 0.4 ? pick(r, bots.NUMS()) : '')).slice(0, 12);
  return (pick(r, bots.ROMA) + (r() < 0.6 ? pick(r, bots.NUMS()) : r() < 0.5 ? '_' : '')).slice(0, 12);
}
// 前のシーズンまでの記録（まとめて作る）と、プロフィール
function profileFor(u, spec, pl, preDays, r) {
  const look = bots.botLook(pl.skill, r), loadout = Array.isArray(spec.loadout) && spec.loadout.length === 3 ? SIM.cleanLoadout(spec.loadout, false) : bots.botLoadout(pl.skill, r);
  const inv = [];
  for (const k of ['hat', 'outfit', 'neck', 'win']) { const it = SIM.itemOf(k, look[k]); if (it && inv.indexOf(it.id) < 0) inv.push(it.id); }
  for (let i = Math.floor(U(r, 0, 4 + 10 * pl.sk)); i > 0; i--) { const it = pick(r, SIM.ITEMS); if (!it.ev && !it.pass && inv.indexOf(it.id) < 0) inv.push(it.id); }   // 着ていない物も少し
  // オンライン（カジュアルが中心）
  const perDay = { heavy: 8, regular: 4.5, casual: 2.2, login: 0.4 }[pl.play];
  const onl = Math.round(preDays * pl.A.pDay * perDay * U(r, 0.5, 1));
  const ow = Math.round(onl * clamp(pl.wr + U(r, -0.04, 0.04), 0.2, 0.8));
  u.online = { w: ow, l: onl - ow };
  u.npc.pre = ow * clans.PTS_WIN + (onl - ow) * clans.PTS_PLAY;   // クランに入ったときに足す、前のポイント
  // CPU戦
  const stats = {}, prog = {}, nCpu = Math.round(onl * U(r, 0.2, 0.8) + U(r, 3, 25));
  let cw = 0, cl = 0;
  DIFFS.forEach((d, i) => {
    const share = [0.25 + 0.3 * (1 - pl.sk), 0.3, 0.15 + 0.2 * pl.sk, 0.25 * pl.sk, 0.12 * pl.sk * pl.sk][i];
    const n = Math.round(nCpu * share * U(r, 0.6, 1.4)), w = Math.round(n * clamp(0.62 + (pl.sk * 4 - i) * 0.17, 0.03, 0.95));
    stats[d] = { w, l: n - w }; cw += w; cl += n - w;
    prog[d] = { beat: w > 0, straight: w > 2 && r() < 0.35 };
  });
  const emp = pl.sk > 0.75 ? { w: r() < 0.4 ? 1 + Math.floor(r() * 2) : 0, l: Math.floor(U(r, 1, 9)), beat: false, seen: true } : { w: 0, l: r() < 0.3 ? Math.floor(U(r, 1, 3)) : 0, beat: false, seen: r() < 0.5 };
  emp.beat = emp.w > 0;
  // 倒した数（使っている武器が多め。前に使っていた武器も少し）
  const kills = {}, killsAll = Math.round((ow + cw) * 3 + (onl - ow + cl) * 1.2);
  for (let i = 0; i < killsAll; i++) { const w = r() < 0.8 ? loadout[pickW(r, [[0, 0.55], [1, 0.3], [2, 0.15]])] : pick(r, SIM.WEAPON_IDS); kills[w] = (kills[w] || 0) + 1; }
  const stages = {}; for (let i = 0; i < cw; i++) { const s = pick(r, STAGE_IDS); stages[s] = (stages[s] || 0) + 1; }
  const wins = ow + cw, best = Math.min(wins, Math.round(U(r, 2, 5) + pl.sk * U(r, 2, 11)));
  const evt = { untouched: Math.round(wins * (0.05 + 0.1 * pl.sk) * U(r, 0.4, 1)), close_call: Math.round(wins * U(r, 0.1, 0.35)),
    precision: pl.sk > 0.5 && r() < 0.5 ? 1 + Math.floor(r() * 3) : 0, first_steps: prog.hard.beat && stats.easy.w > 0 ? 1 : 0, pit_drop: r() < 0.3 ? 1 : 0 };
  const xp = Math.round(onl * U(r, 100, 125) + (cw + cl) * U(r, 65, 80));
  const raw = {
    name: spec.name, bio: typeof spec.bio === 'string' ? spec.bio : pick(r, bots.BIOS), title: 'rookie', look, loadout, inv, xp,
    stats, tierProgress: prog, emperor: emp, ach: { got: {}, kills, stages, evt, streak: Math.floor(U(r, 0, best + 1)), best },
    coins: Math.floor(U(r, 50, 3000)), gems: Math.floor(U(r, 0, 120)), badge: null, bg: null, bestTier: 0, epoch: SIM.PROFILE_EPOCH,
  };
  const ctx = auth.titleCtx(u), proof = { stats, tierProgress: prog, ach: raw.ach, emperor: emp };
  for (const t of SIM.TITLES) if (SIM.titleProof(t.id, proof, ctx)) raw.ach.got[t.id] = 1;   // 記録で取れている称号は、獲得済み
  return auth.npcProfile(u.id, raw);
}
// 付ける称号を選ぶ（取れている物から。はじめたばかりの人は最初の称号のまま。友だちの数で取る称号は、外れることがあるので選ばない）
const TITLE_SKIP = new Set(['unbeaten', 'partner', 'magnificent7', 'pioneer', 'first_ten', 'rule_breaker', 'no_skill', 'liar', 'short_sleeper', 'trusted_hacker', 'dev_tears', 'world_author']);
function chooseTitle(u, pl, r) {
  const p = u.profile;
  if (!p) return;
  const ctx = auth.titleCtx(u), proof = { stats: p.stats, tierProgress: p.tierProgress, ach: p.ach, emperor: p.emperor };
  const ok = SIM.TITLES.filter(t => !TITLE_SKIP.has(t.id) && !t.gift && !t.award && SIM.titleProof(t.id, proof, ctx));
  const title = !ok.length || r() < 0.35 * (1 - pl.sk) ? 'rookie' : pickW(r, ok.map(t => [t.id, t.id === 'rookie' ? 0.3 : t.rare ? 1 + 3 * pl.sk : 1]));
  if (title !== p.title) auth.npcProfile(u.id, Object.assign({}, p, { title }));
}
function createUser(spec, pl, now, minAge) {
  const r = rng(hash('make:' + spec.key));
  const age = Math.max(minAge || 0, pl.climb ? U(r, 8, 25) : Math.pow(r(), 0.8) * 58 + 2);   // はじめた日（新しい人が多め）
  const created = Math.round(now - age * DAY - U(r, 0, 0.9) * DAY);
  const badges = []; for (let s = SIM.seasonNo(created); s <= SIM.seasonNo(now); s++) badges.push(s);
  let dn = discordName(spec.name, r);
  const used = new Set(auth.npcUsers().map(x => String(x.name).toLowerCase()));
  while (used.has(dn.toLowerCase())) dn = dn.replace(/[0-9_]+$/, '').slice(0, 9) + Math.floor(U(r, 10, 999));   // 同じ名前の住人がいたら、数字を足す
  const u = auth.npcAdd({ id: 'npc_' + spec.key, name: dn, created, online: { w: 0, l: 0 }, npc: { k: spec.key, t0: now, cl: spec.climb ? 1 : 0 }, badges: SIM.cleanBadges(badges), lastSeen: 0 });
  if (!u) return null;
  const preDays = Math.max(0, (SIM.seasonStart(now) - created) / DAY);
  profileFor(u, spec, pl, preDays, r);
  return u;
}
// 今のシーズンの試合を、はじめから今まで順に行う（ほかの人と同じ形の記録・レートの動き・クランの週のポイントになる）
// その人が from から now までに遊んだ試合（予定どおり）
function actsOf(u, pl, from, now, r, out) {
  for (let d = jstDay(from) - 1; d <= jstDay(now); d++) for (const s of sessionsOn(pl, d)) {
    let t = Math.max(s[0], from) + Math.round(U(r, 5, 60) * 1000);
    while (t < Math.min(s[1], now) - 2 * MIN) {
      const act = newAct(pl, t, r);
      if (act.end > now) break;
      out.push({ u, pl, act, r }); t = act.end + gap(r);
    }
  }
  return out;
}
function seedSeason(users, now) {
  const evs = [], start = SIM.seasonStart(now);
  for (const u of users) actsOf(u, plans.get(u.id), Math.max(u.created, start), now, rng(hash('seed:' + u.id)), evs);
  evs.sort((a, b) => a.act.end - b.act.end);
  const real = Date.now;
  seeding = [];
  try {
    for (const e of evs) { const t = e.act.end; Date.now = () => t; finish(e.u, e.pl, e.act, t, e.r); }   // 記録の時刻を、その試合の時刻にする
  } finally { Date.now = real; }
  // クランのポイント：今週の分は今週にも、前の週の分は合計にだけ（ほかの人の今週のポイントを消さないように）
  const wk = clans.weekKey(now), pts = seeding; seeding = null;
  for (const [uid, win, t] of pts) { if (clans.weekKey(t) === wk) clans.addMatch(uid, win); else clans.npcPts(uid, win ? clans.PTS_WIN : clans.PTS_PLAY); }
  return evs.length;
}

// あとから climb にした人：今のシーズンのランクの記録（1v1・2v2 のレートと、その動き）だけを作り直す。
// 今日まではゴールドのあたりで遊んでいたことにして、今日から少しずつ上がる。オンラインの戦績・称号・クランのポイントはそのまま
function replayRanked(u, pl, now) {
  u.npc.t0 = now; auth.npcResetRanked(u.id);
  const evs = actsOf(u, pl, Math.max(u.created, SIM.seasonStart(now)), now, rng(hash('replay:' + u.id + ':' + now)), []).filter(e => e.act.kind === 'online');
  const real = Date.now;
  try { for (const e of evs) { const t = e.act.end; Date.now = () => t; playOnline(u, pl, e.act, t, e.r, true); } } finally { Date.now = real; }
  return evs.length;
}

// ---- 住人を消す（クランから抜けて、アカウントを消す）----
function purge(u) {
  for (const id of clans.reqsOf(u.id)) clans.unrequest(u.id, id);
  if (clans.clanOf(u.id)) clans.leave(u.id);
  plans.delete(u.id); live.delete(u.id); busy.delete(u.id);
  auth.npcDrop(u.id);
}

// ---- 起動したとき ----
function init(h) {
  hooks = Object.assign(hooks, h || {});
  presence.configure({ virtual: statusOf });
  if (!ON) {
    const all = auth.npcUsers();
    if (all.length) { all.forEach(purge); auth.npcMetaClear(); hooks.log('residents: RESIDENT_BOTS=0 なので', all.length, '人を消しました'); }
    return { on: false };
  }
  const R = loadRoster();
  if (!R) return { on: false };
  roster = R;
  const now = Date.now(), meta = auth.npcMeta(), keys = new Set(R.people.map(p => p.key));
  specs.clear(); R.people.forEach(p => specs.set(p.key, p));
  // 名簿にいない住人を消す
  let gone = 0;
  for (const u of auth.npcUsers()) if (!keys.has(u.npc.k)) { purge(u); gone++; }
  // 住人を作る（もういる人は名前だけ名簿に合わせる）
  const made = [], redo = [], clanAge = {};
  for (const c of R.clans) clanAge[c.key] = +c.age || 0;
  for (const spec of R.people) {
    const uid = 'npc_' + spec.key, pl = planOf(spec);
    plans.set(uid, pl);
    let u = auth.user(uid);
    if (!u) { u = createUser(spec, pl, now, spec.role === 'leader' ? (clanAge[spec.clan] || 0) + 2 : 0); if (u) made.push(u); continue; }
    if (u.profile && u.profile.name !== spec.name) auth.npcProfile(uid, Object.assign({}, u.profile, { name: spec.name }));
    // 名簿で climb にした人（前は climb でなかった人）：今のシーズンのランクの記録を作り直して、今日から上がり始める
    if (spec.climb && u.npc.cl !== 1) { const n = replayRanked(u, pl, now); u.npc.cl = 1; auth.touch(); redo.push(spec.name + '（' + n + '）'); }
    else if (!spec.climb && u.npc.cl) { u.npc.cl = 0; auth.touch(); }
  }
  // 住人のクラン（まだなければ作る）と、はじめのメンバー
  meta.clans = meta.clans && typeof meta.clans === 'object' ? meta.clans : {};
  const fresh = new Set();   // この起動で作った住人のクラン
  for (const cs of R.clans) {
    if (meta.clans[cs.key] && clans.byId(meta.clans[cs.key])) continue;
    const mem = R.people.filter(p => p.clan === cs.key), lead = mem.find(p => p.role === 'leader') || mem[0];
    if (!lead) continue;
    const owner = auth.user('npc_' + lead.key);
    if (!owner || clans.clanOf(owner.id)) continue;
    const res = clans.npcCreate(owner.id, { name: cs.name, tag: cs.tag, type: cs.type, region: cs.region, minTier: cs.minTier, desc: cs.desc, created: now - (+cs.age || 1) * DAY });
    if (!res.ok) { hooks.log('residents: クランを作れませんでした', cs.key, res.error); continue; }
    meta.clans[cs.key] = res.clan.id; fresh.add(res.clan.id); owner.npc.ci = 1; clans.npcPts(owner.id, owner.npc.pre || 0); auth.touch();
  }
  for (const spec of R.people) {
    const u = auth.user('npc_' + spec.key), cid = meta.clans[spec.clan];
    if (!u || u.npc.ci || !cid) continue;
    u.npc.ci = 1; auth.touch();
    if (!clans.clanOf(u.id) && clans.npcAdd(u.id, cid, spec.role in ROLE_OF ? ROLE_OF[spec.role] : 1, fresh.has(cid)).ok) clans.npcPts(u.id, u.npc.pre || 0);   // 作ったばかりのクランのはじめのメンバーは、できごとに残さない
  }
  // 新しく作った人は、今のシーズンの試合をしてから、称号を選ぶ
  const n = made.length ? seedSeason(made, now) : 0;
  for (const u of made) {
    const pl = plans.get(u.id);
    chooseTitle(u, pl, rng(hash('title:' + u.id)));
    u.lastSeen = lastOff(pl, now, u.created); auth.touch();
  }
  for (const u of auth.npcUsers()) if (!live.has(u.id)) live.set(u.id, { on: false, act: null, next: 0, extra: 0 });
  if (!timer) { timer = setInterval(() => { try { tick(Date.now()); } catch (e) { hooks.log('residents: ERROR', e && e.stack ? e.stack : e); } }, TICK_MS); timer.unref(); }
  hooks.log('residents:', auth.npcUsers().length, '人', made.length ? '（新しく ' + made.length + ' 人・' + n + ' 試合）' : '', gone ? '（名簿にない ' + gone + ' 人を消しました）' : '',
    redo.length ? '（今日から上がる人のランクの記録を作り直しました：' + redo.join('、') + '）' : '');
  tick(now);
  return { on: true, made: made.length, matches: n };
}

// ---- 15秒ごと：オンライン・試合・フレンドとクランの返事 ----
function liveOf(uid) { let L = live.get(uid); if (!L) live.set(uid, L = { on: false, act: null, next: 0, extra: 0 }); return L; }
function tick(now) {
  if (!ON) return;
  const r = Math.random;
  for (const u of auth.npcUsers()) {
    const pl = plans.get(u.id);
    if (!pl) continue;
    const L = liveOf(u.id);
    if (busy.has(u.id)) continue;                                  // 人と試合中（終わるのを待つ）
    if (L.act && now >= L.act.end) { finish(u, pl, L.act, now, r); L.act = null; L.next = now + gap(r); }
    const s = sessionAt(pl, now), on = !!s || L.extra > now, until = Math.max(s ? s[1] : 0, L.extra);
    if (on && !L.on) {
      L.on = true; L.next = now + Math.round(U(r, 5, 60) * 1000);
      const sn = SIM.seasonNo(now), b = SIM.cleanBadges(u.badges);   // 今のシーズンのバッジ（人はログインでもらう）
      if (b.indexOf(sn) < 0) { u.badges = SIM.cleanBadges(b.concat([sn])); auth.touch(); }
      if (r() < 0.08) chooseTitle(u, pl, r);
    }
    if (!on && L.on && !L.act) { L.on = false; u.lastSeen = now; auth.touch(); }
    if (L.on && !L.act && now >= L.next && now < until - 2 * MIN) L.act = newAct(pl, now, r);
    presence.changed(u.id);
  }
  social(now, r);
}
function social(now, r) {
  const npcs = auth.npcUsers();
  // フレンド申請：オンラインのときに、しばらくしてから受ける（受けない人もいる。そのままにしておく）
  for (const u of npcs) {
    const L = live.get(u.id), fin = Array.isArray(u.fin) ? u.fin : [], rq = u.npc.rq || (u.npc.rq = {});
    for (const id of Object.keys(rq)) if (fin.indexOf(id) < 0) { delete rq[id]; auth.touch(); }
    for (const id of fin.slice()) {
      if (auth.isNpc(id)) continue;
      if (rq[id] == null) { rq[id] = now; auth.touch(); continue; }
      if (rq[id] < 0 || !L || !L.on || busy.has(u.id)) continue;
      if (now - rq[id] < (3 + unit('fw' + u.id + id + rq[id]) * 25) * MIN) continue;
      if (unit('fy' + u.id + id + rq[id]) >= FRIEND_YES) { rq[id] = -1; auth.touch(); continue; }
      delete rq[id]; auth.touch();
      if (auth.friendAccept(u.id, id) === 'accepted') { hooks.pushTo(id, { type: 'friend_event', kind: 'accepted', from: hooks.cardOf(u.id) }); hooks.log('residents: friend accepted', u.id, '->', 'discord=' + id); }
    }
  }
  // 住人がリーダーのクランへの参加の申請：幹部から上の住人がオンラインのときに、しばらくしてから受ける・断る
  for (const c of clans.all()) {
    if (!auth.isNpc(c.owner)) continue;
    const reqs = clans.reqs(c).filter(q => !auth.isNpc(q.uid));
    if (!reqs.length) continue;
    const m = clans.managers(c).find(id => auth.isNpc(id) && live.get(id) && live.get(id).on);
    if (!m) continue;
    for (const q of reqs) {
      if (now - q.at < (10 + unit('cw' + c.id + q.uid + q.at) * 50) * MIN) continue;
      const yes = unit('cy' + c.id + q.uid + q.at) < CLAN_YES;
      const res = yes ? clans.accept(m, q.uid) : clans.decline(m, q.uid);
      if (yes && res.ok) hooks.pushTo(q.uid, { type: 'clan_in', name: c.name, tag: c.tag });
      else if (yes) clans.decline(m, q.uid);
      hooks.log('residents: clan request', c.id, '[' + c.tag + ']', 'discord=' + q.uid, yes && res.ok ? 'accepted' : 'declined');
    }
  }
  // 名簿で決めた、今あるクラン（#クランID）に入る。来た日のうちに、オンラインのときに1人ずつ（一度入ったら、外されても入り直さない）
  for (const u of npcs) {
    const spec = specs.get(u.npc.k), L = live.get(u.id);
    if (!spec || !/^#\d{6}$/.test(String(spec.clan || '')) || u.npc.cj) continue;
    if (clans.clanOf(u.id)) { u.npc.cj = 1; auth.touch(); continue; }
    if (!u.npc.cjAt) { u.npc.cjAt = now + Math.round(U(r, 20, 480) * MIN); auth.touch(); }
    if (now < u.npc.cjAt || !L || !L.on) continue;
    const res = clans.npcAdd(u.id, spec.clan.slice(1), spec.role in ROLE_OF ? ROLE_OF[spec.role] : 1);
    if (res.ok) { u.npc.cj = 1; auth.touch(); hooks.log('residents: joined clan', spec.clan, u.id); }
  }
  // ときどき、人が作ったクランに入る（承認制なら申請）
  const meta = auth.npcMeta();
  if (!meta.nextJoin) { meta.nextJoin = now + Math.round(U(r, 0.3, 1.2) * JOIN_HUMAN_EVERY); auth.touch(); }
  if (now >= meta.nextJoin) {
    meta.nextJoin = now + Math.round(U(r, 0.5, 1.5) * JOIN_HUMAN_EVERY); auth.touch();
    const who = npcs.filter(u => { const L = live.get(u.id), sp = specs.get(u.npc.k); return L && L.on && !busy.has(u.id) && !clans.clanOf(u.id) && !clans.reqsOf(u.id).length && !(sp && sp.clan); });
    if (who.length) {
      const u = pick(r, who), tier = auth.peakTier(u.id);
      const cs = clans.all().filter(c => !auth.isNpc(c.owner) && c.type !== 'closed' && c.members.length < clans.MAX_MEMBERS && (c.minTier || 0) <= tier);
      if (cs.length) {
        const c = pick(r, cs), res = clans.join(u.id, c.id, tier);
        if (res.requested) for (const id of clans.managers(res.clan)) hooks.pushTo(id, { type: 'clan_req' });
        if (res.ok) hooks.log('residents: human clan', res.requested ? 'request' : 'join', c.id, '[' + c.tag + ']', u.id);
      }
    }
  }
  // 人のクランから、まれに抜ける（名簿でクランを決めた人は抜けない）
  for (const u of npcs) {
    const c = clans.clanOf(u.id), L = live.get(u.id), sp = specs.get(u.npc.k);
    if (!c || auth.isNpc(c.owner) || (sp && sp.clan) || !L || !L.on || busy.has(u.id)) continue;
    if (r() < LEAVE_HUMAN_PER_DAY * TICK_MS / DAY) { clans.leave(u.id); hooks.log('residents: left human clan', c.id, u.id); }
  }
}

// ---- まわりに見せる状態 ----
function statusOf(uid) {
  const L = live.get(uid);
  if (!L) return '';
  if (busy.has(uid)) return 'match';
  if (!L.on) return '';
  return L.act ? (L.act.kind === 'cpu' ? 'cpu' : 'match') : 'online';
}

// ---- 人との試合 ----
// 列で待っている人の相手を選ぶ。o = { rate, ranked, two（2v2）, range, exclude: Set }。いなければ null
// オンラインで手があいている人を先に。いなければ、オフラインの人がログインして来る
function pick1(o) {
  if (!ON) return null;
  const cand = [];
  for (const u of auth.npcUsers()) {
    if (busy.has(u.id) || (o.exclude && o.exclude.has(u.id)) || !plans.has(u.id)) continue;
    const L = liveOf(u.id);
    if (L.act) continue;                                              // 試合中（CPU戦も）
    const rt = (o.two ? auth.rating2(u.id) : auth.rating(u.id)).rate, d = Math.abs(rt - o.rate);
    if (o.ranked && d > (o.range || 150)) continue;
    cand.push({ id: u.id, d: d + (L.on ? 0 : 120) });
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a.d - b.d);
  return cand[Math.floor(Math.random() * Math.min(3, cand.length))].id;
}
// 試合に出る（部屋の番号を覚えて「対戦中」に）。オフラインだった人は、しばらくオンラインのままにする
function take(uid, roomId) {
  const L = liveOf(uid), now = Date.now();
  L.act = null;
  if (!L.on) { L.on = true; L.extra = Math.max(L.extra, now + Math.round(U(Math.random, 15, 40) * MIN)); }
  busy.set(uid, roomId);
  presence.changed(uid);
}
function release(uid) {
  if (!busy.has(uid)) return;
  busy.delete(uid);
  const L = liveOf(uid), now = Date.now();
  L.next = now + gap(Math.random); L.extra = Math.max(L.extra, now + Math.round(U(Math.random, 5, 20) * MIN));
  presence.changed(uid);
}
// 部屋に入れる BOT の形（名前・見た目・武器・称号・戦績はその人のもの。思考の強さは cfgRate）
function botFor(uid, cfgRate, two) {
  const u = auth.user(uid);
  if (!u || !u.npc || !u.profile) return null;
  const p = u.profile, st = two ? auth.rating2(uid) : auth.rating(uid), sh = auth.shown(uid);
  return { name: p.name, discord: u.name, rate: st.rate, tier: st.tier, tierKey: P.TIER_KEYS[st.tier] || '', look: p.look, loadout: loadoutOf(u),
    title: sh.title, bio: p.bio || '', bg: sh.bg == null ? SIM.artOfTier(p.bestTier || st.tier) : sh.bg, rec: { w: u.online.w, l: u.online.l },
    cfg: SIM.aiForRate(cfgRate == null ? st.rate : cfgRate), npc: uid };
}
// 人との試合の結果（住人の側）。o = { win, two, ranked, mine, theirs, rw, rl, forfeit, stage, tally }
function record(uid, o) {
  if (!auth.isNpc(uid)) return null;
  const r = auth.npcMatch(uid, Object.assign({ mode: 'online', max: RATE_MAX }, o));
  clans.addMatch(uid, !!o.win);
  return r;
}
// 招待を考えている間は、次の試合を始めない
function hold(uid, ms) { const L = live.get(uid); if (L && L.on && !L.act) L.next = Math.max(L.next, Date.now() + ms); }
// 招待・パーティーに誘われたとき：オンラインで手があいていれば、少し考えてから答える（true＝受ける）
function answerInvite(uid, kind) {
  const L = live.get(uid);
  if (!L || !L.on || L.act || busy.has(uid)) return false;
  return kind === 'party' ? false : Math.random() < 0.6;
}

module.exports = {
  init, tick, statusOf, isOn: () => ON, pick: pick1, take, release, botFor, record, answerInvite, hold,
  RATE_MAX, _plans: plans, _live: live, _busy: busy, _sessionAt: sessionAt, _skillAt: skillAt, _hash: hash,
};
