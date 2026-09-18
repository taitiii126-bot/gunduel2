'use strict';
// Discord のスラッシュコマンド /info。Discord から HTTP で届くので、ボットを常時つないでおく必要はない
// （Discord の開発者ページで「Interactions Endpoint URL」にこのサーバーの /discord/interactions を登録する）
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const presence = require('./presence');
const P = require('./profile');
const { SIM } = require('./game');
// 画面の文字の辞書（ゲームと同じ lang.js）。GitHubに全部同じ場所へ置いた場合は同じフォルダ、手元ではひとつ上
const L = require(fs.existsSync(path.join(__dirname, 'lang.js')) ? './lang.js' : '../lang.js').GunDuelLang;

const PUBLIC_KEY = String(process.env.DISCORD_PUBLIC_KEY || '').trim();
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';         // なくてもよい（Client Secret で登録できる）
const API = process.env.DISCORD_API || 'https://discord.com/api/v10';
const GAME_URL = process.env.GAME_URL || '';
const MAX_BODY = 100 * 1024;

// Discord の公開鍵（Ed25519）。届いたリクエストが本当に Discord からかを署名で確かめる
let key = null;
if (/^[0-9a-f]{64}$/i.test(PUBLIC_KEY)) {
  key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
} else if (PUBLIC_KEY) console.error('DISCORD_PUBLIC_KEY の形が正しくありません（64文字の英数字）');

function verify(req, body) {
  const sig = String(req.headers['x-signature-ed25519'] || ''), ts = String(req.headers['x-signature-timestamp'] || '');
  if (!key || !/^[0-9a-f]{128}$/i.test(sig) || !/^\d{1,20}$/.test(ts)) return false;
  try { return crypto.verify(null, Buffer.from(ts + body), key, Buffer.from(sig, 'hex')); } catch (e) { return false; }
}

// ---- コマンドの登録（サーバーの起動時に毎回。同じ内容なら何も変わらない）----
const COMMANDS = [{
  name: 'info', type: 1,
  description: 'Show a GUN DUEL player profile',
  description_localizations: { ja: 'GUN DUEL のプレイヤー情報を表示します' },
  options: [{
    type: 3, name: 'name', required: true, max_length: 40,
    name_localizations: { ja: 'ユーザー名' },
    description: 'In-game name, Discord name or friend ID',
    description_localizations: { ja: 'ゲーム内の名前・Discordの名前・フレンドID' },
  }],
}];
async function register(log) {
  if (!key || !CLIENT_ID) return false;
  try {
    let authz = BOT_TOKEN ? 'Bot ' + BOT_TOKEN : '';
    if (!authz) {
      if (!CLIENT_SECRET) { log('discord: /info の登録には DISCORD_CLIENT_SECRET（または DISCORD_BOT_TOKEN）が必要です'); return false; }
      // ボットのトークンがなくても、アプリの Client ID と Secret でコマンドを登録できる
      const r = await fetch(API + '/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64') },
        body: 'grant_type=client_credentials&scope=applications.commands.update',
      });
      if (!r.ok) throw new Error('トークン取得 ' + r.status);
      authz = 'Bearer ' + (await r.json()).access_token;
    }
    const r2 = await fetch(API + '/applications/' + CLIENT_ID + '/commands', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: authz }, body: JSON.stringify(COMMANDS),
    });
    if (!r2.ok) throw new Error('登録 ' + r2.status + ' ' + (await r2.text()).slice(0, 200));
    log('discord: /info コマンドを登録しました');
    return true;
  } catch (e) {
    log('discord: /info の登録に失敗しました:', e.message);
    return false;
  }
}

