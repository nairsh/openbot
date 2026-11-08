// Runs the real `pi` and `direct` provider drivers and the real Pi binary against a fake Bifrost
// gateway, and books each turn's usage in a real OpenBot database, to check that a custom endpoint
// turn gets the cost that the endpoint reports. Pi cannot price a custom model, so before this a
// custom endpoint turn had no cost. Bifrost reports the cost in the usage chunk, as a number on its
// OpenAI-compatible routes and as an object with `total_cost` on its own routes (a nested and an
// older flat shape); it sends no cost header. Cases: each shape on the `pi` driver, a second turn in
// the same session (it books its own cost, not the session total), an endpoint with no cost (the
// turn stays unpriced), and the object shape on the `direct` driver.
// `PI_CLI=<pi> bun run test:pi-reported-cost`. Writes .openbot-build/pi-reported-cost-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectProviderUsage } from "../src/backend/agent/usage-collection";
import type { AgentClient } from "../src/backend/agent-client";
import { resolvePiCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { type AppServerNotification, getString } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/pi-reported-cost-e2e");
const ENDPOINT = "bifrost-e2e";

/** The `usage.cost` that Bifrost sends for each model of the fake gateway. */
type CostShape = "number" | "nested" | "legacy" | "none";
const MODELS: readonly CostShape[] = ["number", "nested", "legacy", "none"];

interface CaseReport {
  name: string;
  driver: string;
  model: string;
  reported: number | null;
  cost: number | null;
  basis: string;
  passed: boolean;
}

interface Report {
  passed: boolean;
  piVersion?: string;
  usageNotices: unknown[];
  cases: CaseReport[];
  failure?: string;
}

const report: Report = { passed: false, usageNotices: [], cases: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-pi-reported-cost-e2e-"));
const clients: AgentClient[] = [];
/** The total cost that the next reply reports. Each case sets it before its turn. */
let nextCost = 0;

/** Bifrost's cost object: its nested shape, and its older flat shape. */
type BifrostCost =
  | { input_cost: number; output_cost: number; total_cost: number }
  | { input_tokens_cost: number; output_tokens_cost: number; request_cost: number; total_cost: number };

/** Bifrost's `usage.cost` for a total, in the shape of the model. */
function costField(shape: CostShape, total: number): { cost?: number | BifrostCost } {
  if (shape === "number") return { cost: total };
  if (shape === "nested") return { cost: { input_cost: total * 0.25, output_cost: total * 0.75, total_cost: total } };
  if (shape === "legacy")
    return {
      cost: { input_tokens_cost: total * 0.2, output_tokens_cost: total * 0.8, request_cost: 0, total_cost: total },
    };
  return {};
}

/** One server-sent event of a streamed chat completion. The last one has the usage and the cost. */
function chunk(model: string, kind: "text" | "stop" | "usage"): string {
  const shape = MODELS.find((id) => id === model) ?? "none";
  const value = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices:
      kind === "text"
        ? [{ index: 0, delta: { role: "assistant", content: "Done." }, finish_reason: null }]
        : kind === "stop"
          ? [{ index: 0, delta: {}, finish_reason: "stop" }]
          : [],
    ...(kind === "usage"
      ? {
          usage: { prompt_tokens: 1_000, completion_tokens: 50, total_tokens: 1_050, ...costField(shape, nextCost) },
          extra_fields: { provider: "openai", model_requested: model, latency: 12 },
        }
      : {}),
  };
  return `data: ${JSON.stringify(value)}\n\n`;
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  void (async () => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
    const model = getString(body, "model") ?? "";
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(chunk(model, "text"));
    response.write(chunk(model, "stop"));
    response.write(chunk(model, "usage"));
    response.end("data: [DONE]\n\n");
  })().catch((error: unknown) => {
    response.writeHead(500);
    response.end(String(error));
  });
});

