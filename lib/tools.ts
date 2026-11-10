/**
 * Tool registry — the single source of truth for every action the agent can take.
 *
 * Each tool has:
 *  - a Zod schema, used on the client to VALIDATE the LLM's output before anything runs,
 *    and converted to JSON Schema so Claude sees exactly the same contract;
 *  - a domain (files / todos / web / system) for the UI;
 *  - a base risk level (read / write / destructive) that drives the safety gate.
 *
 * This file is shared by the server route (to send tool definitions to Claude)
 * and the browser (to validate + execute), so it must not import server-only code.
 */
import { z } from "zod";

export type Risk = "read" | "write" | "destructive";
export type Domain = "files" | "todos" | "web" | "system";

const reason = z
  .string()
  .min(3)
  .max(200)
  .describe(
    "One short, user-facing sentence explaining why you are taking this action (shown on the action card).",
  );

const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_\\-. ]*";
const PATH_RE = new RegExp(`^${SEGMENT}(/${SEGMENT}){0,4}$`);

export const filePath = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    PATH_RE,
    "Path must be relative (no leading slash), use only letters, numbers, spaces, _ - . and at most 5 levels deep.",
  )
  .refine((p) => !p.split("/").some((s) => s === "." || s === ".."), {
    message: "Path may not contain '.' or '..' segments.",
  })
  .describe('Relative path inside the workspace, e.g. "notes/cs4680.md".');

export const MAX_FILE_CHARS = 20_000;
export const MAX_FILES = 50;
export const MAX_TODOS = 100;

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO currency code like USD, EUR, JPY.")
  .transform((s) => s.toUpperCase());

