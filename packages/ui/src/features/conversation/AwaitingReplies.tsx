import { Button, IconButton, X } from "@openbot/ui";
import { createUniqueId, For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { SidebarAgentWait } from "../sidebar/sidebar-agent-states";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_TITLE, sidebarUsageResetTime } from "../sidebar/sidebar-filtering";
import { createTaskListPlayState, TaskMark, type TaskMarkState } from "./TaskList";

export type AwaitingReplyState = "asked" | "working" | "replied" | "failed";

export interface AwaitingReplyItem {
  id: string;
  /** The agent that owes the reply. A remote or removed agent has no profile. */
  agent?: AgentProfile | undefined;
  name: string;
  state: AwaitingReplyState;
  /** A line under the name, such as the start of a reply that waits in the queue. */
  preview?: string;
  /** A short note after the state, such as who reads the reply next. */
  detail?: string | undefined;
  /**
   * What stops an agent that was asked before it can reply: a question, an approval or a browser
   * takeover in its own chat, or a usage limit. The row names it in place of "Working".
   */
  wait?: SidebarAgentWait | undefined;
}

export interface AwaitingReplyListProps {
  items: readonly AwaitingReplyItem[];
  /** The name of the block for assistive technology. The default is "Waiting for replies". */
  title?: string | undefined;
  /** Hides the block. It has a close button only when this is set and no agent still works. */
  onDismiss?: () => void;
  /** Opens the chat of an agent that waits for the user, where the user can answer it. */
  onOpenAgent?: ((agentId: string) => void) | undefined;
  class?: string;
}

const MARK_STATE: Record<AwaitingReplyState, TaskMarkState> = {
  asked: "pending",
  working: "active",
  replied: "done",
  failed: "failed",
};

const STATE_LABEL = {
  asked: "chat.awaiting.state.asked",
  working: "chat.awaiting.state.working",
  replied: "chat.awaiting.state.replied",
  failed: "chat.awaiting.state.failed",
} as const;

/**
 * The block above the composer while an agent waits for other agents: one row for each agent it
 * asked, with the state of the answer. It has no header: the rows name the agents that work. It
 * renders nothing when nothing waits.
 */
export function AwaitingReplies(props: AwaitingReplyListProps) {
  return (
    <Show when={props.items.length > 0}>
      <AwaitingReplyList {...props} />
    </Show>
  );
}

function AwaitingReplyList(props: AwaitingReplyListProps) {
  const { t, format } = useText();
  const playState = createTaskListPlayState();
  const markState = (item: AwaitingReplyItem): TaskMarkState => (item.wait ? "pending" : MARK_STATE[item.state]);
  const stateLabel = (item: AwaitingReplyItem): string => {
    const wait = item.wait;
    if (wait?.kind === "waiting") return t(SIDEBAR_WAIT_TITLE[wait.reason]);
    if (wait?.kind === "limited") {
      const reset = sidebarUsageResetTime(wait.resetsAt, format);
      return reset ? t("sidebar.state.usageLimitResets", { reset }) : t("sidebar.state.usageLimit");
    }
    return t(STATE_LABEL[item.state]);
  };
  /** The question or the command of a wait, else the line the row has. */
  const preview = (item: AwaitingReplyItem): string | undefined =>
    (item.wait?.kind === "waiting" ? item.wait.detail : null) ?? item.preview;
  const openAction = (item: AwaitingReplyItem) => {
    const wait = item.wait;
    const agentId = item.agent?.id;
    const open = props.onOpenAgent;
    if (wait?.kind !== "waiting" || !agentId || !open) return undefined;
    return { label: t(SIDEBAR_WAIT_ACTION[wait.reason]), run: () => open(agentId) };
  };
  // Every agent replied or failed, so nothing more comes for these rows.
  const settled = () => props.items.every((item) => item.state === "replied" || item.state === "failed");
  return (
    <section
      style={{ "--task-list-play-state": playState() }}
      class={["task-list", "awaiting-replies", props.class]}
      aria-label={props.title ?? t("chat.awaiting.title")}
      data-open=""
    >
      <Show when={settled() && props.onDismiss}>
        {(dismiss) => (
          <IconButton
            class="awaiting-replies-dismiss"
            label={t("chat.awaiting.dismiss")}
            variant="ghost"
            size="icon-xs"
            data-cuelume-tap="close"
            onClick={() => dismiss()()}
          >
            <X aria-hidden="true" />
          </IconButton>
        )}
      </Show>
      <div class="task-list-panel">
        <ol class="task-list-items">
          <For each={props.items} keyed={(item) => item.id}>
            {(item, index) => {
              // Two rows can have the same action word, so the button also names the agent.
              const rowId = createUniqueId();
              return (
                <li
                  class="task-list-item awaiting-replies-item"
                  data-state={markState(item())}
                  data-wait={item().wait ? "" : undefined}
                  style={{ "--task-list-index": index() }}
                >
                  <AgentAvatar
                    agent={item().agent}
                    seed={item().agent ? undefined : item().name}
                    class="awaiting-replies-avatar"
                  />
                  <span class="awaiting-replies-text">
                    <span id={`${rowId}-name`} class="awaiting-replies-name">
                      {item().name}
                    </span>
                    <Show when={preview(item())}>
                      {(text) => <span class="awaiting-replies-preview">{text()}</span>}
                    </Show>
                  </span>
                  <span class="awaiting-replies-state">
                    <Show when={item().detail}>
                      {(detail) => <span class="awaiting-replies-detail">{detail()}</span>}
                    </Show>
                    <span class="awaiting-replies-state-label">{stateLabel(item())}</span>
                    <span class="task-list-item-mark" aria-hidden="true">
                      <TaskMark state={markState(item())} />
                    </span>
                  </span>
                  <Show when={openAction(item())}>
                    {(action) => (
                      <Button
                        id={`${rowId}-open`}
                        size="xs"
                        variant="secondary"
                        class="awaiting-replies-open"
                        aria-labelledby={`${rowId}-open ${rowId}-name`}
                        onClick={() => action().run()}
                      >
                        {action().label}
                      </Button>
                    )}
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </div>
    </section>
  );
}
