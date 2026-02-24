import net from 'net';

/**
 * 处理 WebSocket 隧道：与目标主机建立 TCP 连接，双向转发数据（HTTPS CONNECT 用）
 * 协议：先发 tunnel-ready，失败发 tunnel-error:xxx
 */
export function handleTunnel(ws, params) {
  const host = params.get('host');
  const port = parseInt(params.get('port') || '443', 10);

  if (!host) {
    ws.close(4001, 'Missing host');
    return;
  }

  console.log(`[Tunnel] ${host}:${port}`);

  const socket = net.createConnection({ host, port }, () => {
    try {
      ws.send('tunnel-ready');
    } catch (e) {
      socket.destroy();
    }
  });

  socket.on('error', (err) => {
    console.error(`[Tunnel] connect failed ${host}:${port}:`, err.message);
    try {
      ws.send('tunnel-error:' + err.message);
    } catch (_) {}
    ws.close(4002, 'Connection failed');
  });

  socket.on('data', (chunk) => {
    if (ws.readyState === 1) {
      try {
        ws.send(chunk);
      } catch (e) {
        socket.destroy();
      }
    }
  });

  socket.on('close', () => {
    try { ws.close(1000, 'done'); } catch (_) {}
  });

  ws.on('message', (data) => {
    if (!socket.destroyed) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const ok = socket.write(buf);
      if (!ok) {
        ws._socket?.pause();
        socket.once('drain', () => ws._socket?.resume());
      }
    }
  });

  ws.on('close', () => socket.destroy());
  ws.on('error', () => socket.destroy());
}
