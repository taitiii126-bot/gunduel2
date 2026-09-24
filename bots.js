'use strict';
// レート帯に合った「相手」を1人ぶん作る（名前・見た目・称号・武器・戦績・強さ）。
// 人が作ったプロフィールと同じ形にして、VS画面やカードで同じように表示できるようにする
const { SIM } = require('./game');
const { TIER_KEYS } = require('./profile');

// 名前の材料：前half＋後half＋たまに数字
const HEAD = ['クロ', 'シロ', 'アカ', 'ソラ', 'カゲ', 'ライ', 'ユキ', 'ハヤテ', 'レイ', 'ジン', 'タケ', 'ミナ', 'ノア', 'リク', 'カイ', 'ハル',
  'あお', 'みどり', 'ねこ', 'いぬ', 'うさぎ', 'ぺんぎん', 'たぬき', 'きつね', 'くま', 'とり', 'しお', 'あめ',
  'Kuro', 'Sora', 'Rin', 'Yuki', 'Ken', 'Shin', 'Ray', 'Neo', 'Zero', 'Ace', 'Jack', 'Luna', 'Nova', 'Echo', 'Riku', 'Kaze', 'Mio', 'Taku'];
const TAIL = ['', '', '', '', '', 'マル', 'スケ', 'ゴロー', 'たろう', 'さん', 'ちゃん', 'X', 'Z', 'GG', 'jp', 'san', '_', '-'];
const NUM = ['', '', '', '', '', '7', '99', '01', '23', '777', '8', '2', '13', '46'];
// ひとこと（半分くらいは空にする）
const BIOS = ['', '', '', '', '', 'よろしく', 'よろしくお願いします', 'いい勝負しよう', '毎日練習中', 'まだまだ初心者です',
  '負けません', 'たのしくやろう', 'スナイパー一筋', 'ナイフが好き', 'がんばる', 'ひさしぶりに復帰しました'];

const pick = (a, r) => a[Math.floor(r() * a.length)];
const int = (lo, hi, r) => lo + Math.floor(r() * (hi - lo + 1));

// そのレートの人が持っていそうな称号（レートが高いほど強そうなものが混ざる）
const LOW = ['rookie', 'regular', 'debut', 'first_steps', 'kill_pistol_10', 'kill_knife_10', 'kill_sniper_10', 'kill_ar_10', 'kill_smg_10', 'wanderer'];
const MID = ['bodyguard', 'veteran10', 'kill_pistol_50', 'kill_ar_50', 'kill_revolver_50', 'kill_burst_50', 'shadow_blade', 'far_sight', 'point_blank', 'hive_maker', 'bomber', 'close_call', 'precision', 'pit_drop'];
const HIGH = ['demon_hunter', 'veteran50', 'duel_king', 'wanted', 'unstoppable', 'kill_burst_100', 'kill_lmg_100', 'kill_ar_100', 'one_pistol', 'untouched', 'fall100'];
const TOP = ['godslayer', 'legend', 'veteran100', 'bounty_hunter', 'unbeaten', 'kill_pistol_100', 'kill_knife_100', 'kill_sniper_100', 'kill_revolver_100'];
const ALL_IDS = new Set(SIM.TITLES.map(t => t.id));
function botTitle(rate, r) {
  const pool = (rate < 1300 ? LOW : rate < 1700 ? LOW.concat(MID) : rate < 2100 ? MID.concat(HIGH) : HIGH.concat(TOP)).filter(id => ALL_IDS.has(id));
  return pool.length ? pick(pool, r) : 'rookie';
}
// 戦績：レートが高いほど試合数も勝率も多め（見て不自然にならない範囲で散らす）
function botRecord(rate, r) {
  const games = int(8, 40, r) + Math.floor(Math.max(0, rate - 1000) / 24);
  const wr = 0.42 + Math.min(0.28, Math.max(0, (rate - 1000) / 1600) * 0.28) + (r() - 0.5) * 0.08;
  const w = Math.max(1, Math.round(games * wr));
  return { w, l: Math.max(0, games - w) };
}

// レート帯に合った相手を1人作る
// cfgRate：思考の強さだけ別のレートで作る（見せるレートは rate のまま）
function makeBot(rate, rnd, cfgRate) {
  const r = rnd || Math.random;
  const rt = Math.max(SIM.RATE_FLOOR, Math.round(rate));
  const name = (pick(HEAD, r) + pick(TAIL, r) + pick(NUM, r)).slice(0, 12) || 'プレイヤー';
  const tier = SIM.tierOfRate(rt);
  const rec = botRecord(rt, r);
  return {
    name, rate: rt, tier, tierKey: TIER_KEYS[tier] || '',
    look: SIM.randomLook(r), loadout: SIM.cpuLoadout(r), title: botTitle(rt, r), bio: pick(BIOS, r),
    bg: tier, rec, cfg: SIM.aiForRate(cfgRate == null ? rt : cfgRate),
  };
}

module.exports = { makeBot };
