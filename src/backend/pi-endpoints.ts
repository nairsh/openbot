import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { CustomProviderConfig } from "./opencode-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

/*
 * The Direct provider: the user's own OpenAI-compatible endpoints in Pi, with web tools that a
 * generic endpoint does not give.
 *
 * Each endpoint is a Pi provider with the endpoint's id, so a model id is `<endpointId>/<model>` as
 * it is for OpenCode. The keys and headers arrive in the environment, are removed before a tool can
 * start a child process, and are never written to the extension file. Pi runs the extension again
 * when it switches sessions, so they stay in a process slot for those later runs. Pi reads a value
 * that starts with `$` or `!` as an environment reference or a shell command, so each is escaped to
 * stay a literal.
 *
 * An endpoint gives no model limits, so each model gets a 128K window and 16K of output. Pi prices
 * a model from its cost table, which is empty here; a cost that the endpoint reports with its usage,
 * as OpenRouter does, goes on the message, so the session's cost is the endpoint's own.
 */
const EXTENSION = `export default function (pi) {
  const slot = Symbol.for("openbot.pi.directEndpoints");
  globalThis[slot] ??= JSON.parse(process.env.OPENBOT_PI_DIRECT_ENDPOINTS || "[]");
  delete process.env.OPENBOT_PI_DIRECT_ENDPOINTS;
  const literal = (value) => value.replaceAll("$", "$$$$").replace(/^!/, "$$!");
  const free = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const endpoint of globalThis[slot]) {
    pi.registerProvider(endpoint.id, {
      baseUrl: endpoint.baseUrl,
      api: endpoint.api,
      apiKey: literal(endpoint.apiKey || "none"),
      headers: Object.fromEntries(endpoint.headers.map((header) => [header.name, literal(header.value)])),
      models: endpoint.models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: free,
      })),
    });
  }

  let reportedCost = 0;
  pi.on("provider_stream_event", (event) => {
    const cost = event.data?.usage?.cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) reportedCost = cost;
  });
  pi.on("message_end", (event) => {
    const cost = reportedCost;
    reportedCost = 0;
    const message = event.message;
    if (message.role !== "assistant" || cost <= 0 || !message.usage?.cost || message.usage.cost.total > 0) return;
    return { message: { ...message, usage: { ...message.usage, cost: { ...message.usage.cost, total: cost } } } };
  });

  const MAX_BYTES = 5 * 1024 * 1024;
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decode = (text) =>
    text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    });
  const pageText = (html) =>
    decode(
      html
        .replace(/<(script|style|noscript|svg|head)[^>]*>[\\s\\S]*?<\\/\\1>/gi, " ")
        .replace(/<!--[\\s\\S]*?-->/g, " ")
        .replace(/<(br|\\/p|\\/div|\\/li|\\/h[1-6]|\\/tr|\\/section|\\/article)[^>]*>/gi, "\\n")
        .replace(/<li[^>]*>/gi, "\\n- ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/[ \\t\\f\\v]+/g, " ")
      .replace(/ *\\n */g, "\\n")
      .replace(/\\n{3,}/g, "\\n\\n")
      .trim();
  const read = async (response) => {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
  };
  const timed = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
  const text = (value, details) => ({ content: [{ type: "text", text: value }], details });

  pi.registerTool({
    name: "web_fetch",
    label: "Web fetch",
    description:
      "Fetch a web page or file over HTTP(S) and return its readable text. HTML is reduced to text; JSON and plain text are returned as they are. Use it to read documentation, articles, or a URL from web_search.",
    promptSnippet: "Read a web page or URL as text",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http or https URL to fetch" },
        max_length: { type: "number", description: "The most characters to return. Default 40000." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    async execute(_id, params, signal) {
      let url;
      try {
        url = new URL(params.url);
      } catch {
        throw new Error("The URL is not valid.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https URLs can be fetched.");
      const response = await fetch(url, {
        redirect: "follow",
        signal: timed(signal, 30000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; OpenBot)", accept: "text/html,text/plain,application/json,*/*;q=0.5" },
      });
      const type = response.headers.get("content-type") ?? "";
      const body = await read(response);
      const readable = /html|xml/i.test(type) || /^\\s*</.test(body) ? pageText(body) : body.trim();
      const limit = Math.max(1000, Math.min(200000, Math.floor(params.max_length ?? 40000)));
      const shown = readable.length > limit ? readable.slice(0, limit) + "\\n\\n[Truncated]" : readable;
      return text(\`\${response.status} \${response.url}\\n\\n\${shown || "(no text)"}\`, { url: response.url, status: response.status });
    },
  });

  const tavily = async (query, count, signal) => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: timed(signal, 30000),
      headers: { "content-type": "application/json", authorization: \`Bearer \${process.env.TAVILY_API_KEY}\` },
      body: JSON.stringify({ query, max_results: count }),
    });
    if (!response.ok) throw new Error(\`The search failed with HTTP \${response.status}.\`);
    const data = await response.json();
    return (data.results ?? []).map((result) => ({ title: result.title, url: result.url, snippet: result.content }));
  };
  const duckDuckGo = async (query, count, signal) => {
    const response = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      signal: timed(signal, 30000),
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (compatible; OpenBot)" },
      body: new URLSearchParams({ q: query }).toString(),
    });
    if (!response.ok) throw new Error(\`The search failed with HTTP \${response.status}.\`);
    const html = await read(response);
    const results = [];
    const links = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/g)];
    const snippets = [...html.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:a|div|td)>/g)];
    for (const [index, link] of links.entries()) {
      let url = decode(link[1]);
      if (url.startsWith("//")) url = \`https:\${url}\`;
      try {
        const target = new URL(url).searchParams.get("uddg");
        if (target) url = target;
      } catch {}
      if (url.includes("duckduckgo.com/y.js")) continue;
      results.push({ title: pageText(link[2]), url, snippet: pageText(snippets[index]?.[1] ?? "") });
      if (results.length >= count) break;
    }
    return results;
  };

  pi.registerTool({
    name: "web_search",
    label: "Web search",
    description:
      "Search the web and return the top results with title, URL and snippet. Use it for current information, documentation, or anything outside the workspace; read a result with web_fetch.",
    promptSnippet: "Search the web for current information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        count: { type: "number", description: "How many results to return, 1 to 10. Default 5." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(_id, params, signal) {
      const count = Math.max(1, Math.min(10, Math.floor(params.count ?? 5)));
      const results = process.env.TAVILY_API_KEY
        ? await tavily(params.query, count, signal)
        : await duckDuckGo(params.query, count, signal);
      if (results.length === 0) return text("No results.", { count: 0 });
      return text(
        results.map((result, index) => \`\${index + 1}. \${result.title}\\n   \${result.url}\\n   \${result.snippet}\`).join("\\n\\n"),
        { count: results.length },
      );
    },
  });
}
`;

