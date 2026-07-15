#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";

const API_URL = (process.env.TOKENSIZE_API_URL || "https://api.tokensize.dev").replace(/\/$/, "");
const DISCOVERY_CACHE_VERSION = 3;
const DEFAULT_DISCOVERY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const args = process.argv.slice(2);
const command = args[0] || "help";

function flag(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function has(name) {
  return args.includes(name);
}

function fail(message) {
  process.stderr.write(`tokensize: ${message}\n`);
  process.exit(1);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function tokensizeHome() {
  return process.env.TOKENSIZE_HOME || path.join(os.homedir(), ".tokensize");
}

function discoveryCacheFile() {
  return path.join(tokensizeHome(), "discovery.json");
}

function lastRouteFile() {
  return path.join(tokensizeHome(), "last-route.json");
}

function credentialsFile() { return path.join(tokensizeHome(), "credentials.json"); }
async function savedApiKey() {
  if (process.env.TOKENSIZE_API_KEY) return process.env.TOKENSIZE_API_KEY;
  try {
    const value = JSON.parse(await readFile(credentialsFile(), "utf8"));
    return typeof value.apiKey === "string" ? value.apiKey : undefined;
  } catch { return undefined; }
}
async function saveApiKey(apiKey) {
  await mkdir(tokensizeHome(), { recursive: true, mode: 0o700 });
  await writeFile(credentialsFile(), `${JSON.stringify({ apiKey }, null, 2)}\n`, { mode: 0o600 });
}

function discoveryCacheTtlMs() {
  const configured = Number(process.env.TOKENSIZE_DISCOVERY_CACHE_TTL_MS || DEFAULT_DISCOVERY_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_DISCOVERY_CACHE_TTL_MS;
}

function discoveryFingerprint() {
  return JSON.stringify({
    path: process.env.PATH || "",
    claudeModels: process.env.TOKENSIZE_CLAUDE_MODELS || "",
    copilotModels: process.env.TOKENSIZE_COPILOT_MODELS || "",
  });
}

async function run(executable, argv, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const maximum = options.maxBytes || 4_000_000;
    child.stdout.on("data", (data) => {
      if (stdout.length < maximum) stdout += data.toString().slice(0, maximum - stdout.length);
    });
    child.stderr.on("data", (data) => {
      if (stderr.length < maximum) stderr += data.toString().slice(0, maximum - stderr.length);
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, options.timeoutMs || 15_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(options.input || "");
  });
}

async function findExecutable(names) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }
  }
}

function approved(harness) {
  return (process.env.TOKENSIZE_ALLOW_SUBSCRIPTION_HARNESSES || "")
    .split(",")
    .map((value) => value.trim())
    .includes(harness);
}

function candidate(harness, nativeModelId, displayName, options = {}) {
  const modelName = `${nativeModelId} ${displayName}`.toLowerCase();
  const quality = /opus|fable|gpt-5\.6|extra high|xhigh/.test(modelName) ? 0.98
    : /sonnet|gpt-5\.5|gpt-5\.4|grok|composer|high/.test(modelName) ? 0.94 : 0.88;
  const efficient = /mini|nano|haiku|fast|grok|composer/.test(modelName);
  return {
    id: `${harness}:${nativeModelId}`,
    harness,
    nativeModelId,
    displayName,
    readiness: "model-listed",
    authMode: options.authMode || "subscription",
    productUseApproved: options.approved ?? approved(harness),
    capabilities: {
      tools: true,
      vision: harness === "codex" || harness === "claude",
      structuredOutput: harness === "codex" ? "jsonl" : "json",
      sessions: "resume",
      permissions: options.permissions || ["inspect", "edit", "test"],
    },
    identityProof: "runtime-reported",
    qualityPrior: options.quality || quality,
    tokenEfficiencyPrior: options.efficiency || (efficient ? 0.9 : 0.72),
    latencyPrior: options.latency || (efficient ? 0.88 : 0.66),
  };
}

