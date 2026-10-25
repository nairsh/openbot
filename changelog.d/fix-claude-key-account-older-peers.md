### Changed

- Claude agents use Claude Code's own prompt cache time again by default: 5 minutes with an Anthropic
  API key, and 1 hour for the main chat of a Claude plan within its usage limits. In 0.50.0, OpenBot
  asked for 1 hour for all agents, and a 1-hour cache write costs more. The "Prompt cache" setting on
  the Claude page in Server settings › Providers now has "Claude Code default" and "1 hour". If you
  chose "1 hour", it stays.

### Fixed

- A server with a saved Anthropic API key no longer starts a Claude sign-in on the API key account, or
  removes that account, when an older OpenBot version asks for it. That version shows the key as a
  signed-out account. Now it gets a message that tells you to change the key in Server settings ›
  Providers.
