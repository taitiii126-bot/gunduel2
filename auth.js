'use strict';
// Discordログインとアカウント保存（依存パッケージなし / Node 18以上の fetch を使用）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./profile');

// systemd の StateDirectory=gunduel があれば /var/lib/gunduel に保存する
const DATA_DIR = process.env.DATA_DIR || process.env.STATE_DIRECTORY || __dirname;
const FILE = path.join(DATA_DIR, 'users.json');
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;     // ログインの有効期間: 30日
const NAME_MAX = 12;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// 利用停止するDiscordのユーザーID（カンマ区切り）。ログインもトークンも使えなくなる
const BANNED_IDS = new Set((process.env.BANNED_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

let db = { users: {}, tokens: {} };
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (loaded && typeof loaded === 'object') db = { users: loaded.users || {}, tokens: loaded.tokens || {} };
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
// 開拓者：最初の100人のアカウント（あとから外れることはない）
const PIONEERS = 100;
Object.values(db.users).sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, PIONEERS)
  .forEach(u => { if (!u.pioneer) { u.pioneer = true; dirty = true; } });
// 称号の確認に使う本人の情報
const titleCtx = u => ({ w: u.online.w, l: u.online.l, friends: (u.friends || []).length, pioneer: !!u.pioneer });
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
  return { name: u.name, wins: u.online.w, losses: u.online.l, since: u.created, fid: u.fid, pioneer: !!u.pioneer };
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
    }
    u.name = cleanName(info.name);
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
    const ctx = titleCtx(u), inc = P.clean(raw, ctx), rev = u.profileRev || 0;
    const merged = !!u.profile && Math.floor(+base) !== rev;
    u.profile = merged ? P.merge(P.clean(u.profile, ctx), inc) : inc;
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
    const p = u.profile || null, tier = p ? P.tierIndex(p.tierProgress) : 0;
    return {
      fid: u.fid, name: p ? p.name : u.name, discord: u.name,
      title: p ? P.validTitle(p.title, titleCtx(u)) : 'rookie', bio: p ? p.bio : '', look: p ? p.look : null, loadout: p ? p.loadout || null : null,
      tier, tierKey: P.TIER_KEYS[tier], bg: p ? (p.bg == null ? p.bestTier : p.bg) : 0,
      online: { w: u.online.w, l: u.online.l }, cpu: P.cpuTotals(p),
      status, lastSeen: status === 'offline' ? (u.lastSeen || 0) : 0,
    };
  },
  stats() { return { users: Object.keys(db.users).length, tokens: Object.keys(db.tokens).length }; },
  _flush: flush,
};

module.exports = auth;
