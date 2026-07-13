---
name: delegate
description: Discover locally installed coding-agent CLIs and route bounded software tasks through the hosted TokenSize service while keeping credentials, repository context, prompts, and execution local by default. Use when delegating inspection, planning, implementation, review, or test work to Codex, Claude Code, Cursor Agent, GitHub Copilot CLI, or another configured local harness; comparing available agents; or reducing the primary agent's context usage.
---

# Delegate with TokenSize

Use the bundled client to discover local coding harnesses, obtain an advisory route from TokenSize, and execute only within the user's permission boundary.

## Prepare

1. Require Node.js 20 or newer.
2. Require `TOKENSIZE_API_KEY`. Never print it, place it in arguments, or write it to the repository.
3. Default to `https://api.tokensize.dev`. Set `TOKENSIZE_API_URL` only for a user-authorized alternative deployment.
4. Run:

```sh
node scripts/tokensize.mjs doctor --json
```

Treat discovery as capability metadata, not proof that a paid model invocation will succeed.

## Route safely

Turn the request into one bounded task with explicit scope, acceptance criteria, and forbidden actions. Keep the permission at `inspect` unless the user requested mutation.

```sh
node scripts/tokensize.mjs route \
  --task "Inspect the authentication boundary and report risks" \
  --role inspect --permission inspect --json
```

TokenSize receives task features and candidate metadata by default. It does not receive the task text. Use `--share-prompt` only after the user approves sending that prompt to TokenSize.

Subscription-backed harnesses remain ineligible until the user confirms their product terms and opts in locally:

```sh
export TOKENSIZE_ALLOW_SUBSCRIPTION_HARNESSES=codex,claude,cursor
```

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

Never bypass an unavailable adapter. Network delegation is unsupported. Cursor execution is inspect-only. Edit and test routes require the client-created isolated Git worktree.

## Verify

Verify delegated results with deterministic checks appropriate to the task. Inspect diffs for scope creep and secrets. The primary agent remains responsible for the final result.

Report the selected harness/model, routing reason and confidence, granted permission, execution status, and verification result. Do not claim estimated token savings as measured savings.

Read [safety.md](references/safety.md) before any execution and [public-api.md](references/public-api.md) when troubleshooting hosted-service connectivity.
