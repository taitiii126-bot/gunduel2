// GUN DUEL 3D：ゲームの数字（武器・スキル・モード・難しさ・ステージ）
// 単位：長さ＝メートル、時間＝秒、ダメージ＝体力100に対して。2D版の武器（番号・名前・色・役割）を3Dの遊びに合わせて調整したもの

export const MAX_HP = 100;
export const LOADOUT_SIZE = 3;                 // 持てる武器は3つ（2D版と同じ）
export const REGEN = { idle: 2.0, every: 2.0, amt: 20 };   // 2秒撃たず撃たれずなら、2秒ごとに20回復（2D版と同じ）

// 体の大きさと動き
export const BODY = {
  r: 0.38, h: 1.78, crouchH: 1.22, eye: 1.58, crouchEye: 1.08,
  run: 6.6, crouch: 3.4, air: 0.55, accel: 52, airAccel: 14, friction: 44,
  jump: 8.4, gravity: 23, step: 0.55, maxFall: 40,
  headR: 0.2,
};

// 武器。kind：hitscan=即着弾 / pellet=散弾 / proj=弾が飛ぶ（グレネード）/ beam=溜めて貫通 / focus=溜めて離す / melee=近接
// dmg=1発 / rate=次の1発まで / mag=弾数（0=無限） / reload=リロード / spread=ばらつき（度） / range=減衰が始まる距離 / falloff=最遠での倍率
// head=頭の倍率 / auto=押しっぱなし / move=持っている間の速さの倍率 / ads=覗いたときの画角 / kb=吹き飛ばし
export const WEAPONS = {
  2:  { id: 2,  key: 'pistol',   kind: 'hitscan', dmg: 22, head: 1.6, rate: 0.26, mag: 8,  reload: 1.15, spread: 0.9, adsSpread: 0.25, range: 28, falloff: 0.6, ads: 55, color: '#FACC15', band: [8, 26], recoil: 2.2 },
  3:  { id: 3,  key: 'sniper',   kind: 'hitscan', dmg: 72, head: 2.0, rate: 1.25, mag: 5,  reload: 2.3,  spread: 5.0, adsSpread: 0.0, range: 120, falloff: 1, ads: 22, move: 0.9, color: '#60A5FA', band: [22, 70], recoil: 6, scope: true, tracer: 'heavy' },
  1:  { id: 1,  key: 'knife',    kind: 'melee',   dmg: 40, rate: 0.42, reach: 2.3, arc: 55, wind: 0.06, lunge: 5, move: 1.12, color: '#D1D5DB', band: [0, 2] },
  12: { id: 12, key: 'knuckle',  kind: 'melee',   dmg: 14, rate: 0.17, reach: 1.9, arc: 60, wind: 0.0, auto: true, move: 1.1, color: '#E5E7EB', band: [0, 1.6] },
  13: { id: 13, key: 'spear',    kind: 'melee',   dmg: 46, rate: 0.8,  reach: 3.8, arc: 26, wind: 0.2, lunge: 3, color: '#FCD34D', band: [1.5, 3.4] },
  14: { id: 14, key: 'hammer',   kind: 'melee',   dmg: 55, rate: 1.05, reach: 2.7, arc: 70, wind: 0.26, kb: 13, kbUp: 6.5, move: 0.92, color: '#F87171', band: [0, 2.3] },
  4:  { id: 4,  key: 'smg',      kind: 'hitscan', dmg: 9,  head: 1.4, rate: 0.072, mag: 30, reload: 1.6, spread: 2.6, adsSpread: 1.4, bloom: 0.25, range: 14, falloff: 0.45, auto: true, ads: 62, color: '#F472B6', band: [3, 15], recoil: 0.7 },
  5:  { id: 5,  key: 'shotgun',  kind: 'pellet',  dmg: 9,  head: 1.25, pellets: 10, rate: 0.34, mag: 2, reload: 1.9, spread: 5.5, adsSpread: 4.0, range: 7, falloff: 0.25, ads: 62, color: '#FB923C', band: [1, 8], recoil: 5 },
  6:  { id: 6,  key: 'ar',       kind: 'hitscan', dmg: 13, head: 1.5, rate: 0.11, mag: 25, reload: 1.8, spread: 1.5, adsSpread: 0.35, bloom: 0.16, range: 34, falloff: 0.65, auto: true, ads: 50, color: '#34D399', band: [10, 34], recoil: 1.0 },
  7:  { id: 7,  key: 'burst',    kind: 'hitscan', dmg: 14, head: 1.5, burst: 3, gap: 0.065, rate: 0.48, mag: 24, reload: 1.8, spread: 1.0, adsSpread: 0.2, range: 40, falloff: 0.7, ads: 46, color: '#2DD4BF', band: [12, 40], recoil: 1.1 },
  8:  { id: 8,  key: 'revolver', kind: 'hitscan', dmg: 38, head: 1.6, rate: 0.55, mag: 6,  reload: 2.0,  spread: 0.7, adsSpread: 0.15, range: 32, falloff: 0.65, ads: 50, color: '#F59E0B', band: [8, 30], recoil: 4.5 },
  9:  { id: 9,  key: 'lmg',      kind: 'hitscan', dmg: 11, head: 1.35, rate: 0.088, mag: 60, reload: 3.3, spread: 2.2, adsSpread: 0.9, bloom: 0.12, range: 30, falloff: 0.6, auto: true, ads: 55, move: 0.8, color: '#A3E635', band: [10, 30], recoil: 0.8 },
  10: { id: 10, key: 'grenade',  kind: 'proj',    dmg: 45, sdmg: 52, splash: 4.2, rate: 0.75, mag: 4, reload: 2.4, speed: 27, grav: 15, fuse: 2.6, self: 0.4, kb: 9, ads: 62, color: '#FB7185', band: [9, 24], recoil: 3 },
  11: { id: 11, key: 'railgun',  kind: 'beam',    dmg: 68, head: 1.5, charge: 0.42, rate: 0.2, mag: 1, reload: 2.0, spread: 0, range: 150, falloff: 1, ads: 40, move: 0.88, color: '#A78BFA', band: [16, 70], recoil: 7, tracer: 'beam' },
  // フォーカスライフル：押している間に狙いを絞り（その間は遅い）、離した瞬間に撃つ。full 秒で絞りきって光り、win 秒の間に離すと「ジャスト」
  16: { id: 16, key: 'focus',    kind: 'focus',   dmg: 60, lo: 10, hi: 26, late: 18, full: 0.66, win: 0.14, slow: 0.55, rate: 0.27, mag: 4, reload: 2.3, spread: 0.4, range: 60, falloff: 0.8, head: 1.5, ads: 40, color: '#22D3EE', band: [14, 50], recoil: 3 },
};
export const WEAPON_IDS = [2, 3, 1, 12, 13, 14, 4, 5, 6, 7, 8, 9, 10, 11, 16];
export const DEFAULT_LOADOUT = [6, 5, 3];      // 3Dのはじめの装備：アサルト・ショットガン・スナイパー
export const SWAP_TIME = 0.28;                 // 持ち替えてから撃てるまで

