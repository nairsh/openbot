import {
  type AgentDefaultKey,
  type AgentDefaults,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  COMPOSER_SUGGESTION_MODES,
  type ComposerSuggestionMode,
  type ComposerSuggestionPreference,
  type CustomAgentSummary,
  type CustomProviderSummary,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  ChevronRight,
  DropdownMenu,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  SwitchField,
  Text,
} from "@openbot/ui";
import { For, Show } from "solid-js";
import { ProviderModelPicker } from "../../components/ProviderModelPicker";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/** A setting of the Agents tab: the three account defaults, and "Steer agents while they work". */
export type AgentDefaultSetting = AgentDefaultKey | "busyMessageMode";

/** What one agent does for a setting: follow the default, or its own value. */
export type AgentDefaultChoice = "default" | "on" | "off";

const CHOICES: AgentDefaultChoice[] = ["default", "on", "off"];

/** An agent as the Agents tab shows it. */
export type AgentDefaultsAgent = Pick<
  ClientAgentSummary,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl" | AgentDefaultKey | "busyMessageMode"
>;

/** The settings in page order, with the title and description that agent settings show. */
export const AGENT_DEFAULT_SETTINGS = [
  {
    key: "allowAutomation",
    title: "agentSettings.automation.title",
    description: "agentSettings.automation.description",
  },
  {
    key: "allowNewChat",
    title: "agentSettings.agentNewChat.title",
    description: "agentSettings.agentNewChat.description",
  },
  {
    key: "quickAcknowledgement",
    title: "agentSettings.quickAcknowledgement.title",
    description: "agentSettings.quickAcknowledgement.description",
  },
  { key: "busyMessageMode", title: "settings.busyMessage.title", description: "settings.busyMessage.description" },
] as const satisfies ReadonlyArray<{ key: AgentDefaultSetting; title: AppTextKey; description: AppTextKey }>;

export function agentDefaultSettingTitle(setting: AgentDefaultSetting): AppTextKey {
  return AGENT_DEFAULT_SETTINGS.find((item) => item.key === setting)?.title ?? "settings.tab.agents.title";
}

/** The value that the agent stores, or "default" when it has none and follows the default. */
export function agentDefaultChoice(agent: AgentDefaultsAgent, setting: AgentDefaultSetting): AgentDefaultChoice {
  if (setting === "busyMessageMode") {
    if (agent.busyMessageMode === undefined) return "default";
    return agent.busyMessageMode === "steer" ? "on" : "off";
  }
  const own = agent[setting];
  if (own === undefined) return "default";
  return own ? "on" : "off";
}

/** The models that "Chosen model" can use: this computer's, which run its predictions. */
export interface ComposerSuggestionModels {
  modelOptions: ClientAgentModelOption[];
  agentStatus: AgentStatus;
  /** The model that "Chosen model" starts on when no model was chosen before. */
  initial: { provider: AgentProviderId; model: AgentModelId } | null;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
}

const SUGGESTION_MODE_LABEL = {
  off: "settings.composerSuggestions.off",
  agent: "settings.composerSuggestions.agent",
  model: "settings.composerSuggestions.model",
} as const satisfies Record<ComposerSuggestionMode, AppTextKey>;

const SUGGESTION_MODE_DESCRIPTION = {
  off: "settings.composerSuggestions.offDescription",
  agent: "settings.composerSuggestions.agentDescription",
  model: "settings.composerSuggestions.modelDescription",
} as const satisfies Record<ComposerSuggestionMode, AppTextKey>;

const FACES = 4;

function AgentFaces(props: { agents: AgentDefaultsAgent[] }) {
  const { t } = useText();
  return (
    <Show when={props.agents.length > 0}>
      <span
        class="integrations-face-stack"
        role="img"
        aria-label={t("settings.agentDefaults.agentList", {
          names: props.agents.map((agent) => agent.name).join(", "),
        })}
      >
        <For each={props.agents.slice(0, FACES)}>
          {(agent) => (
            <span class="integrations-agent-face" data-size="sm">
              <AgentAvatar agent={agent} motion="idle" />
            </span>
          )}
        </For>
        <Show when={props.agents.length > FACES}>
          <span class="integrations-face-more" aria-hidden="true">{`+${props.agents.length - FACES}`}</span>
        </Show>
      </span>
    </Show>
  );
}

