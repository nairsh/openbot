import type { UsageTokens } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("cache-read-monitor");

/** A usage update smaller than this says little about the cache. */
const MIN_INPUT_TOKENS = 10_000;
/**
 * A drop within this time is a miss that the shortest provider cache does not explain: Claude's and
 * OpenAI's caches keep a prefix for 5 minutes at least. Later drops are expected expiries.
 */
const UNEXPECTED_WITHIN_MS = 4.5 * 60_000;
const SESSIONS = 500;

/**
 * Logs when the share of the prompt that a session reads from the provider's cache falls while the
 * cache should still hold it: something changed the prefix, such as the instructions, the tools or
 * an edit of earlier messages. The log carries the counts only, never the prompt.
 */
export class CacheReadMonitor {
  readonly #last = new Map<string, { share: number; at: number }>();

  observe(sessionId: string, provider: string, model: string, tokens: UsageTokens, now = Date.now()): void {
    const { uncachedInput, cachedInput, cacheCreation } = tokens;
    if (uncachedInput === null || cachedInput === null) return;
    const input = uncachedInput + cachedInput + (cacheCreation ?? 0);
    if (input < MIN_INPUT_TOKENS) return;
    const share = cachedInput / input;
    const previous = this.#last.get(sessionId);
    this.#last.delete(sessionId);
    this.#last.set(sessionId, { share, at: now });
    if (this.#last.size > SESSIONS) {
      const oldest = this.#last.keys().next().value;
      if (oldest !== undefined) this.#last.delete(oldest);
    }
    if (!previous || previous.share < 0.5 || share >= 0.2) return;
    const elapsedMs = now - previous.at;
    const fields = {
      provider,
      model,
      inputTokens: input,
      cachedShare: share,
      previousShare: previous.share,
      elapsedMs,
    };
    if (elapsedMs < UNEXPECTED_WITHIN_MS)
      logger.warn("Prompt cache reads dropped while the cache was still warm.", fields);
    else logger.info("Prompt cache reads dropped after an idle gap.", fields);
  }
}