// スキル（2D版と同じ5つ。ロールのボタン＝スキルのボタン）
export const SKILLS = {
  roll:   { id: 'roll',   cd: 1.1,  dur: 0.32, iframe: 0.24, speed: 15, color: '#E5E7EB' },
  pierce: { id: 'pierce', cd: 8,    n: 5, color: '#FF9F43' },
  rewind: { id: 'rewind', cd: 12,   back: 2.0, color: '#7DD3FC' },
  decoy:  { id: 'decoy',  cd: 10,   life: 3.2, color: '#C084FC' },
  parry:  { id: 'parry',  cd: 6,    win: 0.22, color: '#FDE047' },
};
export const SKILL_IDS = ['roll', 'pierce', 'rewind', 'decoy', 'parry'];

// モード
export const MODES = {
  duel:  { id: 'duel',  teams: true, size: [1, 1], rounds: 3, roundTime: 100 },
  team:  { id: 'team',  teams: true, size: [2, 2], rounds: 3, roundTime: 120 },
  ffa:   { id: 'ffa',   teams: false, players: 6, killGoal: 15, time: 300, respawn: 3.0, protect: 1.6 },
};

// 難しさ。react=見つけてから撃ち始めるまで / aim=狙いのずれ（度）/ track=狙いの追いつき（1秒あたり）/ head=頭を狙う割合
// dodge=撃たれているときにスキル（ロール）でよける割合 / strafe=横移動の切り返しの多さ / heal=回復を使う体力
export const DIFFS = {
  easy:   { id: 'easy',   react: 0.62, aim: 7.5, track: 5.5, head: 0.05, dodge: 0.05, strafe: 0.35, heal: 30, fov: 110, burst: 0.55, sens: 0.75 },
  normal: { id: 'normal', react: 0.44, aim: 4.6, track: 8,   head: 0.14, dodge: 0.14, strafe: 0.6,  heal: 38, fov: 125, burst: 0.75, sens: 0.85 },
  hard:   { id: 'hard',   react: 0.31, aim: 2.8, track: 11,  head: 0.26, dodge: 0.26, strafe: 0.85, heal: 45, fov: 140, burst: 0.9,  sens: 0.95 },
  oni:    { id: 'oni',    react: 0.22, aim: 1.8, track: 14,  head: 0.36, dodge: 0.36, strafe: 1.0,  heal: 50, fov: 150, burst: 1.0,  sens: 1.0 },
};
export const DIFF_IDS = ['easy', 'normal', 'hard', 'oni'];

