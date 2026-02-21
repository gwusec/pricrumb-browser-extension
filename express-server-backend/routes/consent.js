import express from "express";
import mongodbConn from "../db/connection.js";

const router = express.Router();

router.post("/", async (request, res) => {
  try {
    const data = request.body || {};
    const records = Array.isArray(data.records) ? data.records : [];
    if (records.length === 0) {
      return res.status(400).json({ error: "records must be a non-empty array" });
    }

    const db = await mongodbConn.getDBSurvey();
    const collection = db.collection("consent-domain-data");

    const document = {
      PID: data.prolificID || data.participantId || null,
      timestamp: data.timestamp || Date.now(),
      records,
      receivedAt: new Date().toISOString(),
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
