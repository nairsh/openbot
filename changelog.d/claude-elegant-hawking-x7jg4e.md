### Added

- Add Direct, a light built-in agent for your own OpenAI-compatible endpoints. It uses the custom
  endpoints from Settings › Providers without OpenCode, has shell, file, search and web tools, and
  records the cost that the endpoint reports.
- Compact a long chat that stays idle for 54 minutes, before the one-hour prompt cache expires, so
  the next message does not read the whole context again. It applies to providers that OpenBot can
  ask to compact. Set `OPENBOT_IDLE_COMPACTION=off` to turn it off.

### Changed

- The message box eases to its new height when the text gains or loses a line.
- A new reaction on a message pops in.