// ステージ（どれも浮かぶ闘技場。外に落ちるとアウト）
export const MAP_IDS = ['ruins', 'harbor', 'frost'];

// チームの色（2D版と同じ：自分=紫、味方=青緑、相手=赤）。FFA は1人ずつ違う色
export const TEAM_COLORS = {
  me:   { main: '#7C3AED', light: '#A78BFA', dark: '#2E1065', glow: '#B794FF' },
  ally: { main: '#0E9FB0', light: '#67E8F9', dark: '#083344', glow: '#5CF2FF' },
  foe:  { main: '#E24B4A', light: '#FCA5A5', dark: '#450A0A', glow: '#FF6B6B' },
};
export const FFA_COLORS = [
  { main: '#E24B4A', light: '#FCA5A5', dark: '#450A0A', glow: '#FF6B6B' },
  { main: '#F59E0B', light: '#FCD34D', dark: '#451A03', glow: '#FFC24D' },
  { main: '#10B981', light: '#6EE7B7', dark: '#022C22', glow: '#4DFFB8' },
  { main: '#3B82F6', light: '#93C5FD', dark: '#172554', glow: '#6BA8FF' },
  { main: '#EC4899', light: '#F9A8D4', dark: '#500724', glow: '#FF6FBF' },
  { main: '#94A3B8', light: '#E2E8F0', dark: '#0F172A', glow: '#C8D6EA' },
  { main: '#84CC16', light: '#BEF264', dark: '#1A2E05', glow: '#B6FF4D' },
];

// 2D版と同じ見た目の色（プロフィールの look の番号から）
export const LOOK_SKIN = ['#FFE3CC', '#F5C9A1', '#E0A57A', '#C58456', '#8D5A3B', '#5C3A26', '#9BD3F0', '#A7E3A1'];
export const LOOK_HAIR = ['#1F1B24', '#5B3A1E', '#E8C15A', '#B83A1B', '#E5E7EB', '#3B82F6', '#EC4899', '#22C55E'];
export const LOOK_EYE = ['#2B1B14', '#3B82F6', '#16A34A', '#D97706', '#DC2626', '#9333EA', '#0891B2', '#6B7280'];
export const LOOK_ACCENT = ['#E8B730', '#E23D3D', '#2F6FE0', '#1F9D55', '#F4F1EA', '#2A2530', '#EC5CA8', '#F08A24'];

// BOT の名前（2D版のサーバーで暮らしている住人たちから）
export const BOT_NAMES = ['KT|Kaito', 'KT|Raito', 'KT|Sora', 'CRAZYCHICKEN', '応仁のLAN', 'ジャムを持参', 'ChrisPBacon', 'Baconツ', '帰還者トーマス',
  'ルーキー', '丸投げ製麺', 'ゆうた', '注意力3万', 'AD♥️Astra', 'Medal☆', '卍漆黒の剣士卍', 'Donut♥️', 'ぜた|ねむい', 'YAJ|Kenta', 'ʕ º ᴥ ºʔ'];

// BOT の装備（強すぎない組み合わせ。2D版の「よく使われる組み合わせ」に近い物）
export const BOT_LOADOUTS = [
  [6, 5, 3], [4, 5, 2], [7, 13, 3], [6, 10, 8], [9, 5, 2], [4, 14, 16], [7, 12, 11], [6, 1, 3], [8, 5, 16], [4, 10, 3], [9, 13, 2], [7, 5, 11],
];

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function damp(a, b, k, dt) { return b + (a - b) * Math.exp(-k * dt); }
export function angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
