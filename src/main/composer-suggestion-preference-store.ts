import {
  type ComposerSuggestionPreference,
  DEFAULT_COMPOSER_SUGGESTION_PREFERENCE,
  isComposerSuggestionPreference,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

export type ComposerSuggestionPreferenceStore = PreferenceStore<ComposerSuggestionPreference>;

export function createComposerSuggestionPreferenceStore(path: string): ComposerSuggestionPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_COMPOSER_SUGGESTION_PREFERENCE,
    decode: (parsed): ComposerSuggestionPreference | null => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
      const preference = { mode: parsed.mode, provider: parsed.provider, model: parsed.model };
      return isComposerSuggestionPreference(preference) ? preference : null;
    },
  });
}
