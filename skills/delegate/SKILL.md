---
name: delegate
description: Discover locally installed coding-agent CLIs and route bounded software tasks through the hosted TokenSize service while keeping credentials, repository context, prompts, and execution local by default. Use when delegating inspection, planning, implementation, review, or test work to Codex, Claude Code, Cursor Agent, OpenCode, GitHub Copilot CLI, or another configured local harness; comparing available agents; or reducing the primary agent's context usage.
---

# Delegate with TokenSize

Use the bundled client to discover local coding harnesses, obtain an advisory route from TokenSize, and execute only within the user's permission boundary.

## Prepare

1. Require Node.js 20 or newer.
2. The easiest setup is `node scripts/tokensize.mjs auth login`. It opens TokenSize, asks the signed-in user to approve this terminal, and stores credentials in `~/.tokensize/credentials.json` with owner-only permissions. For headless systems, create a key at `https://tokensize.dev/account` and export `TOKENSIZE_API_KEY` without printing it or putting it in command arguments.
3. Default to `https://api.tokensize.dev`. Set `TOKENSIZE_API_URL` only for a user-authorized alternative deployment.
4. Run:

```sh
node scripts/tokensize.mjs doctor --json
```

Discovery is cached for six hours in `~/.tokensize/discovery.json`. Set `TOKENSIZE_DISCOVERY_CACHE_TTL_MS` to change the TTL, or add `--refresh` to force discovery. Normal output is summarized to conserve context; use `--verbose` only when full model metadata is needed. The cache contains harness/model capability metadata only—never credentials or prompts. Missing executables, stale selected targets, and model/authentication availability failures trigger a refresh. Treat discovery as capability metadata, not proof that a paid model invocation will succeed.

The client also asks supported harnesses for their current allowance without invoking a model. Inspect it with:

```sh
node scripts/tokensize.mjs allowance --refresh --json
```

Normalized remaining fractions are cached for five minutes in `~/.tokensize/allowance.json` with owner-only permissions. Raw account screens and identity data are discarded and never sent to TokenSize. Codex is read through its local app-server; Claude Code is read through its own `/usage` screen on macOS; credential-free OpenCode models are marked unmetered. Harnesses that do not safely expose remaining allowance stay `unknown`, which is never treated as exhausted. A rate-limit execution failure refreshes this cache.

The allowance report labels the harness-wide default separately from model-specific scopes and includes both a normalized fraction and readable percentage. For example, Claude's general limit and a Fable-family limit remain distinguishable, while OpenCode can have an unknown harness default and explicitly unmetered credential-free model scopes. Large identical scopes show a representative model-ID sample plus an omitted count to conserve context; use `doctor --verbose` for the full catalog. Client commands emit JSON by default to keep agent parsing deterministic; `--json` is accepted for compatibility and emphasis.

## Route safely

Turn the request into one bounded task with explicit scope, acceptance criteria, and forbidden actions. Keep the permission at `inspect` unless the user requested mutation.

```sh
node scripts/tokensize.mjs route \
  --task "Inspect the authentication boundary and report risks" \
  --role inspect --permission inspect --json
```

TokenSize receives task features and candidate metadata by default. It does not receive the task text. Use `--share-prompt` only after the user approves sending that prompt to TokenSize.

Allowance cannot make a weaker model eligible. The router first enforces permissions and product approval, excludes exhausted targets, and keeps only quality-equivalent top candidates. It then prefers unmetered, known-available, unknown, and known-low allowances in that order; the requested cost/latency objective breaks ties. A constrained root may delegate a small task only to a quality-equivalent or better target.

Subscription-backed harnesses remain ineligible until the user confirms their product terms and opts in locally:

```sh
export TOKENSIZE_ALLOW_SUBSCRIPTION_HARNESSES=codex,claude,cursor,opencode
```

Credential-free OpenCode models under `opencode/*-free`, plus `opencode/big-pickle`, are discovered and approved without that subscription opt-in. Paid/provider models remain fail-closed.

## Delegate

Preview first:

```sh
node scripts/tokensize.mjs delegate \
  --task "Review this repository for authentication flaws" \
  --role review --permission inspect --json
```

The command remains a dry run unless `--execute` is present. Execute only after reviewing the selected target and permission:

```sh
node scripts/tokensize.mjs delegate \
  --task "Review this repository for authentication flaws" \
  --role review --permission inspect --execute --json
```

Never bypass an unavailable adapter. Network delegation is unsupported. Cursor and OpenCode execution are inspect-only. OpenCode uses its plan agent and never receives `--auto`. Edit and test routes require the client-created isolated Git worktree.

## Verify

Verify delegated results with deterministic checks appropriate to the task. Inspect diffs for scope creep and secrets. The primary agent remains responsible for the final result.

Report the selected harness/model, routing reason and confidence, granted permission, execution status, and verification result. Do not claim estimated token savings as measured savings.

## Send pilot feedback

After the user evaluates the selected route choice, send optional feedback from the locally stored last-route receipt. A dry route stores an evaluated-route receipt even though it does not execute a model, allowing feedback about routing quality itself:

```sh
node scripts/tokensize.mjs feedback \
  --rating 5 --model-choice right --would-use-again yes \
  --tags correct-model,fast
```

Never put code, prompts, model output, secrets, personal information, or repository details in `--comment`. The receipt is stored at `~/.tokensize/last-route.json` with private permissions and contains only the route identifier, short-lived feedback token, expiry, and selected target.

Read [safety.md](references/safety.md) before any execution and [public-api.md](references/public-api.md) when troubleshooting hosted-service connectivity.
