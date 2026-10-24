import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

test("MCP initializes and lists CyTask tools", async () => {
  const api = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../cytask-mcp.mjs", import.meta.url))], {
    env: {
      ...process.env,
      CYTASK_URL: `http://127.0.0.1:${address.port}`,
      CYTASK_TOKEN: `cytask_pat_${"a".repeat(43)}`
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = [];
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => responses.push(JSON.parse(line)));
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }
  })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { clearInterval(timer); resolve(); }, 2_000);
    const timer = setInterval(() => {
      if (responses.length >= 2) { clearInterval(timer); clearTimeout(timeout); resolve(); }
    }, 10);
  });
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  await new Promise((resolve) => api.close(resolve));
  assert.equal(stderr, "");
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.protocolVersion, "2025-11-25");
  assert.ok(responses[1].result.tools.some((item) => item.name === "cytask_split_task"));
  assert.ok(responses[1].result.tools.some((item) => item.name === "cytask_call_agent"));
});
