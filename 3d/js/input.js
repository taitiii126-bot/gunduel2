// 操作：キーボード＋マウス（ポインターロック）・スマホのタッチ（左で移動、右で視点、ボタン）・ゲームパッド
export const DEFAULT_KEYS = {
  fwd: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], crouch: ['ControlLeft', 'KeyC'], skill: ['ShiftLeft', 'ShiftRight'], heal: ['KeyE'], reload: ['KeyR'],
  s1: ['Digit1'], s2: ['Digit2'], s3: ['Digit3'], quick: ['KeyQ'], board: ['Tab'], pause: ['Escape', 'KeyP'],
};

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas; this.settings = settings;
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, leftReleased: false, wheel: 0 };
    this.locked = false; this.enabled = false;
    this.touch = { active: false, move: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, look: { id: null, x: 0, y: 0 }, fire: false, firePressed: false, fireReleased: false, ads: false, btn: new Set(), lookDx: 0, lookDy: 0 };
    this.isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.lastSlot = 0; this.padPrev = [];
    this.onPause = null; this.onBoard = null;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'ControlLeft')) e.preventDefault();
      if (DEFAULT_KEYS.pause.includes(e.code) && this.enabled && this.onPause && !(e.code === 'Escape' && this.locked)) this.onPause();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; this.touch.fire = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { if (this.mouse.left) this.mouse.leftReleased = true; this.mouse.left = false; }
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('mousemove', (e) => { if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      // ゲーム中に Esc でロックが外れたら一時停止
      if (was && !this.locked && this.enabled && this.onPause) this.onPause();
    });
  }

  lock() { try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) {} }); } catch (e) { try { this.canvas.requestPointerLock(); } catch (e2) {} } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(name) { return DEFAULT_KEYS[name].some(k => this.keys.has(k)); }
  hit(name) { return DEFAULT_KEYS[name].some(k => this.pressed.has(k)); }

  // スマホのボタンを作る
  buildTouch(root) {
    root.innerHTML = `
      <div class="tc-zone tc-left"></div><div class="tc-zone tc-right"></div>
      <div class="tc-stick"><div class="tc-knob"></div></div>
      <button class="tc-btn tc-fire" data-b="fire"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg></button>
      <button class="tc-btn tc-ads" data-b="ads"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg></button>
      <button class="tc-btn tc-jump" data-b="jump"><svg viewBox="0 0 24 24"><path d="M12 19V6M6 11l6-6 6 6"/></svg></button>
      <button class="tc-btn tc-crouch" data-b="crouch"><svg viewBox="0 0 24 24"><path d="M12 5v13M6 13l6 6 6-6"/></svg></button>
      <button class="tc-btn tc-skill" data-b="skill"><svg viewBox="0 0 24 24"><path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/></svg><i class="tc-cd"></i></button>
      <button class="tc-btn tc-heal" data-b="heal"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="tc-btn tc-reload" data-b="reload"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg></button>
      <button class="tc-btn tc-pause" data-b="pause"><svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg></button>`;
    this.touchRoot = root;
    const T = this.touch, stick = root.querySelector('.tc-stick'), knob = root.querySelector('.tc-knob');
    this.stickEl = stick; this.knobEl = knob;
    const W = () => window.innerWidth;
    root.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const b = t.target.closest && t.target.closest('.tc-btn');
        if (b) {
          const name = b.dataset.b;
          b.classList.add('on');
          if (name === 'fire') { T.fire = true; T.firePressed = true; T.look.id = t.identifier; T.look.x = t.clientX; T.look.y = t.clientY; T.fireId = t.identifier; }
          else if (name === 'ads') T.ads = !T.ads, b.classList.toggle('lock', T.ads);
          else if (name === 'crouch') { T.crouch = !T.crouch; b.classList.toggle('lock', T.crouch); }
          else if (name === 'pause') { if (this.onPause) this.onPause(); }
          else T.btn.add(name);
          continue;
        }
        if (t.clientX < W() * 0.42 && T.move.id == null) {
          T.move.id = t.identifier; T.move.ox = t.clientX; T.move.oy = t.clientY; T.move.x = t.clientX; T.move.y = t.clientY;
          stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.classList.add('on'); knob.style.transform = 'translate(-50%,-50%)';
        } else if (T.look.id == null) { T.look.id = t.identifier; T.look.x = t.clientX; T.look.y = t.clientY; }
      }
      e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.move.id) {
          T.move.x = t.clientX; T.move.y = t.clientY;
          let dx = t.clientX - T.move.ox, dy = t.clientY - T.move.oy; const L = Math.hypot(dx, dy), R = 56;
          if (L > R) { dx *= R / L; dy *= R / L; }
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (t.identifier === T.look.id) {
          T.lookDx += t.clientX - T.look.x; T.lookDy += t.clientY - T.look.y; T.look.x = t.clientX; T.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.move.id) { T.move.id = null; stick.classList.remove('on'); }
        if (t.identifier === T.look.id) T.look.id = null;
        if (t.identifier === T.fireId) { T.fire = false; T.fireReleased = true; T.fireId = null; }
        const b = t.target.closest && t.target.closest('.tc-btn');
        if (b && b.dataset.b !== 'ads' && b.dataset.b !== 'crouch') b.classList.remove('on');
      }
    };
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
  }

  // 毎フレーム：見る向きの変化と、キャラクターへの入力を作る
  poll(f, camCtl, dt) {
    const s = this.settings, inp = f.input, T = this.touch;
    const sens = (s.sens || 1) * 0.0022 * (f.adsK > 0.5 ? (s.adsSens || 0.75) : 1) * (camCtl.fov / 78);
    const inv = s.invertY ? -1 : 1;
    let dyaw = 0, dpitch = 0;
    dyaw -= this.mouse.dx * sens; dpitch -= this.mouse.dy * sens * inv;
    this.mouse.dx = this.mouse.dy = 0;
    // タッチ
    const tsens = (s.touchSens || 1) * 0.0045 * (camCtl.fov / 78);
    dyaw -= T.lookDx * tsens; dpitch -= T.lookDy * tsens * inv; T.lookDx = T.lookDy = 0;
    let mx = 0, mz = 0;
    if (this.key('fwd')) mz += 1; if (this.key('back')) mz -= 1; if (this.key('left')) mx -= 1; if (this.key('right')) mx += 1;
    if (T.move.id != null) {
      const dx = (T.move.x - T.move.ox) / 56, dy = (T.move.y - T.move.oy) / 56;
      mx += Math.max(-1, Math.min(1, dx)); mz -= Math.max(-1, Math.min(1, dy));
    }
    let fire = this.mouse.left || T.fire, firePressed = this.mouse.leftPressed || T.firePressed, fireReleased = this.mouse.leftReleased || T.fireReleased;
    let ads = this.mouse.right || T.ads, jump = this.hit('jump') || T.btn.has('jump'), crouch = this.key('crouch') || !!T.crouch;
    let skill = this.hit('skill') || T.btn.has('skill'), heal = this.hit('heal') || T.btn.has('heal'), reload = this.hit('reload') || T.btn.has('reload');
    let slot = this.hit('s1') ? 0 : this.hit('s2') ? 1 : this.hit('s3') ? 2 : -1, cycle = this.mouse.wheel;
    if (this.hit('quick')) slot = this.lastSlot;
    if (T.btn.has('slot0')) slot = 0; if (T.btn.has('slot1')) slot = 1; if (T.btn.has('slot2')) slot = 2;
    // ゲームパッド
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = (i) => Math.abs(gp.axes[i] || 0) > 0.15 ? gp.axes[i] : 0;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed, bp = (i) => b(i) && !this.padPrev[i];
      mx += ax(0); mz -= ax(1);
      const gs = (s.padSens || 1) * 2.6 * dt * (camCtl.fov / 78) * (f.adsK > 0.5 ? 0.6 : 1);
      dyaw -= ax(2) * Math.abs(ax(2)) * gs; dpitch -= ax(3) * Math.abs(ax(3)) * gs * inv;
      fire = fire || b(7); firePressed = firePressed || bp(7); fireReleased = fireReleased || (!b(7) && this.padPrev[7]);
      ads = ads || b(6); jump = jump || bp(0); crouch = crouch || b(1); reload = reload || bp(2); skill = skill || bp(4); heal = heal || bp(5);
      if (bp(3)) cycle = 1;
      if (bp(12)) slot = 0; if (bp(15)) slot = 1; if (bp(13)) slot = 2;
      if (bp(9) && this.onPause) this.onPause();
      this.padBoard = b(8);
      this.padPrev = gp.buttons.map(x => x.pressed);
      break;
    }
    camCtl.yaw += dyaw;
    camCtl.pitch = Math.max(-1.35, Math.min(1.25, camCtl.pitch + dpitch));
    // キャラクターは画面の向きを向く
    f.yaw = camCtl.yaw; f.pitch = camCtl.pitch;
    inp.mx = Math.max(-1, Math.min(1, mx)); inp.mz = Math.max(-1, Math.min(1, mz));
    inp.fire = fire; inp.firePressed = inp.firePressed || firePressed; inp.fireReleased = fireReleased; inp.ads = ads;
    inp.jump = inp.jump || jump; inp.crouch = crouch; inp.skill = inp.skill || skill; inp.heal = inp.heal || heal; inp.reload = inp.reload || reload;
    if (slot >= 0) { if (slot !== f.slot) this.lastSlot = f.slot; inp.slot = slot; }
    if (cycle) { this.lastSlot = f.slot; inp.cycle = cycle; }
    this.mouse.leftPressed = this.mouse.leftReleased = false; this.mouse.wheel = 0;
    T.firePressed = T.fireReleased = false; T.btn.clear();
    this.pressed.clear();
  }

  board() { return this.key('board') || !!this.padBoard; }
  clearFrame() { this.pressed.clear(); this.mouse.dx = this.mouse.dy = 0; this.mouse.leftPressed = this.mouse.leftReleased = false; this.mouse.wheel = 0; this.touch.lookDx = this.touch.lookDy = 0; this.touch.btn.clear(); }
}
