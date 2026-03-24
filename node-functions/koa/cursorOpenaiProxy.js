import { Readable } from "stream";

const PROXY_CONFIG = {
  upstreamBaseUrl: "https://api.asxs.top/v1",
  fixedModel: "gpt-5.4",
  fixedReasoningEffort: "xhigh",
  passAuthorization: false,
  fixedAuthorization: "Bearer sk-4234341ca993c7b4b47d5ebf9e54175c",
  verbose: true,
};

function log(event, extra = undefined) {
  const timestamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[edge-openai-proxy] ${timestamp} ${event}`);
    return;
  }
  try {
    console.log(`[edge-openai-proxy] ${timestamp} ${event}`, extra);
  } catch {
    console.log(`[edge-openai-proxy] ${timestamp} ${event}`);
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function joinUrlPath(left, right) {
  const normalizedLeft = left.endsWith("/") ? left.slice(0, -1) : left;
  const normalizedRight = right.startsWith("/") ? right : `/${right}`;
  return `${normalizedLeft}${normalizedRight}`;
}

function buildUpstreamUrl(baseUrl, requestUrl) {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const incoming = new URL(requestUrl, "https://edgeone.local");
  let pathname = incoming.pathname;

  if (base.pathname === "/v1" && pathname.startsWith("/v1/")) {
    pathname = pathname.slice(3);
  } else if (base.pathname && base.pathname !== "/" && pathname.startsWith(`${base.pathname}/`)) {
    pathname = pathname.slice(base.pathname.length);
  }

  const target = new URL(base.toString());
  target.pathname = joinUrlPath(base.pathname === "/" ? "" : base.pathname, pathname);
  target.search = incoming.search;
  return target.toString();
}

function buildFixedModelRewrite(modelName) {
  const originalModel = typeof modelName === "string" && modelName.trim() ? modelName.trim() : "(missing)";
  return {
    originalModel,
    upstreamModel: PROXY_CONFIG.fixedModel,
    reasoningEffort: PROXY_CONFIG.fixedReasoningEffort,
    changed: originalModel !== PROXY_CONFIG.fixedModel || PROXY_CONFIG.fixedReasoningEffort !== null,
  };
}

function toLoggableModelRewrite(rewrite) {
  if (!rewrite.changed) return rewrite.originalModel;
  const parts = [`${rewrite.originalModel} -> ${rewrite.upstreamModel}`];
  if (rewrite.reasoningEffort) {
    parts.push(`reasoning=${rewrite.reasoningEffort}`);
  }
  return parts.join(" ");
}

function summarizePayload(pathname, payload) {
  if (!payload || typeof payload !== "object") {
    return "payload=(unparsed)";
  }

  const summary = [];
  summary.push(`model=${typeof payload.model === "string" ? payload.model : "(missing)"}`);

  if (pathname.endsWith("/responses")) {
    summary.push(`stream=${payload.stream === true}`);
    summary.push(`store=${payload.store === true}`);
    if (payload.reasoning?.effort) {
      summary.push(`reasoning=${payload.reasoning.effort}`);
    }
    if (Array.isArray(payload.tools)) {
      summary.push(`tools=${payload.tools.length}`);
    }
    if (Array.isArray(payload.input)) {
      summary.push(`inputItems=${payload.input.length}`);
    } else if (typeof payload.input === "string") {
      summary.push(`inputChars=${payload.input.length}`);
    }
  } else if (pathname.endsWith("/chat/completions")) {
    summary.push(`stream=${payload.stream === true}`);
    if (Array.isArray(payload.messages)) {
      summary.push(`messages=${payload.messages.length}`);
    }
    if (Array.isArray(payload.tools)) {
      summary.push(`tools=${payload.tools.length}`);
    }
    if (payload.reasoning?.effort) {
      summary.push(`reasoning=${payload.reasoning.effort}`);
    }
  }

  return summary.join(" ");
}

function canRewriteJsonRequest(method, pathname, contentType) {
  if (!["POST", "PUT", "PATCH"].includes(method)) return false;
  if (!String(contentType || "").toLowerCase().includes("application/json")) return false;
  return pathname.endsWith("/responses") || pathname.endsWith("/chat/completions");
}

function rewriteRequestBody(method, pathname, contentType, bodyBuffer) {
  if (!canRewriteJsonRequest(method, pathname, contentType) || bodyBuffer.length === 0) {
    return { bodyBuffer, rewrite: null };
  }

  let payload;
  try {
    payload = JSON.parse(bodyBuffer.toString("utf-8"));
  } catch {
    return { bodyBuffer, rewrite: null };
  }

  if (typeof payload?.model !== "string") {
    return { bodyBuffer, rewrite: null };
  }

  const rewrite = buildFixedModelRewrite(payload.model);
  payload.model = rewrite.upstreamModel;

  if (pathname.endsWith("/responses") && rewrite.reasoningEffort) {
    payload.reasoning = {
      ...(payload.reasoning ?? {}),
      effort: rewrite.reasoningEffort,
    };
  }

  const rewrittenBuffer = Buffer.from(JSON.stringify(payload));
  if (PROXY_CONFIG.verbose) {
    log("model-rewrite", {
      pathname,
      rewrite: toLoggableModelRewrite(rewrite),
      summary: summarizePayload(pathname, payload),
    });
  }

  return {
    bodyBuffer: rewrittenBuffer,
    rewrite,
  };
}

function getRequestBodyBuffer(ctx) {
  if (["GET", "HEAD"].includes(ctx.method)) {
    return Buffer.alloc(0);
  }

  const body = ctx.request.body;
  if (body == null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  return Buffer.from(JSON.stringify(body));
}

function selectAuthorizationHeader(ctx) {
  if (typeof PROXY_CONFIG.fixedAuthorization === "string" && PROXY_CONFIG.fixedAuthorization.trim()) {
    return PROXY_CONFIG.fixedAuthorization.trim();
  }

  if (PROXY_CONFIG.passAuthorization) {
    const incoming = ctx.get("authorization");
    if (incoming && incoming.trim()) {
      return incoming.trim();
    }
  }

  return null;
}

function buildForwardHeaders(ctx, bodyBuffer, authorizationHeader) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(ctx.headers)) {
    if (value == null) continue;
    const lowerKey = key.toLowerCase();
    if (["host", "content-length", "connection"].includes(lowerKey)) continue;
    if (lowerKey === "authorization") continue;

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else {
      headers.set(key, String(value));
    }
  }

  if (authorizationHeader) {
    headers.set("authorization", authorizationHeader);
  }

  if (bodyBuffer.length > 0 && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return headers;
}

function setResponseHeaders(ctx, response, extraHeaders = {}) {
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "content-length") continue;
    ctx.set(key, value);
  }

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value != null) {
      ctx.set(key, value);
    }
  }
}

function previewText(text, maxLength = 600) {
  if (typeof text !== "string") return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export async function cursorOpenaiProxyHealth(ctx) {
  ctx.status = 200;
  ctx.type = "application/json";
  ctx.body = {
    ok: true,
    upstreamBaseUrl: normalizeBaseUrl(PROXY_CONFIG.upstreamBaseUrl),
    fixedModel: PROXY_CONFIG.fixedModel,
    fixedReasoningEffort: PROXY_CONFIG.fixedReasoningEffort,
    passAuthorization: PROXY_CONFIG.passAuthorization,
    hasFixedAuthorization: Boolean(PROXY_CONFIG.fixedAuthorization),
  };
}

export async function cursorOpenaiProxy(ctx) {
  const method = ctx.method || "GET";
  const pathname = ctx.path || "/";
  const originalUrl = ctx.originalUrl || ctx.url || pathname;
  const contentType = String(ctx.headers["content-type"] || "");
  const originalBodyBuffer = getRequestBodyBuffer(ctx);
  const { bodyBuffer, rewrite } = rewriteRequestBody(method, pathname, contentType, originalBodyBuffer);
  const targetUrl = buildUpstreamUrl(PROXY_CONFIG.upstreamBaseUrl, originalUrl);
  const authorizationHeader = selectAuthorizationHeader(ctx);
  const headers = buildForwardHeaders(ctx, bodyBuffer, authorizationHeader);

  log("request-forward", {
    method,
    pathname,
    targetUrl,
    rewrite: rewrite ? toLoggableModelRewrite(rewrite) : null,
    bodyBytes: bodyBuffer.length,
  });

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : bodyBuffer,
      duplex: "half",
    });
  } catch (error) {
    log("upstream-fetch-error", {
      method,
      pathname,
      targetUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    ctx.status = 502;
    ctx.type = "application/json";
    ctx.body = {
      error: {
        type: "proxy_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    return;
  }

  const extraHeaders = {
    "x-cursor-proxy-upstream-status": String(upstreamResponse.status),
  };

  if (rewrite?.changed) {
    extraHeaders["x-cursor-proxy-model"] = rewrite.upstreamModel;
    if (rewrite.reasoningEffort) {
      extraHeaders["x-cursor-proxy-reasoning-effort"] = rewrite.reasoningEffort;
    }
  }

  ctx.status = upstreamResponse.status;
  setResponseHeaders(ctx, upstreamResponse, extraHeaders);

  if (!upstreamResponse.ok) {
    const rawText = upstreamResponse.body ? await upstreamResponse.text() : "";
    log("upstream-error", {
      method,
      pathname,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      bodyPreview: previewText(rawText),
    });
    ctx.body = rawText;
    return;
  }

  log("upstream-ok", {
    method,
    pathname,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    contentType: upstreamResponse.headers.get("content-type") || "",
  });

  if (!upstreamResponse.body) {
    ctx.body = "";
    return;
  }

  ctx.body = Readable.fromWeb(upstreamResponse.body);
}
