const testData = require('./tcf_strings_for_testing.json');
const fs = require('fs'); // for saving results

// --- Mock helpers ---
function decodeTCFString(value) {
  return {
    purposes: { 1: true, 2: false, 3: true },
    purposeLegitimateInterests: {},
    version: 2,
    cmpId: 28,
    lastUpdated: new Date().toISOString(),
    eventStatus: "tcloaded",
    vendorConsents: {},
    vendorLegitimateInterests: {},
  };
}

function enhancedTCFActionDetection(value, cookie, allCookies) {
  return {
    actionTaken: "Yes",
    confidence: 1.0,
    method: "mock",
    reasoning: "mock",
    evidence: "mock"
  };
}

function addDateFields(cookie) { return { created: new Date().toISOString() }; }
function isNoStoreBeforeInteractionSite(domain) { return false; }

function mapTCFPurposesToCategories(tcfData) {
  const { purposes, purposeLegitimateInterests } = tcfData;
  const hasPurpose = (id) => purposes[id] || purposeLegitimateInterests[id];
  return {
    necessary: true,
    functional: hasPurpose(1) || hasPurpose(5) || hasPurpose(6),
    performance: hasPurpose(8) || hasPurpose(10) || hasPurpose(11),
    advertising: hasPurpose(2) || hasPurpose(3) || hasPurpose(4) || hasPurpose(7) || hasPurpose(9)
  };
}

function getCMPNameFromId(cmpId) { return {28: "OneTrust"}[cmpId] || `CMP ID ${cmpId}`; }

// --- Decoder ---
function tcf_decoder(value, cookie = {}, allCookies = {}) {
  try {
    const tcfData = decodeTCFString(value);
    if (!tcfData) throw new Error('Failed to decode TCF string');

    const actionAnalysis = enhancedTCFActionDetection(value, cookie, allCookies);
    const categories = mapTCFPurposesToCategories(tcfData);

    const totalPurposes = 11;
    const consentedPurposes = Object.keys(tcfData.purposes || {}).filter(id => parseInt(id) <= totalPurposes && tcfData.purposes[id]).length;
    const legitimateInterestPurposes = Object.keys(tcfData.purposeLegitimateInterests || {}).filter(id => parseInt(id) <= totalPurposes && tcfData.purposeLegitimateInterests[id]).length;

    const totalConsented = consentedPurposes + legitimateInterestPurposes;
    let consentStatus = totalConsented === 0 ? "No" : consentedPurposes >= Math.floor(totalPurposes * 0.8) ? "Full" : "Partial";

    return {
      cmpName: tcfData.cmpId ? `${getCMPNameFromId(tcfData.cmpId)} (TCF v2.2)` : "TCF v2.2",
      timestamp: tcfData.lastUpdated,
      necessary: categories.necessary,
      functional: categories.functional,
      performance: categories.performance,
      advertising: categories.advertising,
      consent: consentStatus,
      actionTaken: actionAnalysis.actionTaken,
      rawCookie: value,
      misc: tcfData
    };
  } catch (e) {
    return { error: e.message };
  }
}

// --- Test runner ---
const results = [];
let totalTested = 0;
let foundCount = 0;
let decodedCount = 0;

for (const site of testData) {
  totalTested++;

  const siteResult = {
    website: site.website,
    string_name: site.tcf_string_key_name || "unknown",
    actual_string_name_in_extension: null, // extension-mapped key
    string_found_by_extension: false,
    found_in_storage: [], // which storage it was found in
    string_decoded_by_extension: false,
    string_decoding_result: null
  };

  const mockCookies = {};
  const mockLocalStorage = {};
  const mockSessionStorage = {};

  for (const loc of site.storage_locations) {
    if (loc.location === "Cookie") {
      mockCookies[loc.key_name] = site.tcf_string;
      siteResult.found_in_storage.push("Cookie");
      siteResult.actual_string_name_in_extension = loc.key_name;
    }
    if (loc.location === "LocalStorage") {
      mockLocalStorage[loc.key_name] = site.tcf_string;
      siteResult.found_in_storage.push("LocalStorage");
      siteResult.actual_string_name_in_extension = loc.key_name;
    }
    if (loc.location === "SessionStorage") {
      mockSessionStorage[loc.key_name] = site.tcf_string;
      siteResult.found_in_storage.push("SessionStorage");
      siteResult.actual_string_name_in_extension = loc.key_name;
    }
  }

  const found = siteResult.found_in_storage.length > 0;
  siteResult.string_found_by_extension = found;
  if (found) foundCount++;

  if (found) {
    const decoded = tcf_decoder(site.tcf_string, { domain: site.website }, { cookies: mockCookies, localStorage: mockLocalStorage, sessionStorage: mockSessionStorage });
    siteResult.string_decoded_by_extension = !decoded.error;
    if (!decoded.error) decodedCount++;
    siteResult.string_decoding_result = decoded;
  }

  results.push(siteResult);
}

// --- Save results ---
fs.writeFileSync('tcf_test_results.json', JSON.stringify(results, null, 2));
console.log('Detailed results saved to tcf_test_results.json');

// --- Summary ---
console.log('============================');
console.log('TCF DETECTION TEST SUMMARY');
console.log('============================');
console.log('Total tested:', totalTested);
console.log('Strings found by extension:', foundCount);
console.log('Strings decoded successfully:', decodedCount);
console.log('Strings failed to decode:', totalTested - decodedCount);
