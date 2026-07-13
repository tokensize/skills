# TokenSize Skills

Public Agent Skills for routing work through [TokenSize](https://tokensize.dev) to coding-agent harnesses already installed on your machine.

## Available skill

- [`tokensize-delegate`](skills/tokensize-delegate/SKILL.md) discovers local Codex, Claude Code, Cursor Agent, and GitHub Copilot CLI installations; requests a privacy-safe route from `api.tokensize.dev`; and optionally executes the approved route locally.

## Install

Install from this repository with a compatible Agent Skills installer, or copy `skills/tokensize-delegate` into your agent's skills directory.

The skill requires Node.js 20+ and a TokenSize API key supplied through `TOKENSIZE_API_KEY`. It never stores the API key.

## Public-code boundary

This repository contains only client integration, local safety enforcement, and public API usage. TokenSize routing algorithms, training and evaluation systems, infrastructure configuration, credentials, internal telemetry, private benchmarks, and operational runbooks are not included.

See [SECURITY.md](SECURITY.md) for responsible disclosure.
