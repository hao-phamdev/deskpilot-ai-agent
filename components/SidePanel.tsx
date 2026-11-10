"use client";
import { useState, useSyncExternalStore } from "react";
import { type AuditEntry, auditStore, clearAudit, exportAudit } from "@/lib/audit";
import { resetWorkspace, workspaceStore } from "@/lib/workspace";

const useWorkspace = () => useSyncExternalStore(workspaceStore.subscribe, workspaceStore.get, workspaceStore.getServerSnapshot);
const useAudit = () => useSyncExternalStore(auditStore.subscribe, auditStore.get, auditStore.getServerSnapshot);

type Tab = "files" | "todos" | "audit";

const AUDIT_TONE: Partial<Record<AuditEntry["type"], string>> = {
  user_request: "text-[var(--accent)]",
  executed: "text-[var(--ok)]",
  approved: "text-[var(--ok)]",
  validation_failed: "text-[var(--danger)]",
  execution_failed: "text-[var(--danger)]",
  api_error: "text-[var(--danger)]",
  denied: "text-[var(--warn)]",
  confirmation_requested: "text-[var(--warn)]",
};

export function SidePanel() {
  const ws = useWorkspace();
  const log = useAudit();
  const [tab, setTab] = useState<Tab>("files");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const paths = Object.keys(ws.files).sort();
  const openFile = selected && ws.files[selected] ? selected : null;
  const openTodos = ws.todos.filter((t) => !t.done).length;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "files", label: "Files", count: paths.length },
    { id: "todos", label: "Todos", count: openTodos },
    { id: "audit", label: "Audit log", count: log.length },
  ];

  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="flex items-center gap-1 border-b border-[var(--border)] p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-[var(--chip)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
          >
            {t.label}
            <span className="rounded-full bg-[var(--bg)] px-1.5 text-[0.7rem] tabular-nums">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {tab === "files" && (
          <>
            {paths.length === 0 && <p className="text-[var(--muted)]">No files yet. Ask the agent to create one.</p>}
            <ul className="space-y-0.5">
              {paths.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => setSelected(p === selected ? null : p)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-[0.8rem] ${openFile === p ? "bg-[var(--chip)]" : "hover:bg-[var(--chip)]/60"}`}
                  >
                    <span aria-hidden>📄</span>
                    <span className="truncate">{p}</span>
                    <span className="ml-auto shrink-0 text-[var(--muted)]">{ws.files[p].content.length} ch</span>
                  </button>
                </li>
              ))}
            </ul>
            {openFile && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                  <span className="font-mono">{openFile}</span>
                  <span>updated {new Date(ws.files[openFile].updatedAt).toLocaleTimeString()}</span>
                </div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">{ws.files[openFile].content || "(empty)"}</pre>
              </div>
            )}
          </>
        )}

        {tab === "todos" && (
          <>
            {ws.todos.length === 0 && <p className="text-[var(--muted)]">No todos. Ask the agent to add some.</p>}
            <ul className="space-y-1.5">
              {ws.todos.map((t) => (
                <li key={t.id} className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[0.6rem] ${t.done ? "border-[var(--ok)] bg-[var(--ok)] text-white" : "border-[var(--muted)]"}`}>
                    {t.done ? "✓" : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={t.done ? "text-[var(--muted)] line-through" : ""}>{t.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      <span className="font-mono">{t.id}</span>
                      {t.due && <> · due {t.due}</>}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-medium uppercase ${
                      t.priority === "high" ? "bg-[var(--danger)]/15 text-[var(--danger)]" : t.priority === "low" ? "bg-[var(--chip)] text-[var(--muted)]" : "bg-[var(--accent)]/15 text-[var(--accent)]"
                    }`}
                  >
                    {t.priority}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === "audit" && (
          <>
            <div className="mb-2 flex gap-2">
              <button onClick={exportAudit} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:bg-[var(--chip)]">
                Export JSON
              </button>
              <button
                onClick={() => window.confirm("Clear the entire audit log?") && clearAudit()}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--chip)]"
              >
                Clear log
              </button>
            </div>
            {log.length === 0 && <p className="text-[var(--muted)]">Every request, tool call, approval and result will be logged here.</p>}
            <ol className="space-y-1">
              {[...log].reverse().map((e) => (
                <li key={e.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5">
                  <button className="w-full text-left" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono tabular-nums text-[var(--muted)]">{new Date(e.ts).toLocaleTimeString()}</span>
                      <span className={`font-semibold ${AUDIT_TONE[e.type] ?? "text-[var(--fg)]"}`}>{e.type}</span>
                      {e.risk && <span className="text-[var(--muted)]">· {e.risk}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-[0.8rem]">{e.summary}</p>
                  </button>
                  {expanded === e.id && e.detail !== undefined && (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--code-bg)] p-2 font-mono text-[0.7rem]">{JSON.stringify(e.detail, null, 2)}</pre>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
        Stored only in this browser (localStorage).{" "}
        <button
          className="underline hover:text-[var(--fg)]"
          onClick={() => window.confirm("Reset the workspace to the demo files and todos?") && resetWorkspace()}
        >
          Reset workspace
        </button>
      </div>
    </aside>
  );
}
