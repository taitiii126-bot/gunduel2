'use strict';
// GUN DUEL 対戦サーバー（Railway / Raspberry Pi 対応 / Node.js 18以上 / 依存パッケージなし）
const http = require('http');
const crypto = require('crypto');
const { attach, clientIp } = require('./ws-lite');
const { Room, TICK_MS, ACTIVE_MIN_INPUTS, SIM } = require('./game');
const { TeamRoom, SLOTS: TEAM_SLOTS, teamOf } = require('./team');   // 2v2（チーム戦）
const auth = require('./auth');
const presence = require('./presence');
// bots.js が無くても動くようにする（上げ忘れてもサーバー全体が止まらないように）
let bots = null;
try { bots = require('./bots'); } catch (e) { console.error('bots.js を読み込めませんでした。BOTの相手は出ません:', e.message); }
const interactions = require('./interactions');
const { TIER_COLORS, TIER_KEYS } = require('./profile');

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = list(process.env.ALLOWED_ORIGINS);
const MAX_ROOMS = +process.env.MAX_ROOMS || 100;
const MAX_CONNS = +process.env.MAX_CONNS || 300;
const MAX_CONNS_PER_IP = +process.env.MAX_CONNS_PER_IP || 16;    // 同じIPからの同時接続（ログイン中はタブごとに1本つなぎっぱなし）
const MAX_ROOMS_PER_IP = +process.env.MAX_ROOMS_PER_IP || 3;     // 同じIPが同時に作れる部屋
const PAIR_DAILY_CAP = +process.env.PAIR_DAILY_CAP || 10;        // 同じ2人の対戦を記録するのは1日この回数まで
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === '1';          // オンライン対戦をログイン必須にする
const ALLOW_SAME_IP_RECORDS = process.env.ALLOW_SAME_IP_RECORDS === '1';
const BANNED_IPS = new Set(list(process.env.BANNED_IPS));
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';          // 昇格を投稿するDiscordのWebhook
const GAME_URL = process.env.GAME_URL || '';                        // 投稿にゲームへのリンクを付ける（任意）
const MSG_PER_SEC = 120;        // 1接続あたりの受信上限（超えた分は捨てる）
const MSG_KICK_PER_SEC = 600;   // 明らかな連打・攻撃は切断

const rooms = new Map();
const sockets = new Set();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const send = (ws, obj) => ws.send(JSON.stringify(obj));

// ---- IPごとの回数制限 ----
function limiter(max, windowMs) {
  const m = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of m) if (now - v.t > windowMs) m.delete(k); }, windowMs).unref();
  return {
    hit(key) {
      const now = Date.now();
      let e = m.get(key);
      if (!e || now - e.t > windowMs) { e = { n: 0, t: now }; m.set(key, e); }
      return ++e.n <= max;
    },
    blocked(key) { const e = m.get(key); return !!e && Date.now() - e.t <= windowMs && e.n >= max; },
  };
}
const loginTries = limiter(20, 10 * 60 * 1000);   // ログイン：10分で20回まで
const joinFails = limiter(10, 10 * 60 * 1000);    // 部屋番号の入力ミス：10分で10回まで（総当たり対策）
const profileSaves = limiter(30, 60 * 1000);      // プロフィールの保存：1人1分で30回まで
const lookups = limiter(60, 60 * 1000);           // フレンドIDでの検索：1分で60回まで（総当たり対策）
const friendOps = limiter(30, 60 * 1000);         // フレンド申請・承認など：1人1分で30回まで
const inviteTries = limiter(12, 60 * 1000);       // 対戦の招待：1人1分で12回まで

