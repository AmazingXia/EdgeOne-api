/** POST /proxy — 根据 body 中的 url/method/headers/data 代为请求并返回结果（CORS 由入口全局中间件处理） */
export async function proxy(ctx) {
  const body = ctx.request.body || {};
  const { url, method = 'GET', headers = {}, data } = body;

  if (!url) {
    ctx.status = 400;
    ctx.body = 'Missing "url" field in request body.';
    return;
  }

  try {
    const fetchOptions = {
      method: (method || 'GET').toUpperCase(),
      headers: headers && typeof headers === 'object' ? new Headers(headers) : undefined,
      body: ['POST', 'PUT', 'PATCH'].includes((method || 'GET').toUpperCase()) && data != null
        ? (typeof data === 'string' ? data : JSON.stringify(data))
        : undefined,
    };

    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type') || '';

    const result = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    ctx.status = response.status;
    ctx.set('Content-Type', contentType);
    ctx.body = result;
  } catch (e) {
    ctx.status = 500;
    ctx.body = `Proxy error: ${e.message}`;
  }
}
