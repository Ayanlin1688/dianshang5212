import { Agent } from "undici";

/**
 * Relay gateways answer non-streaming chat/responses calls only after the whole
 * completion is generated. A full storyboard round therefore may not send its
 * response headers for several minutes.
 *
 * Node's built-in fetch (undici) aborts such a request at 300s with
 * `UND_ERR_HEADERS_TIMEOUT`, *before* any caller-owned AbortSignal can fire, so
 * raising our own timeout alone cannot rescue a long generation. Route relay
 * traffic through one shared agent with a far larger budget; per-request
 * deadlines are still enforced by the caller's AbortSignal.
 *
 * The generous budgets here also cover the relay's slow image CDN, which can
 * trickle a single image for minutes.
 */
const RELAY_TIMEOUT_MS = 900_000;

let cached: Agent | null | undefined;

/** Shared undici agent for long-running relay calls. Returns undefined if unavailable. */
export function relayDispatcher(): unknown {
  if (cached === undefined) {
    try {
      cached = new Agent({
        headersTimeout: RELAY_TIMEOUT_MS,
        bodyTimeout: RELAY_TIMEOUT_MS,
        connectTimeout: 60_000,
        keepAliveTimeout: 30_000,
      });
    } catch {
      // Never let diagnostics of an exotic runtime break real requests.
      cached = null;
    }
  }
  return cached ?? undefined;
}

/** RequestInit carrying the shared dispatcher; the extra field is Node-only. */
export type RelayInit = RequestInit & { dispatcher?: unknown };

export function withRelayDispatcher(init?: RequestInit): RelayInit {
  return { ...(init ?? {}), dispatcher: relayDispatcher() };
}
