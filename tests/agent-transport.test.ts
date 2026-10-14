import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Agent, tool } from "@openai/agents";
import { z } from "zod";

test("Agent model requests recover once without replaying tools", { timeout: 60000 }, async t => {
  process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), "mxpage-transport-test-"));
  const { makeRunner } = await import("../lib/detail-runs/provider");
  const { describeRunFailure } = await import("../lib/detail-runs/run-errors");
  let calls = 0, executed = 0, mode: "socket" | "body" | "persistent" | "hang" | "persistent-hang" | number = "socket";
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    calls++; requests.push(Buffer.concat(chunks).toString());
    // A relay gateway that accepts the request and never answers.
    if (mode === "hang" && calls === 1) return;
    if (mode === "persistent-hang") return;
    if (mode === "persistent" || mode === "socket" && calls === 1) { response.destroy(); return; }
    if (mode === "body" && calls === 1) {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "10000" });
      response.write('{"id":"partial-response",');
      setTimeout(() => response.destroy(), 10);
      return;
    }
    if (typeof mode === "number" && (calls === 1 || mode < 500)) {
      response.writeHead(mode, { "Content-Type": "application/json" }); response.end('{"error":{"message":"fixture error"}}'); return;
    }
    response.setHeader("Content-Type", "application/json");
    const call = { type: "function_call", id: "fc_fixture", call_id: "call_fixture", name: "commit_result", arguments: '{"value":"ready"}', status: "completed" };
    response.end(JSON.stringify(request.url?.endsWith("responses") ? {
      id: "resp_fixture", object: "response", created_at: 1, status: "completed", model: "fixture", output: [call], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    } : {
      id: "chat_fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: call.call_id, type: "function", function: { name: call.name, arguments: call.arguments } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const agent = new Agent({ name: "transport-fixture", model: "fixture", instructions: "Submit the result", tools: [tool({ name: "commit_result", description: "Save once", parameters: z.object({ value: z.string() }), execute: async ({ value }) => { executed++; return value; } })], toolUseBehavior: "stop_on_first_tool" });
  const reset = (next: typeof mode) => { mode = next; calls = 0; executed = 0; requests.length = 0; };
  const run = (transport: "responses" | "chat", runId: string | undefined = "fixture-run") => makeRunner({ baseUrl, apiKey: "fixture-not-a-secret", modelId: "fixture", transport }, undefined, runId).run(agent, "submit", { maxTurns: 2 });
  try {
    for (const transport of ["responses", "chat"] as const) for (const failure of ["socket", "body", 502] as const) await t.test(`${transport}: ${failure} retries only the unconsumed model request`, async () => {
      reset(failure); await run(transport);
      assert.equal(calls, 2); assert.equal(executed, 1);
      assert.equal(requests[0], requests[1], "retry the exact HTTP payload, not a new Agent turn");
    });
    await t.test("persistent socket interruption stops after two attempts before any tool execution", async () => {
      reset("persistent");
      await assert.rejects(() => run("responses"), error => describeRunFailure(error, "planning").code === "PROVIDER_CONNECTION_INTERRUPTED");
      assert.equal(calls, 2); assert.equal(executed, 0);
    });
    for (const status of [400, 401, 403, 429]) await t.test(`HTTP ${status} is not retried`, async () => {
      reset(status); await assert.rejects(() => run("responses"));
      assert.equal(calls, 1); assert.equal(executed, 0);
    });
    await t.test("gateway hangs are retried once for a run request", async () => {
      reset("hang");
      await makeRunner({ baseUrl, apiKey: "fixture", modelId: "fixture", transport: "responses" }, undefined, "fixture-run", 600).run(agent, "submit", { maxTurns: 2 });
      assert.equal(calls, 2); assert.equal(executed, 1);
    });
    await t.test("a persistent gateway hang fails as a timeout instead of hanging forever", async () => {
      reset("persistent-hang");
      await assert.rejects(() => makeRunner({ baseUrl, apiKey: "fixture", modelId: "fixture", transport: "responses" }, undefined, "fixture-run", 600).run(agent, "submit", { maxTurns: 2 }), error => describeRunFailure(error, "planning").code === "PROVIDER_TIMEOUT");
      assert.equal(calls, 2); assert.equal(executed, 0);
    });
    await t.test("preparation retains its existing outer retry budget", async () => {
      reset("socket");
      await assert.rejects(() => makeRunner({ baseUrl, apiKey: "fixture", modelId: "fixture", transport: "responses" }).run(agent, "submit"));
      assert.equal(calls, 1); assert.equal(executed, 0);
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Agent requests carry the long-budget dispatcher into fetch", { timeout: 60000 }, async () => {
  process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), "mxpage-dispatcher-test-"));
  const { makeRunner } = await import("../lib/detail-runs/provider");
  const { relayDispatcher } = await import("../lib/utils/relay-dispatcher");
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      id: "resp_fixture", object: "response", created_at: 1, status: "completed", model: "fixture",
      output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "done", annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");

  // Without the shared agent, undici aborts a slow non-streaming completion at
  // 300s with UND_ERR_HEADERS_TIMEOUT, which no caller AbortSignal can override.
  const seen: Array<{ dispatcher?: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push(init as { dispatcher?: unknown });
    return original(url as never, init as never);
  }) as typeof fetch;
  try {
    const agent = new Agent({ name: "dispatcher-fixture", model: "fixture", instructions: "Reply" });
    await makeRunner({ baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture", modelId: "fixture", transport: "responses" }, undefined, "fixture-run").run(agent, "hi", { maxTurns: 1 });
  } finally {
    globalThis.fetch = original;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  assert.ok(seen.length > 0, "the model request must go through fetch");
  for (const init of seen) assert.equal(init.dispatcher, relayDispatcher(), "every relay attempt must use the shared agent");
});

