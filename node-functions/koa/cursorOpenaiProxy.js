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

function buildUpstreamUrl(baseUrl, requestUrl, overridePathname = null) {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const incoming = new URL(requestUrl, "https://edgeone.local");
  let pathname = overridePathname ?? incoming.pathname;

  if (overridePathname == null) {
    if (base.pathname === "/v1" && pathname.startsWith("/v1/")) {
      pathname = pathname.slice(3);
    } else if (base.pathname && base.pathname !== "/" && pathname.startsWith(`${base.pathname}/`)) {
      pathname = pathname.slice(base.pathname.length);
    }
  }

  const target = new URL(base.toString());
  target.pathname = joinUrlPath(base.pathname === "/" ? "" : base.pathname, pathname);
  target.search = incoming.search;
  return target.toString();
}

function previewText(text, maxLength = 600) {
  if (typeof text !== "string") return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function createSyntheticId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonStringify(value, fallback = "{}") {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return fallback;
  }
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString("utf-8"));
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isChatCompletionsPath(pathname) {
  return String(pathname || "").endsWith("/chat/completions");
}

function isResponsesPath(pathname) {
  return String(pathname || "").endsWith("/responses");
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
  if (!rewrite?.changed) return rewrite?.originalModel ?? "(missing)";
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

  if (isResponsesPath(pathname)) {
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
  } else if (isChatCompletionsPath(pathname)) {
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

function summarizeChatMessages(messages) {
  const items = asArray(messages);
  const roles = {};
  const contentKinds = {};
  const previews = [];
  let toolCalls = 0;

  for (const [index, message] of items.entries()) {
    const role = typeof message?.role === "string" ? message.role : "(missing)";
    roles[role] = (roles[role] ?? 0) + 1;
    toolCalls += asArray(message?.tool_calls).length;

    const content = message?.content;
    if (typeof content === "string") {
      contentKinds.string = (contentKinds.string ?? 0) + 1;
      if (previews.length < 3) {
        previews.push({
          index,
          role,
          kind: "string",
          chars: content.length,
          preview: previewText(content, 120),
        });
      }
      continue;
    }

    if (Array.isArray(content)) {
      for (const part of content) {
        const kind = typeof part?.type === "string" ? part.type : typeof part;
        contentKinds[kind] = (contentKinds[kind] ?? 0) + 1;
      }
      if (previews.length < 3) {
        previews.push({
          index,
          role,
          kind: "array",
          parts: content.length,
          preview: previewText(
            content
              .map((part) => {
                if (typeof part === "string") return part;
                if (typeof part?.text === "string") return part.text;
                if (typeof part?.refusal === "string") return part.refusal;
                return safeJsonStringify(part);
              })
              .join(" "),
            120,
          ),
        });
      }
      continue;
    }

    const kind = content == null ? "nullish" : typeof content;
    contentKinds[kind] = (contentKinds[kind] ?? 0) + 1;
    if (previews.length < 3) {
      previews.push({
        index,
        role,
        kind,
        preview: previewText(safeJsonStringify(content, String(content)), 120),
      });
    }
  }

  return {
    count: items.length,
    roles,
    contentKinds,
    toolCalls,
    previews,
  };
}

function summarizeResponsesInput(input) {
  if (typeof input === "string") {
    return {
      count: 1,
      kinds: { string: 1 },
      roles: {},
      previews: [
        {
          index: 0,
          kind: "string",
          role: null,
          call_id: null,
          name: null,
          preview: previewText(input, 120),
        },
      ],
    };
  }

  const items = asArray(input);
  const kinds = {};
  const roles = {};
  const previews = [];

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") {
      const kind = typeof item;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      continue;
    }

    const kind = typeof item.type === "string" ? item.type : "message";
    kinds[kind] = (kinds[kind] ?? 0) + 1;

    if (typeof item.role === "string") {
      roles[item.role] = (roles[item.role] ?? 0) + 1;
    }

    if (previews.length < 5) {
      const preview =
        typeof item.output === "string"
          ? item.output
          : asArray(item.content)
              .map((part) => {
                if (typeof part?.text === "string") return part.text;
                if (typeof part?.output_text === "string") return part.output_text;
                if (typeof part?.image_url === "string") return "[image]";
                return "";
              })
              .filter(Boolean)
              .join(" ");
      previews.push({
        index,
        kind,
        role: item.role ?? null,
        call_id: item.call_id ?? null,
        name: item.name ?? null,
        preview: previewText(preview, 120),
      });
    }
  }

  return {
    count: items.length,
    kinds,
    roles,
    previews,
  };
}