// ---- ティア昇格をDiscordに投稿 ----
// ティアはCPU戦（ブラウザ内）の結果なので検証できない。そのため、
// ・ログイン中の本人だけ ・前に報告したティアより上のときだけ（1人最大10回） ・連投は止める に制限する
const TIERS = ['LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1'];   // 添字+1 がティアの順位
// ティアの説明（レートの範囲）
const tierRange = idx => {
  const lo = SIM.TIER_MIN[idx], hi = SIM.TIER_MIN[idx + 1];
  return hi ? 'レート ' + lo + '〜' + (hi - 1) : 'レート ' + lo + ' 以上';
};
const TIER_COOLDOWN_MS = 20 * 1000;
const tierLastReport = new Map();
const webhookPosts = limiter(10, 60 * 1000);   // 投稿は全体で1分10件まで
// Discordの書式記号で表示が崩れないようにする
const mdEscape = s => String(s).replace(/([*_~`|>\\])/g, '\\$1');
function postTierUp(user, key) {
  if (!WEBHOOK_URL || !webhookPosts.hit('all')) return Promise.resolve(false);
  const next = TIERS[TIERS.indexOf(key) + 1];
  const embed = {
    title: 'ティア昇格',
    description: `<@${user.id}>（${mdEscape(user.name)}）が **${key}** に昇格しました！`,
    color: TIER_COLORS[key],
    fields: [
      { name: 'ティア', value: tierRange(TIERS.indexOf(key) + 1), inline: true },
      { name: '次の目標', value: next ? `${next}：レート ${SIM.TIER_MIN[TIERS.indexOf(next) + 1]}` : '最高ティア到達！', inline: true },
    ],
    footer: { text: 'GUN DUEL' },
    timestamp: new Date().toISOString(),
  };
  if (GAME_URL) embed.url = GAME_URL;
  // 埋め込みの中のメンションは通知を飛ばさない（名前の表示だけ）。@everyone なども無効化
  return fetch(WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
  }).then(r => { if (!r.ok) log('webhook failed', r.status); return r.ok; })
    .catch(e => { log('webhook error', e.message); return false; });
}

// ---- 戦績の記録（水増し・途中退出への対策つき）----
const pairCounts = new Map();
let pairDay = '';
function recordResult(room, winner, loser, reason) {
  const tag = 'room ' + room.id;
  if (!winner || !loser) return;
  if (!winner.uid || !loser.uid) return log(tag, 'not recorded: guest player');
  if (winner.uid === loser.uid) return log(tag, 'not recorded: same account on both sides');
  if (winner.suspect || loser.suspect) return log(tag, 'not recorded: suspicious play');
  if (!ALLOW_SAME_IP_RECORDS && winner.ip && winner.ip === loser.ip) return log(tag, 'not recorded: same network', winner.ip);
  if (winner.acts < ACTIVE_MIN_INPUTS || loser.acts < ACTIVE_MIN_INPUTS) return log(tag, 'not recorded: a player was idle');
  const day = new Date().toISOString().slice(0, 10);
  if (day !== pairDay) { pairCounts.clear(); pairDay = day; }
  const key = [winner.uid, loser.uid].sort().join('|');
  const n = (pairCounts.get(key) || 0) + 1;
  pairCounts.set(key, n);
  if (n > PAIR_DAILY_CAP) return log(tag, 'not recorded: same pair over daily cap');
  auth.recordOnlineResult(winner.uid, true);
  auth.recordOnlineResult(loser.uid, false);
  applyRating(room, winner, loser);
  // 再戦のVS画面で新しい戦績を出せるように、接続中の情報も更新しておく
  if (winner.ws.account) winner.ws.account.wins = (winner.ws.account.wins || 0) + 1;
  if (loser.ws.account) loser.ws.account.losses = (loser.ws.account.losses || 0) + 1;
  winner.rec.w++; loser.rec.l++;
  log(tag, 'recorded:', winner.discord || winner.name, 'beat', loser.discord || loser.name, reason === 'forfeit' ? '(opponent left)' : '');
}
// ---- レート（レートの動く部屋だけ。計算はサーバーが行い、結果を両方に知らせる）----
function sendRate(p, r, win) {
  if (!p || !p.ws) return;
  p.ws.send(JSON.stringify({ type: 'rate', win, rate: r.rate, before: r.before, delta: r.delta,
    tier: r.tier, tierBefore: r.tierBefore, games: r.games, streak: r.streak, wstreak: r.wstreak }));
}
function applyRating(room, winner, loser) {
  if (!room.ranked) return;
  const rr = auth.applyRanked(winner.uid, loser.uid, { capWin: winner.bot ? SIM.BOT_TIER_CAP : null });
  if (!rr) return;
  sendRate(winner, rr.win, true); sendRate(loser, rr.lose, false);
  // 再戦のVS画面で新しいレートを出せるように、接続中の情報も更新しておく
  for (const [p, r] of [[winner, rr.win], [loser, rr.lose]]) {
    if (p.ws.account) { p.ws.account.rate = r.rate; p.ws.account.tier = r.tier; p.ws.account.tierKey = TIER_KEYS[r.tier] || ''; }
    p.tier = TIER_KEYS[r.tier] || p.tier; p.rate = r.rate;
  }
  log('room ' + room.id, 'rate:', winner.name, rr.win.before + '→' + rr.win.rate, '/', loser.name, rr.lose.before + '→' + rr.lose.rate);
}

// BOT戦の記録：人の側だけ記録する（レートはランクマッチのときだけ動き、LT1の下限で止まる）
function recordBotResult(room, winner, loser, reason) {
  const tag = 'room ' + room.id;
  const p = winner.bot ? loser : winner, bot = winner.bot ? winner : loser, win = !winner.bot;
  if (!p || p.bot || !p.uid) return;
  if (p.suspect) return log(tag, 'not recorded: suspicious play');
  if (p.acts < ACTIVE_MIN_INPUTS) return log(tag, 'not recorded: a player was idle');
  auth.recordOnlineResult(p.uid, win);
  if (p.ws.account) { if (win) p.ws.account.wins = (p.ws.account.wins || 0) + 1; else p.ws.account.losses = (p.ws.account.losses || 0) + 1; }
  p.rec[win ? 'w' : 'l']++;
  if (room.ranked) {
    const r = auth.applyVsBot(p.uid, bot.rate, win, SIM.BOT_TIER_CAP);
    if (r) {
      sendRate(p, r, win);
      if (p.ws.account) { p.ws.account.rate = r.rate; p.ws.account.tier = r.tier; p.ws.account.tierKey = TIER_KEYS[r.tier] || ''; }
      p.tier = TIER_KEYS[r.tier] || p.tier; p.rate = r.rate;
      log(tag, 'rate:', p.name, r.before + '→' + r.rate, '(vs bot ' + bot.rate + ')');
    }
  }
  log(tag, 'recorded:', p.discord || p.name, win ? 'beat' : 'lost to', bot.name, reason === 'forfeit' ? '(left)' : '');
}

// 怪しい操作は本人には知らせず、ログとアカウントに残す（BANの判断材料）
function onSuspect(p, reason) {
  log('SUSPECT', 'discord=' + (p.uid || '-'), 'name=' + p.name + (p.discord ? ' (' + p.discord + ')' : ''), 'ip=' + p.ip, reason);
  if (p.uid) auth.flag(p.uid, reason);
}

function openRoom() {
  let id;
  do id = String(crypto.randomInt(100000, 1000000)); while (rooms.has(id));
  const room = new Room(id, {
    onClose: r => {
      rooms.delete(r.id); log('room closed', r.id, `(rooms: ${rooms.size})`);
      cancelInvites(r.id);
      for (const k of ['a', 'b']) if (r.players[k]) presence.changed(r.players[k].uid);
    },
    onResult: (w, l, reason) => (((w && w.bot) || (l && l.bot)) ? recordBotResult(room, w, l, reason) : recordResult(room, w, l, reason)),
    onSuspect,
  });
  rooms.set(id, room);
  return room;
}

// ---- 2v2（チーム戦）の部屋 ----
function openTeamRoom(opt) {
  let id;
  do id = String(crypto.randomInt(100000, 1000000)); while (rooms.has(id));
  const room = new TeamRoom(id, {
    onClose: r => {
      rooms.delete(r.id); log('room closed', r.id, '(2v2)', `(rooms: ${rooms.size})`);
      cancelInvites(r.id);
      for (const p of r.allPlayers()) if (p.uid || p.uidLeft) presence.changed(p.uid || p.uidLeft);
    },
    onResult: (r, winTeam) => recordTeamResult(r, winTeam),
    onLeave: (r, p) => recordTeamLeave(r, p),
  }, opt);
  rooms.set(id, room);
  return room;
}
// チームの平均レート（試合が始まったときの値）
function teamAvg(room, team) {
  const r0 = room.rate0 || {}, ks = TEAM_SLOTS.filter(k => teamOf(k) === team && r0[k] != null);
  return ks.length ? ks.reduce((a, k) => a + r0[k], 0) / ks.length : SIM.RATE_START;
}
function sendRate2(p, r, win) {
  if (!p || !p.ws || p.bot) return;
  p.ws.send(JSON.stringify({ type: 'rate', kind: '2v2', win, rate: r.rate, before: r.before, delta: r.delta,
    tier: r.tier, tierBefore: r.tierBefore, games: r.games, streak: r.streak, wstreak: r.wstreak }));
}
// 2v2 の結果：人だけ記録する（BOT と、先に抜けて負けを記録した人は除く）。ランクなら 2v2 のレートを動かす
function recordTeamResult(room, winTeam) {
  const tag = 'room ' + room.id + ' (2v2)', avg = [teamAvg(room, 0), teamAvg(room, 1)], withBots = room.hasBots();
  for (const k of TEAM_SLOTS) {
    const p = room.players[k];
    if (!p || p.done || p.bot) continue;
    p.done = true;
    if (!p.uid) continue;
    if (p.suspect) { log(tag, 'not recorded: suspicious play', p.name); continue; }
    if (p.acts < ACTIVE_MIN_INPUTS) { log(tag, 'not recorded: idle', p.name); continue; }
    const win = teamOf(k) === winTeam;
    auth.recordOnlineResult(p.uid, win);
    if (p.ws.account) { if (win) p.ws.account.wins = (p.ws.account.wins || 0) + 1; else p.ws.account.losses = (p.ws.account.losses || 0) + 1; }
    p.rec[win ? 'w' : 'l']++;
    if (room.ranked) {
      const r = auth.applyRanked2(p.uid, { mine: avg[teamOf(k)], theirs: avg[1 - teamOf(k)], win, cap: withBots ? SIM.BOT_TIER_CAP : null });
      if (r) {
        sendRate2(p, r, win);
        p.rate = r.rate; p.tier = TIER_KEYS[r.tier] || '';
        if (p.ws.account) { p.ws.account.rate2 = r.rate; p.ws.account.tier2 = r.tier; p.ws.account.tier2Key = TIER_KEYS[r.tier] || ''; }
        log(tag, 'rate2:', p.name, r.before + '→' + r.rate, win ? '(win)' : '(lose)');
      }
    }
  }
}
// 試合の途中で抜けた人：結果を待たずに負けを記録する（ランクなら 2v2 のレートも下がる）。キャラクターは BOT が引き継ぐ
function recordTeamLeave(room, p) {
  if (!room.matchLive || p.done || !p.uid) return;
  p.done = true;
  const tag = 'room ' + room.id + ' (2v2)', team = teamOf(p.slot);
  auth.recordOnlineResult(p.uid, false);
  if (room.ranked) {
    const r = auth.applyRanked2(p.uid, { mine: teamAvg(room, team), theirs: teamAvg(room, 1 - team), win: false, cap: null });
    if (r) log(tag, 'left (lose):', p.name, r.before + '→' + r.rate);
  } else log(tag, 'left:', p.name);
}

// ---- ランキング（レート順）----
// 人数が増えても重くならないように、一定時間ごとに1回だけ作り直して使い回す
const RANK_TTL = +process.env.RANK_TTL_MS || 5 * 60 * 1000;
const RANK_TOP = +process.env.RANK_TOP || 100;
const RANK_MIN_GAMES = process.env.RANK_MIN_GAMES == null ? 1 : Math.max(0, Math.floor(+process.env.RANK_MIN_GAMES) || 0);   // ランクマッチをこの回数以上した人だけ載せる（0なら全員）
let rankCache = { at: 0, list: [] };
function buildRanking() {
  const seen = new Set();
  const list = auth.users().map(u => auth.rankRow(u)).filter(r => r && r.games >= RANK_MIN_GAMES && !seen.has(r.uid) && seen.add(r.uid));
  list.sort((a, b) => b.rate - a.rate || b.w - a.w || a.l - b.l || String(a.name).localeCompare(String(b.name)));
  rankCache = { at: Date.now(), list };
  return rankCache;
}
function ranking() { if (Date.now() - rankCache.at > RANK_TTL) buildRanking(); return rankCache; }
let rankCache2 = { at: 0, list: [] };
function ranking2() {
  if (Date.now() - rankCache2.at <= RANK_TTL) return rankCache2;
  const seen = new Set();
  const list = auth.users().map(u => auth.rankRow2(u)).filter(r => r && r.games >= RANK_MIN_GAMES && !seen.has(r.uid) && seen.add(r.uid));
  list.sort((a, b) => b.rate - a.rate || b.w - a.w || a.l - b.l || String(a.name).localeCompare(String(b.name)));
  rankCache2 = { at: Date.now(), list };
  return rankCache2;
}
const rankPub = (r, rank) => ({ rank, name: r.name, title: r.title, tier: r.tier, tierKey: TIER_KEYS[r.tier] || '', rate: r.rate, w: r.w, l: r.l });

// ---- フレンドへのお知らせ（ページを開いている人にだけ届く）----
function pushTo(uid, obj) { const s = JSON.stringify(obj); for (const w of presence.sockets(uid)) w.send(s); }
function cardOf(uid) { const u = auth.user(uid); return u ? auth.card(u, presence.statusOf(uid)) : null; }

// ---- ランダムマッチ（ランクマッチ／アンランクマッチ）----
// 待っている人を1つの列に入れ、1秒ごとに近いレート同士を組ませる。
// 待つほど探す範囲が広がる（秒数→±いくつまで許すか）。アンランクは範囲を見ない
const QUEUE_STEPS = [[0, 50], [15, 100], [30, 200], [45, 400], [75, 99999]];
const MAX_QUEUE = +process.env.MAX_QUEUE || 200;
const WIDEN_SPEED = +process.env.MATCH_WIDEN_SPEED || 1;   // 範囲を広げる速さ（2なら半分の時間で広がる）
// 相手が見つからないときに出す相手。低いレート帯ははじめから、それ以上は本物をしばらく探してから
const BOT_BELOW = +process.env.BOT_BELOW || 1500;
const BOT_WAIT = +process.env.BOT_WAIT || 45;
const BOT_WAIT_LOW = +process.env.BOT_WAIT_LOW || 4;
const BOT_OFF = process.env.BOT_OFF === '1';               // 1 なら本物の相手しか出さない
const queue = new Map();   // ws → { mode, info, rate, tier, at }
function searchRange(sec) { let r = QUEUE_STEPS[0][1]; for (const [t, v] of QUEUE_STEPS) if (sec * WIDEN_SPEED >= t) r = v; return r; }
function queueLeave(ws, why) { if (queue.delete(ws) && why) send(ws, { type: 'queue_left', why }); }
function queueSec(q) { return Math.floor((Date.now() - q.at) / 1000); }
// 組み合わせ：レート順に並べて、となり同士が許せる差なら組ませる
function queueTick() {
  for (const mode of ['ranked', 'casual']) {
    const list = [];
    for (const [ws, q] of queue) if (q.mode === mode) list.push({ ws, q, sec: queueSec(q) });
    list.sort((a, b) => a.q.rate - b.q.rate);
    for (let i = 0; i + 1 < list.length; i++) {
      const A = list[i], B = list[i + 1];
      if (!queue.has(A.ws) || !queue.has(B.ws)) continue;
      if (A.ws.account && B.ws.account && A.ws.account.uid === B.ws.account.uid) continue;   // 同じアカウント同士は組ませない
      if (!ALLOW_SAME_IP_RECORDS && mode === 'ranked' && A.ws.ip && A.ws.ip === B.ws.ip) continue;
      if (mode === 'ranked' && Math.abs(A.q.rate - B.q.rate) > Math.max(searchRange(A.sec), searchRange(B.sec))) continue;
      if (pairUp(A, B, mode)) i++;   // 組んだ2人は飛ばす
    }
  }
  if (bots && !BOT_OFF) for (const [ws, q] of queue) if (botAllowed(q) && queueSec(q) >= botWaitFor(q)) startBotMatch(ws, q);
  for (const [ws, q] of queue) {
    const sec = queueSec(q);
    send(ws, { type: 'queue_status', waited: sec, range: q.mode === 'ranked' ? searchRange(sec) : 0, n: queue.size, rate: q.rate });
  }
}
function pairUp(A, B, mode) {
  if (rooms.size >= MAX_ROOMS) return false;
  queue.delete(A.ws); queue.delete(B.ws);
  const room = openRoom();
  room.ranked = mode === 'ranked';
  room.join(A.ws, A.q.info); room.join(B.ws, B.q.info);
  for (const p of [A, B]) send(p.ws, { type: 'match_found', roomId: room.id, slot: p.ws.slot, mode, ranked: room.ranked });
  log('match', room.id, mode, A.q.rate + ' vs ' + B.q.rate, '(waited ' + A.sec + 's/' + B.sec + 's)');
  room.start();
  cancelInvites(room.id);
  for (const k of ['a', 'b']) if (room.players[k]) presence.changed(room.players[k].uid);
  return true;
}
// その人を何秒待たせてから相手を出すか（毎回少しゆらして、同じ間隔にならないようにする）
// BOTに勝ってもレートが上がらない帯（LT1の下限 2250 以上）の人には、ランクマッチでBOTを出さない（本物の相手だけ）
function botAllowed(q) { return q.mode !== 'ranked' || q.rate < SIM.TIER_MIN[SIM.BOT_TIER_CAP]; }
function botWaitFor(q) {
  if (q.botWait == null) q.botWait = q.rate < BOT_BELOW ? BOT_WAIT_LOW + Math.random() * 4 : BOT_WAIT + Math.random() * 10;
  return q.botWait;
}
function startBotMatch(ws, q) {
  if (!bots || rooms.size >= MAX_ROOMS) return false;
  queue.delete(ws);
  const room = openRoom();
  room.ranked = q.mode === 'ranked';
  if (!room.join(ws, q.info)) { room.close(); return false; }
  // 強さ・レートは本人とちょうど互角（わずかにゆらす）
  const rate = Math.max(SIM.RATE_FLOOR, Math.min(3000, Math.round(q.rate + (Math.random() * 60 - 30))));
  const bot = bots.makeBot(rate);
  if (room.joinBot(bot) == null) { room.close(); return false; }
  send(ws, { type: 'match_found', roomId: room.id, slot: ws.slot, mode: q.mode, ranked: room.ranked });
  log('match', room.id, q.mode, q.rate + ' vs bot ' + bot.rate, '(' + bot.name + ', waited ' + queueSec(q) + 's)');
  room.start();
  if (ws.account) presence.changed(ws.account.uid);
  return true;
}
setInterval(queueTick, 1000);

// ---- 2v2 のランダムマッチ ----
// パーティー（フレンドと2人）はそのまま1チーム。ソロは近いレートの人と組んでチームになる。チームどうしを近いレートで組ませる。
// 待ちすぎたら、空いている場所を BOT で埋める（ランクでも。ただしレート2250以上の人がいるときは入れない）
const BOT_WAIT2 = +process.env.BOT_WAIT2 || 15;                // ランク：BOT で埋めるまでの秒数
const BOT_WAIT2_CASUAL = +process.env.BOT_WAIT2_CASUAL || 8;   // アンランク
const PARTY_JOIN_MS = 20000;                                   // パーティーの相方が列に入るのを待つ時間
const queue2 = new Map();   // ws → { mode, info, rate, uid, party, at }
function q2Leave(ws, why) {
  const q = queue2.get(ws);
  if (!q) return;
  queue2.delete(ws);
  if (why) send(ws, { type: 'queue_left', why });
  // パーティーの相方も列から出す
  if (q.party) for (const [w2, q2] of queue2) if (q2.party === q.party) { queue2.delete(w2); send(w2, { type: 'queue_left', why: 'party' }); }
}
function bot2Allowed(mode, list) { return mode !== 'ranked' || list.every(x => !x || x.q.rate < SIM.TIER_MIN[SIM.BOT_TIER_CAP]); }
const avgRate = list => { const h = list.filter(Boolean); return h.length ? h.reduce((a, x) => a + x.q.rate, 0) / h.length : SIM.RATE_START; };
const unitSec = u => Math.floor((Date.now() - u.at) / 1000);
function queue2Tick() {
  const now = Date.now();
  // 相方が来ないパーティーはあきらめる
  for (const [ws, q] of queue2) {
    if (!q.party) continue;
    const both = [...queue2.values()].filter(q2 => q2.party === q.party).length;
    if (both < 2 && now - q.at > PARTY_JOIN_MS) { queue2.delete(ws); send(ws, { type: 'queue_left', why: 'party_timeout' }); }
  }
  for (const mode of ['ranked', 'casual']) {
    const units = [], seenP = new Set();
    for (const [ws, q] of queue2) {
      if (q.mode !== mode) continue;
      if (q.party) {
        if (seenP.has(q.party)) continue;
        const mem = [...queue2].filter(([, q2]) => q2.party === q.party && q2.mode === mode).map(([w2, q2]) => ({ ws: w2, q: q2 }));
        if (mem.length < 2) continue;
        seenP.add(q.party);
        units.push({ list: mem.slice(0, 2), rate: avgRate(mem), at: Math.min(mem[0].q.at, mem[1].q.at) });
      } else units.push({ list: [{ ws, q }], rate: q.rate, at: q.at });
    }
    const teams = units.filter(u => u.list.length === 2);
    const solos = units.filter(u => u.list.length === 1).sort((a, b) => a.rate - b.rate);
    for (let i = 0; i + 1 < solos.length; i++) {
      const A = solos[i], B = solos[i + 1];
      if (A.used || B.used) continue;
      if (A.list[0].q.uid && A.list[0].q.uid === B.list[0].q.uid) continue;
      if (mode === 'ranked' && Math.abs(A.rate - B.rate) > searchRange(Math.max(unitSec(A), unitSec(B)))) continue;
      A.used = B.used = true;
      teams.push({ list: A.list.concat(B.list), rate: (A.rate + B.rate) / 2, at: Math.min(A.at, B.at) });
      i++;
    }
    teams.sort((a, b) => a.rate - b.rate);
    for (let i = 0; i + 1 < teams.length; i++) {
      const A = teams[i], B = teams[i + 1];
      if (A.used || B.used) continue;
      if (mode === 'ranked' && Math.abs(A.rate - B.rate) > searchRange(Math.max(unitSec(A), unitSec(B)))) continue;
      if (startTeamMatch(mode, A.list, B.list)) { A.used = B.used = true; i++; }
    }
    if (!bots || BOT_OFF) continue;
    const waitFor = mode === 'ranked' ? BOT_WAIT2 : BOT_WAIT2_CASUAL;
    const restSolos = solos.filter(u => !u.used);
    for (const T of teams) {
      if (T.used || unitSec(T) < waitFor || !bot2Allowed(mode, T.list)) continue;
      const S = restSolos.find(u => !u.used && bot2Allowed(mode, u.list));   // 待っている人がいれば、その人＋BOT と当てる
      if (startTeamMatch(mode, T.list, S ? S.list.concat([null]) : [null, null])) { T.used = true; if (S) S.used = true; }
    }
    for (const S of restSolos) {
      if (S.used || unitSec(S) < waitFor || !bot2Allowed(mode, S.list)) continue;
      if (startTeamMatch(mode, S.list.concat([null]), [null, null])) S.used = true;
    }
  }
  for (const [ws, q] of queue2) {
    const sec = Math.floor((now - q.at) / 1000);
    send(ws, { type: 'queue_status', team: true, waited: sec, range: q.mode === 'ranked' ? searchRange(sec) : 0, n: queue2.size, rate: q.rate });
  }
}
// 2チーム（人 {ws,q} か、BOT の null）で部屋を作って始める。左のチームは a・c、右は b・d
function startTeamMatch(mode, A, B) {
  if (rooms.size >= MAX_ROOMS) return false;
  if (!bots && (A.includes(null) || B.includes(null))) return false;
  const humans = A.concat(B).filter(Boolean);
  for (const x of humans) queue2.delete(x.ws);
  const room = openTeamRoom({ private: false });
  room.ranked = mode === 'ranked';
  const ra = avgRate(A), rb = avgRate(B), hasA = A.some(Boolean), hasB = B.some(Boolean);
  const jitter = r => Math.max(SIM.RATE_FLOOR, Math.min(3000, Math.round(r + (Math.random() * 60 - 30))));
  A.forEach((x, i) => { if (x) room.join(x.ws, x.q.info, ['a', 'c'][i]); });
  B.forEach((x, i) => { if (x) room.join(x.ws, x.q.info, ['b', 'd'][i]); });
  A.forEach((x, i) => { if (!x) room.joinBot(bots.makeBot(jitter(hasA ? ra : rb)), ['a', 'c'][i]); });
  B.forEach((x, i) => { if (!x) room.joinBot(bots.makeBot(jitter(hasB ? rb : ra)), ['b', 'd'][i]); });
  for (const x of humans) send(x.ws, { type: 'match_found', roomId: room.id, slot: x.ws.slot, mode, ranked: room.ranked, team: true });
  log('match2', room.id, mode, Math.round(ra) + ' vs ' + Math.round(rb), 'humans ' + humans.length + ' / bots ' + (4 - humans.length));
  room.start();
  for (const x of humans) if (x.ws.account) presence.changed(x.ws.account.uid);
  return true;
}
setInterval(queue2Tick, 1000);

// ---- パーティー（2v2 でフレンドと組む）----
// 誘う → 相手が受ける → 2人のパーティー。どちらかが「さがす」を押すと、もう1人にも知らせて一緒に列に入る
const parties = new Map();       // パーティーID → { id, a: uid, b: uid }
const partyOf = new Map();       // uid → パーティーID
const partyInvites = new Map();  // 誘いID → { id, from, to, at }
function partyCard(uid) { const u = auth.user(uid); return u ? { fid: u.fid, name: (u.profile && u.profile.name) || u.name } : null; }
function pushParty(p) {
  const msg = { type: 'party', id: p.id, members: [partyCard(p.a), partyCard(p.b)] };
  pushTo(p.a, msg); pushTo(p.b, msg);
}
function partyLeave(uid, why) {
  const id = partyOf.get(uid);
  if (!id) return;
  const p = parties.get(id);
  parties.delete(id);
  for (const u of [p.a, p.b]) { partyOf.delete(u); pushTo(u, { type: 'party', id: null, why: why || 'left' }); }
  for (const [ws, q] of queue2) if (q.party === id) { queue2.delete(ws); send(ws, { type: 'queue_left', why: 'party' }); }
}

// ---- 対戦の招待 ----
// 招待する人が部屋を作ってから、部屋番号をフレンドに届ける。受けた人はその部屋にふつうに入る
const invites = new Map();   // 招待ID → { id, from, to, roomId }
function cancelInvites(roomId) {
  for (const [id, iv] of invites) if (iv.roomId === roomId) { invites.delete(id); pushTo(iv.to, { type: 'invite_cancel', id }); }
}

// オンライン状態：部屋にいる人は「対戦中」（相手待ちはオンライン扱い）
presence.configure({
  roomOf(uid) {
    for (const r of rooms.values()) {
      if (r.kind === 'team') { if (r.humans().some(p => p.uid === uid)) return r.phase === 'waiting' ? 'room' : 'match'; continue; }
      const a = r.players.a, b = r.players.b;
      if ((a && a.uid === uid) || (b && b.uid === uid)) return a && b ? 'match' : 'room';
    }
    return '';
  },
  onOffline: uid => { auth.seen(uid); partyLeave(uid, 'offline'); },
  // 状態が変わったら、オンラインのフレンドに知らせる
  onChange(uid, status) {
    const u = auth.user(uid);
    if (!u) return;
    const msg = { type: 'friend_status', fid: u.fid, status, lastSeen: status === 'offline' ? (u.lastSeen || Date.now()) : 0 };
    for (const f of auth.friendIds(uid)) pushTo(f, msg);
  },
});

function onMessage(ws, raw) {
  if (++ws.msgs > MSG_PER_SEC) { if (ws.msgs > MSG_KICK_PER_SEC) ws.destroy(); return; }
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.type !== 'string') return;
  switch (m.type) {
    case 'create_room': {
      if (ws.room) return;
      if (m.v !== SIM.PROTO) return send(ws, { type: 'error', code: 'reload', msg: 'ゲームが更新されました。ページを再読み込みしてください' });
      if (REQUIRE_LOGIN && !ws.account) return send(ws, { type: 'error', code: 'login_required', msg: 'オンライン対戦にはDiscordログインが必要です' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'server_busy', msg: 'サーバーが混み合っています。少し待ってからお試しください' });
      let mine = 0;
      for (const r of rooms.values()) if (r.hostIp() === ws.ip) mine++;
      if (mine >= MAX_ROOMS_PER_IP) return send(ws, { type: 'error', code: 'too_many_rooms', msg: '同時に作れる部屋の数を超えています' });
      const room = openRoom();
      room.join(ws, m);
      send(ws, { type: 'room_created', roomId: room.id, slot: ws.slot });
      log('room created', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
      break;
    }
    case 'join_room': {
      if (ws.room) return;
      if (m.v !== SIM.PROTO) return send(ws, { type: 'error', code: 'reload', msg: 'ゲームが更新されました。ページを再読み込みしてください' });
      if (REQUIRE_LOGIN && !ws.account) return send(ws, { type: 'error', code: 'login_required', msg: 'オンライン対戦にはDiscordログインが必要です' });
      if (joinFails.blocked(ws.ip)) return send(ws, { type: 'error', code: 'too_many_fails', msg: '部屋番号の入力ミスが多すぎます。しばらく待ってからお試しください' });
      const id = String(m.roomId || '');
      const room = /^\d{6}$/.test(id) ? rooms.get(id) : null;
      if (!room) { joinFails.hit(ws.ip); return send(ws, { type: 'error', code: 'room_not_found', msg: '部屋が見つかりません。番号を確認してください' }); }
      if (room.kind === 'team') {
        if (ws.account && room.humans().some(p => p.uid === ws.account.uid)) return send(ws, { type: 'error', code: 'same_account', msg: '同じアカウント同士では対戦できません' });
        if (!room.join(ws, m)) return send(ws, { type: 'error', code: 'room_full', msg: 'この部屋はいっぱいか、すでに対戦中です' });
        send(ws, { type: 'room_joined2', roomId: room.id, slot: ws.slot });
        room.sendLobby();
        log('room joined (2v2)', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
        for (const p of room.humans()) presence.changed(p.uid);
        break;
      }
      const host = room.players.a;
      if (host && host.uid && ws.account && host.uid === ws.account.uid) return send(ws, { type: 'error', code: 'same_account', msg: '同じアカウント同士では対戦できません' });
      if (!room.join(ws, m)) return send(ws, { type: 'error', code: 'room_full', msg: 'この部屋はすでに対戦中です' });
      send(ws, { type: 'room_joined', roomId: room.id, slot: ws.slot });
      log('room joined', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
      room.start();
      cancelInvites(room.id);                // 相手が決まったので、ほかの招待は取り消す
      for (const k of ['a', 'b']) if (room.players[k]) presence.changed(room.players[k].uid);
      break;
    }
    case 'queue': {
      if (ws.room || queue.has(ws)) return;
      if (m.v !== SIM.PROTO) return send(ws, { type: 'error', code: 'reload', msg: 'ゲームが更新されました。ページを再読み込みしてください' });
      const mode = m.mode === 'ranked' ? 'ranked' : 'casual';
      if ((REQUIRE_LOGIN || mode === 'ranked') && !ws.account) {
        return send(ws, { type: 'error', code: 'login_required', msg: mode === 'ranked' ? 'ランクマッチにはDiscordログインが必要です' : 'オンライン対戦にはDiscordログインが必要です' });
      }
      if (queue.size >= MAX_QUEUE || rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'server_busy', msg: 'サーバーが混み合っています。少し待ってからお試しください' });
      const acc = ws.account;
      queue.set(ws, { mode, info: m, at: Date.now(),
        rate: acc && acc.rate ? acc.rate : SIM.RATE_START, tier: acc && acc.tier != null ? acc.tier : SIM.tierOfRate(SIM.RATE_START) });
      send(ws, { type: 'queued', mode });
      log('queue', mode, 'from', ws.ip, acc ? 'discord=' + acc.uid + ' rate=' + acc.rate : 'guest', '(waiting: ' + queue.size + ')');
      break;
    }
    case 'queue_cancel':
      queueLeave(ws, 'cancel');
      q2Leave(ws, 'cancel');
      break;
    // ---- 2v2 ----
    case 'queue2': {
      if (ws.room || queue.has(ws) || queue2.has(ws)) return;
      if (m.v !== SIM.PROTO) return send(ws, { type: 'error', code: 'reload', msg: 'ゲームが更新されました。ページを再読み込みしてください' });
      const mode = m.mode === 'ranked' ? 'ranked' : 'casual';
      if ((REQUIRE_LOGIN || mode === 'ranked') && !ws.account) {
        return send(ws, { type: 'error', code: 'login_required', msg: mode === 'ranked' ? 'ランクマッチにはDiscordログインが必要です' : 'オンライン対戦にはDiscordログインが必要です' });
      }
      if (queue2.size >= MAX_QUEUE || rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'server_busy', msg: 'サーバーが混み合っています。少し待ってからお試しください' });
      const acc = ws.account, uid = acc ? acc.uid : null;
      // パーティー：ログイン中で、パーティーに入っていれば2人で並ぶ（もう1人にも知らせる）
      const pid = m.party && uid ? partyOf.get(uid) : null;
      queue2.set(ws, { mode, info: m, at: Date.now(), uid, party: pid || null, rate: acc && acc.rate2 ? acc.rate2 : SIM.RATE_START });
      send(ws, { type: 'queued', mode, team: true, party: !!pid });
      if (pid) {
        const p = parties.get(pid), mate = p.a === uid ? p.b : p.a;
        const mateIn = [...queue2.values()].some(q => q.party === pid && q.uid === mate);
        if (!mateIn) pushTo(mate, { type: 'party_queue', mode });
      }
      log('queue2', mode, 'from', ws.ip, acc ? 'discord=' + acc.uid + ' rate2=' + acc.rate2 : 'guest', pid ? '(party)' : '', '(waiting: ' + queue2.size + ')');
      break;
    }
    case 'create_room2': {
      if (ws.room) return;
      if (m.v !== SIM.PROTO) return send(ws, { type: 'error', code: 'reload', msg: 'ゲームが更新されました。ページを再読み込みしてください' });
      if (REQUIRE_LOGIN && !ws.account) return send(ws, { type: 'error', code: 'login_required', msg: 'オンライン対戦にはDiscordログインが必要です' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', code: 'server_busy', msg: 'サーバーが混み合っています。少し待ってからお試しください' });
      let mine = 0;
      for (const r of rooms.values()) if (r.hostIp() === ws.ip) mine++;
      if (mine >= MAX_ROOMS_PER_IP) return send(ws, { type: 'error', code: 'too_many_rooms', msg: '同時に作れる部屋の数を超えています' });
      const room = openTeamRoom({ private: true });
      room.join(ws, m);
      send(ws, { type: 'room_created2', roomId: room.id, slot: ws.slot });
      room.sendLobby();
      log('room created (2v2)', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
      break;
    }
    case 'team_slot':                                   // 開始前に、空いている場所（チーム）へ移る
      if (ws.room && ws.room.kind === 'team') ws.room.moveSlot(ws.slot, String(m.to || ''));
      break;
    case 'team_start': {                                // 部屋を作った人が開始を押す：空いている場所は BOT
      const room = ws.room;
      if (!room || room.kind !== 'team' || room.phase !== 'waiting' || ws.slot !== room.hostSlot) return;
      if (!bots && !room.isFull()) return send(ws, { type: 'error', code: 'need_players', msg: '4人そろうと始められます' });
      const hs = room.humans(), r = hs.length ? hs.reduce((a, p) => a + (p.rate || SIM.RATE_START), 0) / hs.length : SIM.RATE_START;
      for (const k of TEAM_SLOTS) if (!room.players[k]) room.joinBot(bots.makeBot(Math.round(r + (Math.random() * 60 - 30))), k);
      room.start();
      cancelInvites(room.id);
      for (const p of room.humans()) presence.changed(p.uid);
      log('start (2v2 room)', room.id, 'humans ' + hs.length);
      break;
    }
    // パーティーに誘う・返事・抜ける（ログイン中のページの接続で送る）
    case 'party_invite': {
      const uid = ws.presUid;
      if (!uid) return;
      const fail = code => send(ws, { type: 'party_fail', fid: auth.normFid(m.fid), code });
      const t = auth.byFid(m.fid);
      if (!t || !auth.isFriend(uid, t.id)) return fail('not_friend');
      if (!inviteTries.hit(uid)) return fail('too_many');
      const st = presence.statusOf(t.id);
      if (st === 'offline') return fail('offline');
      if (st === 'match') return fail('busy');
      for (const [id, iv] of partyInvites) if (iv.from === uid && iv.to === t.id) partyInvites.delete(id);
      const id = crypto.randomBytes(6).toString('hex');
      partyInvites.set(id, { id, from: uid, to: t.id, at: Date.now() });
      pushTo(t.id, { type: 'party_invite', id, from: cardOf(uid) });
      send(ws, { type: 'party_sent', fid: t.fid });
      log('party invite', 'discord=' + uid, '->', 'discord=' + t.id);
      break;
    }
    case 'party_reply': {
      const uid = ws.presUid;
      const iv = uid && partyInvites.get(String(m.id || ''));
      if (!iv || iv.to !== uid) return;
      partyInvites.delete(iv.id);
      const me = auth.user(uid);
      if (!m.ok) { pushTo(iv.from, { type: 'party_declined', fid: me.fid, name: (me.profile && me.profile.name) || me.name, timeout: m.timeout === true }); break; }
      if (Date.now() - iv.at > 60000 || presence.statusOf(iv.from) === 'offline') { send(ws, { type: 'party_fail', code: 'expired' }); break; }
      partyLeave(uid, 'new'); partyLeave(iv.from, 'new');
      const id = crypto.randomBytes(6).toString('hex'), p = { id, a: iv.from, b: uid };
      parties.set(id, p); partyOf.set(iv.from, id); partyOf.set(uid, id);
      pushParty(p);
      log('party', id, 'discord=' + iv.from, '+', 'discord=' + uid);
      break;
    }
    case 'party_leave':
      if (ws.presUid) partyLeave(ws.presUid, 'left');
      break;
    case 'party_get':                                    // 開き直したとき、今のパーティーを教える
      if (ws.presUid) { const id = partyOf.get(ws.presUid); if (id) pushParty(parties.get(id)); else send(ws, { type: 'party', id: null }); }
      break;
    case 'input':
      if (ws.room && m.input && typeof m.input === 'object') ws.room.input(ws.slot, m.input);
      break;
    case 'ping':
      if (ws.room) ws.room.ping(ws.slot, m);
      break;
    case 'spong':
      if (ws.room) ws.room.spong(ws.slot, m);
      break;
    case 'rematch':
      if (ws.room) ws.room.rematch(ws.slot);
      break;
    case 'ready':                                        // 準備完了（試合前）／決定（ラウンド間）
      if (ws.room) ws.room.setReady(ws.slot);
      break;
    case 'loadout':                                      // ラウンド間の武器の変更
      if (ws.room && Array.isArray(m.loadout)) ws.room.setLoadout(ws.slot, m.loadout);
      break;
    case 'auth': {
      if (ws.room) return;                   // 対戦中に別人へ切り替えるのは不可
      const u = auth.verify(typeof m.token === 'string' ? m.token : '');
      if (u) {
        const ur = auth.rating(u.id) || { rate: SIM.RATE_START, tier: 1 }, ur2 = auth.rating2(u.id) || { rate: SIM.RATE_START, tier: 1 };
        ws.account = { uid: u.id, name: u.name, wins: u.online.w, losses: u.online.l, friends: (u.friends || []).length, pioneer: !!u.pioneer, pioneer10: !!u.pioneer10, hacker: !!u.hacker, dev: !!u.dev,
          rate: ur.rate, tier: ur.tier, tierKey: TIER_KEYS[ur.tier] || '',
          rate2: ur2.rate, tier2: ur2.tier, tier2Key: TIER_KEYS[ur2.tier] || '' };
        send(ws, { type: 'auth_ok', user: auth.publicUser(u) });
      }
      else { ws.account = null; send(ws, { type: 'auth_fail' }); }
      break;
    }
    // ログイン中の人がページを開いている間つないでおく接続（オンライン状態・フレンド機能に使う）
    case 'hello': {
      if (m.v !== SIM.PROTO) return send(ws, { type: 'hello_fail', code: 'reload' });
      const u = auth.verify(typeof m.token === 'string' ? m.token : '');
      presence.remove(ws);
      if (!u) return send(ws, { type: 'hello_fail', code: 'auth' });
      presence.add(u.id, ws, m.s);
      auth.seen(u.id);
      send(ws, { type: 'hello_ok', user: auth.publicUser(u) });
      break;
    }
    case 'status':                           // CPU対戦を始めた・やめた
      if (ws.presUid) presence.setStatus(ws, m.s);
      break;
    // フレンドを対戦に招待する（招待する人は先に部屋を作っておく）
    case 'invite': {
      const uid = ws.presUid;
      if (!uid) return;
      const fail = code => send(ws, { type: 'invite_fail', fid: auth.normFid(m.fid), code });
      const t = auth.byFid(m.fid);
      if (!t || !auth.isFriend(uid, t.id)) return fail('not_friend');
      if (!inviteTries.hit(uid)) return fail('too_many');
      const room = rooms.get(String(m.roomId || ''));
      const okRoom = room && room.phase === 'waiting' && (room.kind === 'team'
        ? room.hostUid() === uid && !room.isFull()
        : !!(room.players.a && room.players.a.uid === uid && !room.players.b));
      if (!okRoom) return fail('no_room');
      const st = presence.statusOf(t.id);
      if (st === 'offline') return fail('offline');
      if (st === 'match') return fail('busy');
      for (const [id, iv] of invites) if (iv.from === uid && iv.to === t.id) { invites.delete(id); pushTo(t.id, { type: 'invite_cancel', id }); }
      const id = crypto.randomBytes(6).toString('hex');
      invites.set(id, { id, from: uid, to: t.id, roomId: room.id });
      pushTo(t.id, { type: 'invite', id, roomId: room.id, from: cardOf(uid) });
      send(ws, { type: 'invite_sent', fid: t.fid, status: st });
      log('invite', room.id, 'discord=' + uid, '->', 'discord=' + t.id, '(' + st + ')');
      break;
    }
    // 招待への返事（参加するときは、このあと部屋番号でふつうに入ってくる）
    case 'invite_reply': {
      const uid = ws.presUid;
      const iv = uid && invites.get(String(m.id || ''));
      if (!iv || iv.to !== uid) return;
      invites.delete(iv.id);
      const me = auth.user(uid);
      pushTo(iv.from, { type: m.ok ? 'invite_accepted' : 'invite_declined', fid: me.fid,
        name: (me.profile && me.profile.name) || me.name, timeout: !m.ok && m.timeout === true });
      break;
    }
    // set_difficulty など、オンライン対戦で使わないメッセージは無視
  }
}

// ---- HTTP（動作確認とログインの窓口）----
function cors(req, res) {
  const origin = req.headers.origin || '';
  const allow = !ALLOWED_ORIGINS.length ? '*' : (ALLOWED_ORIGINS.includes(origin) ? origin : '');
  if (!allow) return false;
  res.setHeader('Access-Control-Allow-Origin', allow);
  if (allow !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const bearer = req => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
function readJson(req, cb) {
  let body = '', bad = false;
  req.on('data', d => { body += d; if (body.length > 4096) { bad = true; req.destroy(); } });
  req.on('end', () => { if (bad) return cb(null); try { cb(JSON.parse(body)); } catch { cb(null); } });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const ip = clientIp(req);
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (BANNED_IPS.has(ip)) return json(res, 403, { error: '利用停止されています' });
  // yourIp はサーバーから見えている自分のIP（Railwayで正しく判定できているかの確認用）
  if (url === '/health') return json(res, 200, { ok: true, rooms: rooms.size, connections: sockets.size, online: presence.count(), uptime: Math.round(process.uptime()), accounts: auth.stats().users, yourIp: ip });
  // Discord のスラッシュコマンド（/info）。署名を確かめてから答える
  if (url === '/discord/interactions' && req.method === 'POST') return interactions.handle(req, res, log);
  if (url === '/api/config') return json(res, 200, { login: auth.enabled(), clientId: auth.clientId(), requireLogin: REQUIRE_LOGIN, proto: SIM.PROTO });
  if (url === '/api/login' && req.method === 'POST') {
    if (!auth.enabled()) return json(res, 503, { error: 'このサーバーではログインが設定されていません' });
    if (!loginTries.hit(ip)) return json(res, 429, { error: '試行が多すぎます。しばらく待ってください' });
    return readJson(req, m => {
      if (!m || !m.code || !m.redirect_uri) return json(res, 400, { error: 'リクエストが不正です' });
      auth.login(String(m.code), String(m.redirect_uri))
        .then(r => { log('login', r.user.name, 'from', ip); json(res, 200, r); })
        .catch(e => {
          if (e.code === 'BANNED') { log('login refused (banned) from', ip); return json(res, 403, { error: 'このアカウントは利用停止されています' }); }
          log('login failed:', e.message);
          json(res, 400, { error: 'ログインできませんでした' });
        });
    });
  }
  // レート順のランキング。ログインしていれば、自分の順位も返す
  if (url === '/api/ranking') {
    const u = auth.verify(bearer(req));
    const kind = new URLSearchParams((req.url || '').split('?')[1] || '').get('kind');
    const rk = kind === '2v2' ? ranking2() : ranking();
    const top = rk.list.slice(0, RANK_TOP).map((r, i) => rankPub(r, i + 1));
    let me = null;
    if (u) { const i = rk.list.findIndex(r => r.uid === u.id); if (i >= 0) me = rankPub(rk.list[i], i + 1); }
    return json(res, 200, { top, total: rk.list.length, me, at: rk.at, ttl: RANK_TTL });
  }
  if (url === '/api/me') {
    const u = auth.verify(bearer(req));
    return u ? json(res, 200, { user: auth.publicUser(u), profile: u.profile || null, rev: u.profileRev || 0 }) : json(res, 401, { error: '未ログイン' });
  }
  // 自分のプロフィールを保存する（ログイン中だけ）
  if (url === '/api/profile' && req.method === 'POST') {
    const u = auth.verify(bearer(req));
    if (!u) return json(res, 401, { error: '未ログイン' });
    if (!profileSaves.hit(u.id)) return json(res, 429, { error: '保存が多すぎます。少し待ってください' });
    return readJson(req, m => {
      if (!m || !m.profile || typeof m.profile !== 'object') return json(res, 400, { error: 'リクエストが不正です' });
      json(res, 200, auth.saveProfile(u.id, m.profile, m.base));
    });
  }
  // フレンドの一覧（GET）と、申請・承認・拒否・解除（POST { op, fid }）
  if (url === '/api/friends') {
    const u = auth.verify(bearer(req));
    if (!u) return json(res, 401, { error: '未ログイン' });
    if (req.method === 'GET') {
      const L = auth.friendLists(u.id), cards = ids => ids.map(cardOf).filter(Boolean);
      return json(res, 200, { friends: cards(L.friends), incoming: cards(L.incoming), outgoing: cards(L.outgoing) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!friendOps.hit(u.id)) return json(res, 429, { error: '操作が多すぎます。少し待ってください' });
    return readJson(req, m => {
      const op = m && m.op;
      if (!['request', 'accept', 'decline', 'remove'].includes(op)) return json(res, 400, { error: 'リクエストが不正です' });
      const t = auth.byFid(m.fid);
      if (!t) return json(res, 404, { result: 'not_found' });
      const r = op === 'request' ? auth.friendRequest(u.id, t.id) : op === 'accept' ? auth.friendAccept(u.id, t.id)
        : op === 'decline' ? auth.friendDecline(u.id, t.id) : auth.friendRemove(u.id, t.id);
      // 相手にも知らせる（一覧を読み直してもらう）
      if (r === 'sent') pushTo(t.id, { type: 'friend_event', kind: 'request', from: cardOf(u.id) });
      else if (r === 'accepted') pushTo(t.id, { type: 'friend_event', kind: 'accepted', from: cardOf(u.id) });
      else if (r === 'ok') pushTo(t.id, { type: 'friend_event', kind: op === 'remove' ? 'removed' : 'declined', from: { fid: u.fid } });
      if (r === 'sent' || r === 'accepted' || r === 'ok') log('friend', op, r, 'discord=' + u.id, '->', 'discord=' + t.id);
      json(res, 200, { result: r, player: cardOf(t.id) });
    });
  }
  // フレンドIDで他の人のカードを見る（ログイン中だけ）
  if (url === '/api/player') {
    const u = auth.verify(bearer(req));
    if (!u) return json(res, 401, { error: '未ログイン' });
    if (!lookups.hit(ip)) return json(res, 429, { error: '検索が多すぎます。少し待ってください' });
    const q = new URLSearchParams((req.url || '').split('?')[1] || '');
    const t = auth.byFid(q.get('id'));
    return t ? json(res, 200, { player: auth.card(t, presence.statusOf(t.id)) }) : json(res, 404, { error: 'not_found' });
  }
  if (url === '/api/logout' && req.method === 'POST') { auth.logout(bearer(req)); return json(res, 200, { ok: true }); }
  if (url === '/api/tier' && req.method === 'POST') {
    const u = auth.verify(bearer(req));
    if (!u) return json(res, 401, { error: '未ログイン' });
    return readJson(req, m => {
      const key = m && typeof m.tier === 'string' ? m.tier : '';
      const idx = TIERS.indexOf(key) + 1;
      if (idx < 1) return json(res, 400, { error: 'ティアが不正です' });
      // ティアはサーバーのレートで決まる。まだ届いていないティアは報告できない
      const rs = auth.rating(u.id);
      if (!rs || idx > rs.tier) return json(res, 400, { error: 'ティアが不正です' });
      if (idx <= auth.bestTier(u.id)) return json(res, 200, { notified: false, reason: 'already' });
      const last = tierLastReport.get(u.id) || 0;
      if (Date.now() - last < TIER_COOLDOWN_MS) return json(res, 429, { notified: false, reason: 'cooldown' });
      tierLastReport.set(u.id, Date.now());
      auth.setBestTier(u.id, idx);
      log('tier up', u.name, 'discord=' + u.id, key);
      postTierUp(u, key).then(ok => json(res, 200, { notified: ok }));
    });
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('GUN DUEL server is running\n');
});

attach(server, ws => {
  if (BANNED_IPS.has(ws.ip)) { ws.destroy(); return; }
  if (sockets.size >= MAX_CONNS) { ws.close(); return; }
  let same = 0;
  for (const s of sockets) if (s.ip === ws.ip) same++;
  if (same >= MAX_CONNS_PER_IP) { log('too many connections from', ws.ip); ws.close(); return; }
  sockets.add(ws);
  ws.room = null; ws.slot = null; ws.msgs = 0;
  ws.on('message', raw => onMessage(ws, raw));
  ws.on('close', () => {
    sockets.delete(ws); presence.remove(ws); queue.delete(ws); q2Leave(ws, null);
    if (ws.room) { ws.room.leave(ws.slot); if (ws.account) presence.changed(ws.account.uid); }
  });
}, { checkOrigin: origin => !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin) });

// 60Hz 固定ステップ（タイマーのぶれを蓄積で補正）
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc = Math.min(acc + now - last, 250); last = now;
  while (acc >= TICK_MS) { for (const r of rooms.values()) r.tick(); acc -= TICK_MS; }
}, TICK_MS);

setInterval(() => { for (const ws of sockets) ws.msgs = 0; }, 1000);
// 30秒ごとに生存確認。応答のない接続（回線断など）を片付ける
setInterval(() => {
  for (const ws of sockets) { if (!ws.alive) { ws.destroy(); continue; } ws.alive = false; ws.ping(); }
}, 30000);

server.listen(PORT, HOST, () => {
  log(`GUN DUEL server listening on ${HOST}:${PORT}` +
    (ALLOWED_ORIGINS.length ? ` (origins: ${ALLOWED_ORIGINS.join(', ')})` : '') +
    (REQUIRE_LOGIN ? ' (login required)' : ''));
  if (interactions.enabled()) interactions.register(log);   // Discord に /info を登録
});
function shutdown(sig) {
  log('shutting down', sig);
  for (const ws of sockets) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
