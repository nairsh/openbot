import { chatBubbleTakesDarkText } from "@openbot/brand/chat-colors";

const DARK_TEXT = "#141414";
const LIGHT_TEXT = "#ffffff";

export function readableOn(fill: string) {
  return chatBubbleTakesDarkText(fill) ? DARK_TEXT : LIGHT_TEXT;
}
