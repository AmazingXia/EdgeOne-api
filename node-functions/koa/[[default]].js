import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { curlProxy } from './curlProxy.js';
import { cursorOpenaiProxy } from './cursorOpenaiProxy.js';
import { proxy } from './proxy.js';

// Create Koa application
const app = new Koa();
const router = new Router();

// 解析 JSON body（POST /curl 需要）
app.use(bodyParser());

// 跨域：所有响应带上 CORS 头，OPTIONS 预检直接 204
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

    // 输出详细错误信息
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

// 全局错误监听器
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

// 路由：EdgeOne 上的 OpenAI 兼容代理
router.all(/^\/v1(?:\/.*)?$/, cursorOpenaiProxy);

// Use router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Export handler
export default app;
