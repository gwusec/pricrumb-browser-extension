# Domain Hash Service (HMAC-SHA-256)

This service hashes canonicalized domains using an HMAC key that stays on the server.
The extension sends domains to this service and receives only hashes.

## Endpoints

- `POST /v1/hash-domains`
  - Request:
    - `{"domains":["example.com","stackoverflow.com"]}`
  - Response:
    - `{"hashAlgorithm":"HMAC-SHA-256","hashLength":64,"count":2,"hashes":[{"domain":"example.com","domainHash":"..."}]}`
- `GET /healthz`

## Local Setup

1. Generate a key file:
   - From repo root:
     - `python generate_domain_hmac_key.py`
   - This writes: `ops/domain-hash-service/secrets/domain_hmac.key`
2. Start the service stack:
   - `cd ops/domain-hash-service`
   - `docker compose up -d`
3. Verify:
   - `curl http://localhost:8082/healthz`
   - `curl -X POST http://localhost:8082/v1/hash-domains -H "Content-Type: application/json" -d "{\"domains\":[\"example.com\"]}"`

## Security Notes

- The key file is not bundled in the extension.
- The key file is mounted into `domain-hash-api` only, not nginx.
- nginx binds to `127.0.0.1:8082` in `docker-compose.yml` for local-only access.
- In production, put nginx behind TLS and restrict allowed callers.
