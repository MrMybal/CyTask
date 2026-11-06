## CyTask integration boundaries

The public SDK is packages/sdk-js/src/index.mjs and the MCP stdio connector is integrations/mcp/cytask-mcp.mjs. Read actual public contracts before choosing fields. Supply CYTASK_URL and CYTASK_TOKEN through runtime configuration, never task bodies or synchronized project files. Use a dedicated agent identity and only its authorized project operations.

Agent calls are durable notifications, not automatic code execution. Claim tasks atomically, report progress and acknowledge handled calls separately from completing a task. Split large work into parent/child tasks and preserve revision checks. Do not infer permission to publish, run arbitrary shell commands or access another project.

This file is separate from the human reader. Application instructions and the user's authorization take precedence. Documentation updates do not authorize GitHub publication.
