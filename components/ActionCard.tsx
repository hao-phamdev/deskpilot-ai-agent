"use client";
import { useState } from "react";
import type { ActionItem } from "@/lib/useAgent";

const DOMAIN_ICON: Record<string, string> = { files: "📄", todos: "✅", web: "🌐", system: "⚙️" };

const STATUS: Record<ActionItem["status"], { label: string; cls: string; icon: string }> = {
  queued: { label: "Queued", cls: "text-[var(--muted)] border-[var(--border)]", icon: "•" },
  invalid: { label: "Rejected: invalid", cls: "text-[var(--danger)] border-[var(--danger)]/40", icon: "⛔" },
  awaiting_approval: { label: "Needs approval", cls: "text-[var(--warn)] border-[var(--warn)]/50", icon: "⚠️" },
  running: { label: "Running", cls: "text-[var(--accent)] border-[var(--accent)]/40", icon: "⏳" },
  success: { label: "Done", cls: "text-[var(--ok)] border-[var(--ok)]/40", icon: "✓" },
  error: { label: "Failed", cls: "text-[var(--danger)] border-[var(--danger)]/40", icon: "✕" },
  denied: { label: "Denied", cls: "text-[var(--muted)] border-[var(--border)]", icon: "⊘" },
};

const RISK: Record<string, string> = {
  read: "bg-[var(--chip)] text-[var(--muted)]",
  write: "bg-[var(--accent)]/15 text-[var(--accent)]",
  destructive: "bg-[var(--danger)]/15 text-[var(--danger)]",
};

function argsPreview(input: Record<string, unknown>) {
  const { reason: _r, ...rest } = input;
  return Object.entries(rest)
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${s.length > 60 ? s.slice(0, 57) + "…" : s}`;
    })
    .join("  ·  ");
}

export function ActionCard({ action, onRespond }: { action: ActionItem; onRespond: (id: string, approved: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[action.status];
  const pending = action.status === "awaiting_approval";

  return (
    <div
      className={`rounded-xl border bg-[var(--card)] p-3 text-sm transition ${pending ? "border-[var(--warn)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--warn)_20%,transparent)]" : "border-[var(--border)]"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{DOMAIN_ICON[action.domain ?? ""] ?? "🔧"}</span>
        <code className="font-mono text-[0.85rem] font-semibold">{action.tool}</code>
        {action.risk && <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide ${RISK[action.risk]}`}>{action.risk}</span>}
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-medium ${st.cls}`}>
          <span className={action.status === "running" ? "inline-block animate-spin" : ""}>{st.icon}</span> {st.label}
        </span>
      </div>

      {action.reason && <p className="mt-1.5 text-[var(--fg)]/90">{action.reason}</p>}
      {argsPreview(action.input) && <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{argsPreview(action.input)}</p>}

      {pending && (
        <div className="mt-3 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-3">
          <p className="font-medium text-[var(--warn)]">This action can't be undone.</p>
          {action.impact && <p className="mt-0.5 text-[var(--fg)]/90">{action.impact}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => onRespond(action.id, true)} className="rounded-lg bg-[var(--danger)] px-3 py-1.5 font-medium text-white hover:opacity-90">
              Approve
            </button>
            <button onClick={() => onRespond(action.id, false)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-medium hover:bg-[var(--chip)]">
              Deny
            </button>
          </div>
        </div>
      )}

      {action.output && !pending && (
        <div className="mt-2">
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">
            {open ? "▾ Hide result" : "▸ Show result"}
          </button>
          {open && (
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--code-bg)] p-2 font-mono text-xs">{action.output}</pre>
          )}
        </div>
      )}
    </div>
  );
}
