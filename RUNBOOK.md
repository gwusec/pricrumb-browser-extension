# RUNBOOK

## Purpose
This runbook describes the hashing architecture and the commands needed to run the survey + hash service stack.

## Hashing Architecture

1. The extension can use raw domains at runtime (UI, matching, Tranco lookups).
2. Only hashed domains are allowed in persisted payloads.
3. The HMAC key is server-side only and is never bundled in the extension.
4. The extension requests hashes from a dedicated hash API.
5. Hashing uses `HMAC-SHA-256` with full 64-hex output.
6. Submission is fail-closed: if hashing fails, upload is blocked.
7. Defense in depth is applied:
   - extension sanitizes submit payload
   - survey frontend sanitizes extension data before saving survey fields
   - survey backend sanitizes before database writes

## Services and Ports

- Survey backend: `http://localhost:8080`
- Domain hash service: `http://localhost:8082`

## Startup Commands (Every Time)

Use two terminals.

### Terminal A: Survey app
1. Go to the directory where the survey project is.
2. Run:

```powershell
cp base.env .env
npm i
docker compose up -d
npm run dev
```

What this does:
- `cp base.env .env`: creates local environment variables file.
- `npm i`: installs dependencies.
- `docker compose up -d`: starts required containers (database/services).
- `npm run dev`: starts frontend and backend.

### Terminal B: Extension hash service
1. Go to the directory where the extension project is.
2. Run:

```powershell
python generate_domain_hmac_key.py
cd ops/domain-hash-service
docker compose up -d
```

What this does:
- `python generate_domain_hmac_key.py`: creates/rotates the HMAC key file used by hash service.
- `docker compose up -d`: starts hash API + nginx.

## Health Checks

Run from any terminal:

```powershell
Invoke-RestMethod http://localhost:8080/postsurvey
Invoke-RestMethod -Method Post -Uri http://localhost:8080/postsurvey/start -ContentType "application/json" -Body '{"prolificID":"debug_pid"}'
Invoke-RestMethod http://localhost:8082/healthz
Invoke-RestMethod -Method Post -Uri http://localhost:8082/v1/hash-domains -ContentType "application/json" -Body '{"domains":["example.com"]}'
```

Expected:
- Survey endpoints return JSON responses.
- Hash health returns `{ "ok": true }`.
- Hash API returns `domainHash` values for provided domains.

## Quick Troubleshooting

- If `localhost:8080` is unreachable, survey backend is not running.
- If `localhost:8082/healthz` fails, check hash service logs:
  - `docker compose logs --tail=100` in `ops/domain-hash-service`.
- If survey start fails, check backend logs in Terminal A (`npm run dev` output).
