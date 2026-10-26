const MODEL = "@cf/openai/gpt-oss-20b";
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 30;
const buckets = new Map();

function cors(origin, env) {
  return {
    "Access-Control-Allow-Origin": origin === env.ALLOWED_ORIGIN ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (buckets.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  buckets.set(ip, recent);
  if (buckets.size > 2000) {
    for (const [key, times] of buckets) {
      if (!times.length || now - times[times.length - 1] >= WINDOW_MS) buckets.delete(key);
    }
  }
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "origin not allowed" }, 403, headers);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true }, 200, headers);
    if (url.pathname !== "/chat" || request.method !== "POST") return json({ error: "not found" }, 404, headers);
    if (!env.AI) return json({ error: "Workers AI binding is not configured" }, 503, headers);
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > 40_000) return json({ error: "request too large" }, 413, headers);
    if (rateLimited(request.headers.get("CF-Connecting-IP") || "unknown")) {
      return json({ error: "chat rate limit reached; try again later" }, 429, headers);
    }
    let payload;
    try {
      const raw = await request.text();
      if (raw.length > 40_000) return json({ error: "request too large" }, 413, headers);
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "invalid JSON" }, 400, headers);
    }
    if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > 12) {
      return json({ error: "messages must contain 1-12 items" }, 400, headers);
    }
    const messages = payload.messages.map(m => ({
      role: m?.role,
      content: typeof m?.content === "string" ? m.content.slice(0, 16000) : "",
    }));
    if (messages.some(m => !["system", "user", "assistant"].includes(m.role) || !m.content)) {
      return json({ error: "invalid message" }, 400, headers);
    }
    try {
      const stream = await env.AI.run(MODEL, {
        messages, temperature: 0.65, max_tokens: 400, stream: true,
      });
      return new Response(stream, {
        headers: {
          ...headers,
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 400);
      return json({ error: "Workers AI request failed", detail }, /limit|quota|neuron|429/i.test(detail) ? 429 : 502, headers);
    }
  },
};
