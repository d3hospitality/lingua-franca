import { defineConfig } from 'vite'
import { WebSocket as NodeWebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import type { Duplex } from 'stream'

// ═══════════════════════════════════════════════════════════════════
// Vite WebSocket Proxy for Smallest.ai Pulse STT
// Browser WebSocket can't set Authorization headers, so we proxy:
//   browser → ws://localhost:5173/pulse-proxy → wss://api.smallest.ai
// The proxy reads the API key from the query string and sets the
// proper Authorization: Bearer header on the upstream connection.
// ═══════════════════════════════════════════════════════════════════

const PULSE_UPSTREAM = 'wss://api.smallest.ai/waves/v1/pulse/get_text';

export default defineConfig({
  base: '/lingua-franca/',
  plugins: [
    {
      name: 'pulse-ws-proxy',
      configureServer(server) {
        server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
          const url = new URL(req.url || '', `http://${req.headers.host}`);

          // Only intercept /pulse-proxy paths
          if (!url.pathname.endsWith('/pulse-proxy')) return;

          // Extract API key and audio params from query
          const token = url.searchParams.get('token');
          if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Build upstream URL with audio params (no token in URL)
          const upstreamParams = new URLSearchParams();
          for (const [k, v] of url.searchParams) {
            if (k !== 'token') upstreamParams.set(k, v);
          }
          const upstreamUrl = `${PULSE_UPSTREAM}?${upstreamParams.toString()}`;

          // Connect to Smallest.ai with proper Authorization header
          const upstream = new NodeWebSocket(upstreamUrl, {
            headers: { 'Authorization': `Bearer ${token}` },
          });

          // We need to handle the WebSocket upgrade ourselves
          // Accept the browser's WebSocket handshake
          const key = req.headers['sec-websocket-key'];
          const magic = '258EAFA5-E914-47DA-95CA-5AB5A0085533';
          const crypto = require('crypto');
          const accept = crypto.createHash('sha1').update(key + magic).digest('base64');

          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            '\r\n'
          );

          // Now we have a raw TCP socket from the browser.
          // Use a minimal WebSocket frame parser to relay between browser ↔ upstream.

          let upstreamReady = false;
          let pendingFrames: Buffer[] = [];

          upstream.on('open', () => {
            upstreamReady = true;
            // Flush any buffered frames
            for (const frame of pendingFrames) {
              upstream.send(frame);
            }
            pendingFrames = [];
          });

          // Browser → upstream: parse WebSocket frames from raw socket
          socket.on('data', (data: Buffer) => {
            // Parse WebSocket frame(s) from the raw TCP data
            let offset = 0;
            while (offset < data.length) {
              if (data.length - offset < 2) break;

              const byte1 = data[offset];
              const byte2 = data[offset + 1];
              const masked = (byte2 & 0x80) !== 0;
              let payloadLen = byte2 & 0x7f;
              let headerLen = 2;

              if (payloadLen === 126) {
                if (data.length - offset < 4) break;
                payloadLen = data.readUInt16BE(offset + 2);
                headerLen = 4;
              } else if (payloadLen === 127) {
                if (data.length - offset < 10) break;
                payloadLen = Number(data.readBigUInt64BE(offset + 2));
                headerLen = 10;
              }

              if (masked) headerLen += 4;
              const totalLen = headerLen + payloadLen;
              if (data.length - offset < totalLen) break;

              const opcode = byte1 & 0x0f;

              // Extract and unmask payload
              let payload = data.slice(offset + headerLen, offset + totalLen);
              if (masked) {
                const maskKey = data.slice(offset + headerLen - 4, offset + headerLen);
                payload = Buffer.from(payload);
                for (let i = 0; i < payload.length; i++) {
                  payload[i] ^= maskKey[i % 4];
                }
              }

              if (opcode === 0x08) {
                // Close frame
                upstream.close();
                socket.end();
                return;
              } else if (opcode === 0x09) {
                // Ping — send pong back to browser
                const pong = Buffer.alloc(2);
                pong[0] = 0x8a; // fin + pong
                pong[1] = 0;
                socket.write(pong);
              } else if (opcode === 0x01 || opcode === 0x02) {
                // Text or binary — relay to upstream
                if (upstreamReady) {
                  upstream.send(payload);
                } else {
                  pendingFrames.push(Buffer.from(payload));
                }
              }

              offset += totalLen;
            }
          });

          // Upstream → browser: frame and send to raw socket
          upstream.on('message', (data: Buffer | string, isBinary: boolean) => {
            try {
              const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
              const opcode = isBinary ? 0x02 : 0x01;
              const frame = encodeWebSocketFrame(opcode, payload);
              socket.write(frame);
            } catch { /* socket closed */ }
          });

          upstream.on('close', () => {
            try {
              const frame = encodeWebSocketFrame(0x08, Buffer.alloc(0));
              socket.write(frame);
              socket.end();
            } catch { /* already closed */ }
          });

          upstream.on('error', (err) => {
            console.error('[pulse-proxy] upstream error:', err.message);
            socket.destroy();
          });

          socket.on('close', () => {
            upstream.close();
          });

          socket.on('error', () => {
            upstream.close();
          });
        });

        console.log('\n  ⚡ Pulse STT proxy active at /pulse-proxy\n');
      },
    },
  ],
})

/** Encode a WebSocket frame (server → client, unmasked) */
function encodeWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}
