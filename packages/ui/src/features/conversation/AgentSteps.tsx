import type { ConversationMemoryChange } from "@openbot/contracts/ipc";
import { countConversationMemoryChanges } from "@openbot/contracts/ipc";
import { Dynamic, type JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { Button } from "../../button";
import {
  BookOpen,
  Brain,
  ChevronDown,
  Globe2,
  Lightbulb,
  ListChecks,
  MousePointer2,
  PencilLine,
  Scan,
  Search,
  TriangleAlert,
  UsersRound,
  Wrench,
} from "../../icons";
import { type TextValue, useText } from "../../text";

/**
 * One step of an agent's turn: a thought, a progress line of the host, or a memory change that the
 * turn committed. `memory-summary` is the count that a host without the changes sends instead.
 * The text of `progress` and `memory-summary` is the host's English source text.
 */
export type AgentStep =
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "progress"; text: string }
  | { id: string; kind: "memory"; change: ConversationMemoryChange }
  | { id: string; kind: "memory-summary"; text: string };

const BOLD_TITLE = /\*\*(.+?)\*\*/gs;

/** A thought can hold several titled reasoning summaries. Each one is its own step. */
export function reasoningParts(text: string): string[] {
  return text.split(/\n\s*\n(?=\s*\*\*)/).filter((part) => part.trim());
}

/**
 * The headline of a thought. Reasoning summaries come as `**Title**` paragraphs, and one thought can
 * hold several. The newest complete title replaces the ones before it, without its Markdown marks. A
 * thought with no title shows its text without the marks.
 */
export function reasoningHeadline(text: string): string {
  const titles = [...text.matchAll(BOLD_TITLE)].map((match) => match[1]?.trim() ?? "").filter(Boolean);
  return titles.at(-1) ?? text.replaceAll("**", "").trim();
}

/** How tall the list grows before it scrolls, and before a live list glides to its newest step. */
const STEPS_MAX_HEIGHT = 220;

const MEMORY_ACTION_LABEL = {
  saved: "chat.steps.saved",
  updated: "chat.steps.updated",
  forgotten: "chat.steps.forgotten",
} as const;

/**
 * The steps of a turn, in order. While the turn runs, `live` marks the newest step and the list
 * glides so that step stays at the bottom edge; after the turn the list scrolls.
 */
