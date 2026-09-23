'use strict';
// Discordログインとアカウント保存（依存パッケージなし / Node 18以上の fetch を使用）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./profile');
const { SIM } = require('./game');

// systemd の StateDirectory=gunduel があれば /var/lib/gunduel に保存する
const DATA_DIR = process.env.DATA_DIR || process.env.STATE_DIRECTORY || __dirname;
const FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;     // ログインの有効期間: 30日
const NAME_MAX = 12;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// 利用停止するDiscordのユーザーID（カンマ区切り）。ログインもトークンも使えなくなる
const BANNED_IDS = new Set((process.env.BANNED_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
// 称号「信頼のハッカー」を贈る人。フレンドコード（8文字）か Discord の ID をカンマ区切りで環境変数に書く。
// 例: GIFT_HACKER_IDS=ABCD2345 　書けば付き、消せば外れる（コードには誰も書かない）
const GIFT_HACKER = new Set((process.env.GIFT_HACKER_IDS || '').split(',').map(s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean));
const isGiftHacker = u => GIFT_HACKER.has(String(u.fid || '').toUpperCase()) || GIFT_HACKER.has(String(u.id || ''));
const setGift = u => { const g = isGiftHacker(u); if (g === !!u.hacker) return false; if (g) u.hacker = true; else delete u.hacker; return true; };
// 運営（この世界を作った人）。同じく環境変数で指定する。例: DEV_IDS=ABCD2345,EFGH6789
const DEV_IDS = new Set((process.env.DEV_IDS || '').split(',').map(s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean));
const isDev = u => DEV_IDS.has(String(u.fid || '').toUpperCase()) || DEV_IDS.has(String(u.id || ''));
const setDev = u => { const g = isDev(u); if (g === !!u.dev) return false; if (g) u.dev = true; else delete u.dev; return true; };

let db = { users: {}, tokens: {}, meta: {} };
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (loaded && typeof loaded === 'object') db = { users: loaded.users || {}, tokens: loaded.tokens || {}, meta: loaded.meta || {} };
} catch (e) { /* 初回は存在しない */ }

// フレンドID：英数字8桁（見間違えやすい 0/O・1/I/L は使わない）。アカウントごとに1つ、変わらない
const FID_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const fids = new Map();   // フレンドID → DiscordのユーザーID
function newFid() {
  let f;
  do { f = ''; for (let i = 0; i < 8; i++) f += FID_CHARS[crypto.randomInt(FID_CHARS.length)]; } while (fids.has(f));
  return f;
}
function giveFid(u) {
  if (!u.fid || fids.has(u.fid)) { u.fid = newFid(); dirty = true; }
  fids.set(u.fid, u.id);
}
// フレンド：お互いの ID を friends に持つ。申請中は相手の fin（届いた）と自分の fout（送った）に入る
const MAX_FRIENDS = 100, MAX_PENDING = 50;
const list = (u, k) => (Array.isArray(u[k]) ? u[k] : (u[k] = []));
const drop = (a, v) => { const i = a.indexOf(v); if (i < 0) return false; a.splice(i, 1); return true; };
const normFid = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

let dirty = false;
const touch = () => { dirty = true; };
for (const u of Object.values(db.users)) giveFid(u);   // 前からいる人にも配る
for (const u of Object.values(db.users)) { if (setGift(u)) dirty = true; if (setDev(u)) dirty = true; }   // 配った称号（環境変数のとおりに付け外し）
// 完全レート制に切りかえたので、全員のレートを1000からやり直す（1回だけ）。
// 戦績（オンラインの勝敗）・称号・見た目・解放済みの背景は消さない
if ((db.meta.rateEpoch || 0) < 2) {
  for (const u of Object.values(db.users)) {
    u.rate = SIM.RATE_START; u.rtier = SIM.tierOfRate(SIM.RATE_START); u.rgames = 0; u.rstreak = 0; u.rwstreak = 0;
    u.rpeak = SIM.RATE_START; u.ranked = { w: 0, l: 0 }; u.tierBest = 0;
  }
  db.meta.rateEpoch = 2; dirty = true;
}
// 開拓者：最初の100人のアカウント（あとから外れることはない）
const PIONEERS = 100;
Object.values(db.users).sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, PIONEERS)
  .forEach(u => { if (!u.pioneer) { u.pioneer = true; dirty = true; } });
