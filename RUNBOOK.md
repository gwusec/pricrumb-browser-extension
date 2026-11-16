# RUNBOOK

## Purpose
This runbook describes the current architecture where the survey backend hosts the domain hash API used by the browser extension.

## Hashing Architecture

1. The extension can use raw domains at runtime (UI, matching, Tranco lookups).
2. Before data leaves the extension, domains are hashed via survey backend `POST /postsurvey/hash-domains`.
3. The HMAC key is server-side only and is never bundled in the extension.
4. Hashing uses `HMAC-SHA-256` with full 64-hex output.
5. The extension does not upload directly to DB routes; the survey page pulls extension data and persists via `PATCH /postsurvey`.

## Services and Ports

- Survey backend (includes hash endpoint): `http://localhost:8080`

## Startup Commands (Local)

### Survey app
```powershell
cp base.env .env
npm i
docker compose up -d
npm run dev
```

### Extension
Load the extension as unpacked and open the hosted survey page.
The survey page sends service configuration to the extension (`surveyApiBaseUrl` and `domainHashServiceEndpoint`), so hashing targets the deployed survey host.

## Health Checks

```powershell
Invoke-RestMethod http://localhost:8080/postsurvey
Invoke-RestMethod -Method Post -Uri http://localhost:8080/postsurvey/start -ContentType "application/json" -Body '{"prolificID":"debug_pid"}'
Invoke-RestMethod -Method Post -Uri http://localhost:8080/postsurvey/hash-domains -ContentType "application/json" -Body '{"domains":["example.com"]}'
```

Expected:
- Survey endpoints return JSON responses.
- Hash endpoint returns `domainHash` values for provided domains.

## Key Management

- Configure `DOMAIN_HASH_HMAC_KEY` (base64) or `DOMAIN_HASH_HMAC_KEY_FILE` in the survey app environment.
- Reuse the same key for all participants in the same cohort to keep hashes comparable.
