// tcf_decoder.js

function tcf_decoder(value, cookie = {}, allCookies = {}) {
  try {
    // Paste your decodeTCF function body here
    const tcfData = decodeTCFString(value); // make sure decodeTCFString is available
    const enhancedActionAnalysis = enhancedTCFActionDetection(value, cookie, allCookies);
    const categories = mapTCFPurposesToCategories(tcfData);

    const totalPurposes = 11;
    const consentedPurposes = Object.keys(tcfData.purposes || {})
      .filter(id => parseInt(id) <= 11 && tcfData.purposes[id])
      .length;
    const legitimateInterestPurposes = Object.keys(tcfData.purposeLegitimateInterests || {})
      .filter(id => parseInt(id) <= 11 && tcfData.purposeLegitimateInterests[id])
      .length;
    
    const totalConsented = consentedPurposes + legitimateInterestPurposes;
    
    let consentStatus = "No";
    if (totalConsented === 0) consentStatus = "No";
    else if (consentedPurposes >= Math.floor(totalPurposes * 0.8)) consentStatus = "Full";
    else consentStatus = "Partial";

    return {
      cmpName: tcfData.cmpId ? `${getCMPNameFromId(tcfData.cmpId)} (TCF v2.2)` : "TCF v2.2",
      timestamp: tcfData.lastUpdated ? new Date(tcfData.lastUpdated).toLocaleString() : "Unknown",
      necessary: categories.necessary,
      functional: categories.functional,
      performance: categories.performance,
      advertising: categories.advertising,
      consent: consentStatus,
      actionTaken: isNoStoreBeforeInteractionSite(cookie.domain) ? "Yes" : enhancedActionAnalysis.actionTaken,
      rawCookie: value,
      misc: {
        tcfVersion: tcfData.version,
        cmpId: tcfData.cmpId,
        eventStatus: tcfData.eventStatus,
        confidence: enhancedActionAnalysis.confidence,
        purposeConsents: Object.fromEntries(
          Object.entries(tcfData.purposes || {}).filter(([id]) => parseInt(id) <= 11)
        ),
        purposeLegitimateInterests: Object.fromEntries(
          Object.entries(tcfData.purposeLegitimateInterests || {}).filter(([id]) => parseInt(id) <= 11)
        ),
        vendorConsentCount: Object.keys(tcfData.vendorConsents || {}).length,
        vendorLICount: Object.keys(tcfData.vendorLegitimateInterests || {}).length,
        actionMethod: enhancedActionAnalysis.method,
        actionReasoning: enhancedActionAnalysis.reasoning,
        enhancedEvidence: enhancedActionAnalysis.evidence,
        noStoreBeforeInteraction: isNoStoreBeforeInteractionSite(cookie.domain),
      }
    };
    
  } catch (error) {
    return {
      cmpName: "TCF v2.2",
      necessary: true,
      functional: "Unknown",
      performance: "Unknown",
      advertising: "Unknown",
      consent: "Unknown",
      actionTaken: "Unknown",
      rawCookie: value,
      misc: { error: error.message }
    };
  }
}

// Export for Node.js
module.exports = { tcf_decoder };