function normalizeIncomingResponsesInput(input) {
  if (typeof input === "string") {
    return input;
  }

  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }

    if (typeof item.type === "string") {
      return item;
    }

    if (typeof item.role === "string") {
      return {
        role: item.role,
        content: normalizeChatMessageContent(item.role, item.content),
      };
    }

    return item;
  });
}

function summarizeToolDefinitions(tools) {
  const items = asArray(tools);
  return {
    count: items.length,
    names: items
      .slice(0, 12)
      .map((tool) => tool?.name ?? tool?.function?.name ?? tool?.type ?? "(unknown)"),
  };
}

function pickInterestingHeaders(headers) {
  const interesting = {};
  for (const name of [
    "x-request-id",
    "request-id",
    "cf-ray",
    "server",
    "retry-after",
    "openai-processing-ms",
    "x-cursor-proxy-upstream-status",
  ]) {
    const value = headers.get(name);
    if (value) {
      interesting[name] = value;
    }
  }
  return interesting;
}

function normalizeTextPart(role, text) {
  const normalizedText = typeof text === "string" ? text : String(text ?? "");
  return role === "assistant"
    ? { type: "output_text", text: normalizedText }
    : { type: "input_text", text: normalizedText };
}

function normalizeChatContentPart(role, part) {
  if (part == null) return null;

  if (typeof part === "string") {
    return normalizeTextPart(role, part);
  }

  if (typeof part !== "object") {
    return normalizeTextPart(role, String(part));
  }

  switch (part.type) {
    case "text":
    case "input_text":
    case "output_text":
      return normalizeTextPart(role, part.text ?? "");
    case "image_url": {
      const rawImageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!rawImageUrl) return null;
      return {
        type: "input_image",
        image_url: rawImageUrl,
        detail: part.detail ?? part.image_url?.detail,
      };
    }
    case "input_image":
      return {
        type: "input_image",
        image_url: part.image_url,
        detail: part.detail,
        file_id: part.file_id,
      };
    case "refusal":
      return normalizeTextPart(role, part.refusal ?? part.text ?? "");
    default:
      if (typeof part.text === "string") {
        return normalizeTextPart(role, part.text);
      }
      return normalizeTextPart(role, safeJsonStringify(part, String(part)));
  }
}

function normalizeChatMessageContent(role, content) {
  if (typeof content === "string") {
    return [normalizeTextPart(role, content)];
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => normalizeChatContentPart(role, part))
      .filter(Boolean);
  }

  if (content == null) {
    return [];
  }

  return [normalizeChatContentPart(role, content)].filter(Boolean);
}

function extractPlainTextFromChatContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return String(part ?? "");
        if (typeof part.text === "string") return part.text;
        if (typeof part.refusal === "string") return part.refusal;
        return safeJsonStringify(part);
      })
      .join("");
  }
  if (content == null) return "";
  if (typeof content === "object" && typeof content.text === "string") {
    return content.text;
  }
  return safeJsonStringify(content);
}

function convertChatToolCall(toolCall, fallbackIndex) {
  if (!toolCall || typeof toolCall !== "object") return null;
  const functionName = toolCall.function?.name ?? toolCall.name;
  if (!functionName) return null;

  return {
    type: "function_call",
    call_id: toolCall.id ?? createSyntheticId(`call-${fallbackIndex}`),
    name: functionName,
    arguments: typeof toolCall.function?.arguments === "string"
      ? toolCall.function.arguments
      : safeJsonStringify(toolCall.function?.arguments ?? toolCall.arguments ?? {}),
  };
}

