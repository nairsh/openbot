import type { AgentMessage } from "@openbot/ui/data";

/**
 * Folds the messages of each live voice call into one row that opens to show them. A call holds the
 * user messages that it sent and the rows of their turns. A row with no turn stays in an open call.
 * Any other row, such as a teammate's report or a routine run, closes it. The stored messages stay
 * unchanged.
 */
export function foldVoiceCalls(messages: readonly AgentMessage[], open: ReadonlySet<string>): AgentMessage[] {
  const sessionByTurn = new Map<string, string>();
  for (const message of messages) {
    if (message.author === "you" && message.liveVoiceSessionId && message.turnId) {
      sessionByTurn.set(message.turnId, message.liveVoiceSessionId);
    }
  }
  const sessionOf = (message: AgentMessage): string | undefined =>
    message.author === "you"
      ? message.liveVoiceSessionId
      : message.turnId
        ? sessionByTurn.get(message.turnId)
        : undefined;
  const calls: { sessionId: string | undefined; members: AgentMessage[] }[] = [];
  for (const message of messages) {
    const current = calls.at(-1);
    const sessionId = sessionOf(message);
    const joins =
      current?.sessionId !== undefined &&
      (sessionId === current.sessionId || (message.author !== "you" && !message.turnId));
    if (current && (joins || (current.sessionId === undefined && sessionId === undefined))) {
      current.members.push(message);
    } else {
      calls.push({ sessionId, members: [message] });
    }
  }
  return calls.flatMap(({ sessionId, members }) => {
    const first = members[0];
    if (sessionId === undefined || !first) return members;
    const expanded = open.has(sessionId);
    const row: AgentMessage = {
      id: `voice-call:${sessionId}`,
      author: "agent",
      body: "",
      time: first.time,
      ...(first.createdAt ? { createdAt: first.createdAt } : {}),
      kind: "action-marker",
      actionMarker: {
        kind: "voice-call",
        sessionId,
        messageIds: members.map((message) => message.id),
        timestamp: first.createdAt ?? "",
        expanded,
      },
    };
    return [row, ...(expanded ? members : [])];
  });
}
