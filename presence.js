'use strict';
// オンライン状態：ログイン中の人がページを開いている間つないでいる接続（hello）を、アカウントごとに数える
// 状態は offline / online（メニューなど）/ cpu（CPU対戦中）/ match（オンライン対戦中）
const socks = new Map();          // Discordのユーザー ID → その人の接続（タブごとに1本）
const last = new Map();           // 最後にフレンドへ知らせた状態
let roomOf = () => '';            // 部屋にいるか（'match'＝相手あり / 'room'＝相手待ち / ''）。server.js が教える
let onOffline = () => {};         // 最後の接続が切れたとき
let onChange = () => {};          // 状態が変わったとき（フレンドに知らせる）

function statusOf(uid) {
  const r = roomOf(uid);
  if (r === 'match') return 'match';
  const s = socks.get(uid);
  if (!s || !s.size) return r ? 'online' : 'offline';
  for (const ws of s) if (ws.pstatus === 'cpu') return 'cpu';
  return 'online';
}
// 状態が前に知らせたものと変わっていたら onChange を呼ぶ（部屋に入った・出たときは server.js が呼ぶ）
function changed(uid) {
  if (!uid) return;
  const st = statusOf(uid);
  if ((last.get(uid) || 'offline') === st) return;
  if (st === 'offline') last.delete(uid); else last.set(uid, st);
  onChange(uid, st);
}

function add(uid, ws, status) {
  ws.pstatus = status === 'cpu' ? 'cpu' : 'online';
  let s = socks.get(uid);
  if (!s) socks.set(uid, s = new Set());
  s.add(ws);
  ws.presUid = uid;
  changed(uid);
}
function remove(ws) {
  const uid = ws.presUid;
  if (!uid) return;
  ws.presUid = null;
  const s = socks.get(uid);
  if (!s) return;
  s.delete(ws);
  if (!s.size) { socks.delete(uid); onOffline(uid); }
  changed(uid);
}
function setStatus(ws, v) {
  ws.pstatus = v === 'cpu' ? 'cpu' : 'online';
  changed(ws.presUid);
}

module.exports = {
  add, remove, setStatus, statusOf, changed,
  count: () => socks.size,
  sockets: uid => socks.get(uid) || new Set(),
  configure(o) {
    if (o.roomOf) roomOf = o.roomOf;
    if (o.onOffline) onOffline = o.onOffline;
    if (o.onChange) onChange = o.onChange;
  },
};
