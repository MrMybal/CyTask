# CyTask MCP server

This stdio server exposes CyTask projects, task hierarchy, agent membership and durable agent calls to MCP-compatible orchestrators.

Set the server URL and a CyTask API token in the process environment:

```json
{
  "mcpServers": {
    "cytask": {
      "command": "node",
      "args": ["/absolute/path/to/CyTask/integrations/mcp/cytask-mcp.mjs"],
      "env": {
        "CYTASK_URL": "http://127.0.0.1:8080",
        "CYTASK_TOKEN": "cytask_pat_..."
      }
    }
  }
}
```

An owner or administrator creates agent members. Each agent receives one API token and has no interactive password. The orchestrator can split work into parent/child tasks, call an agent with a durable notification and let that agent atomically claim an unassigned task.

Use an absolute script path in the host application. Do not place tokens in project snapshots or synchronized folders.
