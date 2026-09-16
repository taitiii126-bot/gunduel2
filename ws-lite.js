'use strict';
// 依存パッケージなしの最小 WebSocket サーバー（RFC 6455 / テキストフレームのみ）
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 16 * 1024;       // 1メッセージの上限（ゲームの入力は100バイト程度）
const MAX_BACKLOG = 512 * 1024;      // 送信が詰まったクライアントは切断

class Socket extends EventEmitter {
  constructor(sock, ip) {
    super();
    this.sock = sock; this.ip = ip;
    this.buf = Buffer.alloc(0); this.frags = []; this.fragLen = 0;
    this.open = true; this.alive = true; this._done = false;
    sock.setNoDelay(true);
    sock.on('data', d => this._onData(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f;
      if (!(b1 & 0x80)) return this.destroy();          // クライアントからのフレームは必ずマスクされる
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.destroy();
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (len > MAX_PAYLOAD) return this.destroy();
      if (this.buf.length < off + 4 + len) return;      // フレームの残りを待つ
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (op === 0x8) return this.close();                // close
      if (op === 0x9) { this._send(0xA, data); continue; } // ping → pong
      if (op === 0xA) { this.alive = true; continue; }      // pong
      if (op !== 0x1 && op !== 0x0) return this.destroy(); // バイナリ等は非対応
      this.frags.push(data); this.fragLen += len;
      if (this.fragLen > MAX_PAYLOAD) return this.destroy();
      if (fin) {
        const msg = Buffer.concat(this.frags).toString('utf8');
        this.frags = []; this.fragLen = 0;
        this.emit('message', msg);
      }
    }
  }

  _send(op, payload) {
    if (!this.open || this.sock.destroyed) return;
    if (this.sock.writableLength > MAX_BACKLOG) return this.destroy();
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(len, 6); }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(text) { this._send(0x1, Buffer.from(text, 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return;
    this._send(0x8, Buffer.from([0x03, 0xe8]));           // 1000: normal closure
    this.open = false;
    this.sock.end();
    setTimeout(() => this.sock.destroy(), 2000).unref();
    this._closed();
  }
  destroy() { this.open = false; this.sock.destroy(); this._closed(); }
  _closed() {
    if (this._done) return;
    this._done = true; this.open = false;
    this.emit('close');
  }
}

// 接続元IP。Railwayなどのプロキシの後ろでは、プロキシが付けたヘッダーを使う
// （プロキシがない環境でヘッダーを信用すると、IPを偽装されて制限をすり抜けられるため）
const TRUST_PROXY = process.env.TRUST_PROXY === '1' ||
  !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);
function clientIp(req) {
  if (TRUST_PROXY) {
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return String(req.socket.remoteAddress || '');
}

// http.Server に WebSocket のアップグレード処理を取り付ける
function attach(server, onConnection, { checkOrigin } = {}) {
  server.on('upgrade', (req, sock, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') {
      sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    if (checkOrigin && !checkOrigin(req.headers.origin || '')) {
      sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const ip = clientIp(req);
    const ws = new Socket(sock, ip);
    onConnection(ws, req);
    if (head && head.length) ws._onData(head);
  });
}

module.exports = { attach, clientIp };
