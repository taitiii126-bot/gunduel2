'use strict';
// クラン：仲間で集まって、オンライン対戦のポイントを合計で競う（ログイン中だけ）
// 1人が入れるクランは1つ。部屋番号のような6けたのクランIDで入る。作った人（リーダー）は、メンバーを外せる
// ポイント：オンライン対戦で勝つと 3、負けても 1（遊んだ分）。合計と、今週（月曜はじまり・シンガポール時間）の2つを数える
// 記録は clans.json（users.json と同じ場所）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || process.env.STATE_DIRECTORY || __dirname;
const FILE = path.join(DATA_DIR, 'clans.json');
const MAX_MEMBERS = 20, NAME_MAX = 16, TAG_MIN = 2, TAG_MAX = 4;
const PTS_WIN = 3, PTS_PLAY = 1;

let db = { clans: {}, member: {} };   // clans: ID → クラン、member: DiscordのユーザーID → クランID
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (loaded && typeof loaded === 'object') db = { clans: loaded.clans || {}, member: loaded.member || {} };
} catch (e) { /* 初回は存在しない */ }

let dirty = false;
function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error('clans.json の保存に失敗:', e.message); }
}
setInterval(flush, 5000).unref();
process.on('exit', flush);

// 今週の番号（シンガポール時間の月曜 0 時で切りかわる）
function weekKey(now) {
  const d = Math.floor(((now || Date.now()) + 8 * 3600e3) / 86400e3);   // 1970-01-01 は木曜
  return Math.floor((d + 3) / 7);
}
function cleanName(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, NAME_MAX); }
// タグ：英大文字と数字だけ、2〜4文字（名前の前に [TAG] と出す）
function cleanTag(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TAG_MAX); }
function newId() {
  let id;
  do id = String(crypto.randomInt(100000, 1000000)); while (db.clans[id]);
  return id;
}
function freshWeek(c) { const wk = weekKey(); if (!c.wk || c.wk.key !== wk) { c.wk = { key: wk, pts: 0, mp: {} }; dirty = true; } return c.wk; }

function clanOf(uid) { const id = db.member[uid]; return id ? db.clans[id] || null : null; }
function tagOf(uid) { const c = clanOf(uid); return c ? c.tag : ''; }

function create(uid, name, tag) {
  if (clanOf(uid)) return { error: 'in_clan' };
  const n = cleanName(name), tg = cleanTag(tag);
  if (!n) return { error: 'bad_name' };
  if (tg.length < TAG_MIN) return { error: 'bad_tag' };
  if (Object.values(db.clans).some(c => c.tag === tg)) return { error: 'tag_taken' };
  const id = newId();
  db.clans[id] = { id, name: n, tag: tg, owner: uid, members: [uid], pts: 0, mp: {}, created: Date.now(), wk: { key: weekKey(), pts: 0, mp: {} } };
  db.member[uid] = id; dirty = true;
  return { ok: true, clan: db.clans[id] };
}
function join(uid, id) {
  if (clanOf(uid)) return { error: 'in_clan' };
  const c = db.clans[String(id || '').replace(/\D/g, '')];
  if (!c) return { error: 'not_found' };
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  c.members.push(uid); db.member[uid] = c.id; dirty = true;
  return { ok: true, clan: c };
}
// 抜ける。リーダーが抜けたら、いちばん前からいる人がリーダーに。だれもいなくなったらクランは消える
function leave(uid) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  c.members = c.members.filter(m => m !== uid); delete db.member[uid];
  if (!c.members.length) delete db.clans[c.id];
  else if (c.owner === uid) c.owner = c.members[0];
  dirty = true;
  return { ok: true };
}
function kick(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (c.owner !== uid) return { error: 'not_owner' };
  if (!target || target === uid || !c.members.includes(target)) return { error: 'not_member' };
  c.members = c.members.filter(m => m !== target); delete db.member[target]; dirty = true;
  return { ok: true };
}
// オンライン対戦の結果（サーバーが数えた試合だけ）
function addMatch(uid, win) {
  const c = clanOf(uid);
  if (!c) return;
  const n = win ? PTS_WIN : PTS_PLAY, w = freshWeek(c);
  c.pts += n; c.mp[uid] = (c.mp[uid] || 0) + n;
  w.pts += n; w.mp[uid] = (w.mp[uid] || 0) + n;
  dirty = true;
}
// 見せる形。card(uid) はメンバーの名前など（server.js が渡す）
function view(c, card) {
  const w = freshWeek(c);
  return { id: c.id, name: c.name, tag: c.tag, pts: c.pts, week: w.pts, max: MAX_MEMBERS,
    members: c.members.map(uid => Object.assign({ owner: uid === c.owner, pts: c.mp[uid] || 0, week: w.mp[uid] || 0 }, card(uid) || { name: '?' })) };
}
// ランキング（今週・合計）。数が少ないので毎回並べる
function top(by, n) {
  const k = by === 'week' ? c => freshWeek(c).pts : c => c.pts;
  return Object.values(db.clans).sort((a, b) => k(b) - k(a) || a.created - b.created).slice(0, n || 20)
    .map((c, i) => ({ rank: i + 1, id: c.id, name: c.name, tag: c.tag, pts: k(c), n: c.members.length }));
}

module.exports = { clanOf, tagOf, create, join, leave, kick, addMatch, view, top, weekKey, MAX_MEMBERS, PTS_WIN, PTS_PLAY };