function convertChatMessagesToResponsesInput(messages) {
  const input = [];

  for (const message of asArray(messages)) {
    if (!message || typeof message !== "object") continue;

    const role = typeof message.role === "string" ? message.role : "user";

    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? message.toolCallId ?? createSyntheticId("tool-output"),
        output: extractPlainTextFromChatContent(message.content),
      });
      continue;
    }

    if (role === "assistant") {
      const assistantContent = normalizeChatMessageContent("assistant", message.content);
      if (assistantContent.length > 0) {
        input.push({
          role: "assistant",
          content: assistantContent,
        });
      }

      for (const [toolIndex, toolCall] of asArray(message.tool_calls).entries()) {
        const convertedToolCall = convertChatToolCall(toolCall, toolIndex);
        if (convertedToolCall) {
          input.push(convertedToolCall);
        }
      }
      continue;
    }

    input.push({
      role,
      content: normalizeChatMessageContent(role, message.content),
    });
  }

  return input;
}

function convertChatToolsToResponsesTools(tools, legacyFunctions = []) {
  const combinedTools = [
    ...asArray(tools),
    ...asArray(legacyFunctions).map((fn) => ({ type: "function", function: fn })),
  ];

  return combinedTools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      if (tool.type === "function" && tool.function && typeof tool.function === "object") {
        return {
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict,
        };
      }
      return tool;
    })
    .filter(Boolean);
}

function convertChatToolChoice(toolChoice) {
  if (toolChoice == null) return undefined;
  if (typeof toolChoice === "string") return toolChoice;

  if (toolChoice.type === "function") {
    const functionName = toolChoice.function?.name ?? toolChoice.name;
    if (functionName) {
      return {
        type: "function",
        name: functionName,
      };
    }
  }

  return undefined;
}

function convertChatCompletionsRequestToResponses(payload) {
  const rewrite = buildFixedModelRewrite(payload.model);
  const hasResponsesStyleInput = payload.input !== undefined;
  const originalMessageSummary = summarizeChatMessages(payload.messages);
  const originalInputSummary = summarizeResponsesInput(payload.input);
  const normalizedInput = hasResponsesStyleInput
    ? normalizeIncomingResponsesInput(payload.input)
    : convertChatMessagesToResponsesInput(payload.messages);
  const converted = {
    model: rewrite.upstreamModel,
    input: normalizedInput,
    stream: payload.stream === true,
    store: typeof payload.store === "boolean" ? payload.store : false,
  };
  if (Array.isArray(payload.include)) {
    converted.include = payload.include;
  }
  if (payload.prompt_cache_retention !== undefined) {
    converted.prompt_cache_retention = payload.prompt_cache_retention;
  }

  if (rewrite.reasoningEffort) {
    converted.reasoning = {
      ...(payload.reasoning ?? {}),
      effort: rewrite.reasoningEffort,
    };
  } else if (payload.reasoning) {
    converted.reasoning = payload.reasoning;
  }

  const convertedTools = convertChatToolsToResponsesTools(payload.tools, payload.functions);
  if (convertedTools.length > 0) {
    converted.tools = convertedTools;
  }

  const convertedToolChoice = convertChatToolChoice(payload.tool_choice ?? payload.function_call);
  if (convertedToolChoice !== undefined) {
    converted.tool_choice = convertedToolChoice;
  }

  if (typeof payload.temperature === "number") {
    converted.temperature = payload.temperature;
  }
  if (typeof payload.top_p === "number") {
    converted.top_p = payload.top_p;
  }
  if (typeof payload.max_tokens === "number") {
    converted.max_output_tokens = payload.max_tokens;
  }
  if (typeof payload.max_completion_tokens === "number") {
    converted.max_output_tokens = payload.max_completion_tokens;
  }
  if (typeof payload.parallel_tool_calls === "boolean") {
    converted.parallel_tool_calls = payload.parallel_tool_calls;
  }

  const convertedInputSummary = summarizeResponsesInput(converted.input);
  const droppedFields = [];
  if (payload.user !== undefined) {
    droppedFields.push("user");
  }
  if (payload.stream_options !== undefined) {
    droppedFields.push("stream_options");
  }
  if (payload.metadata !== undefined) {
    droppedFields.push("metadata");
  }
  if (PROXY_CONFIG.verbose) {
    log("bridge-request-shape", {
      source: {
        model: payload.model,
        stream: payload.stream === true,
        inputMode: hasResponsesStyleInput ? "input" : "messages",
        messageSummary: originalMessageSummary,
        inputSummary: originalInputSummary,
        toolSummary: summarizeToolDefinitions(payload.tools ?? payload.functions),
        topLevelKeys: Object.keys(payload),
      },
      converted: {
        model: converted.model,
        stream: converted.stream === true,
        reasoning: converted.reasoning?.effort ?? null,
        inputSummary: convertedInputSummary,
        toolSummary: summarizeToolDefinitions(converted.tools),
        topLevelKeys: Object.keys(converted),
        droppedFields,
      },
    });
  }

  if (convertedInputSummary.count === 0) {
    log("bridge-empty-input-warning", {
      model: payload.model,
      inputMode: hasResponsesStyleInput ? "input" : "messages",
      originalMessageSummary,
      originalInputSummary,
      topLevelKeys: Object.keys(payload),
    });
  }

  return {
    payload: converted,
    rewrite,
    upstreamPathname: "/responses",
    bridgeMode: "chat-completions-to-responses",
    responseModelName: rewrite.originalModel,
  };
}

