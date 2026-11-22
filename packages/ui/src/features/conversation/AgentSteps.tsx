import type { ConversationMemoryChange } from "@openbot/contracts/ipc";
import { countConversationMemoryChanges } from "@openbot/contracts/ipc";
import { Dynamic, type JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show, untrack } from "solid-js";
import { Badge } from "../../badge";
import { Button } from "../../button";
import {
  BookOpen,
  Brain,
  ChevronRight,
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
import { prefersReducedMotion } from "../../utils";
import { ActivityShine } from "./ActivityShine";
import { useDuration } from "./Subagents";
import { type TraceKeyboard, type TraceSpan, TraceWaterfallDialog } from "./TraceWaterfall";

export type AgentStep =
  | { id: string; kind: "thinking"; text: string }
  | { id: string; kind: "progress"; text: string; error?: string | undefined }
  | { id: string; kind: "memory"; change: ConversationMemoryChange }
  | { id: string; kind: "memory-summary"; text: string };

const BOLD_TITLE = /\*\*(.+?)\*\*/gs;

export function reasoningParts(text: string): string[] {
  return text.split(/\n\s*\n(?=\s*\*\*)/).filter((part) => part.trim());
}

export function reasoningHeadline(text: string): string {
  const titles = [...text.matchAll(BOLD_TITLE)].map((match) => match[1]?.trim() ?? "").filter(Boolean);
  return titles.at(-1) ?? text.replaceAll("**", "").trim();
}

const STEPS_MAX_HEIGHT = 220;

const MEMORY_ACTION_LABEL = {
  saved: "chat.steps.saved",
  updated: "chat.steps.updated",
  forgotten: "chat.steps.forgotten",
  notChanged: "chat.steps.notChanged",
} as const;

export function AgentStepList(props: {
  steps: readonly AgentStep[];
  live: boolean;
  id?: string;
  focus?: { id: string } | null | undefined;
}) {
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
  createEffect(
    () => props.focus,
    (focus) => {
      if (!focus) return;
      const step = content?.querySelector(`[data-step-id="${CSS.escape(focus.id)}"]`);
      step?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    },
  );
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
      tabindex={scrolls() ? 0 : undefined}
    >
      <ol ref={content} class="agent-steps-list" style={{ transform: `translateY(${offset()}px)` }}>
        <For each={props.steps} keyed={(step) => step.id}>
          {(step, index) => (
            <li
              class="agent-step"
              data-kind={step().kind}
              data-step-id={step().id}
              data-focused={props.focus?.id === step().id ? "" : undefined}
            >
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
  const failure = () => (props.step.kind === "progress" && props.step.error ? props.step : undefined);
  return (
    <Show when={failure()} fallback={stepBody(props.step, props.newest, text)}>
      {(step) => <FailedStep text={text.sourceText(step().text)} error={step().error} newest={props.newest} />}
    </Show>
  );
}

function stepBody(step: AgentStep, newest: boolean, text: TextValue): JSX.Element {
  if (step.kind === "memory") {
    const change = step.change;
    return (
      <span class="agent-step-memory" data-action={change.action}>
        <span class="agent-step-memory-action">{text.t(MEMORY_ACTION_LABEL[change.action])}</span>
        <Show when={change.previousText}>
          {(previous) => (
            <s class="agent-step-memory-previous" dir="auto">
              {previous()}
            </s>
          )}
        </Show>
        {change.action === "forgotten" ? <s dir="auto">{change.text}</s> : <span dir="auto">{change.text}</span>}
      </span>
    );
  }
  if (step.kind === "thinking") {
    return (
      <span class={["agent-step-text", { "agent-activity-label": newest }]} dir="auto">
        {step.text.replaceAll("**", "").trim()}
        {newest && <ActivityShine text={step.text.replaceAll("**", "").trim()} />}
      </span>
    );
  }
  const label = text.sourceText(step.text);
  return (
    <span class={["agent-step-text", { "agent-activity-label": newest }]}>
      {label}
      {newest && <ActivityShine text={label} />}
    </span>
  );
}

function FailedStep(props: { text: string; error: string | undefined; newest: boolean }) {
  const { t } = useText();
  const outputId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const expanded = () => (open() ? "true" : "false");
  const controls = () => (open() ? outputId : undefined);
  const label = () => t(open() ? "chat.steps.hideError" : "chat.steps.showError");
  return (
    <div class="agent-step-failed">
      <span class={["agent-step-text", { "agent-activity-label": props.newest }]}>
        {props.text}
        <Show when={props.newest}>
          <ActivityShine text={props.text} />
        </Show>
      </span>
      <Button
        type="button"
        variant="ghost"
        class="agent-step-error-toggle"
        aria-expanded={expanded()}
        aria-controls={controls()}
        onClick={() => setOpen(!open())}
      >
        <ChevronRight class="agent-steps-chevron" aria-hidden="true" />
        {label()}
      </Button>
      <Show when={open()}>
        <pre id={outputId} class="agent-step-error" dir="auto">
          {props.error}
        </pre>
      </Show>
    </div>
  );
}

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

function stepsSummary(steps: readonly AgentStep[], worked: string | undefined, text: TextValue): string {
  const changes = steps.flatMap((step) => (step.kind === "memory" ? [step.change] : []));
  const counts = countConversationMemoryChanges(changes);
  const memory = text.format.list(
    [
      counts.saved ? text.t("chat.steps.memorySaved", { count: counts.saved }) : null,
      counts.updated ? text.t("chat.steps.memoryUpdated", { count: counts.updated }) : null,
      counts.forgotten ? text.t("chat.steps.memoryForgotten", { count: counts.forgotten }) : null,
      counts.notChanged ? text.t("chat.steps.memoryNotChanged", { count: counts.notChanged }) : null,
    ].filter((part): part is string => part !== null),
  );
  const fallback = steps.find((step) => step.kind === "memory-summary");
  return [
    worked === undefined ? text.t("chat.steps.worked") : text.t("chat.steps.workedFor", { duration: worked }),
    changes.length > 0 ? text.t("chat.steps.memory", { changes: memory }) : null,
    fallback?.kind === "memory-summary" ? text.sourceText(fallback.text) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function useAgentStepsLabel(): (steps: readonly AgentStep[], facts: AgentStepsFacts | undefined) => string {
  const text = useText();
  const duration = useDuration();
  return (steps, facts) => {
    const summary = stepsSummary(
      steps,
      facts ? duration(Math.round(facts.durationMs / 1_000) * 1_000) : undefined,
      text,
    );
    return facts?.failed ? `${summary} · ${text.t("chat.steps.failed", { count: facts.failed })}` : summary;
  };
}

export interface AgentStepsTrace {
  spans: () => readonly TraceSpan[];
  keyboard: TraceKeyboard;
  canSelectSpan?: (id: string) => boolean;
  onSelectSpan?: (id: string) => void;
}

export interface AgentStepsFacts {
  durationMs: number;
  failed: number;
}

export function AgentStepsDisclosure(props: {
  steps: readonly AgentStep[];
  defaultOpen: boolean;
  trace?: AgentStepsTrace | undefined;
  facts?: AgentStepsFacts | undefined;
  list?: boolean | undefined;
  traceOpener?: ((open: () => void) => void) | undefined;
}) {
  const text = useText();
  const duration = useDuration();
  const turnTime = (ms: number) => duration(Math.round(ms / 1_000) * 1_000);
  const panelId = createUniqueId();
  const [choice, setChoice] = createSignal<boolean>();
  const [traceOpenedAt, setTraceOpenedAt] = createSignal<number | null>(null);
  const [traceUsed, setTraceUsed] = createSignal(false);
  const open = () => props.list !== false && (choice() ?? props.defaultOpen);
  const [built, setBuilt] = createSignal(untrack(open));
  createEffect(open, (isOpen) => {
    if (isOpen) setBuilt(true);
  });
  const [focus, setFocus] = createSignal<{ id: string } | null>(null);
  const isStep = (id: string) => props.steps.some((step) => step.id === id);
  const canSelectSpan = (id: string) =>
    (props.list !== false && isStep(id)) || (props.trace?.canSelectSpan?.(id) ?? false);
  const selectSpan = (id: string) => {
    setTraceOpenedAt(null);
    if (!isStep(id)) {
      props.trace?.onSelectSpan?.(id);
      return;
    }
    setChoice(true);
    setFocus({ id });
  };
  const opensTrace = () => props.trace !== undefined && !open();
  const expanded = () => {
    if (opensTrace()) return undefined;
    return open() ? "true" : "false";
  };
  const controls = () => {
    if (!open()) return undefined;
    return panelId;
  };
  const popup = () => {
    if (opensTrace()) return "dialog";
    return undefined;
  };
  const activate = () => {
    if (opensTrace()) {
      setTraceUsed(true);
      setTraceOpenedAt(Date.now());
      return;
    }
    setFocus(null);
    setChoice(!open());
  };
  props.traceOpener?.(() => {
    if (!props.trace) return;
    setTraceUsed(true);
    setTraceOpenedAt(Date.now());
  });
  return (
    <div class="agent-steps" data-open={open() ? "" : undefined}>
      <Show when={!props.traceOpener}>
        <Button
          type="button"
          variant="ghost"
          class="agent-steps-header"
          aria-expanded={expanded()}
          aria-controls={controls()}
          aria-haspopup={popup()}
          onClick={activate}
        >
          <span class="agent-steps-summary">
            {stepsSummary(props.steps, props.facts ? turnTime(props.facts.durationMs) : undefined, text)}
          </span>
          <Show when={props.facts?.failed}>
            {(failed) => <Badge class="agent-steps-failed">{text.t("chat.steps.failed", { count: failed() })}</Badge>}
          </Show>
          <ChevronRight class="agent-steps-chevron" aria-hidden="true" />
        </Button>
      </Show>
      <Show when={traceUsed() && props.trace}>
        {(trace) => {
          const spans = createMemo(() => trace().spans());
          return (
            <TraceWaterfallDialog
              open={traceOpenedAt() !== null}
              onOpenChange={(next) => {
                if (!next) setTraceOpenedAt(null);
              }}
              spans={spans()}
              now={traceOpenedAt() ?? 0}
              keyboard={trace().keyboard}
              canSelectSpan={canSelectSpan}
              onSelectSpan={selectSpan}
            />
          );
        }}
      </Show>
      <Show when={built()}>
        <div class="agent-steps-panel" inert={open() ? undefined : true}>
          <AgentStepList id={panelId} steps={props.steps} live={false} focus={focus()} />
        </div>
      </Show>
    </div>
  );
}
