'use strict';
// GUN DUEL 対戦サーバー（Railway / Raspberry Pi 対応 / Node.js 18以上 / 依存パッケージなし）
const http = require('http');
const crypto = require('crypto');
const { attach, clientIp } = require('./ws-lite');
const { Room, TICK_MS, ACTIVE_MIN_INPUTS } = require('./game');
const auth = require('./auth');

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = list(process.env.ALLOWED_ORIGINS);
const MAX_ROOMS = +process.env.MAX_ROOMS || 100;
const MAX_CONNS = +process.env.MAX_CONNS || 300;
const MAX_CONNS_PER_IP = +process.env.MAX_CONNS_PER_IP || 8;     // 同じIPからの同時接続
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

// ---- ティア昇格をDiscordに投稿 ----
// ティアはCPU戦（ブラウザ内）の結果なので検証できない。そのため、
// ・ログイン中の本人だけ ・前に報告したティアより上のときだけ（1人最大10回） ・連投は止める に制限する
const TIERS = ['LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1'];   // 添字+1 がティアの順位
const TIER_COLORS = { LT5: 0x92400E, HT5: 0xB45309, LT4: 0x9CA3AF, HT4: 0xCBD5E1, LT3: 0xFBBF24,
  HT3: 0xFDE047, LT2: 0x38BDF8, HT2: 0x22D3EE, LT1: 0xC084FC, HT1: 0xF472B6 };
const TIER_DIFF = { 5: 'よわい', 4: 'ふつう', 3: 'つよい', 2: '鬼', 1: '鬼神' };
const tierText = key => TIER_DIFF[key[2]] + (key[0] === 'H' ? 'にストレート(3-0)で勝利' : 'に勝利');
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
      { name: '達成条件', value: tierText(key), inline: true },
      { name: '次の目標', value: next ? `${next}：${tierText(next)}` : '最高ティア到達！', inline: true },
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
  log(tag, 'recorded:', winner.name, 'beat', loser.name, reason === 'forfeit' ? '(opponent left)' : '');
}
// 怪しい操作は本人には知らせず、ログとアカウントに残す（BANの判断材料）
function onSuspect(p, reason) {
  log('SUSPECT', 'discord=' + (p.uid || '-'), 'name=' + p.name, 'ip=' + p.ip, reason);
  if (p.uid) auth.flag(p.uid, reason);
}

function openRoom() {
  let id;
  do id = String(crypto.randomInt(100000, 1000000)); while (rooms.has(id));
  const room = new Room(id, {
    onClose: r => { rooms.delete(r.id); log('room closed', r.id, `(rooms: ${rooms.size})`); },
    onResult: (w, l, reason) => recordResult(room, w, l, reason),
    onSuspect,
  });
  rooms.set(id, room);
  return room;
}

function onMessage(ws, raw) {
  if (++ws.msgs > MSG_PER_SEC) { if (ws.msgs > MSG_KICK_PER_SEC) ws.destroy(); return; }
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.type !== 'string') return;
  switch (m.type) {
    case 'create_room': {
      if (ws.room) return;
      if (REQUIRE_LOGIN && !ws.account) return send(ws, { type: 'error', msg: 'オンライン対戦にはDiscordログインが必要です' });
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', msg: 'サーバーが混み合っています。少し待ってからお試しください' });
      let mine = 0;
      for (const r of rooms.values()) if (r.hostIp() === ws.ip) mine++;
      if (mine >= MAX_ROOMS_PER_IP) return send(ws, { type: 'error', msg: '同時に作れる部屋の数を超えています' });
      const room = openRoom();
      room.join(ws, m);
      send(ws, { type: 'room_created', roomId: room.id, slot: ws.slot });
      log('room created', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
      break;
    }
    case 'join_room': {
      if (ws.room) return;
      if (REQUIRE_LOGIN && !ws.account) return send(ws, { type: 'error', msg: 'オンライン対戦にはDiscordログインが必要です' });
      if (joinFails.blocked(ws.ip)) return send(ws, { type: 'error', msg: '部屋番号の入力ミスが多すぎます。しばらく待ってからお試しください' });
      const id = String(m.roomId || '');
      const room = /^\d{6}$/.test(id) ? rooms.get(id) : null;
      if (!room) { joinFails.hit(ws.ip); return send(ws, { type: 'error', msg: '部屋が見つかりません。番号を確認してください' }); }
      const host = room.players.a;
      if (host && host.uid && ws.account && host.uid === ws.account.uid) return send(ws, { type: 'error', msg: '同じアカウント同士では対戦できません' });
      if (!room.join(ws, m)) return send(ws, { type: 'error', msg: 'この部屋はすでに対戦中です' });
      send(ws, { type: 'room_joined', roomId: room.id, slot: ws.slot });
      log('room joined', room.id, 'from', ws.ip, ws.account ? 'discord=' + ws.account.uid : 'guest');
      room.start();
      break;
    }
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
    case 'auth': {
      if (ws.room) return;                   // 対戦中に別人へ切り替えるのは不可
      const u = auth.verify(typeof m.token === 'string' ? m.token : '');
      if (u) { ws.account = { uid: u.id, name: u.name }; send(ws, { type: 'auth_ok', user: auth.publicUser(u) }); }
      else { ws.account = null; send(ws, { type: 'auth_fail' }); }
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
  if (url === '/health') return json(res, 200, { ok: true, rooms: rooms.size, connections: sockets.size, uptime: Math.round(process.uptime()), accounts: auth.stats().users, yourIp: ip });
  if (url === '/api/config') return json(res, 200, { login: auth.enabled(), clientId: auth.clientId(), requireLogin: REQUIRE_LOGIN });
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
  if (url === '/api/me') {
    const u = auth.verify(bearer(req));
    return u ? json(res, 200, { user: auth.publicUser(u) }) : json(res, 401, { error: '未ログイン' });
  }
  if (url === '/api/logout' && req.method === 'POST') { auth.logout(bearer(req)); return json(res, 200, { ok: true }); }
  if (url === '/api/tier' && req.method === 'POST') {
    const u = auth.verify(bearer(req));
    if (!u) return json(res, 401, { error: '未ログイン' });
    return readJson(req, m => {
      const key = m && typeof m.tier === 'string' ? m.tier : '';
      const idx = TIERS.indexOf(key) + 1;
      if (idx < 1) return json(res, 400, { error: 'ティアが不正です' });
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
  ws.on('close', () => { sockets.delete(ws); if (ws.room) ws.room.leave(ws.slot); });
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
});
function shutdown(sig) {
  log('shutting down', sig);
  for (const ws of sockets) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
