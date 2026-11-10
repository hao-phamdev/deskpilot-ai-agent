/**
 * The user's workspace: a virtual file system + todo list, persisted in localStorage.
 * No database: everything lives in the visitor's own browser.
 */
import { createStore } from "./storage";

export interface WorkspaceFile {
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  due?: string;
  priority: "low" | "medium" | "high";
  createdAt: string;
}

export interface Workspace {
  files: Record<string, WorkspaceFile>;
  todos: Todo[];
  nextTodoId: number;
}

function seed(): Workspace {
  const now = new Date().toISOString();
  return {
    files: {
      "welcome.md": {
        content: [
          "# Welcome to DeskPilot",
          "",
          "DeskPilot is an AI agent that turns plain-English requests into real actions.",
          "",
          "Try asking it to:",
          "- create notes or a study plan as files",
          "- manage your todo list",
          "- check the weather or convert currencies",
          "- do exact math or tell the time anywhere",
          "",
          "Destructive actions (delete / overwrite / clear) always ask for your approval first.",
        ].join("\n"),
        createdAt: now,
        updatedAt: now,
      },
      "notes/cs4680.md": {
        content: [
          "# CS4680 notes",
          "",
          "- Project: build an AI agent that executes actions from LLM output",
          "- Needs: LLM integration, action executor, UI, safety + logging",
          "- Submit: GitHub repo, deployed URL, 1-2 min demo video",
        ].join("\n"),
        createdAt: now,
        updatedAt: now,
      },
    },
    todos: [
      { id: "t1", title: "Record CS4680 demo video", done: false, priority: "high", createdAt: now },
      { id: "t2", title: "Buy coffee beans", done: true, priority: "low", createdAt: now },
    ],
    nextTodoId: 3,
  };
}

export const workspaceStore = createStore<Workspace>(seed, "deskpilot.workspace.v1");

export function resetWorkspace() {
  workspaceStore.set(seed());
}

/** Compact, model-readable snapshot injected at the top of every user turn. */
export function describeWorkspace(ws: Workspace): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const paths = Object.keys(ws.files).sort();
  const fileLines = paths.length
    ? paths.map((p) => `  - ${p} (${ws.files[p].content.length} chars)`).join("\n")
    : "  (none)";
  const todoLines = ws.todos.length
    ? ws.todos
        .map(
          (t) =>
            `  - ${t.id} [${t.done ? "x" : " "}] ${t.title} | priority: ${t.priority}${t.due ? ` | due: ${t.due}` : ""}`,
        )
        .join("\n")
    : "  (none)";
  return [
    "<workspace_state>",
    `now: ${local} (time zone: ${tz}; ISO date: ${toLocalISODate(now)})`,
    `files (${paths.length}):`,
    fileLines,
    `todos (${ws.todos.length}):`,
    todoLines,
    "</workspace_state>",
  ].join("\n");
}

function toLocalISODate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
