// 当たり判定の世界：箱（AABB）と坂（くさび形）。キャラクターの移動・地面・弾の線（レイ）を受け持つ。three.js を使わない素の計算
import { BODY } from './data.js';

const EPS = 1e-6;

export class CollisionWorld {
  constructor() {
    this.boxes = [];      // { min:[x,y,z], max:[x,y,z], shoot:bool（弾を止める）, walk:bool（上に乗れる）, thin:bool（貫通弾が抜ける）, tag }
    this.ramps = [];      // { x0,z0,x1,z1, y0,y1, axis:'x'|'z', up:+1|-1, planes:[[nx,ny,nz,d]...] }
    this.pads = [];       // ジャンプ台 { x,y,z, r, v:[vx,vy,vz], land:[x,y,z] }
    this.killY = -30;
    this.bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  }

  addBox(minx, miny, minz, maxx, maxy, maxz, o = {}) {
    const b = { min: [Math.min(minx, maxx), Math.min(miny, maxy), Math.min(minz, maxz)], max: [Math.max(minx, maxx), Math.max(miny, maxy), Math.max(minz, maxz)],
      shoot: o.shoot !== false, walk: o.walk !== false, solid: o.solid !== false, thin: !!o.thin, tag: o.tag || '' };
    this.boxes.push(b);
    return b;
  }
  // 中心と大きさで足す
  addBoxC(cx, cy, cz, w, h, d, o) { return this.addBox(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, o); }

  // 坂：x0..x1, z0..z1 の範囲。axis の向きに y0（低い側）から y1（高い側）へ上がる。up=+1 なら座標が大きい側が高い
  addRamp(x0, z0, x1, z1, y0, y1, axis, up, o = {}) {
    const r = { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1, axis, up: up >= 0 ? 1 : -1, base: o.base != null ? o.base : y0, tag: o.tag || '' };
    // 弾の判定用：くさびを平面5つ（坂の面・底・高い側の壁・横2つ）で表す。平面は外向きの法線 n と d（n・p <= d が内側）
    const len = axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0, rise = y1 - y0;
    const L = Math.hypot(len, rise);
    let n, p;
    if (axis === 'x') {
      n = [-r.up * rise / L, len / L, 0];
      p = [r.up > 0 ? r.x0 : r.x1, y0, r.z0];
    } else {
      n = [0, len / L, -r.up * rise / L];
      p = [r.x0, y0, r.up > 0 ? r.z0 : r.z1];
    }
    const planes = [[n[0], n[1], n[2], n[0] * p[0] + n[1] * p[1] + n[2] * p[2]], [0, -1, 0, -r.base]];
    if (axis === 'x') {
      planes.push(r.up > 0 ? [1, 0, 0, r.x1] : [-1, 0, 0, -r.x0]);
      planes.push([0, 0, 1, r.z1], [0, 0, -1, -r.z0]);
      planes.push(r.up > 0 ? [-1, 0, 0, -r.x0] : [1, 0, 0, r.x1]);
    } else {
      planes.push(r.up > 0 ? [0, 0, 1, r.z1] : [0, 0, -1, -r.z0]);
      planes.push([1, 0, 0, r.x1], [-1, 0, 0, -r.x0]);
      planes.push(r.up > 0 ? [0, 0, -1, -r.z0] : [0, 0, 1, r.z1]);
    }
    r.planes = planes;
    this.ramps.push(r);
    return r;
  }

  addPad(x, y, z, r, v, land) { const p = { x, y, z, r, v, land }; this.pads.push(p); return p; }

  rampHeight(r, x, z) {
    const t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
    const u = Math.min(1, Math.max(0, r.up > 0 ? t : 1 - t));
    return r.y0 + (r.y1 - r.y0) * u;
  }

