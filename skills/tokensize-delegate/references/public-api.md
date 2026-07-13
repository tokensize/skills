# Public service integration

The bundled client uses `https://api.tokensize.dev` unless `TOKENSIZE_API_URL` is set.

## Authentication

Set `TOKENSIZE_API_KEY` in the process environment. Requests use bearer authentication over HTTPS. Never pass the key as a command-line argument.

## Stable operations

- `GET /v1/agent-catalog` checks protocol compatibility and advertised harness support.
- `POST /v1/agent-routes` submits task features, locally discovered candidates, and local policy. Metadata-only mode omits the prompt.
- `POST /v1/agent-feedback` submits the outcome of an executed route using the opaque per-route feedback token.

The client generates a random installation identifier under `~/.tokensize/config.json`. The service receives the identifier for continuity; it does not receive local credential material.

## Troubleshooting

- `401`: the API key is absent, invalid, or revoked.
- `403`: the key lacks the required agent-routing scope.
- `400`: client and service schemas are incompatible or the request violates metadata-only rules.
- `NO_ELIGIBLE_LOCAL_TARGET`: authenticate a supported harness, advertise at least one model, and explicitly approve subscription automation where applicable.

Set `TOKENSIZE_ROOT_HARNESS` when the primary agent is not Codex. Optionally set `TOKENSIZE_ROOT_QUALITY_PRIOR` from `0` to `1` when local evidence supports a different root baseline.

Do not retry authorization or validation failures in a loop. Update credentials or client configuration first.
