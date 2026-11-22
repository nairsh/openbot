import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { type AgentModelId, isAgentModel } from "./ipc-agent-identity";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const COMPOSER_SUGGESTION_MODES = ["off", "agent", "model"] as const;
export type ComposerSuggestionMode = (typeof COMPOSER_SUGGESTION_MODES)[number];

export interface ComposerSuggestionPreference {
  mode: ComposerSuggestionMode;
  provider: AgentProviderId | null;
  model: AgentModelId | null;
}

export const DEFAULT_COMPOSER_SUGGESTION_PREFERENCE: ComposerSuggestionPreference = {
  mode: "off",
  provider: null,
  model: null,
};

export const COMPOSER_SUGGESTION_TEXT_LIMIT = 300;

export function isComposerSuggestionMode(value: unknown): value is ComposerSuggestionMode {
  return isOneOf(COMPOSER_SUGGESTION_MODES, value);
}

export function isComposerSuggestionPreference(value: unknown): value is ComposerSuggestionPreference {
  if (!isDynamicRecord(value) || !isComposerSuggestionMode(value.mode)) return false;
  const provider = value.provider === null || isAgentProvider(value.provider);
  const model = value.model === null || isAgentModel(value.model);
  if (!provider || !model || (value.provider === null) !== (value.model === null)) return false;
  return value.mode !== "model" || value.provider !== null;
}

export function isComposerSuggestionText(value: unknown): value is string {
  return isBoundedString(value, COMPOSER_SUGGESTION_TEXT_LIMIT) && value.trim().length > 0;
}
