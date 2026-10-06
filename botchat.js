'use strict';
// BOT のクイックチャット：人がするのと同じくらいの間と回数で、場面に合った言葉を出す
// ・BOTごとに「よくしゃべる／あまりしゃべらない／しゃべらない」の性格がある
// ・すぐには返さない（0.8〜3秒ほど考えてから）。1試合に出す回数にも上限がある
// ・決まった言葉（番号）がほとんど。見る人の言葉に合わせて表示される。たまに短い自由な言葉
// room は game.js / team.js の部屋（later・broadcast・players を使う）
const SIM = require('./sim.js');
const Q = {};
SIM.QUICK_CHAT.forEach((k, i) => { Q[k] = i; });

// 自由な言葉（名前が日本語のBOTは日本語、ローマ字のBOTは英語）
const TEXT = {
  ja: { lose: ['うま', 'つよ', 'えぐ', 'まじか', 'くっそー'], close: ['あぶな', 'ぎりぎり', 'セーフ'], win: ['よし', 'っしゃ'], end: ['ありがとう', 'またね', 'おつかれ'], hello: ['よろしく', 'よろ'] },
  en: { lose: ['wow', 'nice shot', 'dang'], close: ['close one', 'phew'], win: ['yes!', 'got it'], end: ['ggwp', 'gg!', 'wp'], hello: ['hi', 'gl hf', 'hey'] },
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const MAX_PER_MATCH = 5, GAP_MS = 3500;

// BOTの性格を決める（部屋に入れたときに1回）
function init(p) {
  const r = Math.random();
  p.chatTalk = r < 0.3 ? 0 : r < 0.75 ? 0.45 : 0.85;   // 3割はしゃべらない
  p.chatLang = /[ぁ-んァ-ヶ一-龠]/.test(p.name || '') ? 'ja' : (Math.random() < 0.25 ? 'ja' : 'en');
  p.chatFree = Math.random() < 0.5;   // 自由な言葉も使う人
  p.chatN = 0; p.chatLast = 0; p.chatSaid = {};
}
// 新しい試合：回数をもどす
function newMatch(p) { p.chatN = 0; p.chatSaid = {}; }

// 実際に出す（少し待ってから。待っている間に試合が終わっていても、終わりのあいさつは出してよい）
function say(room, slot, kind, preset, textKey, delay) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return false;
  const now = Date.now();
  if (p.chatN >= MAX_PER_MATCH || now - p.chatLast < GAP_MS) return false;
  p.chatN++; p.chatLast = now + delay; p.chatSaid[kind] = true;
  const useText = textKey && p.chatFree && Math.random() < 0.4;
  const msg = useText ? { text: pick(TEXT[p.chatLang][textKey]) } : { i: Q[preset] };
  room.later(() => {
    const q = room.players[slot];
    if (q === p) room.broadcast(Object.assign({ type: 'chat', slot }, msg));
  }, delay);
  return true;
}
const chance = (p, base) => p && p.bot && p.chatTalk && Math.random() < base * p.chatTalk;
const wait = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

// 試合の最初のラウンド
function onStart(room, slot) {
  const p = room.players[slot];
  if (!p || !p.bot) return;
  newMatch(p);
  if (chance(p, 0.45)) say(room, slot, 'hello', 'hello', 'hello', wait(600, 2600));
}
// ラウンドの終わり。won：このBOT（のチーム）が勝った、hp：残りの体力（倒れていたら0）
function onRound(room, slot, won, hp) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return;
  if (won && hp > 0 && hp <= 25 && chance(p, 0.6)) say(room, slot, 'close', 'close', 'close', wait(700, 2000));
  else if (won && chance(p, 0.12)) say(room, slot, 'win', 'wow', 'win', wait(800, 2200));
  else if (!won && chance(p, 0.3)) say(room, slot, 'lose', Math.random() < 0.6 ? 'nice' : 'wow', 'lose', wait(900, 2600));
}
// 試合の終わり
function onEnd(room, slot, won, canRematch) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return;
  p.chatLast = 0;   // 終わりのあいさつは、さっき何か言っていても出せる
  if (chance(p, 0.8)) {
    say(room, slot, 'gg', 'gg', 'end', wait(1200, 3200));
    if (canRematch && !won && chance(p, 0.35)) { p.chatLast = 0; say(room, slot, 'again', 'again', null, wait(5000, 7000)); }
  }
}
// 人のチャットに返す（あいさつにはあいさつ、ほめられたらお礼など）
const REPLY = { hello: 'hello', gg: 'gg', nice: 'thanks', thanks: null, sorry: null, wow: null, close: null, again: 'again' };
function onHeard(room, fromSlot, m) {
  const key = m && m.i != null ? SIM.QUICK_CHAT[m.i] : (m && m.text && /^(gg|ggwp|ggs)\b/i.test(m.text) ? 'gg' : (m && m.text && /よろ|hello|^hi\b/i.test(m.text) ? 'hello' : null));
  const back = key && REPLY[key];
  if (!back) return;
  for (const s of Object.keys(room.players)) {
    const p = room.players[s];
    if (!p || !p.bot || !p.chatTalk || s === fromSlot || (p.chatSaid && p.chatSaid[back])) continue;
    if (chance(p, 0.75)) say(room, s, back, back, back === 'hello' ? 'hello' : back === 'gg' ? 'end' : null, wait(1000, 3000));
  }
}

module.exports = { init, onStart, onRound, onEnd, onHeard };
