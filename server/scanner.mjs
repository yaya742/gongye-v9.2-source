/* 共页 · 病毒扫描（ClamAV clamd）
 *
 * 用 clamd 的 INSTREAM 协议把文件内容发过去扫描，零依赖。
 * 配置：CLAMD_HOST + CLAMD_PORT（默认 3310），或 CLAMD_SOCKET（Unix 套接字）。
 * 没有配置时不扫描；配置了但连不上时由调用方拒绝上传（宁可失败，不放过）。
 */

import net from 'node:net';

const CHUNK = 64 * 1024;

export function createScanner({ host = '', port = 3310, socket = '', timeoutMs = 30_000 } = {}) {
  if (!host && !socket) return null;
  const describe = socket ? `clamd（${socket}）` : `clamd（${host}:${port}）`;

  /** 返回 { clean: true } 或 { clean: false, signature }；连不上、超时或回复异常时抛错 */
  function scan(bytes) {
    return new Promise((resolve, reject) => {
      const conn = socket ? net.createConnection(socket) : net.createConnection({ host, port: Number(port) });
      let reply = '';
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.destroy();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('病毒扫描超时'))), timeoutMs);

      const parse = () => {
        const text = reply.replace(/\0/g, '').trim();
        if (/:\s*OK$/.test(text)) return finish(() => resolve({ clean: true }));
        const found = text.match(/:\s*(.+?)\s+FOUND$/);
        if (found) return finish(() => resolve({ clean: false, signature: found[1] }));
        return finish(() => reject(new Error(`病毒扫描服务返回异常：${text.slice(0, 120)}`)));
      };

      conn.on('error', (error) => finish(() => reject(error)));
      conn.on('data', (chunk) => {
        reply += chunk.toString('utf8');
        if (reply.includes('\0')) parse();
      });
      conn.on('end', () => parse());
      conn.on('connect', () => {
        conn.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const part = bytes.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          conn.write(size);
          conn.write(part);
        }
        // 长度为 0 的块表示文件结束
        conn.write(Buffer.alloc(4));
      });
    });
  }

  return { describe, scan };
}

export function scannerFromEnv(env = process.env) {
  return createScanner({
    host: env.CLAMD_HOST || '',
    port: env.CLAMD_PORT || 3310,
    socket: env.CLAMD_SOCKET || ''
  });
}
