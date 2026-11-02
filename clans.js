'use strict';
// クラン：仲間で集まって、オンライン対戦のポイントを合計で競う（ログイン中だけ）
// 1人が入れるクランは1つ。検索するか、6けたのクランIDで見つけて入る。作った人（リーダー）は、メンバーを外せる
// 名前とタグは作ったときに決めて、あとから変えられない。紹介文・タイプ・必要な最高ティア・地域は、リーダーがあとから変えられる
// タイプ：open＝参加自由、approval＝承認制（参加の申請をリーダーが受ける）、closed＝非公開（新しく入れない）
// ポイント：オンライン対戦で勝つと 3、負けても 1（遊んだ分）。合計と、今週（月曜はじまり・シンガポール時間）の2つを数える
// 記録は clans.json（users.json と同じ場所）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SIM = require('./sim.js');

const DATA_DIR = process.env.DATA_DIR || process.env.STATE_DIRECTORY || __dirname;
const FILE = path.join(DATA_DIR, 'clans.json');
const MAX_MEMBERS = 20, NAME_MAX = 16, TAG_MIN = 2, TAG_MAX = 4, DESC_MAX = 200;
const TYPES = ['open', 'approval', 'closed'], TIER_MAX = SIM.TIER_MIN.length - 1;   // 必要な最高ランク：0（なし）〜24
const REQ_PER_CLAN = 30, REQ_PER_USER = 5, REQ_DAYS = 7;   // 申請：1つのクランに30件まで・1人5件まで・7日で消える
const PTS_WIN = 3, PTS_PLAY = 1;

let db = { clans: {}, member: {} };   // clans: ID → クラン、member: DiscordのユーザーID → クランID
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (loaded && typeof loaded === 'object') db = { clans: loaded.clans || {}, member: loaded.member || {} };
} catch (e) { /* 初回は存在しない */ }
// 前の版で作ったクランには、新しい設定の既定値を入れる（参加自由・条件なし・地域なし）
let migrated = false;
for (const c of Object.values(db.clans)) {
  if (typeof c.desc !== 'string') c.desc = '';
  if (TYPES.indexOf(c.type) < 0) c.type = 'open';
  if (!(c.minTier >= 0)) c.minTier = 0;
  if ((c.tierVer || 1) < SIM.TIER_VER) { c.minTier = SIM.tierFromOld(c.minTier); c.tierVer = SIM.TIER_VER; migrated = true; }   // 前の10段の番号を、24段に直す
  if (typeof c.region !== 'string') c.region = '';
  if (!Array.isArray(c.req)) c.req = [];
}

let dirty = migrated;   // 直した所があれば、すぐ保存する
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
// 紹介文：改行は2つまで続けてよい。ほかの制御文字と < > は消す
function cleanDesc(v) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F<>]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, DESC_MAX); }
// 設定（紹介文・タイプ・必要な最高ティア・地域）を整える。o にない物は base のまま
function cleanSettings(o, base) {
  o = o && typeof o === 'object' ? o : {}; base = base || { desc: '', type: 'open', minTier: 0, region: '' };
  const r = {
    desc: o.desc != null ? cleanDesc(o.desc) : base.desc,
    type: TYPES.indexOf(o.type) >= 0 ? o.type : base.type,
    minTier: o.minTier != null ? Math.max(0, Math.min(TIER_MAX, Math.floor(+o.minTier) || 0)) : base.minTier,
    region: o.region != null ? (SIM.REGIONS.indexOf(String(o.region).toUpperCase()) >= 0 ? String(o.region).toUpperCase() : '') : base.region,
  };
  if (r.desc && SIM.badText(r.desc)) return { error: 'bad_word' };
  return r;
}
// 古い申請（7日より前）を消す
function freshReq(c) { const now = Date.now(), n = c.req.length; c.req = c.req.filter(q => now - q.at < REQ_DAYS * 864e5 && !db.member[q.uid]); if (c.req.length !== n) dirty = true; return c.req; }
function reqsOf(uid) { return Object.values(db.clans).filter(c => freshReq(c).some(q => q.uid === uid)).map(c => c.id); }
function dropReqs(uid) { for (const c of Object.values(db.clans)) { const n = c.req.length; c.req = c.req.filter(q => q.uid !== uid); if (c.req.length !== n) dirty = true; } }
function newId() {
  let id;
  do id = String(crypto.randomInt(100000, 1000000)); while (db.clans[id]);
  return id;
}
function freshWeek(c) { const wk = weekKey(); if (!c.wk || c.wk.key !== wk) { c.wk = { key: wk, pts: 0, mp: {} }; dirty = true; } return c.wk; }

