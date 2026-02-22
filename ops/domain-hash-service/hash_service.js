"use strict";

const fs = require("fs");
const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DOMAIN_HMAC_KEY_FILE = process.env.DOMAIN_HMAC_KEY_FILE || "/run/secrets/domain_hmac.key";
const MAX_DOMAINS_PER_REQUEST = Number(process.env.MAX_DOMAINS_PER_REQUEST || 5000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);

function canonicalizeDomain(domain) {
  let d = String(domain || "").trim().toLowerCase();
  if (d.startsWith(".")) d = d.slice(1);
  if (d.endsWith(".")) d = d.slice(0, -1);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

function loadHmacKey() {
  const b64 = fs.readFileSync(DOMAIN_HMAC_KEY_FILE, "utf8").trim();
  const key = Buffer.from(b64, "base64");
  if (!key.length) {
    throw new Error("Loaded empty HMAC key.");
  }
  return key;
}

const hmacKey = loadHmacKey();

function hashDomain(canonicalDomain) {
  return crypto
    .createHmac("sha256", hmacKey)
    .update(canonicalDomain, "utf8")
    .digest("hex");
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        const data = text ? JSON.parse(text) : {};
        resolve(data);
      } catch (error) {
        reject(new Error(`Invalid JSON payload: ${error.message}`));
      }
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/hash-domains") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const domains = Array.isArray(payload?.domains) ? payload.domains : [];
    if (domains.length === 0) {
      sendJson(response, 400, { error: "domains must be a non-empty array." });
      return;
    }

    if (domains.length > MAX_DOMAINS_PER_REQUEST) {
      sendJson(response, 400, {
        error: `domains cannot exceed ${MAX_DOMAINS_PER_REQUEST} entries per request.`
      });
      return;
    }

    const canonicalDomains = Array.from(
      new Set(
        domains
          .map(canonicalizeDomain)
          .filter(Boolean)
      )
    );

    const hashes = canonicalDomains.map((domain) => ({
      domain,
      domainHash: hashDomain(domain)
    }));

    sendJson(response, 200, {
      hashAlgorithm: "HMAC-SHA-256",
      hashLength: 64,
      count: hashes.length,
      hashes
    });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Domain hash service listening on port ${PORT}`);
});
