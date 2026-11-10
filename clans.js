'use strict';
// クラン：仲間で集まって、オンライン対戦のポイントを合計で競う（ログイン中だけ）
// 1人が入れるクランは1つ。検索するか、6けたのクランIDで見つけて入る
// 格（役職）は5つ：リーダー（1人）・副リーダー・幹部・メンバー・新人。新しく入った人は新人から。
//   自分より下の格の人だけを、昇格・降格・追放できる（上げられるのは自分の1つ下の格まで）。リーダーは、リーダーをほかの人に譲れる
//   申請を受ける・断る＝幹部から上、設定を変える＝副リーダーから上
// 名前とタグは作ったときに決めて、あとから変えられない。紹介文・タイプ・必要な最高ティア・地域は、リーダーがあとから変えられる
// タイプ：open＝参加自由、approval＝承認制（参加の申請をリーダーが受ける）、closed＝非公開（新しく入れない）
// ポイント：オンライン対戦で勝つと 3、負けても 1（遊んだ分）。合計と、今週（月曜はじまり・シンガポール時間）の2つを数える
// できごと：入った・抜けた・追放・昇格・降格・リーダーの交代・作った・ランクアップ、を新しい LOG_MAX 件まで残す（メンバーだけが見られる）
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
const LOG_MAX = 100;
// 招待：幹部から上が、ほかの人をクランに招待できる（7日で消える）。招待された人は、クランに入っていなければ、承認なしで入れる
const INV_DAYS = 7, INV_PER_CLAN = 30;
// 格の番号（大きいほど上）。リーダーは c.owner。ほかの人の格は c.roles[ユーザーID]（書いていない人はメンバー）
const ROLE = { recruit: 0, member: 1, officer: 2, coleader: 3, leader: 4 }, ROLE_KEYS = ['recruit', 'member', 'officer', 'coleader', 'leader'];
const CAN_ACCEPT = ROLE.officer, CAN_EDIT = ROLE.coleader, CAN_MANAGE = ROLE.officer;

