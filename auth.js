'use strict';
// Discordログインとアカウント保存（依存パッケージなし / Node 18以上の fetch を使用）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

let dirty = false;
const touch = () => { dirty = true; };
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
  return { name: u.name, wins: u.online.w, losses: u.online.l, since: u.created };
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
    if (!u) u = db.users[uid] = { id: uid, name: '', created: Date.now(), online: { w: 0, l: 0 } };
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
  stats() { return { users: Object.keys(db.users).length, tokens: Object.keys(db.tokens).length }; },
  _flush: flush,
};

module.exports = auth;
