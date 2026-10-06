'use strict';
// BOT のクイックチャット：人がするのと同じくらいの間と回数で、場面に合った短い言葉を出す
// ・BOTごとに「よくしゃべる／あまりしゃべらない／しゃべらない」の性格がある
// ・すぐには返さない（0.6〜3秒ほどおいてから）。1試合に出す回数にも上限がある
// ・ていねいな言葉は使わない。短い言葉だけ（名前が日本語のBOTは日本語、ローマ字のBOTはだいたい英語）
// ・相手をばかにする言葉（ez など）は使わない
// room は game.js / team.js の部屋（later・broadcast・players を使う）
const SIM = require('./sim.js');

const TEXT = {
  ja: {
    hello: ['よろ', 'ども', 'ノ'],
    lose: ['うま', 'つよ', 'えぐ', 'は？', 'まじか', 'くっそ', 'ラグ', 'えー'],
    close: ['あぶねー', 'あぶねーー', 'ギリ', 'セーフ'],
    win: ['よし', 'っし', 'w'],
    endWin: ['gg', 'ggwp', 'w', 'gg'],
    endLose: ['gg', 'つよすぎ', 'gg'],
    thanks: ['どもw', 'w'],
    gg: ['gg', 'gg'],
  },
  en: {
    hello: ['yo', 'hi', 'gl'],
    lose: ['bruh', 'wtf', 'lag', 'nice', 'omg'],
    close: ['close', 'phew'],
    win: ['lets go', 'w'],
    endWin: ['gg', 'ggwp', 'gg wp'],
    endLose: ['gg', 'ggwp', 'gg wp'],
    thanks: ['ty', 'w'],
    gg: ['gg', 'gg'],
  },
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const MAX_PER_MATCH = 4, GAP_MS = 3500;

// BOTの性格を決める（部屋に入れたときに1回）
function init(p) {
  const r = Math.random();
  p.chatTalk = r < 0.4 ? 0 : r < 0.8 ? 0.45 : 0.85;   // 4割はしゃべらない
  p.chatLang = /[ぁ-んァ-ヶ一-龠]/.test(p.name || '') ? 'ja' : (Math.random() < 0.25 ? 'ja' : 'en');
  p.chatN = 0; p.chatLast = 0; p.chatSaid = {};
}
// 新しい試合：回数をもどす
function newMatch(p) { p.chatN = 0; p.chatSaid = {}; }

// 実際に出す（少し待ってから）
function say(room, slot, kind, delay) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return false;
  const now = Date.now();
  if (p.chatN >= MAX_PER_MATCH || now - p.chatLast < GAP_MS) return false;
  p.chatN++; p.chatLast = now + delay; p.chatSaid[kind] = true;
  const text = pick(TEXT[p.chatLang][kind]);
  room.later(() => {
    if (room.players[slot] === p) room.broadcast({ type: 'chat', slot, text });
  }, delay);
  return true;
}
const chance = (p, base) => p && p.bot && p.chatTalk && Math.random() < base * p.chatTalk;
const wait = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

// 試合の最初のラウンド（あいさつはたまにだけ）
function onStart(room, slot) {
  const p = room.players[slot];
  if (!p || !p.bot) return;
  newMatch(p);
  if (chance(p, 0.25)) say(room, slot, 'hello', wait(600, 2600));
}
// ラウンドの終わり。won：このBOT（のチーム）が勝った、hp：残りの体力（倒れていたら0）
function onRound(room, slot, won, hp) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return;
  if (won && hp > 0 && hp <= 25 && chance(p, 0.6)) say(room, slot, 'close', wait(700, 2000));
  else if (won && chance(p, 0.12)) say(room, slot, 'win', wait(800, 2200));
  else if (!won && chance(p, 0.35)) say(room, slot, 'lose', wait(600, 2400));
}
// 試合の終わり
function onEnd(room, slot, won) {
  const p = room.players[slot];
  if (!p || !p.bot || !p.chatTalk) return;
  p.chatLast = 0; p.chatN = Math.min(p.chatN, MAX_PER_MATCH - 1);   // 終わりの gg は、さっき何か言っていても出せる
  if (chance(p, 0.8)) say(room, slot, won ? 'endWin' : 'endLose', wait(1200, 3200));
}
// 人のチャットに返す（gg には gg、ほめられたら「どもw」、あいさつには短く）
function onHeard(room, fromSlot, m) {
  const k = m && m.i != null ? SIM.QUICK_CHAT[m.i] : '';
  const t = m && m.text ? String(m.text) : '';
  const back = k === 'gg' || /^(gg|ggwp|ggs)\b/i.test(t) ? 'gg'
    : k === 'nice' || /^(ナイス|ないす|nice|うま)/i.test(t) ? 'thanks'
    : k === 'hello' || /^(よろ|hello|hi\b|yo\b)/i.test(t) ? 'hello' : '';
  if (!back) return;
  for (const s of Object.keys(room.players)) {
    const p = room.players[s];
    if (!p || !p.bot || !p.chatTalk || s === fromSlot || (p.chatSaid && (p.chatSaid[back] || (back === 'gg' && (p.chatSaid.endWin || p.chatSaid.endLose))))) continue;
    if (chance(p, back === 'gg' ? 0.8 : 0.5)) say(room, s, back, wait(1000, 3000));
  }
}

module.exports = { init, onStart, onRound, onEnd, onHeard };
