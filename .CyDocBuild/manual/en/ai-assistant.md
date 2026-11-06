---
id: ai-assistant
title: AI Assistant connections
order: 15
description: Configure provider connections and distinguish assistance from agent execution.
section: Extensions
parent: plugins
revision: 2
---

The AI Assistant plugin connects CyTask to configured providers. A connection profile describes how to reach a provider; it is not a guarantee that an agent will autonomously execute every task.

## Configure a connection {#configure-a-connection}
1. Enable AI Assistant for the project.
2. Open its connection settings and choose the supported provider or compatible endpoint.
3. Supply the model and authentication using the dedicated fields.
4. Test the connection before using it with project context.

Profiles cover OpenAI, Anthropic, compatible APIs and local endpoints such as Ollama or LM Studio, as well as supported Codex, Claude Code and OpenCode routes. Availability depends on the server’s configured capabilities.

Do not paste a provider key into a task description. Keep credentials in the connection settings and revoke them at the provider if exposed.

## Local tools and remote servers {#local-tools-and-remote-servers}
“Local” means local to the component running the tool. A CLI on the team server is not automatically the CLI installed on your desktop. Local execution must be explicitly allowed and configured by the administrator.

Choose the minimum project context needed. Review generated suggestions and changes before applying them. A model can misunderstand instructions or return inaccurate content.

## Assistance versus orchestration {#assistance-versus-orchestration}
Task-aware chat and provider connections are separate from durable agent scheduling. To let an orchestrator create members, claim work and acknowledge calls, use the dedicated agent API and MCP integration.

No provider connection should be treated as permission to run arbitrary shell commands or publish your project. See [agents and MCP](doc:agents-api), [permissions](doc:permissions) and [plugins](doc:plugins).
