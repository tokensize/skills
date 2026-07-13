# Safety boundary

- Treat the hosted route as advisory. Enforce permissions, target availability, recursion limits, timeouts, and product-use approval locally.
- Keep harness credentials in their native credential stores. Never inspect credential files or transmit credential values.
- Use metadata-only routing by default. Do not include prompts, source files, repository names, command output, environment values, or personal data in candidate metadata.
- Require explicit local approval before automating a subscription-backed harness.
- Launch processes with argument arrays and prompt input over stdin. Never interpolate task text into a shell command.
- Keep inspection read-only. Run edit/test work in an isolated worktree. Do not commit, push, deploy, publish, or message third parties without separate user authorization.
- Reject network permission and expired or unavailable targets. Keep delegation depth bounded.
- Do not expose route feedback tokens in reports or logs.
