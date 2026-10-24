import { createSignal } from "solid-js";

/** How wide the chat column is: the whole pane, or a medium column in its center. */
export type ChatWidth = "full" | "medium";

const CHAT_WIDTH_STORAGE_KEY = "openbot:chat-width";

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: ChatWidth | undefined;

/**
 * The chat width on this device and browser. It is full unless the user chose otherwise. Reading
 * `window.localStorage` throws when the browser blocks storage, so it is read inside the guard.
 */
export function readChatWidth(): ChatWidth {
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
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = width;
  }
}

const [chatWidth, setChatWidthSignal] = createSignal<ChatWidth>(readChatWidth());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== CHAT_WIDTH_STORAGE_KEY) return;
  setChatWidthSignal(readChatWidth());
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/** The shared reactive preference: a Settings change reaches every open chat at once. */
export function useChatWidth(): () => ChatWidth {
  return chatWidth;
}

export function setChatWidth(width: ChatWidth): void {
  writeChatWidth(width);
  setChatWidthSignal(width);
}
