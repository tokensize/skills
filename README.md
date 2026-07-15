# TokenSize Skills

Public Agent Skills for routing work through [TokenSize](https://tokensize.dev) to coding-agent harnesses already installed on your machine.

## Getting started

Install the TokenSize skill:

```sh
npx skills add tokensize/skills
```

Then invoke it directly in Codex or another compatible agent:

```text
$delegate inspect this repository for authentication risks
```

The [`delegate`](skills/delegate/SKILL.md) skill discovers local Codex, Claude Code, Cursor Agent, OpenCode, and GitHub Copilot CLI installations; requests a privacy-safe route from `api.tokensize.dev`; and optionally executes the approved route locally. OpenCode execution is inspect-only and uses its plan agent without broad `--auto` approval.

OpenCode's built-in `opencode/*-free` models and `opencode/big-pickle` work without stored provider credentials and are eligible automatically. Paid or provider-backed OpenCode models still require local authentication and explicit `TOKENSIZE_ALLOW_SUBSCRIPTION_HARNESSES=opencode` approval.

The easiest setup is the browser callback flow:

```sh
node scripts/tokensize.mjs auth login
```

This opens TokenSize, asks the signed-in user to approve the terminal, and stores the one-time returned credential in `~/.tokensize/credentials.json` with owner-only permissions. Headless users can instead create a key at `https://tokensize.dev/account` and export `TOKENSIZE_API_KEY`.

Discovery is cached locally for six hours at `~/.tokensize/discovery.json`. Use `--refresh` to rescan immediately; missing or unavailable cached targets cause an automatic refresh. Normal output is summarized to conserve agent context, with `--verbose` available for the complete model catalog. The cache never stores credentials or prompts.

Allowance data is refreshed separately every five minutes and stored owner-only at `~/.tokensize/allowance.json`. Run `node scripts/tokensize.mjs allowance --refresh --json` to inspect labeled harness defaults and model-specific scopes with readable percentages. TokenSize uses allowance only among quality-equivalent candidates, so a larger balance never causes a weaker model to be selected. Codex and macOS Claude Code currently expose live remaining allowance; unsupported interfaces remain `unknown`, and credential-free OpenCode models are treated as unmetered. Raw account output and identity never leave the machine. Client commands emit JSON by default; `--json` remains accepted for compatibility.

`$delegate feedback` submits optional route feedback. Feedback excludes prompts, repository contents, model output, credentials, and identity.

The skill requires Node.js 20+. Browser login stores the API key in `~/.tokensize/credentials.json` with owner-only permissions; headless usage reads `TOKENSIZE_API_KEY` from the process environment. It never stores the key in this repository.

## Public-code boundary

This repository contains only client integration, local safety enforcement, and public API usage. TokenSize routing algorithms, training and evaluation systems, infrastructure configuration, credentials, internal telemetry, private benchmarks, and operational runbooks are not included.

See [SECURITY.md](SECURITY.md) for responsible disclosure.
