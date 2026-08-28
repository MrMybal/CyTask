"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const allowedRids = new Set(["win-x64", "win-arm64", "linux-x64", "linux-arm64", "osx-x64", "osx-arm64"]);
function currentRid() {
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `win-${architecture}`;
  if (process.platform === "darwin") return `osx-${architecture}`;
  return `linux-${architecture}`;
}
function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, shell, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const rid = process.argv[2] || currentRid();
if (!allowedRids.has(rid)) throw new Error(`Runtime CyTask non pris en charge : ${rid}`);
const root = path.resolve(__dirname, "../../..");
const clientRoot = path.join(root, "apps", "client");
const serverRoot = path.join(clientRoot, "server");
const output = path.join(serverRoot, "current");
if (!output.startsWith(`${serverRoot}${path.sep}`)) throw new Error("Chemin de publication desktop refusé.");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
run(npmCommand, ["run", "build"], path.join(root, "apps", "web"), process.platform === "win32");

const bundledDotnet = path.join(root, ".tools", "dotnet", process.platform === "win32" ? "dotnet.exe" : "dotnet");
const dotnet = process.env.CYTASK_DOTNET || (fs.existsSync(bundledDotnet) ? bundledDotnet : "dotnet");
const lockPath = path.join(root, ".build", "desktop-locks", `packages.${rid}.lock.json`);
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
run(dotnet, [
  "publish", path.join(root, "apps", "server", "src", "CyTask.Api", "CyTask.Api.csproj"),
  "--configuration", "Release", "--runtime", rid, "--self-contained", "true",
  "--output", output, "-p:PublishSingleFile=false", "-p:PublishTrimmed=false",
  `-p:NuGetLockFilePath=${lockPath}`
], root);

const webDist = path.join(root, "apps", "web", "dist");
const webRoot = path.join(output, "wwwroot");
fs.rmSync(webRoot, { recursive: true, force: true });
fs.cpSync(webDist, webRoot, { recursive: true });
fs.writeFileSync(path.join(output, "runtime.json"), `${JSON.stringify({ rid, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`CyTask local sidecar prêt : ${output} (${rid})`);