export const TOOL_SPECS = {
  // ─── Files ────────────────────────────────────────────────────────────────
  list_files: {
    domain: "files",
    risk: "read",
    description:
      "List every file in the user's workspace with its size and last-modified time. Use when you need an up-to-date listing beyond the <workspace_state> snapshot.",
    schema: z.object({ reason }),
  },
  read_file: {
    domain: "files",
    risk: "read",
    description:
      "Read the full text content of one workspace file. Always read a file before summarizing or editing it — never guess its contents.",
    schema: z.object({ path: filePath, reason }),
  },
  write_file: {
    domain: "files",
    risk: "write",
    description:
      "Create a new text file, or replace the content of an existing one. Overwriting an existing file is destructive and the app will ask the user to approve it. To edit a file, read it first, then write the complete new content. Prefer Markdown (.md) for notes.",
    schema: z.object({
      path: filePath,
      content: z
        .string()
        .max(MAX_FILE_CHARS)
        .describe(`The complete file content (max ${MAX_FILE_CHARS} characters).`),
      reason,
    }),
  },
  delete_file: {
    domain: "files",
    risk: "destructive",
    description:
      "Permanently delete one file from the workspace. Destructive: the user must approve it in the app before it runs.",
    schema: z.object({ path: filePath, reason }),
  },

  // ─── Todos ────────────────────────────────────────────────────────────────
  add_todo: {
    domain: "todos",
    risk: "write",
    description:
      "Add a task to the user's todo list. Convert relative dates (\"Friday\", \"tomorrow\") to YYYY-MM-DD using the current date in <workspace_state>.",
    schema: z.object({
      title: z.string().trim().min(1).max(140).describe("Short task title."),
      due: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.")
        .optional()
        .describe("Optional due date, YYYY-MM-DD."),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Defaults to medium."),
      reason,
    }),
  },
  list_todos: {
    domain: "todos",
    risk: "read",
    description: "List all todos with their id, title, status, due date and priority.",
    schema: z.object({ reason }),
  },
  update_todo: {
    domain: "todos",
    risk: "write",
    description:
      "Update an existing todo by id (e.g. \"t3\"): mark it done/undone, rename it, or change its due date or priority. Only pass the fields you want to change.",
    schema: z.object({
      id: z.string().regex(/^t\d+$/, 'Todo ids look like "t1", "t2".'),
      done: z.boolean().optional(),
      title: z.string().trim().min(1).max(140).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      reason,
    }),
  },
  delete_todo: {
    domain: "todos",
    risk: "destructive",
    description:
      "Permanently delete one todo by id. Destructive: the user must approve it. For bulk requests, call this once per matching todo.",
    schema: z.object({
      id: z.string().regex(/^t\d+$/, 'Todo ids look like "t1", "t2".'),
      reason,
    }),
  },
  clear_workspace: {
    domain: "files",
    risk: "destructive",
    description:
      "Bulk-delete ALL files, ALL todos, or both. Highly destructive — only use when the user explicitly asks to wipe everything in that category.",
    schema: z.object({
      target: z.enum(["files", "todos", "all"]),
      reason,
    }),
  },

  // ─── Web APIs ─────────────────────────────────────────────────────────────
  get_weather: {
    domain: "web",
    risk: "read",
    description:
      "Get the current weather and a 3-day forecast for a city via the Open-Meteo API. Use for any weather question — never answer weather from memory.",
    schema: z.object({
      city: z.string().trim().min(2).max(80).describe('City name, optionally with country, e.g. "Paris" or "Portland, US".'),
      reason,
    }),
  },
  convert_currency: {
    domain: "web",
    risk: "read",
    description:
      "Convert an amount between currencies using today's European Central Bank reference rates (Frankfurter API).",
    schema: z.object({
      amount: z.number().positive().max(1e12),
      from: currency,
      to: currency,
      reason,
    }),
  },

  // ─── System utilities ─────────────────────────────────────────────────────
  calculate: {
    domain: "system",
    risk: "read",
    description:
      "Evaluate a math expression exactly. Supports + - * / ^ % ( ), and sqrt, abs, round, floor, ceil, min, max, log (base 10), ln, sin, cos, tan, pi, e. Use for ANY arithmetic instead of computing in your head.",
    schema: z.object({
      expression: z.string().trim().min(1).max(200).describe('e.g. "86.40 * 0.15" or "sqrt(2)^2"'),
      reason,
    }),
  },
  get_time: {
    domain: "system",
    risk: "read",
    description: "Get the current date and time, optionally in a specific IANA time zone (e.g. \"Asia/Tokyo\").",
    schema: z.object({
      timezone: z.string().trim().max(60).optional().describe("IANA time zone; omit for the user's local time."),
      reason,
    }),
  },
} as const satisfies Record<
  string,
  { domain: Domain; risk: Risk; description: string; schema: z.ZodObject }
>;

export type ToolName = keyof typeof TOOL_SPECS;
export type ToolInput<N extends ToolName> = z.infer<(typeof TOOL_SPECS)[N]["schema"]>;

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_SPECS, name);
}

/** JSON-Schema tool definitions in the shape the Claude Messages API expects. */
export function claudeToolDefinitions() {
  return (Object.keys(TOOL_SPECS) as ToolName[]).map((name) => {
    const spec = TOOL_SPECS[name];
    const { $schema: _ignored, ...schema } = z.toJSONSchema(spec.schema, { io: "input" }) as Record<
      string,
      unknown
    >;
    return {
      name,
      description: spec.description,
      input_schema: { ...schema, type: "object" as const },
    };
  });
}

export type ValidationResult =
  | { ok: true; name: ToolName; input: Record<string, unknown> }
  | { ok: false; error: string };

/** Validate a raw tool call from the LLM. Nothing executes unless this passes. */
export function validateToolCall(name: string, rawInput: unknown): ValidationResult {
  if (!isToolName(name)) {
    return { ok: false, error: `Unknown tool "${name}". Only the provided tools exist.` };
  }
  const parsed = TOOL_SPECS[name].schema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: issues };
  }
  return { ok: true, name, input: parsed.data as Record<string, unknown> };
}
