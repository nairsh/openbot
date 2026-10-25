import {
  type ComposerSuggestionPreference,
  DEFAULT_COMPOSER_SUGGESTION_PREFERENCE,
  isComposerSuggestionPreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/**
 * Which model predicts the user's next message after a turn. This computer keeps it: its agents,
 * models and provider accounts are here, and no server stores it. The backend reads it after each
 * turn, so it is held in memory after `load`.
 *
 * A file that is missing, unreadable as JSON or holds an unknown value reads as `off`, the value
 * before the setting existed. Writes are chained for the reason `update-preference-store.ts` chains
 * its own: an earlier rename that lands last would persist the value the user just changed.
 */
export class ComposerSuggestionPreferenceStore {
  readonly #path: string;
  #preference: ComposerSuggestionPreference = { ...DEFAULT_COMPOSER_SUGGESTION_PREFERENCE };
  #writes = Semaphore.makeUnsafe(1);

  constructor(path: string) {
    this.#path = path;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(
        readPreferenceFile(this.#path, (parsed): ComposerSuggestionPreference | null => {
          if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
          const preference = { mode: parsed.mode, provider: parsed.provider, model: parsed.model };
          return isComposerSuggestionPreference(preference) ? preference : null;
        }),
      );
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#preference = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  get(): ComposerSuggestionPreference {
    return { ...this.#preference };
  }

  readonly set = Effect.fn("ComposerSuggestionPreference.set")(function* (
    this: ComposerSuggestionPreferenceStore,
    { mode, provider, model }: ComposerSuggestionPreference,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#path, { version: 1, mode, provider, model }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#preference = { mode, provider, model };
            }),
          ),
        ),
      ),
    );
    return this.get();
  });
}
