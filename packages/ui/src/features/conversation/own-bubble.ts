import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { avatarHeadColor } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import type { ChatMessageAuthor } from "./ChatMessageRow";

export const CHAT_BUBBLE_STYLES = ["solid", "tint", "classic"] as const;
export type ChatBubbleStyle = (typeof CHAT_BUBBLE_STYLES)[number];
export const DEFAULT_CHAT_BUBBLE_STYLE: ChatBubbleStyle = "solid";

export const CHAT_BUBBLE_STYLE_LABEL = {
  solid: "settings.bubbleStyle.solid",
  tint: "settings.bubbleStyle.tint",
  classic: "settings.bubbleStyle.classic",
} as const satisfies Record<ChatBubbleStyle, AppTextKey>;

export function isChatBubbleStyle(value: unknown): value is ChatBubbleStyle {
  return CHAT_BUBBLE_STYLES.some((style) => style === value);
}

function agentFaceColor(agent: AgentProfile): AvatarColor | undefined {
  if (agent.avatarUrl !== null) return undefined;
  const color = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor ?? null).toLowerCase();
  return isAvatarColor(color) ? color : undefined;
}

export function ownMessageAuthor(input: {
  name: string;
  style: ChatBubbleStyle;
  agent: AgentProfile | undefined;
  chatColor: AvatarColor | undefined;
}): ChatMessageAuthor {
  const color = input.style === "classic" || input.agent === undefined ? undefined : agentFaceColor(input.agent);
  if (color === undefined) return { kind: "you", name: input.name, chatColor: input.chatColor };
  return { kind: "you", name: input.name, chatColor: color, solidBubble: input.style === "solid" };
}
