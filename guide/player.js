// 攻略ガイドのプレイヤー検索：名前かフレンドIDで、その人の戦績をくわしく見せる。
// 表示用の文字や武器の一覧は、ページの中の GD（tools/guide.js がゲームのデータから作る）にある。
// 名前・ひとこと・クラン名などは他人が書いた文字なので、必ず textContent で入れる（innerHTML に入れない）
(function () {
  'use strict';
  var GD = window.GD; if (!GD) return;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var form = $('#find'), input = $('#find-q'), out = $('#player'), msg = $('#find-msg');
  if (!form || !input || !out) return;

  // ---- 小さな部品 ----
  function h(tag, cls, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(function (k) {
      if (k == null || k === false) return;
      el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
    });
    return el;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function s(tag, at) { var el = document.createElementNS(NS, tag); for (var k in at) el.setAttribute(k, at[k]); return el; }
  function num(v) { return Math.max(0, +v || 0); }
  function fmt(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function pct(w, m) { return m > 0 ? Math.round(w / m * 100) + '%' : '–'; }
  function day(ms) { var d = new Date(ms); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function daysAgo(ms) { var n = Math.floor((Date.now() - ms) / 864e5); return n <= 0 ? '今日' : n + '日前'; }
  function tier(t) { return GD.tiers[Math.max(0, Math.min(GD.tiers.length - 1, t | 0))]; }
  function emblem(t, size) {
    var T = tier(t);
    if (!T.r) return h('span', 'pl-em none', '–');
    var img = h('img', 'pl-em'); img.src = 'img/tier-' + T.r + '.webp'; img.alt = T.n; img.width = size; img.height = size; img.loading = 'lazy';
    return img;
  }
  function tile(label, value, sub) { return h('div', 'pl-tile', [h('span', 'pl-tl', label), h('b', null, value), sub ? h('small', null, sub) : null]); }
  function card(title, kids, cls) { return h('div', 'card pl-card' + (cls ? ' ' + cls : ''), [title ? h('h3', 'pl-h', title) : null].concat(kids)); }
  // 切りかえボタン（オンライン／CPU など）。押すと draw(key) で中身を描き直す
  function seg(opts, cur, draw) {
    var box = h('div', 'pl-seg');
    opts.forEach(function (o) {
      var b = h('button', o[0] === cur ? 'on' : '', o[1]); b.type = 'button'; b.setAttribute('aria-pressed', o[0] === cur ? 'true' : 'false');
      b.addEventListener('click', function () { box.querySelectorAll('button').forEach(function (x) { var on = x === b; x.className = on ? 'on' : ''; x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); draw(o[0]); });
      box.appendChild(b);
    });
    return box;
  }

  // ---- 検索 ----
  var busy = false;
  function say(t, bad) { msg.textContent = t || ''; msg.className = 'find-msg' + (bad ? ' bad' : ''); msg.hidden = !t; }
  function lookup(param, value, push) {
    if (busy) return;
    value = String(value || '').trim();
    if (!value) { say('名前かフレンドIDを入れてください', true); return; }
    busy = true; say('さがしています…'); out.classList.add('loading');
    fetch(GD.api + '/api/lookup?' + param + '=' + encodeURIComponent(value), { cache: 'no-store' })
      .then(function (r) { return r.json().then(function (d) { return { st: r.status, d: d }; }, function () { return { st: r.status, d: {} }; }); })
      .then(function (x) {
        busy = false; out.classList.remove('loading');
        if (x.st === 404) { say('「' + value + '」は見つかりませんでした。名前は一部だけでも探せます（2文字以上）', true); return; }
        if (x.st === 429) { say('検索が多すぎます。少し待ってからお試しください', true); return; }
        if (x.st !== 200) { say('サーバーにつながりませんでした。少し待ってからお試しください', true); return; }
        say('');
        if (x.d.list) showList(x.d.list, value);
        else if (x.d.player) { showPlayer(x.d.player, x.d.others || []); if (push !== false) setUrl(x.d.player.fid); }
      })
      .catch(function () { busy = false; out.classList.remove('loading'); say('サーバーにつながりませんでした。少し待ってからお試しください', true); });
  }
  function setUrl(fid) { try { var u = new URL(location.href); u.searchParams.set('p', fid); u.hash = 'player'; history.replaceState(null, '', u.toString()); } catch (e) {} }
  form.addEventListener('submit', function (e) { e.preventDefault(); lookup('q', input.value); });

  // ---- 候補の一覧（同じ・似た名前が何人もいるとき）----
  function row(p) {
    var T = tier(Math.max(p.tier, p.tier2)), b = h('button', 'pl-pick');
    b.type = 'button';
    b.appendChild(emblem(Math.max(p.tier, p.tier2), 40));
    b.appendChild(h('span', 'pl-pick-n', [h('b', null, p.name), h('small', null, (GD.titles[p.title] || {}).n || '')]));
    b.appendChild(h('span', 'pl-pick-r', [h('b', null, T.n), h('small', null, '1v1 ' + p.rate + ' / 2v2 ' + p.rate2)]));
    b.addEventListener('click', function () { lookup('id', p.fid); });
    return b;
  }
  function showList(list, q) {
    out.textContent = ''; out.hidden = false;
    out.appendChild(card('「' + q + '」の候補（' + list.length + '人）', [h('p', 'pl-note', '見たい人を選んでください。レートの高い順です。'), h('div', 'pl-picks', list.map(row))]));
    out.scrollIntoView({ block: 'start' });
  }

  // ---- 1人の戦績 ----
  function showPlayer(P, others) {
    out.textContent = ''; out.hidden = false;
    var best = Math.max(P.bestTier, P.ranked.tier, P.ranked2.tier);
    // 名前・称号・フレンドID・クラン・しるし
    var tt = GD.titles[P.title] || { n: P.title };
    var flags = [];
    if (P.flags.dev) flags.push(['開発者', 'dev']);
    if (P.flags.champion) flags.push(['天下無双' + (P.flags.champSeason ? '（シーズン' + P.flags.champSeason + '）' : ''), 'gold']);
    if (P.flags.champion2) flags.push(['天双無双' + (P.flags.champ2Season ? '（シーズン' + P.flags.champ2Season + '）' : ''), 'gold']);
    if (P.flags.pioneer10) flags.push(['最初の10人', 'gold']); else if (P.flags.pioneer) flags.push(['開拓者', '']);
    if (P.flags.hwking) flags.push(['ハロウィンの王', '']);
    if (P.flags.snowking) flags.push(['冬の王', '']);
    if (P.emperor.beat) flags.push(['鬼帝を討った', 'red']);
    var head = h('div', 'card pl-top', [
      emblem(best, 88),
      h('div', 'pl-id', [
        h('p', 'pl-tt' + (tt.rare ? ' rare' : ''), tt.n),
        h('h2', 'pl-name', [P.name, P.clan ? h('span', 'pl-clan', '[' + P.clan.tag + ']') : null]),
        h('p', 'pl-meta', [h('span', 'pl-dot ' + (P.status === 'online' ? 'on' : ''), P.status === 'online' ? 'オンライン' : 'オフライン'), ' フレンドID ', h('code', null, P.fid), P.clan ? ' ・ クラン ' + P.clan.name : '']),
        P.bio ? h('p', 'pl-bio', '「' + P.bio + '」') : null,
        flags.length ? h('div', 'pl-flags', flags.map(function (f) { return h('span', 'pl-flag ' + f[1], f[0]); })) : null
      ])
    ]);
    out.appendChild(head);

    // 大きな数字
    var on = P.online, onM = on.w + on.l;
    out.appendChild(h('div', 'pl-tiles', [
      tile('1v1 レート', fmt(P.ranked.rate), tier(P.ranked.tier).n + ' ・ 今シーズン最高 ' + fmt(P.ranked.peak)),
      tile('2v2 レート', fmt(P.ranked2.rate), tier(P.ranked2.tier).n + ' ・ 今シーズン最高 ' + fmt(P.ranked2.peak)),
      tile('これまでの最高ランク', tier(best).n, P.prev ? '前シーズン ' + (P.prev.tierOnly ? tier(P.prev.tierOnly).n : tier(GD.tierOf(Math.max(P.prev.p, P.prev.p2))).n) : '前シーズンの記録なし'),
      tile('オンライン戦績', on.w + '勝 ' + on.l + '敗', '勝率 ' + pct(on.w, onM) + ' ・ ' + onM + '試合'),
      tile('最大連勝', P.streak.best + '連勝', '今 ' + P.streak.cur + '連勝（CPU戦をふくむ）'),
      tile('ランクの最大連勝', P.ranked.best + '連勝', '1v1 今 ' + P.ranked.streak + ' ・ 2v2 最大 ' + P.ranked2.best),
      tile('レベル', 'Lv.' + P.level, fmt(P.xp) + ' XP'),
      tile('はじめた日', P.since ? day(P.since) : '–', P.since ? daysAgo(P.since) : ''),
      tile('最後に試合をした日', P.lastMatch ? day(P.lastMatch) : '–', P.lastMatch ? daysAgo(P.lastMatch) : 'この更新のあとは、まだ試合なし'),
      tile('称号', P.titles + ' / ' + P.titlesAll, 'もっている数')
    ]));

    // レートの動き
    var chartBox = h('div', 'pl-chart'), chartNote = h('p', 'pl-note');
    var hasRh2 = P.rh2 && P.rh2.length > 1;
    var drawChart = function (k) {
      var list = k === '2v2' ? P.rh2 : P.rh;
      chartBox.textContent = '';
      if (!list || list.length < 2) { chartBox.appendChild(h('p', 'pl-empty', 'まだ記録がありません。この更新のあとのランクマッチから、1試合ごとに記録します。')); chartNote.textContent = ''; return; }
      rateChart(chartBox, list);
      var a = list[0][1], z = list[list.length - 1][1], d = z - a;
      chartNote.textContent = (list.length - 1) + '試合 ・ ' + fmt(a) + ' → ' + fmt(z) + '（' + (d >= 0 ? '+' : '') + d + '）・ 線の下がった所にはシーズンの切りかえもふくみます';
    };
    out.appendChild(card('レートの動き', [seg([['1v1', '1v1'], ['2v2', '2v2']], '1v1', drawChart), chartBox, chartNote], 'pl-wide'));
    drawChart(P.rh && P.rh.length > 1 ? '1v1' : hasRh2 ? '2v2' : '1v1');

    // シーズンと連勝
    var sea = [];
    sea.push(h('table', 'tbl mini pl-tbl', [h('tbody', null, [
      trow('今シーズン（' + P.season + '）1v1', fmt(P.ranked.rate) + '（最高 ' + fmt(P.ranked.peak) + '）・ ' + P.ranked.w + '勝' + P.ranked.l + '敗'),
      trow('今シーズン（' + P.season + '）2v2', fmt(P.ranked2.rate) + '（最高 ' + fmt(P.ranked2.peak) + '）・ ' + P.ranked2.w + '勝' + P.ranked2.l + '敗'),
      trow('前シーズン', P.prev ? (P.prev.tierOnly ? '最高 ' + tier(P.prev.tierOnly).n : '1v1 最高 ' + fmt(P.prev.p) + '（' + tier(GD.tierOf(P.prev.p)).n + '）・ 2v2 最高 ' + fmt(P.prev.p2)) : '記録なし')
    ])]));
    var past = (P.seasons || []).slice().reverse();
    if (past.length) {
      sea.push(h('div', 'pl-scroll', h('table', 'tbl pl-tbl pl-seasons', [
        h('thead', null, h('tr', null, [h('th', null, 'シーズン'), h('th', null, '1v1 最高'), h('th', null, '1v1 勝敗'), h('th', null, '2v2 最高'), h('th', null, '2v2 勝敗')])),
        h('tbody', null, past.map(function (x) { return h('tr', null, [h('th', null, String(x.s)), h('td', null, fmt(x.p) + ' ' + tier(GD.tierOf(x.p)).n), h('td', null, x.w + '-' + x.l), h('td', null, fmt(x.p2)), h('td', null, x.w2 + '-' + x.l2)]); }))
      ])));
    }
    var stk = h('table', 'tbl mini pl-tbl', [h('tbody', null, [
      trow('全試合（CPU戦をふくむ）', '最大 ' + P.streak.best + ' ・ 今 ' + P.streak.cur),
      trow('オンライン', '最大 ' + P.streak.onlineBest + ' ・ 今 ' + P.streak.online),
      trow('ランク 1v1', '最大 ' + P.ranked.best + ' ・ 今 ' + P.ranked.streak),
      trow('ランク 2v2', '最大 ' + P.ranked2.best + ' ・ 今 ' + P.ranked2.streak)
    ])]);
    out.appendChild(h('div', 'grid g-2 pl-grid', [card('シーズン', sea), card('連勝', [stk, h('p', 'pl-note', 'オンラインとランクの最大連勝は、この更新のあとから数えます（ランクは今の連勝も入れています）。')])]));

    // 武器ごと
    var wBox = h('div', 'pl-weapons');
    var drawW = function (mode) { wBox.textContent = ''; wBox.appendChild(weaponTable(P, mode)); };
    out.appendChild(card('武器ごとの戦績', [seg([['all', '合計'], ['o', 'オンライン'], ['c', 'CPU戦']], 'all', drawW), wBox,
      h('p', 'pl-note', '試合数・勝率・命中率は、この更新のあとの試合から数えます（その試合で1回でも撃った・振った武器）。とどめの数は、これまでの全部です。')], 'flush-pad'));
    drawW('all');

    // ステージと CPU 戦
    var sBox = h('div');
    var drawS = function (mode) { sBox.textContent = ''; sBox.appendChild(stageTable(P, mode)); };
    var cpuRows = GD.diffs.map(function (d) { var x = P.cpu[d[0]] || { w: 0, l: 0 }; return trow(d[1], x.w + '勝 ' + x.l + '敗（勝率 ' + pct(x.w, x.w + x.l) + '）'); });
    if (P.emperor.w + P.emperor.l > 0) cpuRows.push(trow(GD.emperor, P.emperor.w + '勝 ' + P.emperor.l + '敗'));
    out.appendChild(h('div', 'grid g-2 pl-grid', [
      card('ステージごとの勝率', [seg([['all', '合計'], ['o', 'オンライン'], ['c', 'CPU戦']], 'all', drawS), sBox, h('p', 'pl-note', 'この更新のあとの試合から数えます。CPU戦でステージに勝った回数は、これまでの全部です。')]),
      card('CPU戦', [h('table', 'tbl mini pl-tbl', [h('tbody', null, cpuRows)])])
    ]));
    drawS('all');

    if (others && others.length) out.appendChild(card('ほかの候補', [h('div', 'pl-picks', others.map(row))]));
    out.scrollIntoView({ block: 'start' });
  }
  function trow(k, v) { return h('tr', null, [h('th', null, k), h('td', null, v)]); }
  // [試合, 勝ち, とどめ, 撃った, 当てた] を、モードで足し合わせる
  function wsum(rec, mode) {
    var z = [0, 0, 0, 0, 0];
    ['o', 'c'].forEach(function (m) { if ((mode === 'all' || mode === m) && rec && rec[m]) for (var i = 0; i < 5; i++) z[i] += num(rec[m][i]); });
    return z;
  }
  function weaponTable(P, mode) {
    var rows = GD.order.map(function (id) { var a = wsum(P.weapons[id], mode); return { id: id, m: a[0], w: a[1], k: num(P.kills[id]), s: a[3], h: a[4] }; })
      .filter(function (r) { return r.m > 0 || r.k > 0; })
      .sort(function (a, b) { return b.m - a.m || b.k - a.k; });
    if (!rows.length) return h('p', 'pl-empty', 'まだ記録がありません。');
    var maxM = Math.max.apply(null, rows.map(function (r) { return r.m; })) || 1;
    return h('div', 'pl-scroll', h('table', 'tbl pl-tbl pl-wt', [
      h('thead', null, h('tr', null, [h('th', null, '武器'), h('th', null, '試合'), h('th', 'pl-wr-h', '勝率'), h('th', null, 'とどめ'), h('th', null, '命中率')])),
      h('tbody', null, rows.map(function (r) {
        var W = GD.weapons[r.id], ic = h('img', 'pl-wi'); ic.src = 'img/w-' + W.key + '.png'; ic.alt = ''; ic.width = 48; ic.height = 20; ic.loading = 'lazy';
        var bar = h('span', 'pl-bar', h('i')); bar.firstChild.style.width = (r.m ? Math.round(r.w / r.m * 100) : 0) + '%';
        var use = h('span', 'pl-use', h('i')); use.firstChild.style.width = Math.round(r.m / maxM * 100) + '%';
        var tr = h('tr', null, [h('th', null, h('span', 'pl-wn', [ic, W.n])), h('td', 'n', [String(r.m), use]), h('td', 'pl-wr', [bar, h('span', 'v', r.m ? pct(r.w, r.m) + '（' + r.w + '勝）' : '–')]), h('td', 'n', String(r.k)), h('td', 'n', r.s ? pct(r.h, r.s) : '–')]);
        tr.title = W.n + '：' + r.m + '試合 ' + r.w + '勝' + (r.s ? ' ・ ' + r.s + '発中 ' + r.h + '発' : '');
        return tr;
      }))
    ]));
  }
  function stageTable(P, mode) {
    var ids = Object.keys(GD.stages).concat(Object.keys(P.stages || {}).filter(function (k) { return !GD.stages[k]; }));
    var rows = ids.map(function (id) {
      var g = (P.stages || {})[id] || {}, m = 0, w = 0;
      ['o', 'c'].forEach(function (k) { if ((mode === 'all' || mode === k) && g[k]) { m += num(g[k][0]); w += num(g[k][1]); } });
      return { id: id, m: m, w: w, cw: num((P.cpuStageWins || {})[id]) };
    });
    return h('div', 'pl-scroll', h('table', 'tbl pl-tbl pl-st', [
      h('thead', null, h('tr', null, [h('th', null, 'ステージ'), h('th', null, '試合'), h('th', 'pl-wr-h', '勝率'), h('th', null, 'CPU戦の勝ち')])),
      h('tbody', null, rows.map(function (r) {
        var bar = h('span', 'pl-bar', h('i')); bar.firstChild.style.width = (r.m ? Math.round(r.w / r.m * 100) : 0) + '%';
        return h('tr', null, [h('th', null, GD.stages[r.id] || r.id), h('td', 'n', String(r.m)), h('td', 'pl-wr', [bar, h('span', 'v', r.m ? pct(r.w, r.m) : '–')]), h('td', 'n', String(r.cw))]);
      }))
    ]));
  }

  // ---- レートの折れ線（試合ごと）。なぞると、その試合のレートと日時 ----
  function rateChart(box, list) {
    var W = Math.max(280, box.clientWidth || 600), H = W < 520 ? 200 : 240, L = 44, R = 64, T = 14, B = 26;
    var vals = list.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(20, (hi - lo) * .12); lo -= pad; hi += pad;
    var span = hi - lo, step = span > 800 ? 200 : span > 400 ? 100 : span > 160 ? 50 : 20;
    var y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step; lo = y0; hi = y1;
    var X = function (i) { return L + (list.length === 1 ? 0 : i / (list.length - 1)) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * (H - T - B); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': 'レートの動き（' + list.length + '点）' });
    for (var v = y0; v <= y1; v += step) {
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'g' }));
      var tx = s('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'ax' }); tx.textContent = fmt(v); svg.appendChild(tx);
    }
    // ランクの境目（Ⅰになるレート）を、うすい線と名前で
    GD.tiers.forEach(function (t) {
      if (!t.r || t.d !== 1 || t.min <= lo || t.min >= hi) return;
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: Y(t.min), y2: Y(t.min), class: 'rk' }));
      var tx2 = s('text', { x: W - R + 6, y: Y(t.min) + 4, class: 'rkt' }); tx2.textContent = GD.ranks[t.r]; svg.appendChild(tx2);
    });
    var d = '', a = '';
    list.forEach(function (p, i) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[1]).toFixed(1); });
    a = d + 'L' + X(list.length - 1).toFixed(1) + ' ' + (H - B) + 'L' + X(0).toFixed(1) + ' ' + (H - B) + 'Z';
    svg.appendChild(s('path', { d: a, class: 'area' }));
    svg.appendChild(s('path', { d: d, class: 'ln' }));
    var last = list[list.length - 1];
    svg.appendChild(s('circle', { cx: X(list.length - 1), cy: Y(last[1]), r: 4.5, class: 'dot' }));
    var lt = s('text', { x: X(list.length - 1) - 8, y: Y(last[1]) - 10, class: 'endv', 'text-anchor': 'end' });   // 右のランク名と重ならないよう、点の左上に lt.textContent = fmt(last[1]); svg.appendChild(lt);
    // 横軸：最初と最後の日付
    [[0, 'start'], [list.length - 1, 'end']].forEach(function (q) { var t3 = s('text', { x: X(q[0]), y: H - 6, 'text-anchor': q[1], class: 'ax' }); var dd = new Date(list[q[0]][0] * 1000); t3.textContent = (dd.getMonth() + 1) + '/' + dd.getDate(); svg.appendChild(t3); });
    // なぞったとき：縦の線・点・説明
    var cross = s('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }), hd = s('circle', { r: 5, class: 'hdot', visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(hd);
    var hit = s('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent', tabindex: '0' }); svg.appendChild(hit);
    var tip = h('div', 'pl-tip'); tip.hidden = true;
    function at(i) {
      i = Math.max(0, Math.min(list.length - 1, i));
      var p = list[i], x = X(i), y = Y(p[1]), dd = new Date(p[0] * 1000), prev = i ? list[i - 1][1] : null;
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      hd.setAttribute('cx', x); hd.setAttribute('cy', y); hd.setAttribute('visibility', 'visible');
      tip.textContent = '';
      tip.appendChild(h('b', null, fmt(p[1])));
      if (prev != null) tip.appendChild(h('span', 'dl', (p[1] - prev >= 0 ? '+' : '') + (p[1] - prev)));
      tip.appendChild(h('small', null, (dd.getMonth() + 1) + '月' + dd.getDate() + '日 ' + ('0' + dd.getHours()).slice(-2) + ':' + ('0' + dd.getMinutes()).slice(-2) + (i ? ' ・ ' + i + '試合目' : ' ・ はじめ')));
      tip.hidden = false;
      var bw = box.clientWidth, sx = x * (box.clientWidth / W);
      tip.style.left = Math.max(0, Math.min(bw - tip.offsetWidth, sx - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, y * (box.clientWidth / W) - tip.offsetHeight - 12) + 'px';
      cur = i;
    }
    var cur = list.length - 1;
    function fromEvent(e) { var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width); return Math.round((x - L) / (W - L - R) * (list.length - 1)); }
    hit.addEventListener('pointermove', function (e) { at(fromEvent(e)); });
    hit.addEventListener('pointerdown', function (e) { at(fromEvent(e)); });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    hit.addEventListener('focus', function () { at(cur); });
    hit.addEventListener('blur', function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); });
    hit.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') { at(cur - 1); e.preventDefault(); } else if (e.key === 'ArrowRight') { at(cur + 1); e.preventDefault(); } });
    box.appendChild(svg); box.appendChild(tip);
  }

  // ---- ページを開いたとき：?p=フレンドID があれば、その人を出す ----
  try { var p0 = new URL(location.href).searchParams.get('p'); if (p0) { input.value = p0; lookup('id', p0, false); } } catch (e) {}
})();
