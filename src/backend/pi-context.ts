import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

/**
 * How long a Pi request's prompt cache stays warm, in milliseconds. Only a request after this gap
 * prunes old tool results: the prefix that the prune changes is not in the cache any more.
 */
export const PI_SHORT_CACHE_MS = 5 * 60_000;
export const PI_LONG_CACHE_MS = 60 * 60_000;

/*
 * Keeps a long Pi session small without breaking its prompt cache.
 *
 * - A large tool result goes to a file next to the session, and the model gets its start, its end
 *   and the path. Pi's own `bash` and `read` already cut their output and keep the whole of it, so
 *   only the other tools are cut here: MCP tools, OpenBot's tools and the web tools. The cut is made
 *   once, when the result arrives, so the session replays the same bytes.
 * - After the cache has expired, the next request clears the text of old tool results: the ones
 *   before the last three answers. A cleared result stays cleared for the rest of the process, so
 *   later requests send the same bytes and the cache that the first one writes stays valid.
 */
const EXTENSION = `export default async function (pi) {
  // Dynamic imports only: main's bundle holds this text, and electron-vite puts its \`__dirname\`
  // shim after the last static import that it finds there, also one inside a string.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const slot = Symbol.for("openbot.pi.context");
  globalThis[slot] ??= { cacheMs: Number(process.env.OPENBOT_PI_CACHE_TTL_MS) || ${PI_SHORT_CACHE_MS}, sessions: new Map() };
  delete process.env.OPENBOT_PI_CACHE_TTL_MS;
  const state = globalThis[slot];
  const session = (ctx) => {
    const key = ctx.sessionManager?.getSessionFile?.() ?? "";
    let entry = state.sessions.get(key);
    if (!entry) state.sessions.set(key, (entry = { lastRequestAt: 0, cleared: new Set() }));
    return { key, entry };
  };

  const SPILL_CHARACTERS = 30000;
  const HEAD = 6000;
  const TAIL = 2000;
  const CUT_BY_PI = new Set(["bash", "read", "powershell"]);
  pi.on("tool_result", (event, ctx) => {
    if (CUT_BY_PI.has(event.toolName)) return;
    const texts = event.content.filter((part) => part.type === "text");
    const whole = texts.map((part) => part.text).join("\\n");
    if (whole.length <= SPILL_CHARACTERS) return;
    const { key } = session(ctx);
    if (!key) return;
    const folder = join(dirname(key), "openbot-tool-output");
    const path = join(folder, \`\${event.toolCallId.replace(/[^A-Za-z0-9_-]/g, "_")}.txt\`);
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(path, whole, { mode: 0o600 });
    } catch {
      return;
    }
    const images = event.content.filter((part) => part.type !== "text");
    const note = \`[The output has \${whole.length} characters. The start and the end are shown. The whole output is in \${path}; read it with the read tool and its offset and limit.]\`;
    return {
      content: [{ type: "text", text: \`\${whole.slice(0, HEAD)}\\n\\n…\\n\\n\${whole.slice(-TAIL)}\\n\\n\${note}\` }, ...images],
    };
  });

  const KEEP_ANSWERS = 3;
  const CLEAR_CHARACTERS = 2000;
  const CLEARED = "[Old tool output cleared to keep the context small. Run the tool again if you need it.]";
  pi.on("context", (event, ctx) => {
    const { entry } = session(ctx);
    const now = Date.now();
    const expired = entry.lastRequestAt > 0 && now - entry.lastRequestAt > state.cacheMs;
    entry.lastRequestAt = now;
    if (expired) {
      let answers = 0;
      for (let index = event.messages.length - 1; index >= 0; index -= 1) {
        const message = event.messages[index];
        if (message.role === "assistant") answers += 1;
        if (answers < KEEP_ANSWERS || message.role !== "toolResult") continue;
        const size = message.content.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
        if (size > CLEAR_CHARACTERS) entry.cleared.add(message.toolCallId);
      }
    }
    if (entry.cleared.size === 0) return;
    let changed = false;
    const messages = event.messages.map((message) => {
      if (message.role !== "toolResult" || !entry.cleared.has(message.toolCallId)) return message;
      changed = true;
      return { ...message, content: [{ type: "text", text: CLEARED }] };
    });
    return changed ? { messages } : undefined;
  });
}
`;

/** Owns one temporary extension file that keeps a long Pi session small. It holds no secret. */
export const createPiContextExtension = Effect.fn("PiContext.createExtension")(function* (
  cacheMs: number,
  directory?: string,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "context.mjs");
  yield* providerCall(() => writeFile(path, EXTENSION, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  return {
    path,
    environment: { OPENBOT_PI_CACHE_TTL_MS: String(cacheMs) },
    secrets: [],
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
