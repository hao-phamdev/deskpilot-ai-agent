/**
 * Action Executor — turns a VALIDATED tool call into a real operation.
 *
 * Domains:
 *   files  → virtual file system in localStorage
 *   todos  → todo list in localStorage
 *   web    → live HTTP APIs (Open-Meteo weather, Frankfurter/ECB currency rates)
 *   system → safe calculator, clock
 *
 * Every function returns a string result for Claude, or throws an Error whose
 * message is sent back to Claude as an error tool_result.
 */
import { evaluate } from "./math";
import { MAX_FILES, MAX_TODOS, type Risk, type ToolInput, type ToolName, TOOL_SPECS } from "./tools";
import { type Todo, workspaceStore } from "./workspace";

/** Base risk from the registry, escalated by context (e.g. overwriting an existing file). */
export function assessRisk(name: ToolName, input: Record<string, unknown>): Risk {
  const base = TOOL_SPECS[name].risk;
  if (name === "write_file" && typeof input.path === "string" && workspaceStore.get().files[input.path]) {
    return "destructive"; // overwrite
  }
  return base;
}

/** Human-readable preview of what a destructive action will do (shown on the confirm card). */
export function describeImpact(name: ToolName, input: Record<string, unknown>): string | undefined {
  const ws = workspaceStore.get();
  switch (name) {
    case "write_file": {
      const f = ws.files[input.path as string];
      return f ? `Overwrites ${input.path} (${f.content.length} chars → ${(input.content as string).length} chars).` : undefined;
    }
    case "delete_file": {
      const f = ws.files[input.path as string];
      return f ? `Deletes ${input.path} (${f.content.length} chars).` : `${input.path} does not exist.`;
    }
    case "delete_todo": {
      const t = ws.todos.find((x) => x.id === input.id);
      return t ? `Deletes todo ${t.id}: "${t.title}".` : `Todo ${input.id} does not exist.`;
    }
    case "clear_workspace": {
      const parts = [];
      if (input.target !== "todos") parts.push(`${Object.keys(ws.files).length} file(s)`);
      if (input.target !== "files") parts.push(`${ws.todos.length} todo(s)`);
      return `Permanently deletes ${parts.join(" and ")}.`;
    }
  }
  return undefined;
}

const now = () => new Date().toISOString();