// ---- プレイヤーを探す：Discordのメンション → フレンドID → ゲーム内の名前 → Discordの名前 → 名前の一部 ----
const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const nameOf = u => (u.profile && u.profile.name) || u.name;
function find(q) {
  const raw = String(q == null ? '' : q).trim();
  const ok = u => u && !auth.isBanned(u.id);
  const m = raw.match(/^<@!?(\d{5,25})>$/);
  if (m) { const u = auth.user(m[1]); return ok(u) ? [u] : []; }
  if (/^[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{4}$/.test(raw)) { const u = auth.byFid(raw); if (ok(u)) return [u]; }
  const n = norm(raw);
  if (!n) return [];
  const all = auth.users().filter(ok);
  let hit = all.filter(u => norm(nameOf(u)) === n);
  if (!hit.length) hit = all.filter(u => norm(u.name) === n);
  if (!hit.length) hit = all.filter(u => norm(nameOf(u)).includes(n) || norm(u.name).includes(n));
  return hit.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

// ---- 返事 ----
function T(lang, k, vars) {
  let s = (L[lang] && L[lang][k]) || L.ja[k] || k;
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(String(vars[v]));
  return s;
}
// Discordの書式記号で表示が崩れないようにする
const md = s => String(s).replace(/([*_~`|>\\])/g, '\\$1');
const DOT = { online: '🟢', cpu: '🟡', match: '🔴', offline: '⚫' };
function embedFor(u, lang) {
  const st = presence.statusOf(u.id), c = auth.card(u, st);
  const rec = r => { const n = r.w + r.l; return n ? T(lang, 'bot.rec', { p: Math.round(r.w / n * 100), w: r.w, l: r.l }) : T(lang, 'bot.noRec'); };
  let status = DOT[st] + ' ' + T(lang, 'fst.' + st);
  if (st === 'offline' && u.lastSeen) status += '\n' + T(lang, 'bot.lastSeen', { t: '<t:' + Math.floor(u.lastSeen / 1000) + ':R>' });
  const e = {
    title: md(c.name),
    color: P.TIER_COLORS[c.tierKey] || 0x4B5563,
    fields: [
      { name: T(lang, 'bot.tier'), value: c.tierKey || T(lang, 'tier.unranked'), inline: true },
      // レアの称号（ゲームでは青いネオン）には 🔷 を付ける
      { name: T(lang, 'bot.title'), value: (SIM.TITLES.some(x => x.id === c.title && x.rare) ? '🔷 ' : '') + md(T(lang, 'title.' + c.title)), inline: true },
      { name: T(lang, 'bot.status'), value: status, inline: true },
      { name: T(lang, 'bot.online'), value: rec(c.online), inline: true },
      { name: T(lang, 'bot.cpu'), value: rec(c.cpu), inline: true },
      { name: 'Discord', value: '<@' + u.id + '>', inline: true },
    ],
    footer: { text: 'GUN DUEL · ' + T(lang, 'bot.fid') + ' ' + c.fid },
  };
  if (c.bio) e.description = '> ' + md(c.bio);
  if (GAME_URL) e.url = GAME_URL;
  return e;
}
function reply(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  // 名前やひとことに @everyone などが入っていても、通知は飛ばさない
  res.end(JSON.stringify({ type: 4, data: Object.assign({ allowed_mentions: { parse: [] } }, data) }));
}
function info(it, res, log) {
  const lang = String(it.locale || '').startsWith('ja') ? 'ja' : 'en';
  const opt = ((it.data && it.data.options) || []).find(o => o.name === 'name');
  const q = String((opt && opt.value) || '').slice(0, 40);
  const hit = find(q);
  log('discord /info', JSON.stringify(q), '->', hit.length ? hit.length + ' found' : 'not found');
  if (!hit.length) return reply(res, { content: T(lang, 'bot.notFound', { q: md(q) }), flags: 64 });
  // 同じ名前の人が何人もいるときは、フレンドIDで選んでもらう（本人のフレンドIDは申請にしか使えないので出してよい）
  if (hit.length > 1 && norm(nameOf(hit[0])) === norm(nameOf(hit[1]))) {
    const list = hit.slice(0, 5).map(u => '・' + md(nameOf(u)) + '（' + u.fid + '）').join('\n');
    return reply(res, { content: T(lang, 'bot.many', { q: md(q), n: hit.length }) + '\n' + list, flags: 64 });
  }
  reply(res, { embeds: [embedFor(hit[0], lang)] });
}

// POST /discord/interactions
function handle(req, res, log) {
  if (!key) { res.writeHead(404); res.end(); return; }
  let body = '', size = 0, bad = false;
  req.setEncoding('utf8');
  req.on('data', d => { size += Buffer.byteLength(d); if (size > MAX_BODY) { bad = true; req.destroy(); } else body += d; });
  req.on('end', () => {
    if (bad) return;
    if (!verify(req, body)) { res.writeHead(401); res.end('invalid request signature'); return; }
    let it;
    try { it = JSON.parse(body); } catch (e) { res.writeHead(400); res.end(); return; }
    if (it.type === 1) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"type":1}'); return; }   // Discord の疎通確認
    if (it.type === 2 && it.data && it.data.name === 'info') return info(it, res, log);
    res.writeHead(400); res.end();
  });
}

module.exports = { enabled: () => !!key, handle, register, find };