let db = { clans: {}, member: {} };   // clans: ID → クラン、member: DiscordのユーザーID → クランID
try {
  const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (loaded && typeof loaded === 'object') db = { clans: loaded.clans || {}, member: loaded.member || {}, w1: loaded.w1 || null };
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
  if (!c.roles || typeof c.roles !== 'object') c.roles = {};   // 格を入れる前からいる人は、みんなメンバー
  if (!Array.isArray(c.log)) c.log = [];                       // できごと（入れる前のことは残っていない）
  if (!Array.isArray(c.inv)) c.inv = [];                       // 招待
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
setInterval(() => settleWeeks(), 60 * 1000).unref();   // 週が変わったら、だれも見に来なくても1分以内に1位を決める
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
function freshWeek(c) { const wk = weekKey(); if (!c.wk || c.wk.key !== wk) { settleWeeks(); c.wk = { key: wk, pts: 0, mp: {} }; dirty = true; } return c.wk; }
// 週間1位：週が変わったら、どのクランの今週の値も消す前に、終わった週の1位（その週のポイントがいちばん多いクラン。同じなら先に作った方）を決めて数える。
// c.w1＝1位になった回数。db.w1 = { done: 決め終わった週の番号, hist: [{ k: 週, id, pts }] }
function settleWeeks() {
  const cur = weekKey();
  if (!db.w1) { db.w1 = { done: cur - 1, hist: [] }; dirty = true; }   // 数え始めは今の週から（前の週の値は、もう一部のクランで消えている）
  if (db.w1.done >= cur - 1) return;
  const by = {};
  for (const c of Object.values(db.clans)) if (c.wk && c.wk.key > db.w1.done && c.wk.key < cur && c.wk.pts > 0) (by[c.wk.key] = by[c.wk.key] || []).push(c);
  for (const k of Object.keys(by).map(Number).sort((a, b) => a - b)) {
    const win = by[k].sort((a, b) => b.wk.pts - a.wk.pts || a.created - b.created)[0];
    win.w1 = (win.w1 || 0) + 1;
    db.w1.hist.push({ k, id: win.id, pts: win.wk.pts });
    note(win, 'wk1', win.owner, null, win.w1);   // できごと：週間ランキングで1位（r＝何回目）
  }
  db.w1.hist = db.w1.hist.slice(-200);
  db.w1.done = cur - 1; dirty = true;
}

// できごとを1つ残す。t：'create' | 'join' | 'leave' | 'kick' | 'up' | 'down' | 'lead' | 'rank'。uid＝された人、by＝した人、
// r＝新しい格（rank は届いた段）、m＝2 なら 2v2 のランク
function note(c, t, uid, by, r, at, m) {
  if (!Array.isArray(c.log)) c.log = [];
  const e = { t, uid, by: by || null, r: r == null ? null : r, at: at || Date.now() };
  if (m) e.m = m;
  c.log.push(e);
  if (c.log.length > LOG_MAX) c.log.splice(0, c.log.length - LOG_MAX);
  dirty = true;
}
// ランクアップ（auth.js が、今シーズンでいちばん高い段を更新したときに知らせる）。two＝2v2
function rankUp(uid, tier, two) {
  const c = clanOf(uid);
  if (!c || !(tier > 0 && tier <= TIER_MAX)) return;
  note(c, 'rank', uid, null, tier | 0, null, two ? 2 : 0);
}
function clanOf(uid) { const id = db.member[uid]; return id ? db.clans[id] || null : null; }
// その人の格（クランにいなければ -1）
function roleOf(c, uid) {
  if (!c || !uid || !c.members.includes(uid)) return -1;
  if (uid === c.owner) return ROLE.leader;
  const r = c.roles && c.roles[uid];
  return r >= ROLE.recruit && r < ROLE.leader ? r | 0 : ROLE.member;
}
// 申請を見られる人（幹部から上）。参加の申請が来たことを知らせる相手
function managers(c) { return c ? c.members.filter(m => roleOf(c, m) >= CAN_ACCEPT) : []; }
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
  db.clans[id] = Object.assign({ id, name: n, tag: tg, owner: uid, members: [uid], roles: {}, pts: 0, mp: {}, created: Date.now(), wk: { key: weekKey(), pts: 0, mp: {} }, req: [], log: [], tierVer: SIM.TIER_VER }, st);
  db.member[uid] = id; dropReqs(uid); dirty = true;
  note(db.clans[id], 'create', uid);
  return { ok: true, clan: db.clans[id] };
}
// 設定を変える（副リーダーから上。名前とタグは変えられない）
function update(uid, opts) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (roleOf(c, uid) < CAN_EDIT) return { error: 'no_perm' };
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
  c.members.push(uid); c.roles[uid] = ROLE.recruit; db.member[uid] = c.id; dropReqs(uid); dirty = true;
  note(c, 'join', uid);
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
// 幹部から上が、申請を受ける・断る
function accept(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (roleOf(c, uid) < CAN_ACCEPT) return { error: 'no_perm' };
  if (!freshReq(c).some(q => q.uid === target)) return { error: 'no_req' };
  if (clanOf(target)) { c.req = c.req.filter(q => q.uid !== target); dirty = true; return { error: 'in_clan' }; }
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  c.members.push(target); c.roles[target] = ROLE.recruit; db.member[target] = c.id; dropReqs(target); dirty = true;
  note(c, 'join', target, uid);
  return { ok: true, clan: c };
}
function decline(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (roleOf(c, uid) < CAN_ACCEPT) return { error: 'no_perm' };
  const n = c.req.length; c.req = c.req.filter(q => q.uid !== target);
  if (c.req.length === n) return { error: 'no_req' };
  dirty = true;
  return { ok: true, clan: c };
}
// 抜ける。リーダーが抜けたら、いちばん上の格の人（同じなら前からいる人）がリーダーに。だれもいなくなったらクランは消える
function leave(uid) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  const wasOwner = c.owner === uid;
  c.members = c.members.filter(m => m !== uid); delete db.member[uid]; delete c.roles[uid];
  if (!c.members.length) delete db.clans[c.id];
  else {
    note(c, 'leave', uid);
    if (wasOwner) {
      let next = c.members[0];
      for (const m of c.members) if (roleOf(c, m) > roleOf(c, next)) next = m;
      c.owner = next; delete c.roles[next];
      note(c, 'lead', next);   // した人なし＝前のリーダーが抜けたので
    }
  }
  dirty = true;
  return { ok: true };
}
// 追放：幹部から上が、自分より下の格の人を外す
function kick(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (!target || target === uid || !c.members.includes(target)) return { error: 'not_member' };
  const me = roleOf(c, uid);
  if (me < CAN_MANAGE || roleOf(c, target) >= me) return { error: 'no_perm' };
  c.members = c.members.filter(m => m !== target); delete db.member[target]; delete c.roles[target]; dirty = true;
  note(c, 'kick', target, uid);
  return { ok: true, clan: c };
}
// 昇格・降格：自分より下の格の人を、自分の1つ下の格までの好きな格にする（role＝0 新人〜3 副リーダー）
function setRole(uid, target, role) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (!target || target === uid || !c.members.includes(target)) return { error: 'not_member' };
  role = Math.floor(+role);
  if (!(role >= ROLE.recruit && role < ROLE.leader)) return { error: 'bad' };
  const me = roleOf(c, uid), from = roleOf(c, target);
  if (me < CAN_MANAGE || from >= me || role >= me) return { error: 'no_perm' };
  if (role === from) return { error: 'same_role' };
  c.roles[target] = role; dirty = true;
  note(c, role > from ? 'up' : 'down', target, uid, role);
  return { ok: true, clan: c, from, to: role };
}
// リーダーを譲る（リーダーだけ）。前のリーダーは副リーダーになる
function transfer(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (c.owner !== uid) return { error: 'no_perm' };
  if (!target || target === uid || !c.members.includes(target)) return { error: 'not_member' };
  c.owner = target; delete c.roles[target]; c.roles[uid] = ROLE.coleader; dirty = true;
  note(c, 'lead', target, uid);
  return { ok: true, clan: c };
}
// ---- 招待 ----
// c.inv = [{ uid: 招待した相手, by: 招待した人, at }]
function freshInv(c) {
  if (!Array.isArray(c.inv)) c.inv = [];
  const now = Date.now(), n = c.inv.length;
  c.inv = c.inv.filter(q => now - q.at < INV_DAYS * 864e5 && !c.members.includes(q.uid));
  if (c.inv.length !== n) dirty = true;
  return c.inv;
}
function invited(c, uid) { return !!c && freshInv(c).some(q => q.uid === uid); }
// 招待する（幹部から上）。相手がほかのクランにいても招待できる（受けるには、今のクランを抜ける）
function invite(uid, target) {
  const c = clanOf(uid);
  if (!c) return { error: 'no_clan' };
  if (roleOf(c, uid) < CAN_ACCEPT) return { error: 'no_perm' };
  if (!target || target === uid || c.members.includes(target)) return { error: 'already' };
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  if (invited(c, target)) return { ok: true, already: true, clan: c };
  if (c.inv.length >= INV_PER_CLAN) return { error: 'inv_full' };
  c.inv.push({ uid: target, by: uid, at: Date.now() }); dirty = true;
  return { ok: true, clan: c };
}
// 届いている招待（新しい順）
function invitesOf(uid) {
  return Object.values(db.clans).map(c => ({ c, q: freshInv(c).find(q => q.uid === uid) })).filter(x => x.q).sort((a, b) => b.q.at - a.q.at);
}
// 招待に答える。受けると新人で入る（できごとには「◯◯ の招待」）。クランに入っているあいだは受けられない
function inviteAnswer(uid, id, yes) {
  const c = byId(id);
  if (!c) return { error: 'not_found' };
  const q = freshInv(c).find(x => x.uid === uid);
  if (!q) return { error: 'no_inv' };
  if (yes && clanOf(uid)) return { error: 'in_clan' };
  if (yes && c.members.length >= MAX_MEMBERS) return { error: 'full' };
  c.inv = c.inv.filter(x => x.uid !== uid); dirty = true;
  if (!yes) return { ok: true, declined: true, clan: c, by: q.by };
  c.members.push(uid); c.roles[uid] = ROLE.recruit; db.member[uid] = c.id; dropReqs(uid);
  note(c, 'join', uid, q.by, null, null, 'inv');
  return { ok: true, joined: true, clan: c, by: q.by };
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
  return { id: c.id, name: c.name, tag: c.tag, pts: c.pts, week: w.pts, w1: c.w1 || 0, n: c.members.length, max: MAX_MEMBERS, type: c.type, minTier: c.minTier, region: c.region, desc: c.desc };
}
// 見せる形。card(uid) はメンバーの名前など（server.js が渡す）。viewer＝見ている人のID：
// その人の格（myRole、メンバーでなければ -1）を付け、幹部から上なら待っている申請も付ける
function view(c, card, viewer) {
  const w = freshWeek(c), my = roleOf(c, viewer);
  const o = Object.assign(summary(c), { created: c.created, myRole: my,
    members: c.members.map(uid => Object.assign({ owner: uid === c.owner, role: roleOf(c, uid), pts: c.mp[uid] || 0, week: w.mp[uid] || 0 }, card(uid) || { name: '?' })) });
  if (my >= CAN_ACCEPT) o.req = freshReq(c).map(q => Object.assign({ at: q.at }, card(q.uid) || { name: '?' }));
  // できごと（メンバーだけ。新しい順。もういないアカウントの分は出さない）
  if (my >= 0) {
    const names = new Map(), nm = id => { if (!id) return ''; if (!names.has(id)) { const k = card(id); names.set(id, k && k.name ? k.name : ''); } return names.get(id); };
    o.log = (c.log || []).map((e, i) => [e, i]).sort((a, b) => b[0].at - a[0].at || b[1] - a[1]).map(x => x[0]).map(e => Object.assign({ t: e.t, at: e.at, r: e.r, name: nm(e.uid), by: e.by ? nm(e.by) : '' }, e.m ? { m: e.m } : {}))
      .filter(e => e.name && (!e.by || e.by.length));   // 時刻の新しい順（あとから足した前の日付のできごとも、正しい場所に）
  }
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
    .map((c, i) => ({ rank: i + 1, id: c.id, name: c.name, tag: c.tag, pts: k(c), w1: c.w1 || 0, n: c.members.length, max: MAX_MEMBERS, type: c.type, region: c.region }));
}