async function discoverCodex() {
  const executable = await findExecutable(["codex"]);
  if (!executable) return { harness: "codex", installed: false, authenticated: false, models: [], warnings: [] };
  const [version, auth] = await Promise.all([run(executable, ["--version"]), run(executable, ["login", "status"])]);
  const child = spawn(executable, ["app-server", "--stdio"], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const models = await new Promise((resolve) => {
    let buffer = "";
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish([]), 8_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: { includeHidden: false, limit: 100 } })}\n`);
          }
          if (message.id === 2) {
            const apiKeyMode = Boolean(process.env.OPENAI_API_KEY);
            finish((message.result?.data || []).map((item) => candidate("codex", item.id, item.displayName || item.id, {
              approved: apiKeyMode || approved("codex"),
              authMode: apiKeyMode ? "api-key" : "subscription",
            })));
          }
        } catch {}
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "tokensize-public-skill", version: "1.0.0" }, capabilities: { experimentalApi: true } } })}\n`);
  });
  return {
    harness: "codex",
    installed: true,
    authenticated: auth.code === 0,
    executable,
    version: version.stdout.trim(),
    models,
    warnings: models.length ? [] : ["Codex did not return a model catalog"],
  };
}

async function discoverClaude() {
  const executable = await findExecutable(["claude"]);
  if (!executable) return { harness: "claude", installed: false, authenticated: false, models: [], warnings: [] };
  const [version, auth, help] = await Promise.all([
    run(executable, ["--version"]),
    run(executable, ["auth", "status"]),
    run(executable, ["--help"]),
  ]);
  const configured = (process.env.TOKENSIZE_CLAUDE_MODELS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const reported = [...new Set([
    ...(help.stdout.match(/'([a-z][a-z0-9.-]+)'/g) || []).map((value) => value.slice(1, -1)),
    ...(help.stdout.match(/claude-[a-z0-9.-]+/g) || []),
  ])].filter((value) => ["fable", "opus", "sonnet", "haiku"].includes(value) || value.startsWith("claude-"));
  const apiKeyMode = Boolean(process.env.ANTHROPIC_API_KEY);
  const models = [...new Set([...configured, ...reported])].map((id) => candidate("claude", id, id, {
    approved: apiKeyMode || approved("claude"),
    authMode: apiKeyMode ? "api-key" : "subscription",
  }));
  return {
    harness: "claude",
    installed: true,
    authenticated: auth.code === 0,
    executable,
    version: version.stdout.trim(),
    models,
    warnings: models.length ? [] : ["Set TOKENSIZE_CLAUDE_MODELS if this Claude CLI does not advertise aliases"],
  };
}

async function discoverCursor() {
  const executable = await findExecutable(["agent", "cursor-agent"]);
  if (!executable) return { harness: "cursor", installed: false, authenticated: false, models: [], warnings: [] };
  const [version, auth, catalog] = await Promise.all([
    run(executable, ["--version"]),
    run(executable, ["status"]),
    run(executable, ["--list-models"], { timeoutMs: 30_000 }),
  ]);
  const available = catalog.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^(\S+)\s+-\s+(.+)$/.exec(line.trim());
    return match && match[1] !== "auto" ? [{ id: match[1], name: match[2] }] : [];
  });
  const frontier = available.filter(({ id, name }) => /gpt-5\.[4-9]|opus|fable|sonnet|grok|composer|high|xhigh/i.test(`${id} ${name}`));
  const models = (frontier.length ? frontier : available).slice(0, 48).map(({ id, name }) =>
    candidate("cursor", id, name, { permissions: ["inspect"] }));
  return {
    harness: "cursor",
    installed: true,
    authenticated: auth.code === 0 && /logged in/i.test(auth.stdout),
    executable,
    version: version.stdout.trim(),
    models,
    warnings: models.length ? [] : ["Cursor did not return a model catalog"],
  };
}

