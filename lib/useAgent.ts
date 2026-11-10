"use client";
/**
 * Action Interpreter — the agent loop, running in the browser.
 *
 *   user text ─▶ /api/agent (Claude) ─▶ response
 *        ▲                                 │
 *        │                 tool_use blocks │ (parse)
 *        │                                 ▼
 *   tool_result ◀── execute ◀── confirm? ◀── validate (Zod) + assess risk
 *
 * The loop repeats until Claude stops asking for tools (or MAX_STEPS is hit).
 * Every step is written to the audit log.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { useCallback, useRef, useState } from "react";
import { audit } from "./audit";
import { assessRisk, describeImpact, executeTool } from "./executor";
import { type Risk, TOOL_SPECS, validateToolCall } from "./tools";
import { describeWorkspace, workspaceStore } from "./workspace";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

const MAX_STEPS = 10;
const MAX_CLIENT_RETRIES = 2;

export type ActionStatus = "queued" | "invalid" | "awaiting_approval" | "running" | "success" | "error" | "denied";

export interface ActionItem {
  id: string;
  tool: string;
  domain?: string;
  input: Record<string, unknown>;
  reason: string;
  risk?: Risk;
  impact?: string;
  status: ActionStatus;
  output?: string;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "actions"; id: string; actions: ActionItem[] }
  | { kind: "notice"; id: string; text: string; tone: "info" | "warn" | "error"; retry?: boolean };

interface ApiOk {
  content: ContentBlock[];
  stop_reason: string | null;
  stop_details: { category?: string | null; explanation?: string | null } | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };
}

let uid = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Stats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  model?: string;
}

export function useAgent() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats>({ calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  const history = useRef<MessageParam[]>([]);
  const approvals = useRef(new Map<string, (approved: boolean) => void>());
  const stopRequested = useRef(false);
  const checkpoint = useRef<MessageParam[]>([]);

  const push = useCallback((item: ChatItem) => setItems((prev) => [...prev, item]), []);

  const patchAction = useCallback((groupId: string, actionId: string, patch: Partial<ActionItem>) => {
    setItems((prev) =>
      prev.map((it) =>
        it.kind === "actions" && it.id === groupId
          ? { ...it, actions: it.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }
          : it,
      ),
    );
  }, []);

  /** Called by the UI's Approve / Deny buttons. */
  const respondToApproval = useCallback((actionId: string, approved: boolean) => {
    approvals.current.get(actionId)?.(approved);
    approvals.current.delete(actionId);
  }, []);

  /** Append content to the conversation as a user turn (merging with a trailing user turn). */
  function appendUser(blocks: Anthropic.Beta.BetaContentBlockParam[]) {
    const last = history.current[history.current.length - 1];
    if (last?.role === "user" && Array.isArray(last.content)) {
      history.current = [...history.current.slice(0, -1), { role: "user", content: [...last.content, ...blocks] }];
    } else {
      history.current.push({ role: "user", content: blocks });
    }
  }

  /** POST the conversation to the server, with client-side retry for rate limits / overload. */
  async function callModel(): Promise<ApiOk | null> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let data: any;
      try {
        res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.current }),
        });
        data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
      } catch {
        if (attempt < MAX_CLIENT_RETRIES) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        audit("api_error", "Network error reaching /api/agent");
        push({ kind: "notice", id: nextId("n"), tone: "error", text: "Network error: couldn't reach the server.", retry: true });
        return null;
      }
      if (res.ok) return data as ApiOk;

      const retryable = res.status === 429 || res.status === 503;
      if (retryable && attempt < MAX_CLIENT_RETRIES) {
        const wait = Math.min(Number(data.retryAfter) || 2 ** attempt * 2, 20);
        push({ kind: "notice", id: nextId("n"), tone: "warn", text: `${data.error} Retrying in ${wait}s…` });
        await sleep(wait * 1000);
        continue;
      }
      audit("api_error", data.error ?? `HTTP ${res.status}`, { detail: data });
      push({ kind: "notice", id: nextId("n"), tone: "error", text: data.error ?? `Request failed (${res.status}).`, retry: retryable || res.status >= 500 });
      return null;
    }
  }

  /** Validate → assess risk → (confirm) → execute one tool call. Returns the tool_result for Claude. */
  async function handleToolUse(block: Anthropic.Beta.BetaToolUseBlock, groupId: string): Promise<ToolResult> {
    const raw = (block.input ?? {}) as Record<string, unknown>;
    const result = (content: string, is_error = false): ToolResult => ({ type: "tool_result", tool_use_id: block.id, content, is_error });

    audit("tool_call", `Claude requested ${block.name}`, { tool: block.name, detail: raw });

    if (stopRequested.current) {
      patchAction(groupId, block.id, { status: "denied", output: "Stopped by user." });
      return result("CANCELLED: The user stopped the agent before this action ran.", true);
    }

    // 1) Validate the LLM's output before anything executes.
    const v = validateToolCall(block.name, raw);
    if (!v.ok) {
      patchAction(groupId, block.id, { status: "invalid", output: v.error });
      audit("validation_failed", v.error, { tool: block.name, detail: raw });
      return result(`VALIDATION ERROR: ${v.error}. Nothing was executed. Fix the arguments and try again.`, true);
    }

    // 2) Risk assessment + human-in-the-loop confirmation for destructive actions.
    const risk = assessRisk(v.name, v.input);
    const impact = risk === "destructive" ? describeImpact(v.name, v.input) : undefined;
    patchAction(groupId, block.id, { risk, impact, input: v.input });
    if (risk === "destructive") {
      patchAction(groupId, block.id, { status: "awaiting_approval" });
      audit("confirmation_requested", impact ?? `${v.name} needs approval`, { tool: v.name, risk, detail: v.input });
      const approved = await new Promise<boolean>((resolve) => approvals.current.set(block.id, resolve));
      if (!approved) {
        patchAction(groupId, block.id, { status: "denied", output: "You declined this action." });
        audit("denied", `User denied ${v.name}`, { tool: v.name, risk, detail: v.input });
        return result("DENIED: The user declined this action. It was not executed. Do not retry it.", true);
      }
      audit("approved", `User approved ${v.name}`, { tool: v.name, risk, detail: v.input });
    }

    // 3) Execute.
    patchAction(groupId, block.id, { status: "running" });
    try {
      const out = await executeTool(v.name, v.input);
      patchAction(groupId, block.id, { status: "success", output: out });
      audit("executed", `${v.name} succeeded`, { tool: v.name, risk, detail: { input: v.input, output: out } });
      return result(out);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchAction(groupId, block.id, { status: "error", output: msg });
      audit("execution_failed", `${v.name} failed: ${msg}`, { tool: v.name, risk, detail: v.input });
      return result(`ERROR: ${msg}`, true);
    }
  }

  /** The agent loop. */
  async function runLoop() {
    setBusy(true);
    stopRequested.current = false;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRequested.current) {
          push({ kind: "notice", id: nextId("n"), tone: "info", text: "Stopped." });
          return;
        }
        const res = await callModel();
        if (!res) return;

        setStats((s) => ({
          calls: s.calls + 1,
          inputTokens: s.inputTokens + res.usage.input_tokens,
          outputTokens: s.outputTokens + res.usage.output_tokens,
          cachedTokens: s.cachedTokens + res.usage.cache_read_input_tokens,
          model: res.model,
        }));

        // Keep the assistant turn exactly as returned (thinking blocks must be passed back unchanged).
        history.current.push({ role: "assistant", content: res.content as Anthropic.Beta.BetaContentBlockParam[] });

        const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        audit("llm_response", `stop_reason=${res.stop_reason}, ${toolUses.length} tool call(s)`, {
          detail: { model: res.model, usage: res.usage },
        });

        // Render reasoning summary + any text.
        for (const b of res.content) {
          if (b.type === "thinking" && b.thinking.trim()) push({ kind: "thinking", id: nextId("th"), text: b.thinking });
          if (b.type === "text" && b.text.trim()) push({ kind: "assistant", id: nextId("a"), text: b.text });
          if (b.type === "fallback")
            push({ kind: "notice", id: nextId("n"), tone: "info", text: `Answered by fallback model ${b.to.model}.` });
        }

        if (res.stop_reason === "refusal") {
          push({ kind: "notice", id: nextId("n"), tone: "warn", text: "Claude declined this request." });
          history.current = checkpoint.current; // roll back the refused request
          return;
        }
        if (res.stop_reason === "max_tokens") {
          push({ kind: "notice", id: nextId("n"), tone: "warn", text: "The response hit the length limit. Try a smaller request." });
          if (toolUses.length === 0) return;
        }
        if (toolUses.length === 0) return; // done

        // Parse tool calls into action cards, then process them in order.
        const groupId = nextId("g");
        push({
          kind: "actions",
          id: groupId,
          actions: toolUses.map((tu) => {
            const input = (tu.input ?? {}) as Record<string, unknown>;
            return {
              id: tu.id,
              tool: tu.name,
              domain: tu.name in TOOL_SPECS ? TOOL_SPECS[tu.name as keyof typeof TOOL_SPECS].domain : undefined,
              input,
              reason: typeof input.reason === "string" ? input.reason : "",
              status: "queued",
            };
          }),
        });
        const results: ToolResult[] = [];
        for (const tu of toolUses) results.push(await handleToolUse(tu, groupId));
        appendUser(results); // all results in ONE user message
      }
      push({ kind: "notice", id: nextId("n"), tone: "warn", text: `Stopped after ${MAX_STEPS} steps to prevent a runaway loop.` });
    } finally {
      setBusy(false);
    }
  }

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      push({ kind: "user", id: nextId("u"), text: trimmed });
      audit("user_request", trimmed);
      checkpoint.current = [...history.current];
      appendUser([{ type: "text", text: `${describeWorkspace(workspaceStore.get())}\n\n${trimmed}` }]);
      await runLoop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy],
  );

  const retry = useCallback(async () => {
    if (busy || history.current.length === 0) return;
    await runLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const stop = useCallback(() => {
    stopRequested.current = true;
    // Deny any pending approvals so the loop can finish cleanly.
    approvals.current.forEach((resolve) => resolve(false));
    approvals.current.clear();
  }, []);

  const reset = useCallback(() => {
    stop();
    history.current = [];
    setItems([]);
  }, [stop]);

  return { items, busy, stats, send, retry, stop, reset, respondToApproval };
}
