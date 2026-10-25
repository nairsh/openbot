### Fixed

- Pi agents no longer stop with "Pi returned an invalid RPC record." when a tool call has a value
  such as `true` that is also the value of an MCP server setting or of the GitHub connection. Before,
  OpenBot stopped Pi and started it again, and the turn failed.