function rewriteResponsesRequest(payload) {
  const rewrite = buildFixedModelRewrite(payload.model);
  const converted = {
    ...payload,
    model: rewrite.upstreamModel,
  };

  if (rewrite.reasoningEffort) {
    converted.reasoning = {
      ...(payload.reasoning ?? {}),
      effort: rewrite.reasoningEffort,
    };
  }

  return {
    payload: converted,
    rewrite,
    upstreamPathname: null,
    bridgeMode: null,
    responseModelName: rewrite.originalModel,
  };
}

function canRewriteJsonRequest(method, pathname, contentType) {
  if (!["POST", "PUT", "PATCH"].includes(method)) return false;
  if (!String(contentType || "").toLowerCase().includes("application/json")) return false;
  return isResponsesPath(pathname) || isChatCompletionsPath(pathname);
}

function prepareJsonRequest(method, pathname, contentType, bodyBuffer) {
  if (!canRewriteJsonRequest(method, pathname, contentType) || bodyBuffer.length === 0) {
    return {
      bodyBuffer,
      rewrite: null,
      upstreamPathname: null,
      bridgeMode: null,
      responseModelName: PROXY_CONFIG.fixedModel,
    };
  }

  const payload = parseJsonBuffer(bodyBuffer);
  if (!payload || typeof payload.model !== "string") {
    return {
      bodyBuffer,
      rewrite: null,
      upstreamPathname: null,
      bridgeMode: null,
      responseModelName: PROXY_CONFIG.fixedModel,
    };
  }

  const prepared = isChatCompletionsPath(pathname)
    ? convertChatCompletionsRequestToResponses(payload)
    : rewriteResponsesRequest(payload);

  const rewrittenBuffer = Buffer.from(JSON.stringify(prepared.payload));

  if (PROXY_CONFIG.verbose) {
    log("model-rewrite", {
      pathname,
      upstreamPathname: prepared.upstreamPathname ?? pathname,
      rewrite: toLoggableModelRewrite(prepared.rewrite),
      summary: summarizePayload(prepared.upstreamPathname ?? pathname, prepared.payload),
      bridgeMode: prepared.bridgeMode,
    });
  }

  return {
    bodyBuffer: rewrittenBuffer,
    rewrite: prepared.rewrite,
    upstreamPathname: prepared.upstreamPathname,
    bridgeMode: prepared.bridgeMode,
    responseModelName: prepared.responseModelName,
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

function normalizeChatStreamFinishReason(reason, sawToolCalls) {
  if (sawToolCalls) return "tool_calls";
  if (typeof reason === "string" && reason.includes("max_output_tokens")) return "length";
  return "stop";
}

function responseUsageToChatUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;

  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  const result = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };

  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;
  if (typeof reasoningTokens === "number") {
    result.completion_tokens_details = {
      reasoning_tokens: reasoningTokens,
    };
  }

  return result;
}