function clanOf(uid) { const id = db.member[uid]; return id ? db.clans[id] || null : null; }
function tagOf(uid) { const c = clanOf(uid); return c ? c.tag : ''; }

function create(uid, name, tag, opts) {
  if (clanOf(uid)) return { error: 'in_clan' };
  const n = cleanName(name), tg = cleanTag(tag);
  if (!n) return { error: 'bad_name' };
  if (SIM.badText(n) || SIM.badText(tg)) return { error: 'bad_word' };   // 禁止ワード
  if (tg.length < TAG_MIN) return { error: 'bad_tag' };
  if (Object.values(db.clans).some(c => c.tag === tg)) return { error: 'tag_taken' };
  const st = cleanSettings(opts);
  if (st.error) return st;
  const id = newId();
  db.clans[id] = Object.assign({ id, name: n, tag: tg, owner: uid, members: [uid], pts: 0, mp: {}, created: Date.now(), wk: { key: weekKey(), pts: 0, mp: {} }, req: [], tierVer: SIM.TIER_VER }, st);
  db.member[uid] = id; dropReqs(uid); dirty = true;
  return { ok: true, clan: db.clans[id] };
}
// 設定を変える（リーダーだけ。名前とタグは変えられない）
function update(uid, opts) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (c.owner !== uid) return { error: 'not_owner' };
  const st = cleanSettings(opts, c);
  if (st.error) return st;
  Object.assign(c, st);
  if (c.type !== 'approval' && c.req.length) c.req = [];   // 承認制でなくなったら、待っている申請は消す
  dirty = true;
  return { ok: true, clan: c };
}
// 入る：参加自由ならすぐ入る、承認制なら申請を出す、非公開は入れない。tier＝その人がこれまでに届いた一番上のティア
function join(uid, id, tier) {
  if (clanOf(uid)) return { error: 'in_clan' };
  const c = db.clans[String(id || '').replace(/\D/g, '')];
  if (!c) return { error: 'not_found' };
  if (c.type === 'closed') return { error: 'closed' };
  if ((tier || 0) < (c.minTier || 0)) return { error: 'low_tier' };
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  if (c.type === 'approval') {
    if (freshReq(c).some(q => q.uid === uid)) return { ok: true, requested: true, clan: c };
    if (reqsOf(uid).length >= REQ_PER_USER) return { error: 'too_many_req' };
    if (c.req.length >= REQ_PER_CLAN) return { error: 'req_full' };
    c.req.push({ uid, at: Date.now() }); dirty = true;
    return { ok: true, requested: true, clan: c };
  }
  c.members.push(uid); db.member[uid] = c.id; dropReqs(uid); dirty = true;
  return { ok: true, clan: c };
}
// 出した申請を取り消す
function unrequest(uid, id) {
  const c = db.clans[String(id || '').replace(/\D/g, '')];
  if (!c) return { error: 'not_found' };
  const n = c.req.length; c.req = c.req.filter(q => q.uid !== uid);
  if (c.req.length === n) return { error: 'no_req' };
  dirty = true;
  return { ok: true, clan: c };
}
// リーダーが申請を受ける・断る
function accept(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (c.owner !== uid) return { error: 'not_owner' };
  if (!freshReq(c).some(q => q.uid === target)) return { error: 'no_req' };
  if (clanOf(target)) { c.req = c.req.filter(q => q.uid !== target); dirty = true; return { error: 'in_clan' }; }
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  c.members.push(target); db.member[target] = c.id; dropReqs(target); dirty = true;
  return { ok: true, clan: c };
}
function decline(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (c.owner !== uid) return { error: 'not_owner' };
  const n = c.req.length; c.req = c.req.filter(q => q.uid !== target);
  if (c.req.length === n) return { error: 'no_req' };
  dirty = true;
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
// 一覧に出す短い形
function summary(c) {
  const w = freshWeek(c);
  return { id: c.id, name: c.name, tag: c.tag, pts: c.pts, week: w.pts, n: c.members.length, max: MAX_MEMBERS, type: c.type, minTier: c.minTier, region: c.region, desc: c.desc };
}
// 見せる形。card(uid) はメンバーの名前など（server.js が渡す）。leader なら、待っている申請も付ける
function view(c, card, leader) {
  const w = freshWeek(c);
  const o = Object.assign(summary(c), { created: c.created,
    members: c.members.map(uid => Object.assign({ owner: uid === c.owner, pts: c.mp[uid] || 0, week: w.mp[uid] || 0 }, card(uid) || { name: '?' })) });
  if (leader) o.req = freshReq(c).map(q => Object.assign({ at: q.at }, card(q.uid) || { name: '?' }));
  return o;
}
// 探す：名前（一部でよい）・タグ・ID。q が空ならおすすめ（今週のポイント順）。
// region＝地域でしぼる、joinable＝今入れる（申請できる）クランだけ（tier＝その人の最高ティア）
function search(q, opt) {
  opt = opt || {};
  const s = String(q == null ? '' : q).trim().toLowerCase().slice(0, 20), tg = cleanTag(s), id = s.replace(/\D/g, '');
  const region = SIM.REGIONS.indexOf(String(opt.region || '').toUpperCase()) >= 0 ? String(opt.region).toUpperCase() : '';
  let list = Object.values(db.clans).filter(c => {
    if (region && c.region !== region) return false;
    if (opt.joinable && (c.type === 'closed' || c.members.length >= MAX_MEMBERS || (c.minTier || 0) > (opt.tier || 0))) return false;
    if (!s) return true;
    return c.name.toLowerCase().indexOf(s) >= 0 || (tg && c.tag.indexOf(tg) === 0) || (id.length === 6 && c.id === id);
  });
  const exact = c => (id.length === 6 && c.id === id) || (tg && c.tag === tg) || c.name.toLowerCase() === s ? 1 : 0;
  list.sort((a, b) => exact(b) - exact(a) || freshWeek(b).pts - freshWeek(a).pts || b.pts - a.pts || b.members.length - a.members.length || a.created - b.created);
  return list.slice(0, 30).map(summary);
}
function byId(id) { return db.clans[String(id || '').replace(/\D/g, '')] || null; }
// ランキング（今週・合計）。数が少ないので毎回並べる
function top(by, n) {
  const k = by === 'week' ? c => freshWeek(c).pts : c => c.pts;
  return Object.values(db.clans).sort((a, b) => k(b) - k(a) || a.created - b.created).slice(0, n || 20)
    .map((c, i) => ({ rank: i + 1, id: c.id, name: c.name, tag: c.tag, pts: k(c), n: c.members.length, max: MAX_MEMBERS, type: c.type, region: c.region }));
}

module.exports = { clanOf, tagOf, create, update, join, unrequest, accept, decline, reqsOf, leave, kick, addMatch, view, summary, search, byId, top, weekKey, MAX_MEMBERS, PTS_WIN, PTS_PLAY, TYPES, DESC_MAX };
