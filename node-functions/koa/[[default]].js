import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { WebSocketServer } from 'ws';
import { curlProxy } from './curlProxy.js';
import { proxy } from './proxy.js';
import { handleTunnel } from './tunnel.js';
import { handleHttpStream } from './httpStream.js';

const app = new Koa();
const router = new Router();

// 解析 JSON body（POST /curl 需要）
app.use(bodyParser());

// 跨域：所有响应带上 CORS 头，OPTIONS 预检直接 204
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
app.use(async (ctx, next) => {
  ctx.set(corsHeaders);
  if (ctx.method === 'OPTIONS') {
    ctx.status = 204;
    return;
  }
  await next();
});

// 请求日志中间件
app.use(async (ctx, next) => {
  const start = Date.now();
  console.log(`\n📥 [${new Date().toISOString()}] ${ctx.method} ${ctx.path}`);
  console.log('📋 Query:', ctx.query);
  console.log('📋 Headers:', {
    'content-type': ctx.headers['content-type'],
    'content-length': ctx.headers['content-length']
  });

  await next();

  const ms = Date.now() - start;
  console.log(`📤 [${ctx.status}] 响应时间: ${ms}ms`);
  ctx.set('X-Response-Time', `${ms}ms`);
});

// Error handling middleware - 增强错误处理和调试信息
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const status = err.status || 500;
    ctx.status = status;

    console.error('\n❌ 错误发生:');
    console.error('📍 路径:', ctx.method, ctx.path);
    console.error('📋 错误消息:', err.message);
    console.error('📋 错误堆栈:', err.stack);
    console.error('📋 请求体:', ctx.request.body);
    console.error('📋 Query:', ctx.query);

    ctx.body = {
      error: err.message || 'Internal Server Error',
      status: status,
      stack: err.stack,
      path: ctx.path,
      method: ctx.method,
      timestamp: new Date().toISOString()
    };

    ctx.app.emit('error', err, ctx);
  }
});

app.on('error', (err, ctx) => {
  console.error('🚨 应用级错误:', err.message);
  console.error('📍 上下文:', {
    method: ctx.method,
    path: ctx.path,
    status: ctx.status
  });
});

// 路由：POST /curl — 解析前端传来的 curl 字符串并代为请求，返回结果
router.post('/curl', curlProxy);
// 路由：/proxy — 根据 body 的 url/method/headers/data 代为请求
router.post('/proxy', proxy);
// 代理诊断（与 proxy-local 配合时可用）
router.get('/vpn/test', (ctx) => {
  const host = ctx.query.host || 'github.com';
  const port = parseInt(ctx.query.port || '443', 10);
  ctx.body = { host, port, message: 'Use WebSocket /vpn/tunnel for proxy. GET /vpn/test is OK.' };
});

app.use(router.routes()).use(router.allowedMethods());

const koaCallback = app.callback();

// WebSocket 代理：/vpn/tunnel（TCP 隧道）、/vpn/http-stream（流式 HTTP）
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, req) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const searchParams = new URL(req.url || '/', 'http://localhost').searchParams;

  if (pathname.endsWith('/tunnel')) {
    handleTunnel(ws, searchParams);
  } else if (pathname.endsWith('/http-stream')) {
    handleHttpStream(ws);
  } else {
    ws.close(4000, 'Unknown path');
  }
});

/**
 * 统一入口：优先处理 WebSocket Upgrade，否则走 Koa
 * EdgeOne 以 (req, res) 调用 default 时，Upgrade 请求走代理隧道，其余走 Koa 路由
 */
function handler(req, res) {
  if (req.headers.upgrade === 'websocket') {
    const head = Buffer.alloc(0);
    wss.handleUpgrade(req, req.socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return;
  }
  koaCallback(req, res);
}

export default handler;