/** The Pi API that serves an endpoint: Anthropic's own API, or OpenAI chat completions. */
function endpointApi(baseUrl: string): { api: string; baseUrl: string } {
  const url = URL.canParse(baseUrl) ? new URL(baseUrl) : null;
  return url?.protocol === "https:" && url.hostname === "api.anthropic.com"
    ? { api: "anthropic-messages", baseUrl: url.origin }
    : { api: "openai-completions", baseUrl };
}

/** Owns one temporary, secret-free extension file that adds the endpoints and the web tools to Pi. */
export const createPiEndpointsExtension = Effect.fn("PiEndpoints.createExtension")(function* (
  endpoints: readonly CustomProviderConfig[],
  directory?: string,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "direct.mjs");
  yield* providerCall(() => writeFile(path, EXTENSION, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  const secrets = endpoints.flatMap((endpoint) => [
    ...(endpoint.apiKey ? [endpoint.apiKey] : []),
    ...endpoint.headers.map((header) => header.value).filter(Boolean),
  ]);
  const list = endpoints.map((endpoint) => ({
    id: endpoint.id,
    ...endpointApi(endpoint.baseUrl),
    apiKey: endpoint.apiKey,
    headers: endpoint.headers,
    models: endpoint.models,
  }));
  return {
    path,
    environment: { OPENBOT_PI_DIRECT_ENDPOINTS: JSON.stringify(list) },
    secrets,
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