// 超古参プレイヤー：いちばん最初の10人のアカウント（あとから外れることはない）
const FIRST_TEN = 10;
Object.values(db.users).sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, FIRST_TEN)
  .forEach(u => { if (!u.pioneer10) { u.pioneer10 = true; dirty = true; } });
// 称号の確認に使う本人の情報
const titleCtx = u => ({ w: u.online.w, l: u.online.l, friends: (u.friends || []).length, pioneer: !!u.pioneer, pioneer10: !!u.pioneer10, hacker: !!u.hacker, dev: !!u.dev });

// ---- レート ----
// ティアはレートの数値だけで決まる。最初は全員1000。レートが動くのはランクマッチだけ（CPU戦では動かない）
function rateState(u) {
  if (typeof u.rate !== 'number' || !isFinite(u.rate)) { u.rate = SIM.RATE_START; u.rgames = 0; touch(); }   // 全員1000から
  const t2 = SIM.tierOfRate(u.rate);   // ティアはレートの数値だけで決まる
  if (u.rtier !== t2) { u.rtier = t2; touch(); }
  if (!u.ranked) { u.ranked = { w: 0, l: 0 }; touch(); }
  return { rate: u.rate, tier: u.rtier, games: u.rgames || 0, streak: u.rstreak || 0, wstreak: u.rwstreak || 0,
    w: u.ranked.w, l: u.ranked.l, peak: u.rpeak || u.rate };
}
// ---- 2v2 のレート（1v1 とは完全に別。1000 から、ティアの区切りは同じ）----
function rateState2(u) {
  if (typeof u.rate2 !== 'number' || !isFinite(u.rate2)) { u.rate2 = SIM.RATE_START; u.rgames2 = 0; touch(); }
  if (!u.ranked2) { u.ranked2 = { w: 0, l: 0 }; touch(); }
  return { rate: u.rate2, tier: SIM.tierOfRate(u.rate2), games: u.rgames2 || 0, streak: u.rstreak2 || 0, wstreak: u.rwstreak2 || 0,
    w: u.ranked2.w, l: u.ranked2.l, peak: u.rpeak2 || u.rate2 };
}
function writeRate2(u, r, win) {
  u.rate2 = r.rate; u.rgames2 = r.games; u.rstreak2 = r.streak; u.rwstreak2 = r.wstreak;
  u.rpeak2 = Math.max(u.rpeak2 || 0, r.rate);
  if (!u.ranked2) u.ranked2 = { w: 0, l: 0 };
  if (win) u.ranked2.w++; else u.ranked2.l++;
  touch();
}
function writeRate(u, r, win) {
  u.rate = r.rate; u.rtier = r.tier; u.rgames = r.games; u.rstreak = r.streak; u.rwstreak = r.wstreak;
  u.rpeak = Math.max(u.rpeak || 0, r.rate);
  if (!u.ranked) u.ranked = { w: 0, l: 0 };
  if (win) u.ranked.w++; else u.ranked.l++;
  touch();
}
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);          // 書き換え途中で壊れないように差し替える
  } catch (e) {
    console.error('users.json の保存に失敗:', e.message);
  }
}
setInterval(flush, 5000).unref();
process.on('exit', flush);

function cleanName(v) {
  const n = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, NAME_MAX);
  return n || 'プレイヤー';
}
function publicUser(u) {
  const r = rateState(u), r2 = rateState2(u);
  return { name: u.name, wins: u.online.w, losses: u.online.l, since: u.created, fid: u.fid, pioneer: !!u.pioneer, pioneer10: !!u.pioneer10, hacker: !!u.hacker, dev: !!u.dev,
    rate: r.rate, tier: r.tier, rgames: r.games, rstreak: r.streak, rwstreak: r.wstreak, ranked: { w: r.w, l: r.l }, peak: r.peak,
    rate2: r2.rate, tier2: r2.tier, rgames2: r2.games, ranked2: { w: r2.w, l: r2.l }, peak2: r2.peak };
}
function cleanupTokens() {
  const now = Date.now();
  for (const t of Object.keys(db.tokens)) if (db.tokens[t].exp < now) { delete db.tokens[t]; touch(); }
}