export function AgentStepList(props: { steps: readonly AgentStep[]; live: boolean; id?: string }) {
  const { t } = useText();
  const [contentHeight, setContentHeight] = createSignal(0);
  let content: HTMLOListElement | undefined;
  onSettled(() => {
    const element = content;
    if (!element) return;
    const observer = new ResizeObserver(() => setContentHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  });
  const capped = () => contentHeight() > STEPS_MAX_HEIGHT;
  const scrolls = () => !props.live && capped();
  const offset = () => (props.live && capped() ? STEPS_MAX_HEIGHT - contentHeight() : 0);
  return (
    <section
      id={props.id}
      class="agent-steps-viewport"
      aria-label={t("chat.steps.list")}
      data-capped={capped() ? "" : undefined}
      data-scrolls={scrolls() ? "" : undefined}
      // A list that scrolls needs a keyboard stop of its own.
      tabindex={scrolls() ? 0 : undefined}
    >
      <ol ref={content} class="agent-steps-list" style={{ transform: `translateY(${offset()}px)` }}>
        <For each={props.steps} keyed={(step) => step.id}>
          {(step, index) => (
            <li class="agent-step" data-kind={step().kind}>
              <StepIcon step={step()} />
              <StepBody step={step()} newest={props.live && index() === props.steps.length - 1} />
            </li>
          )}
        </For>
      </ol>
    </section>
  );
}

function StepBody(props: { step: AgentStep; newest: boolean }) {
  const text = useText();
  return <>{stepBody(props.step, props.newest, text)}</>;
}

function stepBody(step: AgentStep, newest: boolean, text: TextValue): JSX.Element {
  if (step.kind === "memory") {
    const change = step.change;
    return (
      <span class="agent-step-memory" data-action={change.action}>
        <span class="agent-step-memory-action">{text.t(MEMORY_ACTION_LABEL[change.action])}</span>
        <Show when={change.previousText}>{(previous) => <s class="agent-step-memory-previous">{previous()}</s>}</Show>
        {change.action === "forgotten" ? <s>{change.text}</s> : <span>{change.text}</span>}
      </span>
    );
  }
  const shown = step.kind === "thinking" ? step.text.replaceAll("**", "").trim() : text.sourceText(step.text);
  return <span class={["agent-step-text", { "agent-activity-label": newest }]}>{shown}</span>;
}

/*
 * The host sends a progress line as its English source text, so the icon follows the words of the
 * line: the first pattern that matches names the kind of tool work.
 */
const PROGRESS_ICONS: ReadonlyArray<readonly [RegExp, typeof Wrench]> = [
  [/failed/u, TriangleAlert],
  [/memories/u, Brain],
  [/skill/u, BookOpen],
  [/screen capture|capture the screen/u, Scan],
  [/an app on this computer|in the app/u, MousePointer2],
  [/current information|sources/u, Globe2],
  [/gather|information/u, Search],
  [/check|verification/u, ListChecks],
  [/changes/u, PencilLine],
  [/agent/u, UsersRound],
];

function progressIcon(text: string): typeof Wrench {
  return PROGRESS_ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? Wrench;
}

function StepIcon(props: { step: AgentStep }) {
  const icon = () => {
    const step = props.step;
    if (step.kind === "thinking") return Lightbulb;
    if (step.kind === "progress") return progressIcon(step.text);
    return Brain;
  };
  return <Dynamic component={icon()} class="agent-step-icon" aria-hidden="true" />;
}

/** How long a turn worked: "12s" or "2m 05s". */
function workedFor(ms: number, text: TextValue): string {
  const total = Math.max(1, Math.round(ms / 1_000));
  if (total < 60) return text.t("chat.steps.seconds", { seconds: total });
  return text.t("chat.steps.minutes", {
    minutes: Math.floor(total / 60),
    seconds: String(total % 60).padStart(2, "0"),
  });
}

/** The one-line summary of a finished turn's steps: "Worked for 12s · Memory: 2 saved and 1 forgotten". */
function stepsSummary(steps: readonly AgentStep[], durationMs: number | undefined, text: TextValue): string {
  const changes = steps.flatMap((step) => (step.kind === "memory" ? [step.change] : []));
  const counts = countConversationMemoryChanges(changes);
  const memory = text.format.list(
    [
      counts.saved ? text.t("chat.steps.memorySaved", { count: counts.saved }) : null,
      counts.updated ? text.t("chat.steps.memoryUpdated", { count: counts.updated }) : null,
      counts.forgotten ? text.t("chat.steps.memoryForgotten", { count: counts.forgotten }) : null,
    ].filter((part): part is string => part !== null),
  );
  const fallback = steps.find((step) => step.kind === "memory-summary");
  return [
    durationMs === undefined
      ? text.t("chat.steps.worked")
      : text.t("chat.steps.workedFor", { duration: workedFor(durationMs, text) }),
    changes.length > 0 ? text.t("chat.steps.memory", { changes: memory }) : null,
    fallback?.kind === "memory-summary" ? text.sourceText(fallback.text) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * The steps of a finished turn, above its answer: a closed summary row that opens the list. The
 * "Show agent steps" setting opens it at first.
 */
export function AgentStepsDisclosure(props: {
  steps: readonly AgentStep[];
  defaultOpen: boolean;
  /** How long the turn worked. Without it, the row says only "Worked". */
  durationMs?: number | undefined;
}) {
  const text = useText();
  const panelId = createUniqueId();
  const [choice, setChoice] = createSignal<boolean>();
  const open = () => choice() ?? props.defaultOpen;
  return (
    <div class="agent-steps" data-open={open() ? "" : undefined}>
      <Button
        type="button"
        variant="ghost"
        class="agent-steps-header"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={open() ? panelId : undefined}
        onClick={() => setChoice(!open())}
      >
        <span class="agent-steps-summary">{stepsSummary(props.steps, props.durationMs, text)}</span>
        <ChevronDown class="agent-steps-chevron" aria-hidden="true" />
      </Button>
      {/* A long chat has a row for each turn, so a closed row builds no list. */}
      <Show when={open()}>
        <div class="agent-steps-panel">
          <AgentStepList id={panelId} steps={props.steps} live={false} />
        </div>
      </Show>
    </div>
  );
}