  // (x,z) に半径 rr の足を置いたとき、feetY + maxUp 以下でいちばん高い床。無ければ null
  groundAt(x, z, rr, feetY, maxUp) {
    let best = -Infinity, kind = null;
    const lim = feetY + maxUp;
    for (const b of this.boxes) {
      if (!b.walk) continue;
      const top = b.max[1];
      if (top > lim || top <= best) continue;
      const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz <= rr * rr) { best = top; kind = b; }
    }
    for (const r of this.ramps) {
      const cx = Math.max(r.x0, Math.min(x, r.x1)), cz = Math.max(r.z0, Math.min(z, r.z1));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > rr * rr) continue;
      const h = this.rampHeight(r, cx, cz);
      if (h <= lim && h > best) { best = h; kind = r; }
    }
    return best === -Infinity ? null : { y: best, obj: kind };
  }

  // 頭の上の天井（feetY+h より上で最初にぶつかる箱の底）
  ceilingAt(x, z, rr, fromY, toY) {
    let best = Infinity;
    for (const b of this.boxes) {
      if (!b.solid) continue;
      const bot = b.min[1];
      if (bot < fromY - 0.02 || bot > toY || bot >= best) continue;
      const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < rr * rr * 0.8) best = bot;
    }
    return best;
  }

  // 横方向の押し出し。pos=[x,y,z]（足もと）、高さ h、乗り越えられる段 step。ぶつかったら法線の合計を返す
  pushOut(pos, rr, h, step, out) {
    let nx = 0, nz = 0, hit = false;
    const feet = pos[1], head = pos[1] + h;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of this.boxes) {
        if (!b.solid) continue;
        if (b.min[1] >= head - 0.02 || b.max[1] <= feet + step) continue;
        const cx = Math.max(b.min[0], Math.min(pos[0], b.max[0])), cz = Math.max(b.min[2], Math.min(pos[2], b.max[2]));
        let dx = pos[0] - cx, dz = pos[2] - cz, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        if (d2 < EPS) {
          // 中心が箱の中：いちばん近い面から出す
          const ex = [pos[0] - b.min[0], b.max[0] - pos[0], pos[2] - b.min[2], b.max[2] - pos[2]];
          let k = 0; for (let i = 1; i < 4; i++) if (ex[i] < ex[k]) k = i;
          if (k === 0) { pos[0] = b.min[0] - rr; nx -= 1; } else if (k === 1) { pos[0] = b.max[0] + rr; nx += 1; }
          else if (k === 2) { pos[2] = b.min[2] - rr; nz -= 1; } else { pos[2] = b.max[2] + rr; nz += 1; }
        } else {
          const d = Math.sqrt(d2), push = rr - d;
          dx /= d; dz /= d;
          pos[0] += dx * push; pos[2] += dz * push; nx += dx; nz += dz;
        }
        hit = moved = true;
      }
      // 坂の横・高い側：その場所の坂の高さが段より高ければ、壁として押し出す
      for (const r of this.ramps) {
        const cx = Math.max(r.x0, Math.min(pos[0], r.x1)), cz = Math.max(r.z0, Math.min(pos[2], r.z1));
        let dx = pos[0] - cx, dz = pos[2] - cz, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < EPS) continue;   // 中に入っているときは、上に乗っている（床として扱う）
        const hgt = this.rampHeight(r, cx, cz);
        if (hgt <= feet + step || r.base >= head) continue;
        const d = Math.sqrt(d2), push = rr - d;
        dx /= d; dz /= d;
        pos[0] += dx * push; pos[2] += dz * push; nx += dx; nz += dz;
        hit = moved = true;
      }
      if (!moved) break;
    }
    if (out) { out.hit = hit; out.nx = nx; out.nz = nz; }
    return hit;
  }

  // レイ：原点 o・向き d（長さ1）・最大の長さ maxT。opt.pierce なら thin の箱を抜ける。当たれば { t, n:[..], obj } を返す
  raycast(ox, oy, oz, dx, dy, dz, maxT, opt) {
    let best = maxT, bn = null, bo = null;
    const pierce = opt && opt.pierce, ignoreThin = opt && opt.ignoreThin;
    const idx = dx !== 0 ? 1 / dx : 1e12, idy = dy !== 0 ? 1 / dy : 1e12, idz = dz !== 0 ? 1 / dz : 1e12;
    for (const b of this.boxes) {
      if (!b.shoot) continue;
      if ((pierce || ignoreThin) && b.thin) continue;
      let t1 = (b.min[0] - ox) * idx, t2 = (b.max[0] - ox) * idx;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
      t1 = (b.min[1] - oy) * idy; t2 = (b.max[1] - oy) * idy;
      let lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; ax = 1; }
      if (hi < tmax) tmax = hi;
      t1 = (b.min[2] - oz) * idz; t2 = (b.max[2] - oz) * idz;
      lo = Math.min(t1, t2); hi = Math.max(t1, t2);
      if (lo > tmin) { tmin = lo; ax = 2; }
      if (hi < tmax) tmax = hi;
      if (tmax < 0 || tmin > tmax || tmin >= best) continue;
      if (tmin < 0) continue;   // 箱の中から撃った（中から外へは当たらない）
      best = tmin; bo = b;
      bn = [0, 0, 0]; bn[ax] = (ax === 0 ? dx : ax === 1 ? dy : dz) > 0 ? -1 : 1;
    }
    for (const r of this.ramps) {
      // 凸多面体とレイ（Cyrus-Beck）
      let tE = 0, tL = best, nE = null, ok = true;
      for (const p of r.planes) {
        const denom = p[0] * dx + p[1] * dy + p[2] * dz, dist = p[3] - (p[0] * ox + p[1] * oy + p[2] * oz);
        if (Math.abs(denom) < EPS) { if (dist < 0) { ok = false; break; } continue; }
        const t = dist / denom;
        if (denom < 0) { if (t > tE) { tE = t; nE = p; } } else if (t < tL) tL = t;
        if (tE > tL) { ok = false; break; }
      }
      if (ok && nE && tE < best) { best = tE; bn = [nE[0], nE[1], nE[2]]; bo = r; }
    }
    return bo ? { t: best, n: bn, obj: bo } : null;
  }

  // a から b まで、弾を止める物が無いか
  clear(ax, ay, az, bx, by, bz, opt) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L - 0.02, opt);
  }

  // (x,z) に半径 rr・高さ h の体が立てるか（床 y から上が空いているか）
  fits(x, y, z, rr, h) {
    for (const b of this.boxes) {
      if (!b.solid) continue;
      if (b.min[1] >= y + h || b.max[1] <= y + 0.06) continue;
      const cx = Math.max(b.min[0], Math.min(x, b.max[0])), cz = Math.max(b.min[2], Math.min(z, b.max[2]));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    for (const r of this.ramps) {
      const cx = Math.max(r.x0, Math.min(x, r.x1)), cz = Math.max(r.z0, Math.min(z, r.z1));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz >= rr * rr) continue;
      const hh = this.rampHeight(r, cx, cz);
      if (hh > y + BODY.step && r.base < y + h) return false;
    }
    return true;
  }
}