function fmtTodo(t: Todo) {
  return `${t.id} [${t.done ? "x" : " "}] ${t.title} (priority: ${t.priority}${t.due ? `, due ${t.due}` : ""})`;
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

const WEATHER_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
  77: "snow grains", 80: "light showers", 81: "showers", 82: "violent showers", 85: "snow showers",
  86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

type Handlers = { [N in ToolName]: (input: ToolInput<N>) => Promise<string> | string };

const handlers: Handlers = {
  // ── Files ──────────────────────────────────────────────────────────────────
  list_files() {
    const files = workspaceStore.get().files;
    const paths = Object.keys(files).sort();
    if (!paths.length) return "The workspace has no files.";
    return paths.map((p) => `${p} — ${files[p].content.length} chars, updated ${files[p].updatedAt}`).join("\n");
  },
  read_file({ path }) {
    const f = workspaceStore.get().files[path];
    if (!f) throw new Error(`File not found: ${path}. Existing files: ${Object.keys(workspaceStore.get().files).join(", ") || "none"}`);
    return f.content || "(empty file)";
  },
  write_file({ path, content }) {
    const ws = workspaceStore.get();
    const existing = ws.files[path];
    if (!existing && Object.keys(ws.files).length >= MAX_FILES) {
      throw new Error(`Workspace file limit reached (${MAX_FILES}). Delete something first.`);
    }
    const t = now();
    workspaceStore.set({
      ...ws,
      files: { ...ws.files, [path]: { content, createdAt: existing?.createdAt ?? t, updatedAt: t } },
    });
    return `${existing ? "Overwrote" : "Created"} ${path} (${content.length} chars).`;
  },
  delete_file({ path }) {
    const ws = workspaceStore.get();
    if (!ws.files[path]) throw new Error(`File not found: ${path}`);
    const { [path]: _removed, ...rest } = ws.files;
    workspaceStore.set({ ...ws, files: rest });
    return `Deleted ${path}.`;
  },

  // ── Todos ──────────────────────────────────────────────────────────────────
  add_todo({ title, due, priority }) {
    const ws = workspaceStore.get();
    if (ws.todos.length >= MAX_TODOS) throw new Error(`Todo limit reached (${MAX_TODOS}).`);
    const todo: Todo = { id: `t${ws.nextTodoId}`, title, due, priority: priority ?? "medium", done: false, createdAt: now() };
    workspaceStore.set({ ...ws, todos: [...ws.todos, todo], nextTodoId: ws.nextTodoId + 1 });
    return `Added ${fmtTodo(todo)}`;
  },
  list_todos() {
    const todos = workspaceStore.get().todos;
    return todos.length ? todos.map(fmtTodo).join("\n") : "The todo list is empty.";
  },
  update_todo({ id, done, title, due, priority }) {
    const ws = workspaceStore.get();
    const existing = ws.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Todo ${id} not found. Existing ids: ${ws.todos.map((t) => t.id).join(", ") || "none"}`);
    const updated: Todo = {
      ...existing,
      ...(done !== undefined && { done }),
      ...(title !== undefined && { title }),
      ...(due !== undefined && { due }),
      ...(priority !== undefined && { priority }),
    };
    workspaceStore.set({ ...ws, todos: ws.todos.map((t) => (t.id === id ? updated : t)) });
    return `Updated ${fmtTodo(updated)}`;
  },
  delete_todo({ id }) {
    const ws = workspaceStore.get();
    const existing = ws.todos.find((t) => t.id === id);
    if (!existing) throw new Error(`Todo ${id} not found.`);
    workspaceStore.set({ ...ws, todos: ws.todos.filter((t) => t.id !== id) });
    return `Deleted todo ${id} ("${existing.title}").`;
  },
  clear_workspace({ target }) {
    const ws = workspaceStore.get();
    const nFiles = Object.keys(ws.files).length;
    const nTodos = ws.todos.length;
    workspaceStore.set({
      ...ws,
      files: target === "todos" ? ws.files : {},
      todos: target === "files" ? ws.todos : [],
    });
    const parts = [];
    if (target !== "todos") parts.push(`${nFiles} file(s)`);
    if (target !== "files") parts.push(`${nTodos} todo(s)`);
    return `Cleared ${parts.join(" and ")}.`;
  },

  // ── Web APIs ───────────────────────────────────────────────────────────────
  async get_weather({ city }) {
    const [name, country] = city.split(",").map((s) => s.trim());
    const geo = await fetchJSON(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`,
    );
    const results: any[] = geo.results ?? [];
    const place =
      (country && results.find((r) => [r.country_code, r.country].some((c: string) => c?.toLowerCase() === country.toLowerCase()))) ||
      results[0];
    if (!place) throw new Error(`Could not find a city named "${city}".`);
    const wx = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&timezone=auto&forecast_days=3`,
    );
    const c = wx.current;
    const days = (wx.daily.time as string[]).map(
      (d, i) =>
        `  ${d}: ${WEATHER_CODES[wx.daily.weather_code[i]] ?? "unknown"}, ${wx.daily.temperature_2m_min[i]}–${wx.daily.temperature_2m_max[i]} °C, rain chance ${wx.daily.precipitation_probability_max[i] ?? "?"}%`,
    );
    return [
      `Location: ${place.name}${place.admin1 ? `, ${place.admin1}` : ""}, ${place.country} (local time zone ${wx.timezone})`,
      `Now: ${WEATHER_CODES[c.weather_code] ?? "unknown"}, ${c.temperature_2m} °C (feels like ${c.apparent_temperature} °C), humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h`,
      `Forecast:`,
      ...days,
      `Source: Open-Meteo`,
    ].join("\n");
  },
  async convert_currency({ amount, from, to }) {
    if (from === to) return `${amount} ${from} = ${amount} ${to}`;
    const data = await fetchJSON(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`).catch((e: Error) => {
      throw new Error(`Currency lookup failed (${e.message}). The code may be unsupported by the ECB.`);
    });
    const rate = data.rates?.[to];
    if (typeof rate !== "number") throw new Error(`No rate available for ${from} → ${to}.`);
    const converted = Math.round(amount * rate * 100) / 100;
    return `${amount} ${from} = ${converted} ${to} (rate ${rate}, ECB reference rate for ${data.date}, via Frankfurter)`;
  },

  // ── System utilities ───────────────────────────────────────────────────────
  calculate({ expression }) {
    const result = evaluate(expression);
    const pretty = Number.isInteger(result) ? String(result) : String(Math.round(result * 1e10) / 1e10);
    return `${expression} = ${pretty}`;
  },
  get_time({ timezone }) {
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const s = new Date().toLocaleString("en-US", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      return `${s} (${tz})`;
    } catch {
      throw new Error(`Unknown time zone "${tz}". Use an IANA name like "Europe/London".`);
    }
  },
};

export async function executeTool(name: ToolName, input: Record<string, unknown>): Promise<string> {
  const handler = handlers[name] as (i: Record<string, unknown>) => Promise<string> | string;
  return await handler(input);
}
