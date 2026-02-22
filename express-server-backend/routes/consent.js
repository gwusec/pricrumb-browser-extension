import express from "express";
import mongodbConn from "../db/connection.js";

const router = express.Router();

router.post("/", async (request, res) => {
  try {
    const data = request.body || {};
    const records = Array.isArray(data.records)
      ? data.records
      : (Array.isArray(data.consentDomainData) ? data.consentDomainData : []);
    const consentDomainData = Array.isArray(data.consentDomainData) ? data.consentDomainData : records;
    const browsingHistoryData = Array.isArray(data.browsingHistoryData) ? data.browsingHistoryData : [];
    if (records.length === 0 && browsingHistoryData.length === 0) {
      return res.status(400).json({ error: "records or browsingHistoryData must be a non-empty array" });
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