// キャラクターを1ステップ動かす。c={ pos:[x,y,z], vel:[x,y,z], onGround, h, r }。dt は小さく（1/120 くらいまで）
// 返り値：着地した（landed）、ジャンプ台に乗った（pad）、壁に当たった（wall）
const _out = { hit: false, nx: 0, nz: 0 };
export function stepCharacter(world, c, dt) {
  const res = { landed: false, pad: null, wall: false, fallSpeed: 0 };
  const p = c.pos, v = c.vel, rr = c.r, h = c.h;
  // 横
  p[0] += v[0] * dt; p[2] += v[2] * dt;
  const step = c.onGround ? BODY.step : 0.28;   // 空中でも少しの段差はよじ登る
  if (world.pushOut(p, rr, h, step, _out)) {
    res.wall = true;
    // 壁に向かう速さを消す
    const L = Math.hypot(_out.nx, _out.nz);
    if (L > EPS) {
      const nx = _out.nx / L, nz = _out.nz / L, vn = v[0] * nx + v[2] * nz;
      if (vn < 0) { v[0] -= vn * nx; v[2] -= vn * nz; }
    }
  }
  // 縦
  const prevY = p[1];
  if (!c.onGround) v[1] = Math.max(-BODY.maxFall, v[1] - BODY.gravity * dt);
  p[1] += v[1] * dt;
  // 天井
  if (v[1] > 0) {
    const ceil = world.ceilingAt(p[0], p[2], rr, prevY + h, p[1] + h);
    if (ceil < Infinity) { p[1] = ceil - h - 0.01; v[1] = 0; }
  }
  // 床
  const up = c.onGround ? BODY.step : Math.max(0.28, 0.02);
  const g = world.groundAt(p[0], p[2], rr * 0.62, Math.max(p[1], prevY), up);
  const wasGround = c.onGround;
  if (g) {
    if (c.onGround) {
      // 坂を下る・小さな段を下りるときは、床に吸いつかせる
      if (v[1] <= 0.01 && g.y >= p[1] - 0.38 && g.y <= p[1] + BODY.step) { p[1] = g.y; v[1] = 0; }
      else if (g.y < p[1] - 0.38) c.onGround = false;
    } else if (v[1] <= 0 && p[1] <= g.y + 0.001 && prevY >= g.y - 0.3) {
      res.fallSpeed = -v[1];
      p[1] = g.y; v[1] = 0; c.onGround = true; res.landed = true;
    }
  } else c.onGround = false;
  if (c.onGround && !wasGround) res.landed = true;
  // ジャンプ台
  if (c.onGround) {
    for (const pad of world.pads) {
      const dx = p[0] - pad.x, dz = p[2] - pad.z;
      if (dx * dx + dz * dz < pad.r * pad.r && Math.abs(p[1] - pad.y) < 0.4) { res.pad = pad; break; }
    }
  }
  return res;
}

// レイと縦のカプセル（足もと y0 から y1 まで、半径 r）。当たれば距離
export function rayCapsule(ox, oy, oz, dx, dy, dz, cx, y0, y1, cz, r) {
  // 縦の線分 A=(cx,y0+r,cz)〜B=(cx,y1-r,cz) との最短距離を使う（解析的に：無限円柱＋両端の球）
  const a0 = y0 + r, a1 = Math.max(a0, y1 - r);
  // 円柱（xz の円）
  const px = ox - cx, pz = oz - cz;
  const A = dx * dx + dz * dz, B = 2 * (px * dx + pz * dz), C = px * px + pz * pz - r * r;
  let best = Infinity;
  if (A > EPS) {
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc), t = (-B - s) / (2 * A);
      if (t >= 0) { const y = oy + dy * t; if (y >= a0 && y <= a1) best = t; }
    }
  }
  const ts = raySphere(ox, oy, oz, dx, dy, dz, cx, a0, cz, r);
  if (ts < best) best = ts;
  const tt = raySphere(ox, oy, oz, dx, dy, dz, cx, a1, cz, r);
  if (tt < best) best = tt;
  return best;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const px = ox - cx, py = oy - cy, pz = oz - cz;
  const b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - r * r;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
