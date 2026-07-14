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

The [`delegate`](skills/delegate/SKILL.md) skill discovers local Codex, Claude Code, Cursor Agent, and GitHub Copilot CLI installations; requests a privacy-safe route from `api.tokensize.dev`; and optionally executes the approved route locally.

The easiest setup is the browser callback flow:

```sh
node scripts/tokensize.mjs auth login
```

This opens TokenSize, asks the signed-in user to approve the terminal, and stores the one-time returned credential in `~/.tokensize/credentials.json` with owner-only permissions. Headless users can instead create a key at `https://tokensize.dev/account` and export `TOKENSIZE_API_KEY`.

Discovery is cached locally for six hours at `~/.tokensize/discovery.json`. Use `--refresh` to rescan immediately; missing or unavailable cached targets cause an automatic refresh. Normal output is summarized to conserve agent context, with `--verbose` available for the complete model catalog. The cache never stores credentials or prompts.

`$delegate feedback` submits optional route feedback. Feedback excludes prompts, repository contents, model output, credentials, and identity.

The skill requires Node.js 20+ and a TokenSize API key supplied through `TOKENSIZE_API_KEY`. It never stores the API key.

## Public-code boundary

This repository contains only client integration, local safety enforcement, and public API usage. TokenSize routing algorithms, training and evaluation systems, infrastructure configuration, credentials, internal telemetry, private benchmarks, and operational runbooks are not included.

See [SECURITY.md](SECURITY.md) for responsible disclosure.
