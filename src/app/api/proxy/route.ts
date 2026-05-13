import { NextRequest, NextResponse } from "next/server";

// 仅允许页面里会用到的上游，避免开放代理被滥用。
const ALLOWED_URL_PATTERNS: RegExp[] = [
  /^https:\/\/gbapi\.eastmoney\.com\//,
  /^https:\/\/np-tjxg-app-b\.eastmoney\.com\//,
  /^https:\/\/search-codetable\.eastmoney\.com\//,
  /^https:\/\/query-suggestion\.eastmoney\.com\//,
  /^https:\/\/calendars\.icloud\.com\//,
];

function isAllowedTargetUrl(url: string): boolean {
  return ALLOWED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * ① 与浏览器直连外站相比：同源 POST，无 CORS；服务端 fetch 东方财富，可走 HTTP 连接复用。
 * ② 与再经 api.niumengke.top 相比：少一跳子域代理，通常延迟更低。
 */
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }

  const { url, method = "GET", headers, data } = body as {
    url?: unknown;
    method?: unknown;
    headers?: unknown;
    data?: unknown;
  };

  if (typeof url !== "string" || !isAllowedTargetUrl(url)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const upperMethod = typeof method === "string" ? method.toUpperCase() : "GET";
  const init: RequestInit = {
    method: upperMethod,
    cache: "no-store",
  };

  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    init.headers = headers as HeadersInit;
  }

  if (upperMethod !== "GET" && upperMethod !== "HEAD" && data !== undefined) {
    const headerObject = new Headers(init.headers as HeadersInit | undefined);
    if (!headerObject.has("content-type")) {
      headerObject.set("content-type", "application/json");
    }
    init.headers = headerObject;
    init.body = typeof data === "string" ? data : JSON.stringify(data);
  }

  const upstream = await fetch(url, init);
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const buffer = await upstream.arrayBuffer();

  return new NextResponse(buffer, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