function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

export interface SettingsAgentsTabProps {
  /** The agents on this computer. */
  agents: readonly AgentDefaultsAgent[];
  /** True when the agents could not be read. */
  loadFailed: boolean;
  defaults: AgentDefaults;
  /** The app default of "Steer agents while they work". */
  steer: boolean;
  /** The open setting, or null for the list of settings. */
  setting: AgentDefaultSetting | null;
  /** The dialog element that the menus portal into. */
  menuMount: HTMLElement | undefined;
  onOpen: (setting: AgentDefaultSetting) => void;
  onDefaultChange: (setting: AgentDefaultSetting, on: boolean) => void;
  /** Gives `choice` to each agent of `agentIds`. */
  onChoiceChange: (agentIds: readonly string[], setting: AgentDefaultSetting, choice: AgentDefaultChoice) => void;
  /** Which model predicts the user's next message after a turn. */
  suggestions: ComposerSuggestionPreference;
  /** This computer's models, or undefined while they cannot be listed here. */
  suggestionModels: ComposerSuggestionModels | undefined;
  onSuggestionsChange: (preference: ComposerSuggestionPreference) => void;
}

/**
 * Settings › Agents, in the design of Server settings › Roles. The list has one row for each
 * setting, with the agents that have it on. A setting page has its default, and each agent with a
 * menu and Set all. An agent with no value of its own follows the default.
 */
