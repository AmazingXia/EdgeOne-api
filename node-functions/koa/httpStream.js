import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * 流式 HTTP 转发：协议与 proxy-local 一致
 * 收：request-meta → body chunks → request-end
 * 发：response-meta → body chunks → close
 */
export function handleHttpStream(ws) {
  let proxyReq = null;
  let meta = null;

  ws.on('message', (data) => {
    const raw = data;
    const isText = typeof raw === 'string';

    if (!meta && isText) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'request-meta') {
          meta = msg;
          startRequest(ws, meta);
          return;
        }
      } catch (e) {}
      return;
    }

    if (isText) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'request-end') {
          if (proxyReq && !proxyReq.destroyed) proxyReq.end();
          return;
        }
      } catch (e) {}
    }

    if (proxyReq && !proxyReq.destroyed) {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      proxyReq.write(buf);
    }
  });

  ws.on('close', () => {
    if (proxyReq && !proxyReq.destroyed) proxyReq.destroy();
  });
  ws.on('error', () => {
    if (proxyReq && !proxyReq.destroyed) proxyReq.destroy();
  });

  function startRequest(ws, { method, url, headers }) {
    console.log(`[HTTP-Stream] ${method} ${url}`);

    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const cleanHeaders = { ...headers };
    delete cleanHeaders['proxy-connection'];
    delete cleanHeaders['proxy-authorization'];
    delete cleanHeaders['transfer-encoding'];
    cleanHeaders.host = parsedUrl.host;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: cleanHeaders,
    };

    proxyReq = transport.request(options, (proxyRes) => {
      try {
        ws.send(
          JSON.stringify({
            type: 'response-meta',
            statusCode: proxyRes.statusCode,
            headers: proxyRes.headers,
          })
        );
      } catch (e) {
        proxyRes.destroy();
        return;
      }

      proxyRes.on('data', (chunk) => {
        if (ws.readyState === 1) {
          try {
            ws.send(chunk);
          } catch (e) {
            proxyRes.destroy();
          }
        }
      });

      proxyRes.on('end', () => {
        try { ws.close(); } catch (_) {}
      });
      proxyRes.on('error', (err) => {
        console.error(`[HTTP-Stream] response error ${url}:`, err.message);
        try { ws.close(); } catch (_) {}
      });
    });

    proxyReq.on('error', (err) => {
      console.error(`[HTTP-Stream] request error ${url}:`, err.message);
      try {
        ws.send(
          JSON.stringify({
            type: 'response-meta',
            statusCode: 502,
            headers: { 'content-type': 'text/plain' },
          })
        );
        ws.send(Buffer.from('请求失败: ' + err.message));
        ws.close();
      } catch (_) {}
    });
  }
}
