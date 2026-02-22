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
8. The same HMAC key should be reused for all participants in the same study.
   - Reason: HMAC is deterministic for the same input + same key, so the same domain will produce the same hash across participants.
   - This enables cross-participant comparisons without storing raw domains.

## Services and Ports

- Survey backend: `http://localhost:8080`
- Domain hash service: `http://localhost:8082`

## HMAC Key File (Exact Name and Location)

- File name: `domain_hmac.key`
- Exact location (inside the extension project): `ops/domain-hash-service/secrets/domain_hmac.key`

How to use it:
- If the team already has a shared study key, place that file at `ops/domain-hash-service/secrets/domain_hmac.key` before starting the hash service.
- If no key exists yet, run `python generate_domain_hmac_key.py` once from the extension project root. The script writes the key to that exact path.

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
2. Make sure the shared HMAC key file exists at:
   - `ops/domain-hash-service/secrets/domain_hmac.key`
3. If this is the first run (or the key file is missing), run:

```powershell
python generate_domain_hmac_key.py
```

4. Then run:

```powershell
cd ops/domain-hash-service
docker compose up -d
```

What this does:
- `python generate_domain_hmac_key.py`: creates/rotates the HMAC key file used by hash service.
  - Output file: `ops/domain-hash-service/secrets/domain_hmac.key`
  - Run this only once per study (or when intentionally rotating the key).
  - Reusing the same key keeps hashes comparable across participants and sessions.
- `docker compose up -d`: starts hash API + nginx.

### Why the key is usually generated only once

- If two participants both have the same domain (for example `google.com`), you want the hashed value to be the same so records can be compared.
- That only happens if the same hashing key is reused.
- If you generate a new key every run, the same domain will hash to a different value, breaking comparability across participants/runs.
- Recommended practice: use one key per study/cohort, rotate only when you intentionally want a new hash namespace.

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
