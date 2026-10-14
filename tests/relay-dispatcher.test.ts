import test from "node:test";
import assert from "node:assert/strict";

import { relayDispatcher, withRelayDispatcher } from "../lib/utils/relay-dispatcher";

/** undici keeps its resolved options behind a private symbol; scan for them. */
function dispatcherTimeouts(value: unknown) {
  for (const symbol of Object.getOwnPropertySymbols(value as object)) {
    const options = (value as Record<symbol, unknown>)[symbol] as { headersTimeout?: number; bodyTimeout?: number } | undefined;
    if (options && typeof options.headersTimeout === "number" && typeof options.bodyTimeout === "number") return options;
  }
  return undefined;
}

test("relay requests raise undici's built-in 300s transport budget", () => {
  const dispatcher = relayDispatcher();
  assert.ok(dispatcher, "a dispatcher must be available to relay calls");
  const options = dispatcherTimeouts(dispatcher);
  assert.ok(options, "the dispatcher must expose resolved options");
  // A full storyboard round is a single non-streaming call: the gateway sends no
  // response headers until the completion is finished. undici's 300s default
  // would abort first and our own AbortSignal could not override it.
  assert.ok(options.headersTimeout! > 300_000, `headersTimeout must exceed 300s, got ${options.headersTimeout}`);
  assert.ok(options.bodyTimeout! > 300_000, `bodyTimeout must exceed 300s, got ${options.bodyTimeout}`);
});

test("the shared dispatcher is reused and attached to every relay request", () => {
  assert.equal(relayDispatcher(), relayDispatcher(), "one agent must be shared across requests");
  const init = withRelayDispatcher({ method: "POST", cache: "no-store" });
  assert.equal(init.dispatcher, relayDispatcher());
  // Caller-owned fields survive the wrap, including no init at all.
  assert.equal(init.method, "POST");
  assert.equal(init.cache, "no-store");
  assert.ok(withRelayDispatcher().dispatcher, "an omitted init still receives the dispatcher");
});
