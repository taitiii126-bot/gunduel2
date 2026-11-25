// ステージを作って場面に入れる・片付ける
import * as THREE from '../lib/three.js';
import { buildRuins } from './map-ruins.js';
import { buildHarbor } from './map-harbor.js';
import { buildFrost } from './map-frost.js';
import { NavGraph } from './nav.js';
import { U } from './arena-common.js';

const BUILDERS = { ruins: buildRuins, harbor: buildHarbor, frost: buildFrost };

export function loadArena(id, gfx) {
  const arena = (BUILDERS[id] || buildRuins)(gfx.q);
  arena.nav = null;
  const sc = gfx.scene;
  sc.add(arena.group);
  sc.fog = arena.fog;
  sc.background = new THREE.Color(arena.fog.color);
  gfx.renderer.toneMappingExposure = arena.grade.exposure;
  gfx.bakeEnvironment(arena.envScene);
  sc.environmentIntensity = arena.envIntensity != null ? arena.envIntensity : 0.7;
  gfx.setSun(arena.sun, arena.sunExtent);
  // 映り込みの強さを材質ごとに
  arena.group.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.envMapIntensity === 1) o.material.envMapIntensity = 0.9; });
  arena.getNav = () => arena.nav || (arena.nav = new NavGraph(arena.world, { spacing: 1.5 }));
  return arena;
}

export function unloadArena(arena, gfx) {
  if (!arena) return;
  gfx.scene.remove(arena.group);
  arena.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); } m.dispose(); });
  });
  if (arena.envScene) arena.envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

export function tickArena(arena, dt, t) { U.time.value = t; if (arena) arena.update(dt, t); }
