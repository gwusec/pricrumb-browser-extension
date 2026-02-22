import express from "express";
import mongodbConn from "../db/connection.js";

const router = express.Router();
const DOMAIN_HASH_PATTERN = /^[0-9a-f]{64}$/i;

function normalizeDomainHash(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeDomainRecord(record) {
  if (!record || typeof record !== "object") return null;

  const domainHash = normalizeDomainHash(record.domainHash);
  if (!DOMAIN_HASH_PATTERN.test(domainHash)) return null;

  const sanitized = {
    ...record,
    domainHash,
  };
  delete sanitized.domain;
  delete sanitized.originalDomain;
  delete sanitized.canonicalDomain;
  delete sanitized.cookieDomain;
  delete sanitized.sourceDomain;
  delete sanitized.url;

  return sanitized;
}

function sanitizeDomainRecordList(records) {
  if (!Array.isArray(records)) return [];

  const deduped = new Map();
  records
    .map((record) => sanitizeDomainRecord(record))
    .filter(Boolean)
    .forEach((record) => {
      if (!deduped.has(record.domainHash)) {
        deduped.set(record.domainHash, record);
      }
    });

  return Array.from(deduped.values());
}

router.post("/", async (request, res) => {
  try {
    const data = request.body || {};
    const rawRecords = Array.isArray(data.records)
      ? data.records
      : (Array.isArray(data.consentDomainData) ? data.consentDomainData : []);
    const rawConsentDomainData = Array.isArray(data.consentDomainData) ? data.consentDomainData : rawRecords;
    const rawBrowsingHistoryData = Array.isArray(data.browsingHistoryData) ? data.browsingHistoryData : [];
    const records = sanitizeDomainRecordList(rawRecords);
    const consentDomainData = sanitizeDomainRecordList(rawConsentDomainData);
    const browsingHistoryData = sanitizeDomainRecordList(rawBrowsingHistoryData);
    if (records.length === 0 && browsingHistoryData.length === 0) {
      return res.status(400).json({ error: "records or browsingHistoryData must include valid hashed domains" });
    }

    const db = await mongodbConn.getDBSurvey();
    const collection = db.collection("consent-domain-data");
    const receivedAt = new Date().toISOString();

    const document = {
      PID: data.prolificID || data.participantId || null,
      timestamp: data.timestamp || Date.now(),
      consentDomainData,
      consentDomainDataUpdatedAt: receivedAt,
      browsingHistoryData,
      browsingHistoryDataUpdatedAt: receivedAt,
      records: consentDomainData,
      receivedAt,
      userAgent: request.headers["user-agent"] || null,
      source: "extension"
    };

    const result = await collection.insertOne(document);
    return res.status(201).json({ ok: true, id: result.insertedId });
  } catch (error) {
    console.error("Error saving consent data:", error);
    return res.status(500).json({ error: "Failed to save consent data" });
  }
});

export default router;
