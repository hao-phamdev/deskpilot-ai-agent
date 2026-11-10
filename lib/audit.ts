/** Append-only audit log of everything the agent does, persisted in localStorage. */
import { createStore } from "./storage";

export type AuditType =
  | "user_request"
  | "llm_response"
  | "tool_call"
  | "validation_failed"
  | "confirmation_requested"
  | "approved"
  | "denied"
  | "executed"
  | "execution_failed"
  | "api_error";

export interface AuditEntry {
  id: string;
  ts: string;
  type: AuditType;
  summary: string;
  tool?: string;
  risk?: string;
  detail?: unknown;
}

const MAX_ENTRIES = 500;
export const auditStore = createStore<AuditEntry[]>(() => [], "deskpilot.audit.v1");

let counter = 0;
export function audit(type: AuditType, summary: string, extra: Partial<AuditEntry> = {}) {
  const entry: AuditEntry = {
    id: `${Date.now().toString(36)}-${(counter++).toString(36)}`,
    ts: new Date().toISOString(),
    type,
    summary,
    ...extra,
  };
  const next = [...auditStore.get(), entry];
  auditStore.set(next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next);
  return entry;
}

export function clearAudit() {
  auditStore.set([]);
}

export function exportAudit() {
  const blob = new Blob([JSON.stringify(auditStore.get(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deskpilot-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
