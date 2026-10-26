### Changed

- Agents on a custom endpoint model now run in Direct instead of OpenCode. OpenBot moves each such
  agent when it is idle, with the same model, workspace and chat. A message that you send while the
  agent works now steers the running turn instead of waiting in the queue, and the status line names
  Direct. The model picker shows the endpoints once, on the Custom tab. Direct agents stay on this
  computer, so team members no longer see them.
