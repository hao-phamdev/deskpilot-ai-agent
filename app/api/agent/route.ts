/**
 * LLM Integration Module (server side).
 *
 * A thin, stateless relay between the browser and the Claude API:
 *  - keeps the API key on the server,
 *  - attaches the system prompt + tool definitions,
 *  - validates the request body,
 *  - enforces a simple per-IP rate limit,
 *  - retries transient API failures (SDK: exponential backoff on 408/409/429/5xx),
 *  - maps API errors to clear, typed JSON responses the UI can act on.
 *
 * Tools are NOT executed here: Claude's tool calls are returned to the browser,
 * which validates them, asks for confirmation when needed, and runs them against
 * the user's local workspace.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { SYSTEM_PROMPT } from "@/lib/prompt";
import { claudeToolDefinitions } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT || "medium") as "low" | "medium" | "high";
const MAX_BODY_CHARS = 400_000;

const client = new Anthropic({ maxRetries: 3, timeout: 55_000 });
const TOOLS = claudeToolDefinitions();

// ── Rate limiting (best-effort, per server instance) ─────────────────────────
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function rateLimit(ip: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    hits.set(ip, recent);
    return { ok: false, retryAfter };
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return { ok: true };
}

// ── Request validation ───────────────────────────────────────────────────────
const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
      }),
    )
    .min(1)
    .max(120),
});

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return Response.json(body, { status, headers });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limited = rateLimit(ip);
  if (!limited.ok) {
    return json(
      429,
      { error: "Too many requests from your network. Please wait a bit.", kind: "rate_limit", retryAfter: limited.retryAfter },
      { "Retry-After": String(limited.retryAfter) },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(500, { error: "Server is missing ANTHROPIC_API_KEY.", kind: "config" });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return json(413, { error: "Conversation is too long. Start a new chat.", kind: "too_large" });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(JSON.parse(raw));
  } catch {
    return json(400, { error: "Malformed request body.", kind: "bad_request" });
  }
  if (body.messages[0].role !== "user") {
    return json(400, { error: "Conversation must start with a user message.", kind: "bad_request" });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS as Anthropic.Beta.BetaTool[],
      messages: body.messages as Anthropic.Beta.BetaMessageParam[],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      // If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    return json(200, {
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_details ?? null,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      const retryAfter = Number(error.headers?.get?.("retry-after")) || 10;
      return json(429, { error: "Claude is rate-limiting requests right now.", kind: "rate_limit", retryAfter });
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return json(500, { error: "The server's Claude API key is invalid or lacks access.", kind: "config" });
    }
    if (error instanceof Anthropic.BadRequestError) {
      console.error("[agent] bad request:", error.message);
      return json(400, { error: `Claude rejected the request: ${error.message}`, kind: "bad_request" });
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) {
      return json(503, { error: "Couldn't reach Claude (network/timeout).", kind: "unavailable", retryAfter: 3 });
    }
    if (error instanceof Anthropic.APIError) {
      const overloaded = error.status === 529 || (error.status ?? 0) >= 500;
      return json(overloaded ? 503 : 502, {
        error: overloaded ? "Claude is temporarily overloaded." : `Claude API error (${error.status}).`,
        kind: overloaded ? "unavailable" : "api_error",
        retryAfter: overloaded ? 5 : undefined,
      });
    }
    console.error("[agent] unexpected error:", error);
    return json(500, { error: "Unexpected server error.", kind: "internal" });
  }
}
