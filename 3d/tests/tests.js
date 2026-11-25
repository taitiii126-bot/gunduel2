// ステージと仕組みの確認（ブラウザで開くと結果が出る。tools の自動テストからも使う）
// 出てくる場所・道案内のつながり・ジャンプ台の着地・坂を登れるか・武器のデータ
import { buildRuins } from '../js/map-ruins.js';
import { buildHarbor } from '../js/map-harbor.js';
import { buildFrost } from '../js/map-frost.js';
import { NavGraph } from '../js/nav.js';
import { stepCharacter } from '../js/collision.js';
import { BODY, WEAPONS, WEAPON_IDS, SKILLS, SKILL_IDS, BOT_LOADOUTS, DEFAULT_LOADOUT } from '../js/data.js';
import { QUALITY } from '../js/gfx.js';

const out = document.getElementById('out');
const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info: info || '' }); out.innerHTML += `<span class="${ok ? 'ok' : 'ng'}">${ok ? 'OK ' : 'NG '}</span>${name}${info ? '  ' + info : ''}\n`; }

// キャラクターを動かすだけの小さな体
function body(x, y, z) { return { pos: [x, y, z], vel: [0, 0, 0], onGround: true, r: BODY.r, h: BODY.h }; }
function sim(W, c, secs, each) { const dt = 1 / 120; let t = 0, landed = false; while (t < secs) { if (each) each(c, t); const r = stepCharacter(W, c, dt); if (r.landed && t > 0.05) landed = true; t += dt; if (c.pos[1] < W.killY) break; if (landed && each === undefined) break; } return c; }

const maps = { ruins: buildRuins, harbor: buildHarbor, frost: buildFrost };
for (const [id, build] of Object.entries(maps)) {
  const A = build(QUALITY.low), W = A.world, S = A.spawns;
  const nav = new NavGraph(W, { spacing: 1.5 });
  check(`${id}: 道案内の点がある`, nav.nodes.length > 300, `${nav.nodes.length} 点`);
  // 出てくる場所
  const all = [...S.duel, ...S.team[0], ...S.team[1], ...S.ffa];
  const bad = all.filter(s => { const g = W.groundAt(s[0], s[2], 0.2, s[1] + 0.2, 0.3); return !g || Math.abs(g.y - s[1]) > 0.05 || !W.fits(s[0], s[1], s[2], BODY.r, BODY.h); });
  check(`${id}: 出てくる場所はすべて床の上で、体が入る`, bad.length === 0, bad.length ? JSON.stringify(bad) : `${all.length} か所`);
  // どの出てくる場所からも、ほかの出てくる場所へ行ける
  let unreachable = [];
  for (const a of all) for (const b of all) {
    if (a === b) continue;
    const na = nav.nearest(a[0], a[1], a[2], 3), nb = nav.nearest(b[0], b[1], b[2], 3);
    if (!na || !nb || !nav.path(na, nb)) unreachable.push(`${a.slice(0, 3)}→${b.slice(0, 3)}`);
  }
  check(`${id}: 出てくる場所どうしが道でつながっている`, unreachable.length === 0, unreachable.slice(0, 4).join(' '));
  // 高い所へも行ける（ジャンプ台・坂）
  const high = nav.nodes.filter(n => n.y > 2.5);
  const na = nav.nearest(S.duel[0][0], S.duel[0][1], S.duel[0][2], 3);
  const reachHigh = high.filter(n => nav.path(na, n)).length;
  check(`${id}: 高い場所の多くへ行ける`, high.length === 0 || reachHigh / high.length > 0.5, `${reachHigh}/${high.length}`);
  for (const pad of W.pads) {
    const nl = nav.nearest(pad.land[0], pad.land[1], pad.land[2], 3), np = nav.nearest(pad.x, pad.y, pad.z, 3);
    check(`${id}: ジャンプ台 (${pad.x},${pad.z}) へも、その行き先へも道がある`, nl && np && nav.path(na, np) && nav.path(na, nl));
  }
  // ジャンプ台：乗ると目当ての場所に着く
  for (const pad of W.pads) {
    const c = body(pad.x, pad.y, pad.z);
    c.vel = pad.v.slice(); c.onGround = false;
    let t = 0; const dt = 1 / 120; let land = null;
    while (t < 4) { const r = stepCharacter(W, c, dt); t += dt; if (r.landed && t > 0.1) { land = c.pos.slice(); break; } if (c.pos[1] < W.killY) break; }
    const d = land ? Math.hypot(land[0] - pad.land[0], land[2] - pad.land[2]) : 99;
    check(`${id}: ジャンプ台 (${pad.x},${pad.z}) の着地`, land && d < 1.6 && Math.abs(land[1] - pad.land[1]) < 0.3, land ? `ずれ ${d.toFixed(2)}m・高さ ${land[1].toFixed(2)}` : '着かない');
  }
  // 坂：下から上まで歩いて登れる
  for (const r of W.ramps) {
    const lowAtMin = r.up > 0; // up>0：座標の大きい側が高い
    const along = r.axis === 'x' ? 0 : 2, cross = r.axis === 'x' ? 2 : 0;
    const lo = r.axis === 'x' ? (lowAtMin ? r.x0 - 0.8 : r.x1 + 0.8) : (lowAtMin ? r.z0 - 0.8 : r.z1 + 0.8);
    const mid = r.axis === 'x' ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
    const p = [0, 0, 0]; p[along] = lo; p[cross] = mid;
    const g = W.groundAt(p[0], p[2], 0.2, r.y0 + 0.3, 0.6);
    p[1] = g ? g.y : r.y0;
    const c = body(p[0], p[1], p[2]);
    const dir = lowAtMin ? 1 : -1;
    for (let t = 0; t < 4; t += 1 / 120) { c.vel[along] = dir * BODY.run; c.vel[cross] = 0; stepCharacter(W, c, 1 / 120); if (c.pos[1] >= r.y1 - 0.05) break; }
    check(`${id}: 坂 (${r.axis} ${r.y0}→${r.y1}) を登れる`, c.pos[1] >= r.y1 - 0.1, `高さ ${c.pos[1].toFixed(2)}`);
  }
  // 外に落ちるとアウトになる高さ
  check(`${id}: 落下の高さが床より下`, W.killY < -5);
}

// 武器・スキルのデータ
for (const id of WEAPON_IDS) {
  const w = WEAPONS[id];
  const need = w.kind === 'melee' ? ['dmg', 'rate', 'reach', 'arc'] : ['dmg', 'rate', 'reload', 'mag'];
  const miss = need.filter(k => typeof w[k] !== 'number');
  check(`武器 ${id} (${w.key}) のデータ`, !miss.length && w.band && w.color, miss.join(','));
}
check('はじめの装備は3つ・すべてちがう武器', DEFAULT_LOADOUT.length === 3 && new Set(DEFAULT_LOADOUT).size === 3);
check('BOT の装備は3つずつ・すべてある武器', BOT_LOADOUTS.every(l => l.length === 3 && new Set(l).size === 3 && l.every(id => WEAPONS[id])));
check('スキル5つ', SKILL_IDS.length === 5 && SKILL_IDS.every(s => SKILLS[s] && SKILLS[s].cd > 0));

const ng = results.filter(r => !r.ok);
out.innerHTML += `\n${results.length - ng.length}/${results.length} OK\n`;
window.__tests = { total: results.length, ng };