async function discoverCopilot() {
  const executable = await findExecutable(["copilot", "github-copilot-cli"]);
  if (!executable) return { harness: "copilot", installed: false, authenticated: false, models: [], warnings: [] };
  const version = await run(executable, ["--version"]);
  const modelIds = (process.env.TOKENSIZE_COPILOT_MODELS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const authenticated = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  return {
    harness: "copilot",
    installed: true,
    authenticated,
    executable,
    version: version.stdout.trim(),
    models: modelIds.map((id) => candidate("copilot", id, id)),
    warnings: authenticated && modelIds.length ? [] : ["Copilot fails closed unless authentication and TOKENSIZE_COPILOT_MODELS are explicit"],
  };
}

function stripAnsi(value) {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function opencodeModelIds(output) {
  return [...new Set(stripAnsi(output).split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i.test(line)))];
}

function isCredentialFreeOpenCodeModel(id) {
  return /^opencode\/(?:big-pickle|[a-z0-9._:/-]+-free)$/i.test(id);
}

async function discoverOpenCode() {
  const executable = await findExecutable(["opencode"]);
  if (!executable) return { harness: "opencode", installed: false, authenticated: false, models: [], warnings: [] };
  const [version, auth, initialCatalog] = await Promise.all([
    run(executable, ["--version"]),
    run(executable, ["auth", "list"]),
    run(executable, ["models"], { timeoutMs: 30_000, maxBytes: 2_000_000 }),
  ]);
  const authOutput = stripAnsi(`${auth.stdout}\n${auth.stderr}`).trim();
  const hasStoredCredentials = auth.code === 0 && authOutput.length > 0 && !/\b(?:no|0)\s+(?:credentials|providers|authentication)\b/i.test(authOutput);
  let available = opencodeModelIds(initialCatalog.stdout);
  if (available.length === 0) {
    available = opencodeModelIds((await run(executable, ["models"], { timeoutMs: 30_000, maxBytes: 2_000_000 })).stdout);
  }
  const credentialFree = available.filter(isCredentialFreeOpenCodeModel);
  const authenticated = hasStoredCredentials || credentialFree.length > 0;
  const frontier = available.filter((id) => /gpt-5\.[4-9]|opus|fable|sonnet|grok|gemini|glm|qwen|coder/i.test(id));
  const ids = [...new Set([...credentialFree, ...(frontier.length ? frontier : available)])].slice(0, 48);
  const models = ids.map((id) => {
    const credentialFreeModel = isCredentialFreeOpenCodeModel(id);
    return candidate("opencode", id, id, {
      permissions: ["inspect"],
      approved: credentialFreeModel || approved("opencode"),
      authMode: credentialFreeModel ? "cloud-provider" : "subscription",
    });
  });
  const warnings = [];
  if (!hasStoredCredentials && credentialFree.length) warnings.push(`OpenCode has no stored provider credentials; ${credentialFree.length} credential-free model(s) remain available`);
  else if (!hasStoredCredentials) warnings.push("OpenCode did not report a configured provider credential");
  if (!models.length) warnings.push("OpenCode model catalog was unavailable; run `opencode models --refresh`");
  if (!approved("opencode") && models.some((model) => model.authMode === "subscription")) warnings.push("Paid/provider OpenCode models remain ineligible; set TOKENSIZE_ALLOW_SUBSCRIPTION_HARNESSES=opencode only when provider and product terms permit delegated use");
  return { harness: "opencode", installed: true, authenticated, executable, version: version.stdout.trim(), models, warnings };
}

async function discoverFresh() {
  return await Promise.all([discoverCodex(), discoverClaude(), discoverCursor(), discoverCopilot(), discoverOpenCode()]);
}

function applyCurrentApproval(harnesses) {
  return harnesses.map((item) => ({
    ...item,
    models: item.models.map((model) => {
      const apiKeyMode = (model.harness === "codex" && Boolean(process.env.OPENAI_API_KEY))
        || (model.harness === "claude" && Boolean(process.env.ANTHROPIC_API_KEY));
      return {
        ...model,
        authMode: model.harness === "opencode" && isCredentialFreeOpenCodeModel(model.nativeModelId) ? "cloud-provider" : apiKeyMode ? "api-key" : "subscription",
        productUseApproved: (model.harness === "opencode" && isCredentialFreeOpenCodeModel(model.nativeModelId)) || apiKeyMode || approved(model.harness),
      };
    }),
  }));
}

async function cachedExecutablesExist(harnesses) {
  try {
    await Promise.all(harnesses
      .filter((item) => item.installed)
      .map((item) => item.executable ? access(item.executable) : Promise.reject(new Error("missing executable"))));
    return true;
  } catch {
    return false;
  }
}

async function readDiscoveryCache() {
  const file = discoveryCacheFile();
  try {
    const cached = JSON.parse(await readFile(file, "utf8"));
    if (cached.schemaVersion !== DISCOVERY_CACHE_VERSION
      || cached.fingerprint !== discoveryFingerprint()
      || !Array.isArray(cached.harnesses)
      || Date.parse(cached.expiresAt) <= Date.now()
      || !(await cachedExecutablesExist(cached.harnesses))) return null;
    return {
      harnesses: applyCurrentApproval(cached.harnesses),
      cache: {
        hit: true,
        path: file,
        createdAt: cached.createdAt,
        expiresAt: cached.expiresAt,
        ageMs: Math.max(0, Date.now() - Date.parse(cached.createdAt)),
      },
    };
  } catch {
    return null;
  }
}

async function writeDiscoveryCache(harnesses, reason) {
  const home = tokensizeHome();
  const file = discoveryCacheFile();
  const temporary = `${file}.${process.pid}.tmp`;
  const createdAt = new Date();
  const value = {
    schemaVersion: DISCOVERY_CACHE_VERSION,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + discoveryCacheTtlMs()).toISOString(),
    fingerprint: discoveryFingerprint(),
    harnesses,
  };
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  return {
    hit: false,
    refreshed: true,
    reason,
    path: file,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ageMs: 0,
  };
}

