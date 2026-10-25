### Added

- Add Direct, a light built-in agent for your own OpenAI-compatible endpoints. It uses the custom
  endpoints from Settings › Providers without OpenCode, has shell, file, search and web tools, and
  records the cost that the endpoint reports.
- Compact a long chat that stays idle for 54 minutes, before the one-hour prompt cache expires, so
  the next message does not read the whole context again. It applies to providers that OpenBot can
  ask to compact. Set `OPENBOT_IDLE_COMPACTION=off` to turn it off.
- Save the durable facts of a chat as memories before its context is compacted, with every
  provider. Set `OPENBOT_MEMORY_FLUSH=off` to turn it off.
- Keep long Pi, Inception and Direct chats small: a large tool result goes to a file, and old tool
  results are cleared only after the prompt cache has expired.

### Changed

- A memory that an agent saves no longer makes Codex, Pi and the other providers read the whole
  chat again without their prompt cache. The session gets the memory at its next start or after a
  compaction. Claude still gets it at the next message.
- Routine runs and one-time generations use the 5-minute prompt cache, which costs less to write.
- The message box eases to its new height when the text gains or loses a line.
- A new reaction on a message pops in.

### Fixed

- Start the app again after the last update. The main process stopped at launch with
  "`__dirname` is not defined in ES module scope".