// Discordに認可コードを渡して、本人のIDと表示名を受け取る
async function exchangeWithDiscord(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  });
  const tr = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!tr.ok) throw new Error('Discordのトークン取得に失敗 (' + tr.status + ')');
  const tok = await tr.json();
  const ur = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: 'Bearer ' + tok.access_token },
  });
  if (!ur.ok) throw new Error('Discordのユーザー取得に失敗 (' + ur.status + ')');
  const me = await ur.json();
  return { id: String(me.id), name: me.global_name || me.username || '' };
}

const auth = {
  enabled() { return !!(CLIENT_ID && CLIENT_SECRET); },
  clientId() { return CLIENT_ID; },

  // exchange はテスト用に差し替えられるようにしてある（既定は本物のDiscord）
  async login(code, redirectUri, exchange) {
    if (!auth.enabled()) throw new Error('ログインは設定されていません');
    if (!code || typeof code !== 'string' || code.length > 256) throw new Error('コードが不正です');
    const info = await (exchange || exchangeWithDiscord)(code, redirectUri);
    if (!info || !info.id) throw new Error('ユーザー情報を取得できませんでした');
    const uid = String(info.id);
    if (BANNED_IDS.has(uid)) { const e = new Error('banned'); e.code = 'BANNED'; throw e; }
    let u = db.users[uid];
    if (!u) {
      u = db.users[uid] = { id: uid, name: '', created: Date.now(), online: { w: 0, l: 0 } };
      giveFid(u);
      if (Object.keys(db.users).length <= PIONEERS) u.pioneer = true;
      if (Object.keys(db.users).length <= FIRST_TEN) u.pioneer10 = true;
    }
    u.name = cleanName(info.name);
    setGift(u); setDev(u);                             // 配った称号は、入り直すたびに環境変数と合わせる
    u.lastSeen = Date.now();
    cleanupTokens();
    const token = crypto.randomBytes(32).toString('base64url');
    db.tokens[token] = { uid, exp: Date.now() + TOKEN_TTL };
    touch();
    return { token, user: publicUser(u) };
  },

  verify(token) {
    if (!token || typeof token !== 'string') return null;
    const t = db.tokens[token];
    if (!t) return null;
    if (t.exp < Date.now()) { delete db.tokens[token]; touch(); return null; }
    const u = db.users[t.uid];
    if (!u || BANNED_IDS.has(u.id)) return null;
    u.lastSeen = Date.now();
    return u;
  },

  logout(token) {
    if (token && db.tokens[token]) { delete db.tokens[token]; touch(); return true; }
    return false;
  },

  // オンライン対戦の結果だけを公式記録として残す（CPU戦は自己申告なので記録しない）
  recordOnlineResult(uid, win) {
    const u = db.users[uid];
    if (!u) return;
    if (win) u.online.w++; else u.online.l++;
    touch();
  },

  // 今のレート（無ければ CPU戦の到達度から作る）
  rating(uid) { const u = db.users[uid]; return u ? rateState(u) : null; },
  // ランクマッチの結果をレートに当てはめて、両方の結果を返す。
  // capWin：勝った側がここまでしか上がれない（BOT戦の上限）。二人ぶんとも、試合前の値から計算する
  applyRanked(winUid, loseUid, opt) {
    const a = db.users[winUid], b = db.users[loseUid];
    if (!a || !b) return null;
    const ra = rateState(a), rb = rateState(b);
    const A2 = SIM.applyRate(ra, { theirs: rb.rate, opTier: rb.tier, win: true, cap: (opt && opt.capWin) || null });
    const B2 = SIM.applyRate(rb, { theirs: ra.rate, opTier: ra.tier, win: false, cap: null });
    writeRate(a, A2, true); writeRate(b, B2, false);
    return { win: A2, lose: B2 };
  },

  // BOT戦：人の側だけレートを動かす。勝っても cap のティアの下限より上には行かない
  applyVsBot(uid, botRate, win, cap) {
    const u = db.users[uid];
    if (!u) return null;
    const st = rateState(u);
    const r = SIM.applyRate(st, { theirs: botRate, opTier: SIM.tierOfRate(botRate), win: !!win, cap: win ? cap : null });
    writeRate(u, r, !!win);
    return r;
  },

  // 2v2 のレート（1v1 とは別）
  rating2(uid) { const u = db.users[uid]; return u ? rateState2(u) : null; },
  // 2v2 のランクマッチの結果を1人ぶん当てはめる。o = { mine: 自分のチームの平均, theirs: 相手チームの平均, win, cap }
  applyRanked2(uid, o) {
    const u = db.users[uid];
    if (!u) return null;
    const st = rateState2(u);
    const r = SIM.applyRate(st, { mine: o.mine, theirs: o.theirs, win: !!o.win, cap: o.win ? (o.cap == null ? null : o.cap) : null });
    writeRate2(u, r, !!o.win);
    return r;
  },
  rankRow2(u) {
    if (!u || BANNED_IDS.has(String(u.id))) return null;
    const r = rateState2(u), p = u.profile || null;
    return { uid: u.id, name: p ? p.name : cleanName(u.name), title: p ? P.validTitle(p.title, titleCtx(u)) : 'rookie',
      tier: r.tier, rate: r.rate, w: r.w, l: r.l, games: r.games, dev: !!u.dev };
  },
  // ランキングに出す1行（BOTはアカウントを持たないので、そもそも入らない）
  rankRow(u) {
    if (!u || BANNED_IDS.has(String(u.id))) return null;
    const r = rateState(u), p = u.profile || null;
    return { uid: u.id, name: p ? p.name : cleanName(u.name), title: p ? P.validTitle(p.title, titleCtx(u)) : 'rookie',
      tier: r.tier, rate: r.rate, w: r.w, l: r.l, games: r.games, dev: !!u.dev };
  },

  // 怪しいプレイを検知した回数をアカウントに残す（BANするかの判断材料）
  flag(uid, reason) {
    const u = db.users[uid];
    if (!u) return;
    u.flags = (u.flags || 0) + 1; u.lastFlag = String(reason).slice(0, 80); u.lastFlagAt = Date.now();
    touch();
  },
  isBanned(uid) { return BANNED_IDS.has(String(uid)); },
  // Discordに報告済みの最高ティア（0=未ランク、1=LT5 … 10=HT1）
  bestTier(uid) { const u = db.users[uid]; return u ? (u.tierBest || 0) : 0; },
  setBestTier(uid, idx) {
    const u = db.users[uid];
    if (!u) return;
    u.tierBest = idx; u.tierAt = Date.now();
    touch();
  },
  publicUser,

  // ---- プロフィールの保存 ----
  // base（ブラウザが最後に見た版）が今の版と同じなら丸ごと置き換える（戦績のリセットもそのまま反映）。
  // 違う＝別の端末で先に保存されていたら、戦績と進み具合は大きい方を残して混ぜ、merged: true で返す
  saveProfile(uid, raw, base) {
    const u = db.users[uid];
    if (!u) return null;
    const rt = rateState(u).tier;
    const ctx = titleCtx(u), inc = P.clean(raw, ctx, rt), rev = u.profileRev || 0;
    const merged = !!u.profile && Math.floor(+base) !== rev;
    u.profile = merged ? P.merge(P.clean(u.profile, ctx, rt), inc) : inc;
    u.profileRev = rev + 1; u.profileAt = Date.now();
    touch();
    return { rev: u.profileRev, merged, profile: u.profile };
  },
  user(uid) { return db.users[uid] || null; },
  users() { return Object.values(db.users); },

  // ---- フレンド ----
  // 戻り値：sent / accepted / already / pending / self / limit / full / not_found
  friendRequest(uid, tid) {
    const u = db.users[uid], t = db.users[tid];
    if (!u || !t) return 'not_found';
    if (uid === tid) return 'self';
    if (list(u, 'friends').includes(tid)) return 'already';
    if (list(u, 'fin').includes(tid)) return auth.friendAccept(uid, tid);   // 相手からも申請が来ていたら、そのままフレンドに
    if (list(u, 'fout').includes(tid)) return 'pending';
    if (u.friends.length >= MAX_FRIENDS) return 'limit';
    if (u.fout.length >= MAX_PENDING || list(t, 'fin').length >= MAX_PENDING) return 'full';
    u.fout.push(tid); t.fin.push(uid);
    touch();
    return 'sent';
  },
  friendAccept(uid, fromId) {
    const u = db.users[uid], f = db.users[fromId];
    if (!u || !f || !list(u, 'fin').includes(fromId)) return 'not_found';
    if (list(u, 'friends').length >= MAX_FRIENDS || list(f, 'friends').length >= MAX_FRIENDS) return 'limit';
    drop(u.fin, fromId); drop(list(f, 'fout'), uid);
    drop(list(u, 'fout'), fromId); drop(list(f, 'fin'), uid);    // お互いに申請していた場合も片付ける
    if (!u.friends.includes(fromId)) u.friends.push(fromId);
    if (!f.friends.includes(uid)) f.friends.push(uid);
    touch();
    return 'accepted';
  },
  // 届いた申請を断る・自分の申請を取り消す
  friendDecline(uid, oid) {
    const u = db.users[uid], o = db.users[oid];
    if (!u || !o) return 'not_found';
    const a = drop(list(u, 'fin'), oid), b = drop(list(o, 'fout'), uid);
    const c = drop(list(u, 'fout'), oid), d = drop(list(o, 'fin'), uid);
    if (!(a || b || c || d)) return 'not_found';
    touch();
    return 'ok';
  },
  friendRemove(uid, oid) {
    const u = db.users[uid], o = db.users[oid];
    if (!u || !o) return 'not_found';
    const a = drop(list(u, 'friends'), oid), b = drop(list(o, 'friends'), uid);
    if (!(a || b)) return 'not_found';
    touch();
    return 'ok';
  },
  titleCtx,
  friendIds(uid) { const u = db.users[uid]; return u && Array.isArray(u.friends) ? u.friends : []; },
  isFriend(uid, oid) { return auth.friendIds(uid).includes(oid); },
  friendLists(uid) {
    const u = db.users[uid] || {};
    return { friends: u.friends || [], incoming: u.fin || [], outgoing: u.fout || [] };
  },
  byFid(fid) { const uid = fids.get(normFid(fid)); return uid ? db.users[uid] || null : null; },
  normFid,
  // 最後にオンラインだった時刻
  seen(uid) { const u = db.users[uid]; if (u) { u.lastSeen = Date.now(); touch(); } },
  // 他の人に見せるカード（DiscordのユーザーIDは出さない）
  card(u, status) {
    const p = u.profile || null, rs = rateState(u), tier = rs.tier, r2 = rateState2(u);
    return {
      fid: u.fid, name: p ? p.name : u.name, discord: u.name, dev: !!u.dev,
      title: p ? P.validTitle(p.title, titleCtx(u)) : 'rookie', bio: p ? p.bio : '', look: p ? p.look : null, loadout: p ? p.loadout || null : null,
      tier, tierKey: P.TIER_KEYS[tier], bg: p ? (p.bg == null ? p.bestTier : p.bg) : 0,
      online: { w: u.online.w, l: u.online.l }, cpu: P.cpuTotals(p), rate: rs.rate, ranked: { w: rs.w, l: rs.l },
      rate2: r2.rate, tier2: r2.tier, ranked2: { w: r2.w, l: r2.l },
      status, lastSeen: status === 'offline' ? (u.lastSeen || 0) : 0,
    };
  },
  stats() { return { users: Object.keys(db.users).length, tokens: Object.keys(db.tokens).length }; },
  _flush: flush,
};

module.exports = auth;
