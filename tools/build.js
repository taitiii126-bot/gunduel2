// 公開用のファイルを dist/ に作る（コメントを消し、名前と文字列を読みにくくする）。
// 使い方：npm i --no-save javascript-obfuscator && node tools/build.js
// ゲームの動きは変えない。重くなる変換（制御の流れの書き換えなど）は使わない
const fs = require('fs'), path = require('path');
const JO = require('javascript-obfuscator');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist');
// 毎日ちがう形にする（日付＝シンガポール時間から種を決める）。BUILD_SEED で指定もできる
const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const seed = process.env.BUILD_SEED || day;
let seedNum = 0;
for (const ch of seed) seedNum = (seedNum * 31 + ch.charCodeAt(0)) >>> 0;
const opts = {
  seed: seedNum, compact: true, target: 'browser',
  // 開発者ツールを開くと、止まる命令（debugger）がくり返し動いて、ブレークポイントでの書き換えをやりにくくする
  debugProtection: true, debugProtectionInterval: 2000,
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false,   // HTML の onclick などから呼ぶ名前は残す
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75, rotateStringArray: true, shuffleStringArray: true,
  splitStrings: false, controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false,
  transformObjectKeys: false, unicodeEscapeSequence: false, numbersToExpressions: false, simplify: true,
};
const ob = (code, extra) => JO.obfuscate(code, Object.assign({}, opts, extra || {})).getObfuscatedCode();
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
// sim.js はサーバーと同じ物。プロパティ名（SIM.xxx）は変えずに中身だけ読みにくくする
for (const f of ['sim.js', 'lang.js']) fs.writeFileSync(path.join(out, f), ob(fs.readFileSync(path.join(root, f), 'utf8')));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// 画面のボタンから呼ぶ関数は、関数の名前（f.name）で window に出しているので、その名前だけは変えない
const keep = [];
html.replace(/\n\[([\w\s,]+)\]\.forEach\(function\(f\)\{window\[f\.name\]/g, (m, list) => { keep.push(...list.split(',').map(x => x.trim()).filter(Boolean)); return m; });
if (!keep.length) throw new Error('外に出す関数の一覧が見つかりません');
html = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => '<script>' + ob(code, { reservedNames: keep.map(n => '^' + n + '$') }).replace(/<\/script/gi, '<\\/script') + '</script>');
html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');   // HTML のコメントも消す
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of fs.readdirSync(root)) if (/\.(png|jpg|jpeg|gif|svg|ico|webp|mp3|ogg|wav|woff2?|json|txt|webmanifest)$/i.test(f) && f !== 'users.json' && f !== 'package.json') fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log('dist/ を作りました（' + seed + '）：', fs.readdirSync(out).join(', '));
