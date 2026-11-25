// BOT の道案内：ステージの床を格子で調べて点（ノード）を作り、歩ける・飛び降りる・跳び上がる・ジャンプ台のつながりを張る。A* で道を探す
import { BODY } from './data.js';

export class NavGraph {
  constructor(world, opt = {}) {
    this.world = world;
    this.s = opt.spacing || 1.5;
    this.nodes = [];     // { id, x, y, z, edges:[{to, cost, type}], edge:0..1（端の近さ）, cell }
    this.cells = new Map();
    this.build();
  }

  key(i, j) { return i * 4096 + j; }

  build() {
    const W = this.world, s = this.s, b = W.bounds, rr = BODY.r;
    const i0 = Math.floor(b.minX / s), i1 = Math.ceil(b.maxX / s), j0 = Math.floor(b.minZ / s), j1 = Math.ceil(b.maxZ / s);
    // 1. 床の点
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = i * s, z = j * s;
      const tops = new Set();
      for (const bx of W.boxes) {
        if (!bx.walk) continue;
        if (x >= bx.min[0] + rr * 0.5 && x <= bx.max[0] - rr * 0.5 && z >= bx.min[2] + rr * 0.5 && z <= bx.max[2] - rr * 0.5) tops.add(+bx.max[1].toFixed(3));
      }
      for (const r of W.ramps) if (x >= r.x0 + 0.1 && x <= r.x1 - 0.1 && z >= r.z0 + 0.1 && z <= r.z1 - 0.1) tops.add(+W.rampHeight(r, x, z).toFixed(3));
      for (const y of tops) {
        // 本当にいちばん上の床か（その高さに別の床が重なっていないか）と、体が入るか
        const g = W.groundAt(x, z, 0.05, y, 0.01);
        if (!g || Math.abs(g.y - y) > 0.02) continue;
        if (!W.fits(x, y, z, rr * 0.95, BODY.h)) continue;
        const n = { id: this.nodes.length, x, y, z, i, j, edges: [], edge: 0 };
        this.nodes.push(n);
        const k = this.key(i - i0, j - j0);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(n);
      }
    }
    this.i0 = i0; this.j0 = j0;
    // 2. 端（落ちる場所）の近さ
    for (const n of this.nodes) {
      let miss = 0;
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4, px = n.x + Math.cos(ang) * 1.6, pz = n.z + Math.sin(ang) * 1.6;
        const g = W.groundAt(px, pz, 0.2, n.y + 0.3, 0.3);
        if (!g || g.y < n.y - 6) miss++;
      }
      n.edge = miss / 8;
    }
    // 3. つながり
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const n of this.nodes) {
      for (const [di, dj] of dirs) {
        const list = this.cells.get(this.key(n.i + di - i0, n.j + dj - j0));
        if (!list) continue;
        for (const m of list) {
          const dy = m.y - n.y, d = Math.hypot(m.x - n.x, m.z - n.z);
          let type = null, cost = d;
          if (Math.abs(dy) <= BODY.step) { if (this.walkable(n, m)) type = 'walk'; }
          else if (dy < 0 && dy >= -8) { if (this.dropable(n, m)) { type = 'drop'; cost = d + 0.6; } }
          else if (dy > 0 && dy <= 1.25) { if (this.dropable(m, n)) { type = 'jump'; cost = d + 1.5; } }
          if (!type) continue;
          cost *= 1 + m.edge * 2.5;   // 端は遠回りに感じさせる（落ちないように）
          n.edges.push({ to: m.id, cost, type });
        }
      }
    }
    // 4. ジャンプ台
    for (const pad of W.pads) {
      const from = this.nearest(pad.x, pad.y, pad.z, 2.2), to = this.nearest(pad.land[0], pad.land[1], pad.land[2], 3);
      if (from && to) { from.edges.push({ to: to.id, cost: 4, type: 'pad', pad }); from.pad = pad; }
    }
  }

  // 同じ高さの2点の間を歩けるか：間に床があり、体がぶつからない
  walkable(a, b) {
    const W = this.world;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      const g = W.groundAt(x, z, BODY.r * 0.5, y + 0.1, BODY.step);
      if (!g || g.y < y - BODY.step) return false;
      if (!W.fits(x, g.y, z, BODY.r * 0.9, BODY.h)) return false;
    }
    return true;
  }
  // 高い a から低い b へ飛び降りられるか：a の高さのまま b の上まで行けて、そこから b まで空いている
  dropable(a, b) {
    const W = this.world, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    if (!W.fits(mx, a.y, mz, BODY.r * 0.9, BODY.h)) return false;
    if (!W.fits(b.x, b.y, b.z, BODY.r * 0.9, a.y - b.y + BODY.h)) return false;
    return true;
  }

  nearest(x, y, z, maxD = 4) {
    let best = null, bd = maxD * maxD;
    const s = this.s, ci = Math.round(x / s) - this.i0, cj = Math.round(z / s) - this.j0, R = Math.ceil(maxD / s);
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const list = this.cells.get(this.key(i, j));
      if (!list) continue;
      for (const n of list) {
        const dy = (n.y - y) * 2.5, d = (n.x - x) ** 2 + (n.z - z) ** 2 + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  // A*：from と to はノード。avoid(node) は追加のコスト（敵の射線など）
  path(from, to, avoid) {
    if (!from || !to) return null;
    if (from === to) return [from];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = new MinHeap();
    g[from.id] = 0;
    heap.push(from.id, this.h(from, to));
    let iter = 0;
    while (heap.size && iter++ < 6000) {
      const cur = heap.pop();
      if (cur === to.id) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const n = this.nodes[cur];
      for (const e of n.edges) {
        if (closed[e.to]) continue;
        const m = this.nodes[e.to];
        const ng = g[cur] + e.cost + (avoid ? avoid(m) : 0);
        if (ng < g[e.to]) { g[e.to] = ng; came[e.to] = cur; heap.push(e.to, ng + this.h(m, to)); }
      }
    }
    if (came[to.id] < 0) return null;
    const out = [];
    for (let c = to.id; c >= 0; c = came[c]) { out.push(this.nodes[c]); if (c === from.id) break; }
    return out.reverse();
  }
  h(a, b) { return Math.hypot(a.x - b.x, (a.y - b.y) * 1.5, a.z - b.z); }

  edgeType(a, b) { for (const e of a.edges) if (e.to === b.id) return e; return null; }

  randomNode(filter) {
    for (let k = 0; k < 40; k++) {
      const n = this.nodes[(Math.random() * this.nodes.length) | 0];
      if (n && n.edge < 0.2 && n.edges.length >= 3 && (!filter || filter(n))) return n;
    }
    return this.nodes[(Math.random() * this.nodes.length) | 0];
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(id, pri) {
    const k = this.k, v = this.v;
    k.push(id); v.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v, top = k[0], lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