function extractResponseTextFromContent(content) {
  return asArray(content)
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.output_text === "string") return part.output_text;
      if (typeof part.refusal === "string") return part.refusal;
      return "";
    })
    .join("");
}

function extractResponseText(output, responsePayload) {
  const collected = [];
  for (const item of asArray(output)) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "message") {
      const text = extractResponseTextFromContent(item.content);
      if (text) {
        collected.push(text);
      }
    }
  }

  if (collected.length > 0) {
    return collected.join("");
  }

  if (typeof responsePayload?.output_text === "string") {
    return responsePayload.output_text;
  }

  return "";
}

function extractResponseToolCalls(output) {
  return asArray(output)
    .filter((item) => item && typeof item === "object" && item.type === "function_call")
    .map((item, index) => ({
      id: item.call_id ?? item.id ?? createSyntheticId(`call-${index}`),
      type: "function",
      function: {
        name: item.name ?? "",
        arguments: typeof item.arguments === "string" ? item.arguments : safeJsonStringify(item.arguments ?? {}),
      },
    }));
}

function buildChatCompletionResponse(responsePayload, responseModelName) {
  const output = asArray(responsePayload?.output);
  const toolCalls = extractResponseToolCalls(output);
  const content = extractResponseText(output, responsePayload);
  const finishReason = normalizeChatStreamFinishReason(
    responsePayload?.incomplete_details?.reason ?? responsePayload?.status,
    toolCalls.length > 0,
  );

  return {
    id: responsePayload?.id ?? createSyntheticId("chatcmpl"),
    object: "chat.completion",
    created: Number(responsePayload?.created_at ?? responsePayload?.created ?? Math.floor(Date.now() / 1000)),
    model: responseModelName,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || (toolCalls.length > 0 ? null : ""),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    ...(responseUsageToChatUsage(responsePayload?.usage) ? { usage: responseUsageToChatUsage(responsePayload.usage) } : {}),
  };
}

