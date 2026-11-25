// 描画のしくみ：WebGL2（GPU）のレンダラー、HDR の後処理（ブルーム・AO・色の調整・ビネット）、画質の段階、解像度の自動調整
import * as THREE from '../lib/three.js';
import { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, GTAOPass } from '../lib/three.js';

export const QUALITY = {
  low:    { id: 'low',    ratio: 0.85, shadow: 1024, soft: false, post: false, bloom: false, msaa: 0, ao: false, particles: 0.45, decor: 0.5, shadowChars: true },
  medium: { id: 'medium', ratio: 1.15, shadow: 2048, soft: true,  post: true,  bloom: true,  msaa: 2, ao: false, particles: 0.75, decor: 0.8, shadowChars: true },
  high:   { id: 'high',   ratio: 1.6,  shadow: 2048, soft: true,  post: true,  bloom: true,  msaa: 4, ao: false, particles: 1, decor: 1, shadowChars: true },
  ultra:  { id: 'ultra',  ratio: 2.0,  shadow: 4096, soft: true,  post: true,  bloom: true,  msaa: 4, ao: true,  particles: 1.25, decor: 1, shadowChars: true },
};
export const QUALITY_IDS = ['low', 'medium', 'high', 'ultra'];

// 色の調整・ビネット・色収差・ダメージの赤・低い体力のモノクロ・フィルムの粒（HDR のまま、トーンマップの前にかける）
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.32 }, uChroma: { value: 0 }, uDamage: { value: 0 }, uLow: { value: 0 }, uFlash: { value: 0 },
    uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uTint: { value: new THREE.Color(1, 1, 1) }, uGrain: { value: 0.025 }, uHeal: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime,uVignette,uChroma,uDamage,uLow,uFlash,uSat,uContrast,uGrain,uHeal; uniform vec2 uRes; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c,c);
      vec3 col;
      if (uChroma > 0.0005) {
        vec2 off = c * uChroma * (0.6 + r2*2.0);
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else col = texture2D(tDiffuse, vUv).rgb;
      col *= uTint;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uLow*0.75));
      col = (col - 0.18) * uContrast + 0.18; col = max(col, 0.0);
      float vig = smoothstep(0.85, 0.18, r2 * (1.0 + uVignette*1.4));
      col *= mix(1.0, vig, uVignette + uDamage*0.4 + uLow*0.35);
      // ダメージ：画面の端が赤く
      float edge = smoothstep(0.08, 0.36, r2);
      col = mix(col, col*0.35 + vec3(0.55,0.02,0.03)*(0.6+l), edge * clamp(uDamage,0.0,1.0) * 0.85);
      col = mix(col, col*0.5 + vec3(0.25,0.0,0.0), edge * uLow * (0.55 + 0.45*sin(uTime*7.0)));
      // 回復：端が緑に光る
      col += vec3(0.1,0.9,0.5) * edge * uHeal * 0.6;
      col += vec3(uFlash);
      col += (hash(vUv*uRes) - 0.5) * uGrain * (0.4 + l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Gfx {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.gl = r.getContext();
    this.gpu = Gfx.gpuName(this.gl);
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 1400);
    this.dyn = 1;               // 解像度の自動調整（0.55〜1）
    this.ft = 1 / 60;           // なめらかにした1フレームの時間
    this.dynTimer = 0;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.setQuality(settings.quality || Gfx.autoQuality(this.gpu, this.isMobile));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static gpuName(gl) {
    try {
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      const s = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return String(s || 'WebGL2').replace(/^ANGLE \((.*)\)$/, '$1');
    } catch (e) { return 'WebGL2'; }
  }
  // GPU の名前から、はじめの画質を決める（あとで設定から変えられる）
  static autoQuality(gpu, mobile) {
    const g = (gpu || '').toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(g)) return 'low';
    if (mobile) return /apple gpu|adreno \(tm\) 7|mali-g7|mali-g6[18]|xclipse/.test(g) ? 'medium' : 'low';
    if (/rtx|radeon rx|geforce gtx 1[06-9]|geforce gtx 16|rx 6|rx 7|apple m[1-9] (pro|max|ultra)|arc a/.test(g)) return 'ultra';
    if (/nvidia|geforce|radeon|apple m|apple gpu/.test(g)) return 'high';
    return 'medium';
  }

  setQuality(id) {
    const q = this.q = QUALITY[id] || QUALITY.medium;
    this.qid = q.id;
    const r = this.renderer;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.needsUpdate = true;
    this.buildComposer();
    if (this.sun) this.applySunShadow(this.sun);
    this.resize();
    // 影の形式が変わったので、材質を作り直してもらう
    this.scene.traverse(o => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach(x => { x.needsUpdate = true; }); } });
  }

  buildComposer() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    const q = this.q;
    if (!q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    const c = this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);
    if (q.ao) {
      this.aoPass = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.aoPass.output = GTAOPass.OUTPUT.Default;
      this.aoPass.blendIntensity = 0.9;
      this.aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      c.addPass(this.aoPass);
    } else this.aoPass = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.62, 0.48, 0.82);
      c.addPass(this.bloom);
    } else this.bloom = null;
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    c.addPass(new OutputPass());
  }

  // 画面の大きさが変わった・画質が変わった
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const base = Math.min(window.devicePixelRatio || 1, this.q.ratio) * (this.settings.resScale || 1);
    const pr = Math.max(0.45, base * this.dyn);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.grade) this.grade.uniforms.uRes.value.set(w * pr, h * pr);
    }
    this.pr = pr;
  }

  // 1フレームの時間を見て、重ければ解像度を下げ、軽ければ戻す
  adapt(dt) {
    if (!this.settings.dynRes) { if (this.dyn !== 1) { this.dyn = 1; this.resize(); } return; }
    this.ft = this.ft * 0.94 + dt * 0.06;
    this.dynTimer += dt;
    const target = 1 / 58;
    if (this.dynTimer > 1.0 && this.ft > target * 1.22 && this.dyn > 0.56) { this.dyn = Math.max(0.55, this.dyn - 0.08); this.dynTimer = 0; this.resize(); }
    else if (this.dynTimer > 3.0 && this.ft < target * 0.86 && this.dyn < 1) { this.dyn = Math.min(1, this.dyn + 0.05); this.dynTimer = 0; this.resize(); }
  }

  // 太陽（影を落とす光）を登録。影の範囲はステージに合わせる
  setSun(light, extent) {
    this.sun = light; this.sunExtent = extent || 34;
    this.applySunShadow(light);
  }
  applySunShadow(light) {
    const q = this.q, e = this.sunExtent;
    light.castShadow = true;
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    light.shadow.mapSize.set(q.shadow, q.shadow);
    const c = light.shadow.camera;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
    light.shadow.bias = -0.00025;
    light.shadow.normalBias = q.shadow >= 4096 ? 0.018 : 0.03;
    light.shadow.radius = q.soft ? 3 : 1;
  }

  // 空の場面から、映り込み・環境光の元になる環境マップを作る（GPU でぼかした PMREM）
  bakeEnvironment(envScene) {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 400);
    this.scene.environment = this.envRT.texture;
    return this.envRT.texture;
  }

  render(fx) {
    const r = this.renderer;
    r.info.reset();
    if (this.composer) {
      const u = this.grade.uniforms;
      u.uTime.value = fx.time;
      u.uChroma.value = fx.chroma; u.uDamage.value = fx.damage; u.uLow.value = fx.low; u.uFlash.value = fx.flash;
      u.uVignette.value = fx.vignette; u.uSat.value = fx.sat; u.uContrast.value = fx.contrast; u.uHeal.value = fx.heal || 0;
      u.uTint.value.copy(fx.tint);
      if (this.bloom) { this.bloom.strength = fx.bloom; this.bloom.threshold = fx.bloomThreshold; this.bloom.radius = fx.bloomRadius; }
      this.renderPass.scene = this.scene; this.renderPass.camera = this.camera;
      if (this.aoPass) { this.aoPass.scene = this.scene; this.aoPass.camera = this.camera; }
      this.composer.render();
    } else {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
    }
  }

  // 武器のアイコンなどを作る：小さな場面を絵にして、データURLにする
  snapshot(scene, camera, w, h) {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    const prevTM = r.toneMapping, prevTarget = r.getRenderTarget();
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(prevTarget);
    r.toneMapping = prevTM;
    rt.dispose();
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
    // 描いた色は明るさがそのまま（リニア）なので、画面用の色（sRGB）に直す。上下も逆に（WebGL は下から）
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        const a = buf[src + x + 3];
        img.data[dst + x] = lut[buf[src + x]]; img.data[dst + x + 1] = lut[buf[src + x + 1]]; img.data[dst + x + 2] = lut[buf[src + x + 2]]; img.data[dst + x + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
}
