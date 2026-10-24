# CyTask JavaScript SDK

Small dependency-free client for embedding CyTask in a Node.js application, desktop shell or automation service.

```js
import { CyTaskClient } from "@cytask/sdk";

const cytask = new CyTaskClient({
  baseUrl: process.env.CYTASK_URL,
  token: process.env.CYTASK_TOKEN
});

const context = await cytask.agentContext();
const task = await cytask.claimTask(context.notifications[0].taskId);
```

Keep the API token outside project data and pass it at runtime. The client works with a regular CyTask server and with the loopback server started by CyTask Desktop.