function createChatCompletionChunk(streamState, delta, finishReason = null) {
  return {
    id: streamState.responseId,
    object: "chat.completion.chunk",
    created: streamState.created,
    model: streamState.responseModelName,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function syncStreamStateFromPayload(streamState, payload) {
  const response = payload?.response && typeof payload.response === "object" ? payload.response : payload;
  if (!response || typeof response !== "object") return;

  if (typeof response.id === "string" && response.id) {
    streamState.responseId = response.id;
  }
  if (typeof response.created_at === "number") {
    streamState.created = response.created_at;
  } else if (typeof response.created === "number") {
    streamState.created = response.created;
  }
}

function ensureToolCallState(streamState, itemLike) {
  const preferredKey = itemLike?.id ?? itemLike?.call_id;
  if (preferredKey && streamState.toolCallState.has(preferredKey)) {
    return streamState.toolCallState.get(preferredKey);
  }

  const indexFromPayload = Number.isInteger(itemLike?.output_index) ? itemLike.output_index : streamState.nextToolIndex;
  const key = preferredKey ?? `${indexFromPayload}`;
  if (streamState.toolCallState.has(key)) {
    return streamState.toolCallState.get(key);
  }

  const nextState = {
    key,
    index: indexFromPayload,
    callId: itemLike?.call_id ?? itemLike?.id ?? createSyntheticId(`call-${indexFromPayload}`),
    name: itemLike?.name ?? "",
    introSent: false,
    argsSent: false,
  };

  streamState.toolCallState.set(key, nextState);
  streamState.nextToolIndex = Math.max(streamState.nextToolIndex, indexFromPayload + 1);
  return nextState;
}

function maybeCreateRoleChunk(streamState, chunks) {
  if (streamState.roleSent) return;
  streamState.roleSent = true;
  chunks.push(createChatCompletionChunk(streamState, { role: "assistant" }));
}

function emitFullOutputAsChatChunks(streamState, responsePayload, chunks) {
  const output = asArray(responsePayload?.output);
  const text = extractResponseText(output, responsePayload);
  const toolCalls = extractResponseToolCalls(output);

  if (!text && toolCalls.length === 0) {
    return;
  }

  maybeCreateRoleChunk(streamState, chunks);

  if (text) {
    streamState.sawText = true;
    chunks.push(createChatCompletionChunk(streamState, { content: text }));
  }

  for (const [toolIndex, toolCall] of toolCalls.entries()) {
    streamState.sawToolCalls = true;
    const toolState = ensureToolCallState(streamState, {
      id: toolCall.id,
      call_id: toolCall.id,
      name: toolCall.function.name,
      output_index: toolIndex,
    });
    toolState.introSent = true;
    toolState.argsSent = true;
    chunks.push(
      createChatCompletionChunk(streamState, {
        tool_calls: [
          {
            index: toolState.index,
            id: toolState.callId,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          },
        ],
      }),
    );
  }
}

function convertResponsesEventToChatChunks(eventName, payload, streamState) {
  const chunks = [];
  syncStreamStateFromPayload(streamState, payload);

  switch (eventName) {
    case "response.output_text.delta":
      if (typeof payload?.delta === "string" && payload.delta.length > 0) {
        maybeCreateRoleChunk(streamState, chunks);
        streamState.sawText = true;
        chunks.push(createChatCompletionChunk(streamState, { content: payload.delta }));
      }
      break;
    case "response.output_item.added":
    case "response.output_item.done":
      if (payload?.item?.type === "function_call") {
        maybeCreateRoleChunk(streamState, chunks);
        streamState.sawToolCalls = true;
        const toolState = ensureToolCallState(streamState, {
          id: payload.item.id,
          call_id: payload.item.call_id,
          name: payload.item.name,
          output_index: payload.output_index,
        });
        const argumentsText = typeof payload.item.arguments === "string" ? payload.item.arguments : "";
        if (!toolState.introSent || (argumentsText && !toolState.argsSent)) {
          chunks.push(
            createChatCompletionChunk(streamState, {
              tool_calls: [
                {
                  index: toolState.index,
                  id: toolState.callId,
                  type: "function",
                  function: {
                    name: payload.item.name ?? toolState.name,
                    arguments: toolState.introSent ? argumentsText : argumentsText || "",
                  },
                },
              ],
            }),
          );
          toolState.introSent = true;
          toolState.name = payload.item.name ?? toolState.name;
          if (argumentsText) {
            toolState.argsSent = true;
          }
        }
      } else if (eventName === "response.output_item.done" && payload?.item?.type === "message" && !streamState.sawText) {
        const text = extractResponseTextFromContent(payload.item.content);
        if (text) {
          maybeCreateRoleChunk(streamState, chunks);
          streamState.sawText = true;
          chunks.push(createChatCompletionChunk(streamState, { content: text }));
        }
      }
      break;
    case "response.function_call_arguments.delta":
      if (typeof payload?.delta === "string") {
        maybeCreateRoleChunk(streamState, chunks);
        streamState.sawToolCalls = true;
        const toolState = ensureToolCallState(streamState, {
          id: payload.item_id,
          call_id: payload.call_id,
          name: payload.name,
          output_index: payload.output_index,
        });
        if (!toolState.introSent) {
          chunks.push(
            createChatCompletionChunk(streamState, {
              tool_calls: [
                {
                  index: toolState.index,
                  id: toolState.callId,
                  type: "function",
                  function: {
                    name: toolState.name,
                    arguments: "",
                  },
                },
              ],
            }),
          );
          toolState.introSent = true;
        }
        if (payload.delta.length > 0) {
          chunks.push(
            createChatCompletionChunk(streamState, {
              tool_calls: [
                {
                  index: toolState.index,
                  function: {
                    arguments: payload.delta,
                  },
                },
              ],
            }),
          );
          toolState.argsSent = true;
        }
      }
      break;
    case "response.function_call_arguments.done":
      if (typeof payload?.arguments === "string" && payload.arguments.length > 0) {
        maybeCreateRoleChunk(streamState, chunks);
        streamState.sawToolCalls = true;
        const toolState = ensureToolCallState(streamState, {
          id: payload.item_id,
          call_id: payload.call_id,
          name: payload.name,
          output_index: payload.output_index,
        });
        if (!toolState.introSent) {
          chunks.push(
            createChatCompletionChunk(streamState, {
              tool_calls: [
                {
                  index: toolState.index,
                  id: toolState.callId,
                  type: "function",
                  function: {
                    name: toolState.name,
                    arguments: "",
                  },
                },
              ],
            }),
          );
          toolState.introSent = true;
        }
        if (!toolState.argsSent) {
          chunks.push(
            createChatCompletionChunk(streamState, {
              tool_calls: [
                {
                  index: toolState.index,
                  function: {
                    arguments: payload.arguments,
                  },
                },
              ],
            }),
          );
          toolState.argsSent = true;
        }
      }
      break;
    case "response.completed": {
      const responsePayload = payload?.response ?? payload;
      if (!streamState.sawText && !streamState.sawToolCalls) {
        emitFullOutputAsChatChunks(streamState, responsePayload, chunks);
      }
      chunks.push(
        createChatCompletionChunk(
          streamState,
          {},
          normalizeChatStreamFinishReason(responsePayload?.incomplete_details?.reason, streamState.sawToolCalls),
        ),
      );
      streamState.finished = true;
      break;
    }
    case "response.incomplete": {
      const responsePayload = payload?.response ?? payload;
      if (!streamState.sawText && !streamState.sawToolCalls) {
        emitFullOutputAsChatChunks(streamState, responsePayload, chunks);
      }
      chunks.push(
        createChatCompletionChunk(
          streamState,
          {},
          normalizeChatStreamFinishReason(responsePayload?.incomplete_details?.reason, streamState.sawToolCalls),
        ),
      );
      streamState.finished = true;
      break;
    }
    case "response.failed":
      chunks.push(createChatCompletionChunk(streamState, {}, normalizeChatStreamFinishReason("failed", streamState.sawToolCalls)));
      streamState.finished = true;
      break;
    default:
      break;
  }

  return chunks;
}

function parseSseBlock(rawBlock) {
  const lines = rawBlock.split(/\r?\n/);
  let eventName = "";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    eventName,
    data: dataLines.join("\n"),
  };
}

function toSseDataLine(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function* createChatCompletionsBridgeStream(upstreamBody, responseModelName) {
  const streamState = {
    responseId: createSyntheticId("chatcmpl"),
    created: Math.floor(Date.now() / 1000),
    responseModelName,
    roleSent: false,
    sawText: false,
    sawToolCalls: false,
    finished: false,
    toolCallState: new Map(),
    nextToolIndex: 0,
  };

  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });

      while (true) {
        const separatorIndex = buffered.search(/\r?\n\r?\n/);
        if (separatorIndex === -1) break;

        const rawBlock = buffered.slice(0, separatorIndex);
        const separatorMatch = buffered.match(/\r?\n\r?\n/);
        buffered = buffered.slice(separatorIndex + separatorMatch[0].length);

        if (!rawBlock.trim()) continue;

        const { eventName, data } = parseSseBlock(rawBlock);
        if (!data) continue;
        if (data === "[DONE]") break;

        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          log("bridge-parse-error", {
            eventName,
            dataPreview: previewText(data),
          });
          continue;
        }

        const chunks = convertResponsesEventToChatChunks(eventName, payload, streamState);
        for (const chunk of chunks) {
          yield toSseDataLine(chunk);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (buffered.trim()) {
    const { eventName, data } = parseSseBlock(buffered);
    if (data && data !== "[DONE]") {
      try {
        const payload = JSON.parse(data);
        const chunks = convertResponsesEventToChatChunks(eventName, payload, streamState);
        for (const chunk of chunks) {
          yield toSseDataLine(chunk);
        }
      } catch {
        log("bridge-parse-error", {
          eventName,
          dataPreview: previewText(data),
        });
      }
    }
  }

  if (!streamState.finished) {
    yield toSseDataLine(
      createChatCompletionChunk(
        streamState,
        {},
        normalizeChatStreamFinishReason("stream_ended", streamState.sawToolCalls),
      ),
    );
  }

  yield "data: [DONE]\n\n";
}

export async function cursorOpenaiProxy(ctx) {
  const method = ctx.method || "GET";
  const pathname = ctx.path || "/";
  const originalUrl = ctx.originalUrl || ctx.url || pathname;
  const contentType = String(ctx.headers["content-type"] || "");
  const originalBodyBuffer = getRequestBodyBuffer(ctx);
  const preparedRequest = prepareJsonRequest(method, pathname, contentType, originalBodyBuffer);
  const targetUrl = buildUpstreamUrl(
    PROXY_CONFIG.upstreamBaseUrl,
    originalUrl,
    preparedRequest.upstreamPathname,
  );
  const authorizationHeader = selectAuthorizationHeader(ctx);
  const headers = buildForwardHeaders(ctx, preparedRequest.bodyBuffer, authorizationHeader);

  log("request-forward", {
    method,
    pathname,
    targetUrl,
    rewrite: preparedRequest.rewrite ? toLoggableModelRewrite(preparedRequest.rewrite) : null,
    bridgeMode: preparedRequest.bridgeMode,
    bodyBytes: preparedRequest.bodyBuffer.length,
  });

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : preparedRequest.bodyBuffer,
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

  if (preparedRequest.rewrite?.changed) {
    extraHeaders["x-cursor-proxy-model"] = preparedRequest.rewrite.upstreamModel;
    if (preparedRequest.rewrite.reasoningEffort) {
      extraHeaders["x-cursor-proxy-reasoning-effort"] = preparedRequest.rewrite.reasoningEffort;
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
      responseHeaders: pickInterestingHeaders(upstreamResponse.headers),
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
    bridgeMode: preparedRequest.bridgeMode,
  });

  if (!upstreamResponse.body) {
    ctx.body = "";
    return;
  }

  if (preparedRequest.bridgeMode === "chat-completions-to-responses") {
    const upstreamContentType = upstreamResponse.headers.get("content-type") || "";
    if (upstreamContentType.includes("text/event-stream")) {
      ctx.set("content-type", "text/event-stream; charset=utf-8");
      ctx.body = Readable.from(
        createChatCompletionsBridgeStream(upstreamResponse.body, preparedRequest.responseModelName),
      );
      return;
    }

    const rawText = await upstreamResponse.text();
    const responsePayload = rawText ? parseJsonBuffer(Buffer.from(rawText)) : {};
    if (responsePayload == null) {
      log("bridge-nonstream-parse-error", {
        pathname,
        bodyPreview: previewText(rawText),
      });
      ctx.set("content-type", "application/json; charset=utf-8");
      ctx.body = rawText;
      return;
    }
    ctx.set("content-type", "application/json; charset=utf-8");
    ctx.body = buildChatCompletionResponse(responsePayload, preparedRequest.responseModelName);
    return;
  }

  ctx.body = Readable.fromWeb(upstreamResponse.body);
}
