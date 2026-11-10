"use client";
import { useEffect, useRef, useState } from "react";
import { ActionCard } from "@/components/ActionCard";
import { Markdown } from "@/components/Markdown";
import { SidePanel } from "@/components/SidePanel";
import { useAgent } from "@/lib/useAgent";

const EXAMPLES = [
  "Make a study plan for my CS4680 final in a file and add 3 todos for it",
  "What's the weather in Tokyo, and how much is 50 USD in JPY?",
  "What's an 18% tip on $86.40, and what time is it in London?",
  "Summarize notes/cs4680.md",
  "Delete all my completed todos",
  "Run rm -rf / on my computer",
];

export default function Home() {
  const { items, busy, stats, send, retry, stop, reset, respondToApproval } = useAgent();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const submit = (text = input) => {
    if (!text.trim() || busy) return;
    setInput("");
    void send(text);
  };

  const awaiting = items.some((it) => it.kind === "actions" && it.actions.some((a) => a.status === "awaiting_approval"));

  return (
    <div className="mx-auto flex h-dvh max-w-7xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)] text-lg text-white" aria-hidden>
          ✦
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight">DeskPilot</h1>
          <p className="text-xs text-[var(--muted)]">An AI agent that turns plain-English requests into real, audited actions</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">
          {stats.calls > 0 && (
            <span className="hidden rounded-full border border-[var(--border)] px-2.5 py-1 tabular-nums sm:inline">
              {stats.model} · {stats.calls} calls · {(stats.inputTokens + stats.outputTokens).toLocaleString()} tokens
            </span>
          )}
          <button onClick={reset} className="rounded-lg border border-[var(--border)] px-2.5 py-1 hover:bg-[var(--chip)] hover:text-[var(--fg)]">
            New chat
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,40%)] gap-3 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {items.length === 0 && (
              <div className="mx-auto max-w-xl py-6 text-center">
                <p className="text-base font-medium">What should I do for you?</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  I can manage files and todos, call live weather and currency APIs, do exact math and tell time. Anything destructive asks for your approval first.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => submit(ex)}
                      className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-left text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {items.map((it) => {
              switch (it.kind) {
                case "user":
                  return (
                    <div key={it.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-2 text-white">{it.text}</div>
                    </div>
                  );
                case "assistant":
                  return (
                    <div key={it.id} className="max-w-[90%] rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--card)] px-4 py-2.5">
                      <Markdown text={it.text} />
                    </div>
                  );
                case "thinking":
                  return (
                    <details key={it.id} className="max-w-[90%] text-sm text-[var(--muted)]">
                      <summary className="cursor-pointer select-none">🧠 Reasoning summary</summary>
                      <div className="mt-1 border-l-2 border-[var(--border)] pl-3">
                        <Markdown text={it.text} />
                      </div>
                    </details>
                  );
                case "actions":
                  return (
                    <div key={it.id} className="max-w-[90%] space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                        Planned {it.actions.length} action{it.actions.length > 1 ? "s" : ""}
                      </p>
                      {it.actions.map((a) => (
                        <ActionCard key={a.id} action={a} onRespond={respondToApproval} />
                      ))}
                    </div>
                  );
                case "notice":
                  return (
                    <div
                      key={it.id}
                      className={`flex max-w-[90%] items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
                        it.tone === "error"
                          ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
                          : it.tone === "warn"
                            ? "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]"
                            : "border-[var(--border)] text-[var(--muted)]"
                      }`}
                    >
                      <span>{it.text}</span>
                      {it.retry && !busy && (
                        <button onClick={() => void retry()} className="ml-auto rounded-lg border border-current px-2 py-0.5 text-xs">
                          Retry
                        </button>
                      )}
                    </div>
                  );
              }
            })}

            {busy && !awaiting && (
              <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                </span>
                Working…
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-end gap-2 border-t border-[var(--border)] p-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={busy ? "Agent is working…" : "Ask DeskPilot to do something…  (Enter to send)"}
              className="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-[0.95rem] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
            />
            {busy ? (
              <button type="button" onClick={stop} className="h-[42px] rounded-xl border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--chip)]">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="h-[42px] rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:opacity-40">
                Send
              </button>
            )}
          </form>
        </section>

        <SidePanel />
      </main>
    </div>
  );
}