async function discover(options = {}) {
  if (!options.forceRefresh && !has("--refresh")) {
    const cached = await readDiscoveryCache();
    if (cached) return cached;
  }
  const harnesses = await discoverFresh();
  const reason = options.reason || (has("--refresh") ? "manual" : "miss-or-stale");
  let cache;
  try {
    cache = await writeDiscoveryCache(harnesses, reason);
  } catch (error) {
    cache = {
      hit: false,
      refreshed: true,
      persisted: false,
      reason,
      warning: `could not persist discovery cache: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { harnesses, cache };
}

async function installationId() {
  const home = tokensizeHome();
  const file = path.join(home, "config.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (typeof value.installationId === "string") return value.installationId;
  } catch {}
  const id = randomUUID();
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ installationId: id }, null, 2)}\n`, { mode: 0o600 });
  return id;
}

async function saveLastRoute(route) {
  const home = tokensizeHome();
  const file = lastRouteFile();
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify({
    routeId: route.routeId,
    feedbackToken: route.feedbackToken,
    expiresAt: route.expiresAt,
    targetId: route.plan?.targetId ?? null,
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function lastRoute() {
  try {
    const value = JSON.parse(await readFile(lastRouteFile(), "utf8"));
    if (typeof value.routeId !== "string" || typeof value.feedbackToken !== "string") throw new Error();
    if (typeof value.expiresAt === "string" && Date.parse(value.expiresAt) < Date.now()) fail("the last route has expired; delegate another task before sending feedback");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("the last route")) throw error;
    fail("no local route receipt found; delegate a task before sending feedback");
  }
}

function features(task, role, permission) {
  const text = task.toLowerCase();
  const tokens = Math.ceil(task.length / 4);
  const type = /\bbug|fix|error|broken\b/.test(text) ? "bug"
    : /\brefactor|cleanup\b/.test(text) ? "refactor"
      : /\bmigrat/.test(text) ? "migration"
        : /\breview|audit\b/.test(text) ? "review"
          : /\btest|spec\b/.test(text) ? "test"
            : /\bdocs?|readme\b/.test(text) ? "docs"
              : /\bbuild|implement|add|create\b/.test(text) ? "feature" : "unknown";
  const complexity = Math.min(1, 0.2 + tokens / 2_000 + (/architecture|distributed|security|migration/.test(text) ? 0.25 : 0));
  return {
    role,
    type,
    complexity,
    scopeBreadth: Math.min(1, 0.15 + (text.match(/\b(file|package|service|workspace|repository|system)\b/g) || []).length * 0.12),
    contextTokens: tokens,
    oracleStrength: /\btest|lint|typecheck|build|compile\b/.test(text) ? 0.7 : 0.2,
    codeDensity: /```|\b(function|class|const|import|SELECT)\b/.test(task) ? 0.4 : 0.05,
    risk: /security|auth|payment|production|migration/.test(text) ? "high" : permission === "inspect" ? "low" : "medium",
    languages: [],
    requiredTools: [],
    requiresVision: /image|screenshot|visual|ui\b/.test(text),
    requiresNetwork: permission === "network",
    cacheHit: false,
  };
}

async function api(pathname, options = {}) {
  const apiKey = await savedApiKey();
  if (!apiKey) fail("TokenSize API key is missing. Run: node scripts/tokensize.mjs auth login");
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`service returned ${response.status}: ${body?.error?.message || body.message || "request failed"}`);
  return body;
}

async function prepare(task) {
  const role = flag("--role") || "inspect";
  const permission = flag("--permission") || "inspect";
  if (!["inspect", "plan", "implement", "review", "test"].includes(role)) fail("invalid --role");
  if (!["inspect", "edit", "test", "network"].includes(permission)) fail("invalid --permission");
  const discovered = await discover();
  const discovery = discovered.harnesses;
  const queues = discovery.filter((item) => item.authenticated).map((item) => [...item.models]);
  const candidates = [];
  while (candidates.length < 100 && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) candidates.push(next);
      if (candidates.length === 100) break;
    }
  }
  const body = {
    schemaVersion: 1,
    requestId: randomUUID(),
    installationId: await installationId(),
    routerMode: has("--share-prompt") ? "prompt-assisted" : "metadata-only",
    task: features(task, role, permission),
    ...(has("--share-prompt") ? { prompt: task } : {}),
    candidates,
    root: {
      harness: process.env.TOKENSIZE_ROOT_HARNESS || "codex",
      qualityPrior: Number(process.env.TOKENSIZE_ROOT_QUALITY_PRIOR || 0.82),
    },
    policy: {
      objective: flag("--objective") || "balanced",
      maxDelegationDepth: 1,
      delegationDepth: Number(process.env.TOKENSIZE_DELEGATION_DEPTH || 0),
      permissionCeiling: permission,
      wallTimeBudgetMs: Number(flag("--timeout-ms") || 900_000),
    },
  };
  return { body, discovery, cache: discovered.cache };
}

function publicRoute(route) {
  return { ...route, feedbackToken: "[redacted]" };
}

function publicDiscovery(harnesses) {
  if (has("--verbose")) return harnesses;
  return harnesses.map((item) => ({
    harness: item.harness,
    installed: item.installed,
    authenticated: item.authenticated,
    version: item.version,
    modelCount: item.models.length,
    warnings: item.warnings,
  }));
}

async function execute(task, route, discovery, cache) {
  if (!route.plan?.targetId) fail(`no local target selected (${(route.reasonCodes || []).join(", ")})`);
  if (route.plan.permissionProfile === "network") fail("network delegation is not supported");
  const target = discovery.flatMap((item) => item.models.map((model) => ({ item, model }))).find(({ model }) => model.id === route.plan.targetId);
  if (!target?.item.executable || !target.item.authenticated) {
    await discover({ forceRefresh: true, reason: "selected-target-unavailable" });
    fail("selected target is no longer available; local discovery cache refreshed");
  }
  try {
    await access(target.item.executable);
  } catch {
    await discover({ forceRefresh: true, reason: "selected-executable-missing" });
    fail("selected harness executable no longer exists; local discovery cache refreshed");
  }
  if (!["codex", "claude", "cursor", "opencode"].includes(target.model.harness)) fail(`${target.model.harness} is discovery-only in this client`);
  if (["cursor", "opencode"].includes(target.model.harness) && route.plan.permissionProfile !== "inspect") fail(`${target.model.harness === "cursor" ? "Cursor" : "OpenCode"} execution is inspect-only`);

  let cwd = process.cwd();
  let worktree = null;
  if (route.plan.requiresWorktree) {
    const gitCheck = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 15_000 });
    if (gitCheck.code !== 0) fail("edit/test delegation requires a Git repository");
    worktree = path.join(tokensizeHome(), "worktrees", route.routeId);
    await mkdir(path.dirname(worktree), { recursive: true, mode: 0o700 });
    const branch = `tokensize/${route.routeId.slice(0, 8)}`;
    const created = await run("git", ["worktree", "add", "-b", branch, worktree, "HEAD"], { cwd, timeoutMs: 30_000 });
    if (created.code !== 0) fail(`could not create isolated worktree: ${created.stderr.trim()}`);
    cwd = worktree;
  }

  const permission = route.plan.permissionProfile;
  const argv = target.model.harness === "codex"
    ? ["exec", "-C", cwd, "-s", permission === "inspect" ? "read-only" : "workspace-write", "--json", "-m", target.model.nativeModelId, "-"]
    : target.model.harness === "claude"
      ? ["-p", "--model", target.model.nativeModelId, "--output-format", "json", "--permission-mode", permission === "inspect" ? "plan" : "acceptEdits", "--no-session-persistence"]
      : target.model.harness === "cursor"
        ? ["-p", "--output-format", "json", "--mode", "plan", "--model", target.model.nativeModelId, "--workspace", cwd, "--trust"]
        : ["run", "--model", target.model.nativeModelId, "--agent", "plan", "--format", "json", "--dir", cwd];
  const started = Date.now();
  const result = await run(target.item.executable, argv, { cwd, input: task, timeoutMs: route.plan.maxWallMs });
  const elapsed = Date.now() - started;
  const availabilityFailure = result.timedOut || (result.code !== 0
    && /unknown model|model.{0,24}(not found|not available|unavailable|invalid)|invalid value.{0,80}--model|not logged in|unauthenticated|authentication|command not found|enoent/i.test(`${result.stderr}\n${result.stdout}`));
  let discoveryRefresh;
  if (availabilityFailure) {
    const refreshed = await discover({ forceRefresh: true, reason: result.timedOut ? "execution-timeout" : "execution-availability-failure" });
    discoveryRefresh = refreshed.cache;
  }
  try {
    await api("/v1/agent-feedback", {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: 1,
        routeId: route.routeId,
        feedbackToken: route.feedbackToken,
        idempotencyKey: randomUUID(),
        status: result.code === 0 ? "completed" : "failed",
        confirmedTargetId: target.model.id,
        identityConfirmed: true,
        checksPassed: 0,
        checksFailed: 0,
        retries: 0,
        usage: { contextTokensEstimated: route.expected?.contextTokens || 0, source: "estimated" },
        timings: { totalMs: elapsed, routingMs: 0, executionMs: elapsed, verificationMs: 0 },
        ...(result.code === 0 ? {} : { failureCode: result.timedOut ? "EXECUTION_TIMEOUT" : "EXECUTION_FAILED" }),
      }),
    });
  } catch (error) {
    result.feedbackWarning = error instanceof Error ? error.message : String(error);
  }
  return { target: target.model.id, code: result.code, timedOut: result.timedOut, worktree, stdout: result.stdout, stderr: result.stderr, feedbackWarning: result.feedbackWarning, cacheUsed: cache, discoveryRefresh };
}

async function main() {
  if (command === "auth") {
    if (args[1] !== "login") fail("use: auth login");
    const state = randomUUID();
    let completed = false;
    const server = createServer((request, response) => {
      if (request.method === "OPTIONS" && request.url === `/callback/${state}`) { response.writeHead(204, { "access-control-allow-origin": "https://tokensize.dev", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" }).end(); return; }
      if (request.method !== "POST" || request.url !== `/callback/${state}`) { response.writeHead(404).end(); return; }
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          if (payload.state !== state || typeof payload.apiKey !== "string" || payload.apiKey.length < 20 || /\s/.test(payload.apiKey)) throw new Error("invalid callback");
          await saveApiKey(payload.apiKey);
          completed = true;
          response.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "https://tokensize.dev" }).end("TokenSize connected. You can close this window.\n");
          setTimeout(() => server.close(), 100);
        } catch { response.writeHead(400, { "access-control-allow-origin": "https://tokensize.dev" }).end("Invalid TokenSize callback.\n"); }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") fail("could not start local callback");
    const callback = `http://127.0.0.1:${address.port}/callback/${state}`;
    const url = `https://tokensize.dev/authorize?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}`;
    process.stdout.write(`Opening TokenSize authorization…\n${url}\n`);
    execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", url] : [url]);
    const timeout = setTimeout(() => server.close(), 10 * 60 * 1_000);
    await new Promise((resolve) => server.on("close", resolve));
    clearTimeout(timeout);
    if (!completed) fail("browser authorization timed out or was cancelled");
    process.stdout.write(`Saved credentials to ${credentialsFile()}\n`);
    return;
  }
  if (command === "doctor") {
    const [catalog, discovered] = await Promise.all([
      savedApiKey().then((key) => key ? api("/v1/agent-catalog") : null),
      discover(),
    ]);
    emit({ service: { url: API_URL, authenticated: Boolean(await savedApiKey()), catalog }, privacy: "credentials and prompts remain local unless prompt sharing is explicit", cache: discovered.cache, harnesses: publicDiscovery(discovered.harnesses) });
    return;
  }
  if (command === "feedback") {
    const rating = Number(flag("--rating"));
    const modelChoice = flag("--model-choice");
    const wouldUseAgain = flag("--would-use-again");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail("--rating must be an integer from 1 to 5");
    if (!["right", "acceptable", "wrong"].includes(modelChoice)) fail("--model-choice must be right, acceptable, or wrong");
    if (!["yes", "no"].includes(wouldUseAgain)) fail("--would-use-again must be yes or no");
    const receipt = await lastRoute();
    const reasonTags = (flag("--tags") || "").split(",").map((value) => value.trim()).filter(Boolean);
    const response = await api("/v1/agent-feedback", {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: 1,
        routeId: receipt.routeId,
        feedbackToken: receipt.feedbackToken,
        idempotencyKey: randomUUID(),
        status: modelChoice === "wrong" ? "failed" : "verified",
        confirmedTargetId: receipt.targetId,
        identityConfirmed: true,
        checksPassed: modelChoice === "right" ? 1 : 0,
        checksFailed: modelChoice === "wrong" ? 1 : 0,
        retries: 0,
        usage: { contextTokensEstimated: 0, source: "unknown" },
        timings: { totalMs: 0, routingMs: 0, executionMs: 0, verificationMs: 0 },
      }),
    });
    emit({ ...response, routeId: receipt.routeId, privacy: "feedback excludes prompts, repository contents, model output, and credentials" });
    return;
  }
  if (command === "route" || command === "delegate") {
    const task = flag("--task");
    if (!task) fail("--task is required");
    const prepared = await prepare(task);
    const route = await api("/v1/agent-routes", { method: "POST", body: JSON.stringify(prepared.body) });
    await saveLastRoute(route);
    if (command === "route" || !has("--execute")) {
      emit({ dryRun: true, route: publicRoute(route), cache: prepared.cache, harnesses: publicDiscovery(prepared.discovery) });
      return;
    }
    const execution = await execute(task, route, prepared.discovery, prepared.cache);
    emit({ dryRun: false, route: publicRoute(route), execution });
    if (execution.code !== 0) process.exitCode = 1;
    return;
  }
  process.stdout.write(`TokenSize Delegate\n\n  doctor [--refresh] [--verbose] [--json]\n  route --task TEXT [--role inspect|plan|implement|review|test] [--permission inspect|edit|test] [--refresh] [--verbose]\n  delegate --task TEXT [same options] [--execute]\n  feedback --rating 1..5 --model-choice right|acceptable|wrong --would-use-again yes|no [--tags TAGS] [--comment TEXT]\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
