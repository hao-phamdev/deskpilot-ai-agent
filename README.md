# DeskPilot: an AI agent that turns LLM output into real actions

**CS4680 Project.** DeskPilot is a web-based AI agent. You type a request in plain English, Claude (Anthropic) decides which actions to take, and the app **validates, risk-checks, confirms, executes and logs** each one.

> "Make a study plan for my CS4680 final in a file and add 3 todos for it."
> → `write_file` → `add_todo` ×3 → summary. Every step is shown live and saved to an audit log.

---

## 1. Problem

Students juggle notes, deadlines and small lookups (weather, currency, quick math) across many apps. Chatbots can *talk* about these tasks, but they don't *do* them, and an LLM that acts on your data without checks is risky. DeskPilot shows how to build an agent that does real work **safely**. It validates LLM output before running it, asks before destructive actions, and keeps an audit trail of everything.

## 2. Features at a glance

| Requirement | How DeskPilot meets it |
|---|---|
| **LLM integration** | Claude API through the official `@anthropic-ai/sdk` with native tool use ([app/api/agent/route.ts](app/api/agent/route.ts)). |
| Handle API errors & rate limiting | SDK retries with exponential backoff (429/5xx, 3 retries). Typed error mapping (`RateLimitError`, `AuthenticationError`, …) returns friendly JSON. The client retries 429/503 using `Retry-After`. A per-IP server rate limit (60 req / 10 min). Server-side refusal fallback. |
| **Action interpreter** | Parses `tool_use` blocks from Claude's response into action cards, runs them, and feeds `tool_result`s back in a loop until the task is done (max 10 steps) ([lib/useAgent.ts](lib/useAgent.ts)). |
| Multiple domains | **Files** (virtual file system), **Todos** (CRUD), **Web APIs** (Open-Meteo weather, ECB currency rates), **System** (safe calculator, world clock) ([lib/executor.ts](lib/executor.ts)). |
| **User interface** | Chat UI with example prompts, live action cards (Queued → Running → Done/Failed), reasoning summaries, and a side panel showing Files / Todos / Audit log. Works in light and dark mode and on mobile. |
| **Validation** | Every tool call is checked against a Zod schema before running ([lib/tools.ts](lib/tools.ts)): path traversal blocked, sizes capped, enums and date formats enforced, unknown tools rejected. Invalid calls are **not executed**. The error goes back to Claude so it can correct itself. |
| **Safety checks** | Each action has a risk level: `read` / `write` / `destructive`. Destructive actions (delete, overwrite an existing file, clear) **pause for Approve / Deny** and show an impact preview. The calculator uses a hand-written parser (no `eval`). No shell access exists at all. |
| **Audit log** | Every request, LLM response, tool call, validation failure, approval/denial, result and API error is logged with a timestamp, viewable in the UI and exportable as JSON ([lib/audit.ts](lib/audit.ts)). |

## 3. Architecture

```
 Browser (Next.js client)                                   Vercel serverless          Anthropic
┌──────────────────────────────────────────────────────┐   ┌──────────────────┐      ┌──────────┐
│  Chat UI ──▶ Agent loop (useAgent)                   │   │  /api/agent      │      │  Claude  │
│               │  1. add <workspace_state> + request  │──▶│  validate body   │─────▶│ Messages │
│               │                                      │   │  rate-limit      │      │   API    │
│               │  2. receive content (text/tool_use)  │◀──│  system prompt   │◀─────│ + tools  │
│               ▼                                      │   │  + tool schemas  │      └──────────┘
│   Interpreter: tool_use ─▶ Zod validate ─▶ risk ─┐   │   │  retries/errors  │
│                                                  ▼   │   └──────────────────┘
│              destructive? ─▶ Approve/Deny card       │
│                                                  ▼   │
│   Executor: files │ todos │ weather │ fx │ calc │ time
│               │                                      │
│               └─▶ tool_result ─▶ back to step 2      │
│                                                      │
│  localStorage: workspace (files + todos), audit log  │
└──────────────────────────────────────────────────────┘
```

* **No database.** The workspace and audit log live in the visitor's browser (`localStorage`), so each visitor gets their own private sandbox.
* **The server is a stateless relay.** It holds the API key, attaches the system prompt and tool definitions, and never executes tools.
* **Tools run client-side.** This makes the human-in-the-loop confirmation natural, and the agent can't touch the server or the user's real computer.

## 4. Prompt engineering

The system prompt is in [lib/prompt.ts](lib/prompt.ts). It uses these techniques:

1. **Role and scope.** A clear persona ("DeskPilot… you complete tasks by calling tools") sets the agent's behavior.
2. **XML-structured sections** (`<role>`, `<environment>`, `<how_to_work>`, `<safety_rules>`, `<response_style>`, `<examples>`) make the instructions easy for the model to follow.
3. **Context injection / grounding.** Every user turn is prefixed with a fresh `<workspace_state>` snapshot (files, todos, current date/time/time zone). The model can then resolve "my notes" or "next Friday" without guessing or extra calls.
4. **Step-by-step procedure** (understand → plan → act → verify → report), which also tells the model to batch independent calls in parallel.
5. **Few-shot examples.** These cover a normal action, parallel tool calls, an ambiguous request that needs a clarifying question, and how to respond to a denied action.
6. **Structured output through tool schemas.** Actions come back as JSON matching a schema, not free text. Every tool requires a `reason` field, so the model explains each action in plain language on the action card.
7. **Safety and anti-prompt-injection rules.** File contents and API data are treated as untrusted, the agent may not work around a denial, and it must not invent tool-provided facts (weather, rates, math).
8. **Self-correction loop.** Validation and execution errors are returned as `is_error` tool results with instructions, so the model fixes its own mistakes.
9. **Adaptive thinking with reasoning summaries.** Claude plans internally, and the UI shows a collapsible "Reasoning summary".
10. **Prompt caching.** The system prompt and tools stay static (volatile context goes in the user turn), so they can be cached.

## 5. Tools

| Domain | Tool | Risk |
|---|---|---|
| Files | `list_files`, `read_file` | read |
| | `write_file` | write (**destructive** if it overwrites an existing file) |
| | `delete_file` | destructive |
| Todos | `list_todos` | read |
| | `add_todo`, `update_todo` | write |
| | `delete_todo` | destructive |
| Workspace | `clear_workspace` | destructive |
| Web API | `get_weather` (Open-Meteo), `convert_currency` (Frankfurter / ECB) | read |
| System | `calculate` (safe parser), `get_time` (any IANA time zone) | read |

## 6. Run locally

```bash
npm install
cp .env.example .env.local     # then put your key in ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

## 7. Deploy (Vercel)

1. Import this GitHub repo in Vercel (framework preset: Next.js).
2. Add the environment variable `ANTHROPIC_API_KEY`.
3. Deploy. Later pushes to `main` redeploy automatically.

Optional environment variables: `ANTHROPIC_MODEL` (default `claude-opus-5-5`) and `ANTHROPIC_EFFORT` (`low` / `medium` / `high`, default `medium`).

## 8. Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Anthropic TypeScript SDK · Zod 4 · Open-Meteo API · Frankfurter API
