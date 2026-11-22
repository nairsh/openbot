import { createSignal } from "solid-js";

export type ChatWidth = "full" | "medium";

const CHAT_WIDTH_STORAGE_KEY = "openbot:chat-width";

let unsavedPreference: ChatWidth | undefined;

function readChatWidth(): ChatWidth {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY) === "medium" ? "medium" : "full";
  } catch {
    return "full";
  }
}

function writeChatWidth(width: ChatWidth): void {
  try {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, width);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = width;
  }
}

const [chatWidth, setChatWidthSignal] = createSignal<ChatWidth>(readChatWidth());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== CHAT_WIDTH_STORAGE_KEY) return;
  setChatWidthSignal(readChatWidth());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useChatWidth(): () => ChatWidth {
  return chatWidth;
}

export function setChatWidth(width: ChatWidth): void {
  writeChatWidth(width);
  setChatWidthSignal(width);
}