// ---- 住人（residents.js）のためのもの ----
// 住人のクランを作る（名前・タグの決まりは同じ。タグが使われていたら、後ろに数字を足す）。created：作った日（前の日付にできる）
function npcCreate(uid, o) {
  if (clanOf(uid)) return { error: 'in_clan' };
  const n = cleanName(o.name), st = cleanSettings(o);
  let tg = cleanTag(o.tag);
  if (!n || tg.length < TAG_MIN || st.error) return { error: 'bad' };
  for (let i = 2; Object.values(db.clans).some(c => c.tag === tg) && i < 99; i++) tg = (cleanTag(o.tag).slice(0, TAG_MAX - String(i).length) + i);
  const id = newId(), at = Math.min(Date.now(), +o.created || Date.now());
  db.clans[id] = Object.assign({ id, name: n, tag: tg, owner: uid, members: [uid], roles: {}, pts: 0, mp: {}, created: at, wk: { key: weekKey(), pts: 0, mp: {} }, req: [], log: [], tierVer: SIM.TIER_VER }, st);
  db.member[uid] = id; dropReqs(uid); dirty = true;
  note(db.clans[id], 'create', uid, null, null, at);
  return { ok: true, clan: db.clans[id] };
}
// 住人をクランに入れる（申請なし。role＝格。いっぱいなら入れない。quiet＝できごとに残さない：作ったときのはじめのメンバー）
function npcAdd(uid, id, role, quiet) {
  const c = byId(id);
  if (!c) return { error: 'not_found' };
  if (clanOf(uid)) return { error: 'in_clan' };
  if (c.members.length >= MAX_MEMBERS) return { error: 'full' };
  c.members.push(uid); c.roles[uid] = role >= ROLE.recruit && role < ROLE.leader ? role | 0 : ROLE.member;
  db.member[uid] = c.id; dropReqs(uid); dirty = true;
  if (!quiet) note(c, 'join', uid);
  return { ok: true, clan: c };
}
// 前の試合のポイントを、合計にだけ足す（住人を作ったときの、それまでの分）
function npcPts(uid, n) {
  const c = clanOf(uid);
  if (!c || !(n > 0)) return;
  c.pts += n; c.mp[uid] = (c.mp[uid] || 0) + n; dirty = true;
}
function all() { return Object.values(db.clans); }

module.exports = { settleWeeks, npcCreate, npcAdd, npcPts, all, reqs: freshReq, rankUp, invite, invited, invitesOf, inviteAnswer, clanOf, tagOf, roleOf, managers, create, update, join, unrequest, accept, decline, reqsOf, leave, kick, setRole, transfer, addMatch, view, summary, search, byId, top, weekKey,
  MAX_MEMBERS, PTS_WIN, PTS_PLAY, TYPES, DESC_MAX, ROLE, ROLE_KEYS };