export function SettingsAgentsTab(props: SettingsAgentsTabProps) {
  const { t } = useText();
  const defaultOn = (setting: AgentDefaultSetting) =>
    setting === "busyMessageMode" ? props.steer : props.defaults[setting];
  const isOn = (agent: AgentDefaultsAgent, setting: AgentDefaultSetting) => {
    const choice = agentDefaultChoice(agent, setting);
    return choice === "default" ? defaultOn(setting) : choice === "on";
  };
  const valueLabel = (setting: AgentDefaultSetting, on: boolean) => {
    if (setting === "busyMessageMode")
      return t(on ? "agentSettings.busyMessage.steer" : "agentSettings.busyMessage.queue");
    return t(on ? "settings.agentDefaults.on" : "settings.agentDefaults.off");
  };
  const choiceLabel = (setting: AgentDefaultSetting, choice: AgentDefaultChoice) => {
    if (choice !== "default") return valueLabel(setting, choice === "on");
    if (setting === "busyMessageMode")
      return t(props.steer ? "agentSettings.busyMessage.appDefaultSteer" : "agentSettings.busyMessage.appDefaultQueue");
    return t("settings.agentDefaults.followDefault", { value: valueLabel(setting, defaultOn(setting)) });
  };

  const loadError = () => (
    <Show when={props.loadFailed}>
      <Alert tone="danger" role="alert" report={{ operation: "settings", source: "system", cause_code: "unknown" }}>
        <AlertContent>
          <AlertDescription>{t("settings.agentDefaults.loadFailed")}</AlertDescription>
        </AlertContent>
      </Alert>
    </Show>
  );

  /** The model "Chosen model" uses: the saved one, else the default of a new agent. */
  const chosenModel = () => {
    const { provider, model } = props.suggestions;
    return provider && model ? { provider, model } : (props.suggestionModels?.initial ?? null);
  };
  const changeSuggestionMode = (mode: ComposerSuggestionMode) => {
    if (mode === props.suggestions.mode) return;
    if (mode !== "model") {
      props.onSuggestionsChange({ ...props.suggestions, mode });
      return;
    }
    const chosen = chosenModel();
    if (chosen) props.onSuggestionsChange({ mode, provider: chosen.provider, model: chosen.model });
  };
  /** A saved model that the list no longer has, so no prediction runs. Unknown while the list is not here. */
  const chosenModelMissing = () => {
    const { mode, provider, model } = props.suggestions;
    const models = props.suggestionModels;
    return (
      mode === "model" &&
      models !== undefined &&
      !models.modelOptions.some((option) => option.provider === provider && option.id === model)
    );
  };

  const suggestionsSection = () => (
    <SettingsSection
      title={t("settings.composerSuggestions.title")}
      description={t("settings.composerSuggestions.description")}
    >
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("settings.composerSuggestions.mode")}</ItemTitle>
            <ItemDescription>{t(SUGGESTION_MODE_DESCRIPTION[props.suggestions.mode])}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select<ComposerSuggestionMode>
              options={[...COMPOSER_SUGGESTION_MODES]}
              value={props.suggestions.mode}
              placement="bottom-end"
              // "Chosen model" needs a model to start on.
              optionDisabled={(mode) => mode === "model" && chosenModel() === null}
              onChange={(mode) => {
                if (mode) changeSuggestionMode(mode);
              }}
              itemComponent={(item) => (
                <SelectItem item={item.item}>{t(SUGGESTION_MODE_LABEL[item.item.rawValue])}</SelectItem>
              )}
            >
              <SelectTrigger size="sm" class="server-roles-level" aria-label={t("settings.composerSuggestions.mode")}>
                <SelectValue<ComposerSuggestionMode>>
                  {(state) => t(SUGGESTION_MODE_LABEL[state.selectedOption()])}
                </SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        </Item>
        <Show when={props.suggestions.mode === "model" && chosenModel()}>
          {(chosen) => (
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("settings.composerSuggestions.modelLabel")}</ItemTitle>
                <ItemDescription>
                  {chosenModelMissing()
                    ? t("settings.composerSuggestions.modelMissing")
                    : props.suggestionModels
                      ? t("settings.composerSuggestions.modelHint")
                      : t("settings.composerSuggestions.modelsElsewhere")}
                </ItemDescription>
              </ItemContent>
              <Show when={props.suggestionModels}>
                {(models) => (
                  <ItemActions>
                    <ProviderModelPicker
                      variant="field"
                      ariaLabel={t("settings.composerSuggestions.modelLabel")}
                      provider={chosen().provider}
                      value={chosen().model}
                      modelOptions={models().modelOptions}
                      agentStatus={models().agentStatus}
                      customProviders={models().customProviders}
                      customAgents={models().customAgents}
                      mount={props.menuMount}
                      onChange={(model, provider) => props.onSuggestionsChange({ mode: "model", provider, model })}
                    />
                  </ItemActions>
                )}
              </Show>
            </Item>
          )}
        </Show>
      </ItemGroup>
    </SettingsSection>
  );

  const list = () => (
    <SettingsSection title={t("settings.agentDefaults.title")} description={t("settings.agentDefaults.description")}>
      <ItemGroup class="settings-modal-card">
        <For each={AGENT_DEFAULT_SETTINGS}>
          {(setting) => {
            const on = () => props.agents.filter((agent) => isOn(agent, setting.key));
            return (
              <Item data-settings-row={setting.title} class="settings-modal-row integrations-hub-row">
                <Button
                  type="button"
                  variant="ghost"
                  class="integrations-hub-hitarea"
                  aria-label={t("settings.agentDefaults.open", { name: t(setting.title) })}
                  onClick={() => props.onOpen(setting.key)}
                />
                <ItemContent>
                  <ItemTitle>{t(setting.title)}</ItemTitle>
                  <ItemDescription>
                    {t("settings.agentDefaults.value", { value: valueLabel(setting.key, defaultOn(setting.key)) })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions class="integrations-hub-actions">
                  <AgentFaces agents={on()} />
                  <Show when={props.agents.length > 0}>
                    <Text variant="label-sm" tone="muted" class="server-roles-member-count">
                      {t("settings.agentDefaults.count", {
                        on: String(on().length),
                        total: String(props.agents.length),
                      })}
                    </Text>
                  </Show>
                  <ChevronRight class="integrations-hub-chevron" aria-hidden="true" />
                </ItemActions>
              </Item>
            );
          }}
        </For>
      </ItemGroup>
    </SettingsSection>
  );

  const settingPage = (setting: AgentDefaultSetting) => {
    const title = () => t(agentDefaultSettingTitle(setting));
    const description = () =>
      t(AGENT_DEFAULT_SETTINGS.find((item) => item.key === setting)?.description ?? "settings.tab.agents.description");
    const common = () => {
      const choices = props.agents.map((agent) => agentDefaultChoice(agent, setting));
      const [first] = choices;
      return first !== undefined && choices.every((choice) => choice === first) ? first : undefined;
    };
    const setAllLabel = () => t("settings.agentDefaults.setAllLabel", { setting: title() });
    return (
      <>
        <SettingsSection
          title={t("settings.agentDefaults.defaultTitle")}
          description={t("settings.agentDefaults.defaultDescription")}
        >
          <ItemGroup class="settings-modal-card">
            <SwitchField
              checked={defaultOn(setting)}
              onChange={(next) => props.onDefaultChange(setting, next)}
              label={title()}
              description={description()}
            />
          </ItemGroup>
        </SettingsSection>
        <Show when={props.agents.length > 0}>
          <SettingsSection
            title={t("settings.agentDefaults.agents")}
            actions={
              <DropdownMenu.Root placement="bottom-end" gutter={4} modal={false}>
                <DropdownMenu.Trigger
                  class={`${buttonVariants({ variant: "ghost", size: "sm" })} server-roles-member-trigger`}
                  aria-label={setAllLabel()}
                >
                  <span class="server-roles-member-summary">{t("settings.agentDefaults.setAll")}</span>
                  <ChevronDown aria-hidden="true" />
                </DropdownMenu.Trigger>
                {/* A portal without a mount uses the document body. */}
                <DropdownMenu.Portal mount={props.menuMount ?? document.body}>
                  <DropdownMenu.Content>
                    {/* With mixed values no item is checked, so each choice is a change. */}
                    <DropdownMenu.RadioGroup
                      aria-label={setAllLabel()}
                      value={common() ?? ""}
                      onChange={(value: string) => {
                        const choice = CHOICES.find((item) => item === value);
                        if (!choice) return;
                        const changed = props.agents
                          .filter((agent) => agentDefaultChoice(agent, setting) !== choice)
                          .map((agent) => agent.id);
                        if (changed.length > 0) props.onChoiceChange(changed, setting, choice);
                      }}
                    >
                      <For each={CHOICES}>
                        {(choice) => (
                          <DropdownMenu.RadioItem value={choice} closeOnSelect>
                            <MenuMark on={common() === choice} />
                            {choiceLabel(setting, choice)}
                          </DropdownMenu.RadioItem>
                        )}
                      </For>
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.agents}>
                {(agent) => (
                  <Item class="settings-modal-row">
                    <ItemMedia>
                      <span class="integrations-agent-face" data-size="md">
                        <AgentAvatar agent={agent} motion="idle" />
                      </span>
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{agent.name}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Select<AgentDefaultChoice>
                        options={CHOICES}
                        value={agentDefaultChoice(agent, setting)}
                        placement="bottom-end"
                        onChange={(choice) => {
                          if (choice && choice !== agentDefaultChoice(agent, setting))
                            props.onChoiceChange([agent.id], setting, choice);
                        }}
                        itemComponent={(item) => (
                          <SelectItem item={item.item}>{choiceLabel(setting, item.item.rawValue)}</SelectItem>
                        )}
                      >
                        <SelectTrigger
                          size="sm"
                          class="server-roles-level"
                          aria-label={t("settings.agentDefaults.agentLabel", { setting: title(), agent: agent.name })}
                        >
                          <SelectValue<AgentDefaultChoice>>
                            {(state) => choiceLabel(setting, state.selectedOption())}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent mount={props.menuMount} />
                      </Select>
                    </ItemActions>
                  </Item>
                )}
              </For>
            </ItemGroup>
          </SettingsSection>
        </Show>
      </>
    );
  };

  return (
    <>
      {loadError()}
      <Show
        when={props.setting}
        fallback={
          <>
            {list()}
            {suggestionsSection()}
          </>
        }
        keyed
      >
        {(setting) => settingPage(setting)}
      </Show>
    </>
  );
}