try {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake gateway has no port.");

  // Pi must not read the developer's own providers and keys.
  const agentDirectory = join(root, "agent");
  await mkdir(agentDirectory, { recursive: true });
  await writeFile(join(agentDirectory, "settings.json"), "{}\n");
  await writeFile(join(agentDirectory, "auth.json"), "{}");
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Bifrost E2E",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "sk-bf-e2e",
    headers: [],
    models: MODELS.map((id) => ({ id, name: id })),
    harness: "pi",
  };

  const database = new OpenBotDatabase(join(root, "profile"));
  await runCauseEffect(database.initialize());
  const reader = new DatabaseSync(database.path);
  const cli = await runCauseEffect(resolvePiCli({ bundledExecutable: process.env.PI_CLI }));
  report.piVersion = cli.version;

  /** The agent service books each provider notice of a session as this does. */
  const sessions = new Map<string, { id: string; createdAt: string; model: string; driver: "pi" | "direct" }>();
  const client = (driver: "pi" | "direct"): AgentClient => {
    const created = requireProviderDriver(driver).createClient(cli, 60_000, {
      apiKey: () => null,
      customProviders: () => [endpoint],
      mcpServers: () => [],
      providerStateDirectory: join(root, `state-${driver}`),
    });
    clients.push(created);
    created.on("notification", (notification: AppServerNotification) => {
      const session = sessions.get(`${driver}:${getString(notification.params, "threadId") ?? ""}`);
      if (!session) return;
      if (notification.method === "openbot/usage") report.usageNotices.push(notification.params);
      collectProviderUsage(
        database.usage,
        { id: `agent-${driver}`, model: session.model },
        { id: session.id, provider: driver, createdAt: session.createdAt },
        notification.method,
        notification.params,
      );
    });
    created.start();
    return created;
  };

  async function open(target: AgentClient, driver: "pi" | "direct", shape: CostShape): Promise<string> {
    const model = `${ENDPOINT}/${shape}`;
    const thread = await startThread(target, { cwd: workspace, model });
    sessions.set(`${driver}:${thread}`, {
      id: `session-${sessions.size + 1}`,
      createdAt: new Date().toISOString(),
      model,
      driver,
    });
    return thread;
  }

  async function turn(name: string, target: AgentClient, key: string, reported: number | null): Promise<void> {
    const session = sessions.get(key);
    assert.ok(session, `${name}: no session`);
    const rows = () =>
      reader
        .prepare(
          "SELECT estimated_cost_usd AS cost, rate_basis AS basis FROM agent_usage_records WHERE session_id = ? ORDER BY rowid",
        )
        .all(session.id);
    const count = rows().length;
    nextCost = reported ?? 0;
    const thread = key.slice(key.indexOf(":") + 1);
    const result = await runTurn(target, thread, { text: name, timeoutMs: 60_000 });
    assert.equal(result.error, null, `${name}: the turn failed: ${result.error}`);
    const after = rows();
    assert.equal(after.length, count + 1, `${name}: the turn must add one usage record`);
    const row = after.at(-1);
    assert.ok(row, `${name}: no usage record`);
    const cost = typeof row.cost === "number" ? row.cost : null;
    const entry: CaseReport = {
      name,
      driver: session.driver,
      model: session.model,
      reported,
      cost,
      basis: String(row.basis),
      passed: false,
    };
    report.cases.push(entry);
    if (reported === null) assert.equal(cost, null, `${name}: the turn must stay unpriced`);
    else assert.ok(cost !== null && Math.abs(cost - reported) < 1e-9, `${name}: cost ${cost}, not ${reported}`);
    entry.passed = true;
  }

  const pi = client("pi");
  const numberThread = await open(pi, "pi", "number");
  await turn("number cost (Bifrost /openai/v1)", pi, `pi:${numberThread}`, 0.0123);
  const nestedThread = await open(pi, "pi", "nested");
  await turn("object cost (Bifrost /v1)", pi, `pi:${nestedThread}`, 0.0042);
  await turn("second turn in the session", pi, `pi:${nestedThread}`, 0.0017);
  const legacyThread = await open(pi, "pi", "legacy");
  await turn("older flat object cost", pi, `pi:${legacyThread}`, 0.0009);
  const noneThread = await open(pi, "pi", "none");
  await turn("no reported cost", pi, `pi:${noneThread}`, null);

  const direct = client("direct");
  const directThread = await open(direct, "direct", "nested");
  await turn("object cost on Direct", direct, `direct:${directThread}`, 0.0031);

  reader.close();
  database.close();
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  server.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
}
