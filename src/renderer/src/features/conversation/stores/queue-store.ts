import type { QueueDelivery } from "@openbot/contracts/ipc";
import { agentActivityExitDuration } from "@openbot/ui/features/conversation/activity-timing";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { agentAwaitingReplies } from "../../../awaiting-replies";
import { activeQueueDeliveries, presentQueueDeliveries, queuedDeliveriesInOrder } from "../../../queue-reconciliation";
import type { ConversationProps } from "../conversation-types";

/** Longer than a local host takes to start a sent message. */
const IDLE_QUEUE_SHOW_DELAY_MS = 500;

export interface QueueStoreDeps {
  props: ConversationProps;
  hiddenAwaitingReplyIds: Accessor<ReadonlySet<string>>;
}

export function createQueueStore(deps: QueueStoreDeps) {
  const activeDeliveries = createMemo(() => activeQueueDeliveries(deps.props.queue, deps.props.activeTurnId));
  const orderedQueuedDeliveries = createMemo(() => queuedDeliveriesInOrder(deps.props.queue));
  const presentedQueueDeliveries = createMemo(() =>
    presentQueueDeliveries({
      snapshot: deps.props.queue,
      activeTurnId: deps.props.activeTurnId,
      renderedMessageIds: new Set(deps.props.messages.map((message) => message.id)),
    }),
  );
  // The agents this agent asked, and the answers that wait for it. A queue of another agent, which
  // the view holds for a moment while it switches, answers nothing here.
  // The person can close the block when every agent is done. A closed row that works again shows.
  const awaitingReplies = createMemo(() => {
    const hidden = deps.hiddenAwaitingReplyIds();
    return agentAwaitingReplies({
      messages: deps.props.messages,
      queue: deps.props.queue?.agentId === deps.props.agent?.id ? deps.props.queue : undefined,
      agents: deps.props.agents,
      self: deps.props.agent,
      waits: deps.props.agentWaits,
    }).filter((row) => !(hidden.has(row.id) && (row.state === "replied" || row.state === "failed")));
  });
  const [renderedQueueDeliveries, setRenderedQueueDeliveries] = createSignal<QueueDelivery[]>([]);
  const queuePanelVisible = createMemo(() => renderedQueueDeliveries().length > 0);
  let queueExitTimer: number | undefined;
  let queueShowTimer: number | undefined;
  createEffect(
    () => presentedQueueDeliveries(),
    (deliveries) => {
      if (queueExitTimer !== undefined) {
        window.clearTimeout(queueExitTimer);
        queueExitTimer = undefined;
      }
      if (deliveries.length > 0) {
        if (untrack(renderedQueueDeliveries).length > 0 || untrack(() => deps.props.activeTurnId)) {
          setRenderedQueueDeliveries(deliveries);
        } else {
          // A message to an idle agent passes through the queue on its way to the transcript. The
          // panel waits that long, so it does not open and close above the composer.
          queueShowTimer ??= window.setTimeout(() => {
            queueShowTimer = undefined;
            setRenderedQueueDeliveries(untrack(presentedQueueDeliveries));
          }, IDLE_QUEUE_SHOW_DELAY_MS);
        }
        return;
      }
      window.clearTimeout(queueShowTimer);
      queueShowTimer = undefined;
      if (untrack(renderedQueueDeliveries).length === 0) return;
      queueExitTimer = window.setTimeout(() => {
        queueExitTimer = undefined;
        if (untrack(presentedQueueDeliveries).length === 0) setRenderedQueueDeliveries([]);
      }, agentActivityExitDuration());
    },
  );
  onCleanup(() => {
    if (queueExitTimer !== undefined) window.clearTimeout(queueExitTimer);
    window.clearTimeout(queueShowTimer);
  });

  return {
    activeDeliveries,
    awaitingReplies,
    orderedQueuedDeliveries,
    presentedQueueDeliveries,
    renderedQueueDeliveries,
    setRenderedQueueDeliveries,
    queuePanelVisible,
  };
}
