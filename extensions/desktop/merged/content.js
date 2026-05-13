// Content script

// if (window.location.hostname === "localhost") {
//     // dev logic
// } else if (window.location.hostname === "www.example.com") {
//     // prod logic
// } else {
//     // ignore other domains
//     return;
// }

if (window.location.hostname === "localhost" || window.location.hostname === "nets.gwusec.seas.gwu.edu") {
  console.log("[pricrumbs] content script successfully injected");

  // Notify that content script is ready
  window.postMessage(
    { type: "pricrumbs_extension_ready", payload: { extensionInstalled: true } },
    "*"
  );

  const DOMAIN_HASH_PATTERN = /^[0-9a-f]{64}$/i;
  const SCENARIO_FAMILIARITY_CANDIDATES_KEY = "scenarioFamiliarityCandidates";
  const SELECTED_SCENARIO_DOMAIN_HASHES_KEY = "selectedScenarioDomainHashes";
  const SCENARIO_GROUP_BY_CATEGORY_TYPE = {
    "accept-all": "all_cookies_accepted",
    "reject-all": "all_cookies_rejected",
    "mixed": "ad_cookies_rejected",
    "default": "default_cookies"
  };
  const SCENARIO_GROUP_NAMES = Object.values(SCENARIO_GROUP_BY_CATEGORY_TYPE);
  const SCENARIO_FLAG_NAME_BY_GROUP = {
    all_cookies_accepted: "hasAllAccepted",
    all_cookies_rejected: "hasAllRejected",
    ad_cookies_rejected: "hasAdvertisingRejected",
    default_cookies: "hasDefaultCookies"
  };
  const SCENARIO_FALLBACK_FAVICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iI2QxZDVkYiIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzExMTgyNyIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIj4/PC90ZXh0Pjwvc3ZnPg==";

function normalizeConsentValue(value) {
  if (value === true || value === "yes" || value === "Yes") return "yes";
  if (value === false || value === "no" || value === "No") return "no";
  return "unknown";
}

function normalizeActionTakenValue(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value === "number") {
    if (value === 1) return "yes";
    if (value === 0) return "no";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") return "yes";
    if (normalized === "no" || normalized === "false" || normalized === "0") return "no";
    if (normalized.startsWith("yes")) return "yes";
    if (normalized.startsWith("no")) return "no";
  }
  return "unknown";
}

  function normalizeDomainHash(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function isValidDomainHash(value) {
    return DOMAIN_HASH_PATTERN.test(normalizeDomainHash(value));
  }

  function sanitizeDomainRecord(record) {
    if (!record || typeof record !== "object") return null;

    const domainHash = normalizeDomainHash(record.domainHash);
    if (!isValidDomainHash(domainHash)) return null;

    const sanitized = {
      ...record,
      domainHash
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

  function normalizeHttpUrl(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      parsed.hash = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch (_error) {
      return "";
    }
  }

  function buildDomainConsentRecords(cookieData) {
    if (!Array.isArray(cookieData)) return [];

    const recordsByHash = new Map();

    cookieData.forEach((cookie) => {
      const domainHash = normalizeDomainHash(cookie?.domainHash);
      if (!isValidDomainHash(domainHash)) return;

    const numberOfVisits = Number(cookie?.totalVisitCount) || 0;
    const dates = Array.isArray(cookie?.visitedDates) ? cookie.visitedDates : [];
    const actionTaken = normalizeActionTakenValue(cookie?.actionTaken);

    if (!recordsByHash.has(domainHash)) {
      recordsByHash.set(domainHash, {
        domainHash,
        domainRankRange: cookie?.domainRankRange || null,
        numberOfVisits,
        dates: Array.from(new Set(dates)).sort(),
        actionTaken,
        consent: {
          necessary: normalizeConsentValue(cookie?.categories?.necessary),
          functional: normalizeConsentValue(cookie?.categories?.functional),
          performance: normalizeConsentValue(cookie?.categories?.performance),
          advertising: normalizeConsentValue(cookie?.categories?.advertising),
        }
      });
      return;
    }

    const existing = recordsByHash.get(domainHash);
    existing.numberOfVisits = Math.max(existing.numberOfVisits || 0, numberOfVisits);
    existing.dates = Array.from(new Set([...(existing.dates || []), ...dates])).sort();
    if (existing.actionTaken !== "yes" && actionTaken === "yes") {
      existing.actionTaken = "yes";
    } else if (existing.actionTaken === "unknown" && actionTaken !== "unknown") {
      existing.actionTaken = actionTaken;
    }
  });

    return Array.from(recordsByHash.values());
  }

  function normalizeDomainForPreferenceMatch(domain) {
    if (typeof domain !== "string") return "";
    let normalized = domain.trim().toLowerCase();
    if (!normalized) return "";
    normalized = normalized.replace(/^https?:\/\//, "");
    normalized = normalized.split("/")[0];
    normalized = normalized.replace(/^\.+/, "");
    normalized = normalized.replace(/\.+$/, "");
    if (normalized.startsWith("www.")) {
      normalized = normalized.slice(4);
    }
    return normalized;
  }

  function normalizePreferenceValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const numericValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function normalizePreferenceEntry(entry) {
    let domain = "";
    let preferences = null;

    if (Array.isArray(entry)) {
      domain = entry[0];
      preferences = entry[1];
    } else if (entry && typeof entry === "object") {
      domain = entry.domain;
      preferences = entry;
    } else {
      return null;
    }

    const normalizedDomain = normalizeDomainForPreferenceMatch(domain);
    if (!normalizedDomain) return null;

    return {
      domain: normalizedDomain,
      functional: normalizePreferenceValue(preferences?.functional),
      performance: normalizePreferenceValue(preferences?.performance),
      advertising: normalizePreferenceValue(preferences?.advertising)
    };
  }

  function buildNormalizedPreferenceMap(storedPreferences) {
    const byDomain = new Map();

    (Array.isArray(storedPreferences) ? storedPreferences : []).forEach((entry) => {
      const normalized = normalizePreferenceEntry(entry);
      if (!normalized) return;

      const existing = byDomain.get(normalized.domain) || {
        functional: null,
        performance: null,
        advertising: null
      };

      if (normalized.functional !== null) existing.functional = normalized.functional;
      if (normalized.performance !== null) existing.performance = normalized.performance;
      if (normalized.advertising !== null) existing.advertising = normalized.advertising;

      byDomain.set(normalized.domain, existing);
    });

    return byDomain;
  }

  function findPreferenceForDomain(domain, prefsMap) {
    const normalized = normalizeDomainForPreferenceMatch(domain);
    if (!normalized) return null;

    const variants = [
      normalized,
      `.${normalized}`,
      `www.${normalized}`,
      `.www.${normalized}`
    ];
    for (const variant of variants) {
      if (prefsMap.has(variant)) return prefsMap.get(variant);
    }

    return prefsMap.get(normalized) || null;
  }

  function createEmptyScenarioCandidateMap() {
    return Object.fromEntries(SCENARIO_GROUP_NAMES.map((groupName) => [groupName, []]));
  }

  function createEmptySelectedScenarioDomainHashes() {
    return Object.fromEntries(SCENARIO_GROUP_NAMES.map((groupName) => [groupName, null]));
  }

  function normalizeSelectedScenarioDomainHashes(value) {
    const normalized = createEmptySelectedScenarioDomainHashes();
    if (!value || typeof value !== "object") return normalized;

    SCENARIO_GROUP_NAMES.forEach((groupName) => {
      const domainHash = normalizeDomainHash(value[groupName]);
      normalized[groupName] = isValidDomainHash(domainHash) ? domainHash : null;
    });

    return normalized;
  }

  function normalizeScenarioCandidatesByCondition(value) {
    const normalized = createEmptyScenarioCandidateMap();
    if (!value || typeof value !== "object") return normalized;

    SCENARIO_GROUP_NAMES.forEach((groupName) => {
      const candidates = Array.isArray(value[groupName]) ? value[groupName] : [];
      normalized[groupName] = candidates.filter((candidate) => {
        const domainHash = normalizeDomainHash(candidate?.domainHash);
        const rawDomain = typeof candidate?.rawDomain === "string" ? candidate.rawDomain.trim() : "";
        return isValidDomainHash(domainHash) && rawDomain !== "";
      }).map((candidate) => ({
        domainHash: normalizeDomainHash(candidate.domainHash),
        rawDomain: candidate.rawDomain.trim(),
        displayDomain:
          typeof candidate?.displayDomain === "string" && candidate.displayDomain.trim() !== ""
            ? candidate.displayDomain.trim()
            : candidate.rawDomain.trim(),
        faviconDataUrl: typeof candidate?.faviconDataUrl === "string" ? candidate.faviconDataUrl.trim() : ""
      }));
    });

    return normalized;
  }

  function buildScenarioWebsiteFlags(selectedScenarioDomainHashes) {
    return {
      hasAllAccepted: Boolean(selectedScenarioDomainHashes.all_cookies_accepted),
      hasAllRejected: Boolean(selectedScenarioDomainHashes.all_cookies_rejected),
      hasAdvertisingRejected: Boolean(selectedScenarioDomainHashes.ad_cookies_rejected),
      hasDefaultCookies: Boolean(selectedScenarioDomainHashes.default_cookies)
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // Listens for messages from the webpage
  // NOTE: manifest.json must be updated if website url changes
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || !(event.data.type === "FROM_SURVEY" || event.data.type === "FROM_CONTENT")) return;

    // This is a check called by the survey to ask if the extension is installed
    if (event.data.payload?.action === "checkExtension") {
      window.postMessage(
        { type: "pricrumbs_extension_ready", payload: { extensionInstalled: true } },
        "*"
      );
      return;
    }

    if (event.data.payload?.action === "injectIframeAndReadLocalStorage") {
      injectIframeAndRead(event.data.payload.url);
      return;
    }

    if (event.data.payload?.action === "setParticipantId") {
      const participantId = typeof event.data.payload?.participantId === "string"
        ? event.data.payload.participantId.trim()
        : "";
      const pageOrigin = normalizeHttpUrl(window.location.origin);
      const surveyApiBaseUrl = normalizeHttpUrl(event.data.payload?.surveyApiBaseUrl);
      const domainHashServiceEndpoint = normalizeHttpUrl(event.data.payload?.domainHashServiceEndpoint);
      const updates = {};

      if (participantId) {
        updates.participantId = participantId;
      }
      if (surveyApiBaseUrl && surveyApiBaseUrl === pageOrigin) {
        updates.surveyApiBaseUrl = surveyApiBaseUrl;
      }
      if (
        domainHashServiceEndpoint &&
        pageOrigin &&
        domainHashServiceEndpoint.startsWith(`${pageOrigin}/`)
      ) {
        updates.domainHashServiceEndpoint = domainHashServiceEndpoint;
      }

      if (Object.keys(updates).length > 0) {
        ext.storage.local.set(updates).catch((error) => {
          console.warn("Content script: Failed to persist survey service config:", error);
        });
      }
      return;
    }

    if (event.data.payload?.action === "getConsentChoices") {
      (async () => {
        try {
          const category = event.data.payload?.category || null;
          const response = await ext.runtime.sendMessage({
            action: "getConsentChoices",
            category
          });

          window.postMessage({
            type: "FROM_EXTENSION_CONSENT_CHOICES",
            payload: {
              category,
              choices: Array.isArray(response?.choices) ? response.choices : []
            }
          }, "*");
        } catch (error) {
          console.error("Content script: Error reading consent choices:", error);
          window.postMessage({
            type: "FROM_EXTENSION_CONSENT_CHOICES",
            payload: {
              category: event.data.payload?.category || null,
              choices: [],
              error: String(error)
            }
          }, "*");
        }
      })();
      return;
    }

  if (event.data.payload?.action === "getConsentDomainData") {
    console.info("[pricrumbs][content script] Received getConsentDomainData request");
    (async () => {
      try {
        const result = await ext.storage.local.get([
          "consentDomainData",
          "cookieData",
          "browsingHistoryData",
          "hasDiscrepancies",
          "hasDiscrepanciesCheckedAt"
        ]);
        const cookieData = Array.isArray(result.cookieData) ? result.cookieData : [];
        const consentDomainDataFromStorage = Array.isArray(result.consentDomainData)
          ? result.consentDomainData
          : [];
        const consentDomainDataFromCookies = buildDomainConsentRecords(cookieData);
        let consentDomainData = consentDomainDataFromStorage.length > 0
          ? consentDomainDataFromStorage
          : consentDomainDataFromCookies;

        // Backfill actionTaken for older consentDomainData entries that were stored before
        // this field was included in the per-domain record schema.
        if (consentDomainData.length > 0 && consentDomainDataFromCookies.length > 0) {
          const actionTakenByHash = new Map();
          consentDomainDataFromCookies.forEach((record) => {
            const hash = normalizeDomainHash(record?.domainHash);
            if (!hash) return;
            actionTakenByHash.set(hash, normalizeActionTakenValue(record?.actionTaken));
          });

          let updatedActionTakenCount = 0;
          consentDomainData = consentDomainData.map((record) => {
            if (!record || typeof record !== "object") return record;
            const currentActionTaken = normalizeActionTakenValue(record.actionTaken);
            if (currentActionTaken !== "unknown") return record;

            const hash = normalizeDomainHash(record.domainHash);
            const fallbackActionTaken = actionTakenByHash.get(hash);
            if (!fallbackActionTaken || fallbackActionTaken === "unknown") return record;

            updatedActionTakenCount += 1;
            return {
              ...record,
              actionTaken: fallbackActionTaken
            };
          });

          if (updatedActionTakenCount > 0) {
            await ext.storage.local.set({
              consentDomainData: sanitizeDomainRecordList(consentDomainData)
            });
          }
        }
        let browsingHistoryData = Array.isArray(result.browsingHistoryData) ? result.browsingHistoryData : [];
        const hasDiscrepancies =
          typeof result.hasDiscrepancies === "boolean" ? result.hasDiscrepancies : null;
        const hasDiscrepanciesCheckedAt =
          typeof result.hasDiscrepanciesCheckedAt === "string"
            ? result.hasDiscrepanciesCheckedAt
            : null;

          if (browsingHistoryData.length === 0) {
            try {
              const historyResponse = await ext.runtime.sendMessage({ action: "getBrowsingHistoryData" });
              browsingHistoryData = Array.isArray(historyResponse?.browsingHistoryData)
                ? historyResponse.browsingHistoryData
                : [];
              await ext.storage.local.set({
                browsingHistoryData: sanitizeDomainRecordList(browsingHistoryData)
              });
            } catch (historyError) {
              console.error("Content script: Error fetching browsing history data:", historyError);
            }
          }

          const sanitizedConsentDomainData = sanitizeDomainRecordList(consentDomainData);
          const sanitizedBrowsingHistoryData = sanitizeDomainRecordList(browsingHistoryData);
          const droppedConsentRecords = Math.max(0, consentDomainData.length - sanitizedConsentDomainData.length);
          const droppedBrowsingRecords = Math.max(0, browsingHistoryData.length - sanitizedBrowsingHistoryData.length);
          const hashIntegrityError = (droppedConsentRecords > 0 || droppedBrowsingRecords > 0)
            ? `Dropped unhashed or invalid records (consent=${droppedConsentRecords}, browsing=${droppedBrowsingRecords}).`
            : null;

          window.postMessage({
            type: "FROM_EXTENSION_CONSENT_DOMAIN_DATA",
            payload: {
              records: sanitizedConsentDomainData,
              consentDomainData: sanitizedConsentDomainData,
              consentDomainDataCount: sanitizedConsentDomainData.length,
              browsingHistoryData: sanitizedBrowsingHistoryData,
              browsingHistoryDataCount: sanitizedBrowsingHistoryData.length,
              hasDiscrepancies,
              hasDiscrepanciesCheckedAt,
              count: sanitizedConsentDomainData.length,
              fetchedAt: new Date().toISOString(),
              hashIntegrityError
            }
          }, "*");
        } catch (error) {
          console.error("Content script: Error reading consent domain data:", error);
          window.postMessage({
            type: "FROM_EXTENSION_CONSENT_DOMAIN_DATA",
            payload: {
              records: [],
              consentDomainData: [],
              consentDomainDataCount: 0,
              browsingHistoryData: [],
              browsingHistoryDataCount: 0,
              hasDiscrepancies: null,
              hasDiscrepanciesCheckedAt: null,
              count: 0,
              error: String(error)
            }
          }, "*");
        }
      })();
      return;
    }

    if (event.data.payload?.action === "getBrowsingHistoryData") {
      console.info("[pricrumbs][content script] Received getBrowsingHistoryData request");
      (async () => {
        try {
          const result = await ext.storage.local.get(["browsingHistoryData"]);
          let records = sanitizeDomainRecordList(
            Array.isArray(result.browsingHistoryData) ? result.browsingHistoryData : []
          );

          if (records.length === 0) {
            try {
              const response = await ext.runtime.sendMessage({ action: "getBrowsingHistoryData" });
              records = sanitizeDomainRecordList(
                Array.isArray(response?.browsingHistoryData) ? response.browsingHistoryData : []
              );
              await ext.storage.local.set({ browsingHistoryData: records });
            } catch (backgroundError) {
              console.error("Content script: Error fetching browsing history from background:", backgroundError);
            }
          }

          window.postMessage({
            type: "FROM_EXTENSION_BROWSING_HISTORY_DATA",
            payload: {
              records,
              count: records.length,
              fetchedAt: new Date().toISOString()
            }
          }, "*");
        } catch (error) {
          console.error("Content script: Error reading browsing history data:", error);
          window.postMessage({
            type: "FROM_EXTENSION_BROWSING_HISTORY_DATA",
            payload: { records: [], count: 0, error: String(error) }
          }, "*");
        }
      })();
      return;
    }

    //this part is for eligibility check (if users have 10 or more unique websites where action taken = yes):
    if (event.data.payload?.action === "checkEligibility") {
      console.log("Content script: Received eligibility check request");

      const isActionTakenYes = (value) =>
        typeof value === "string" && value.trim().toLowerCase() === "yes";



      if (event.data.payload?.action === "injectIframeAndReadLocalStorage") {
        const url = event.data.payload.url;
        injectIframeAndRead(url);
        return;
      }

      // Helper function to categorize websites based on preferences
      function categorizeWebsites(cookieData) {
        console.log('Categorizing websites, total cookies:', cookieData.length);

        // Filter for cookies where actionTaken = "Yes"
        const actionTakenCookies = cookieData.filter(cookie =>
          cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
        );
        // Filter for websites where action taken is "No"
        const noActionCookies = cookieData.filter(cookie =>
          cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'no'
        );

        console.log('[content.js] Cookies with action taken:', actionTakenCookies.length);
        console.log('[content.js] Cookies with action taken = no:', noActionCookies.length);

        // Arrays to store categorized domains
        const category1 = []; // Accept all (functional=true, performance=true, advertising=true)
        const category2 = []; // Reject all (functional=false, performance=false, advertising=false)
        const category3 = []; // Mixed (functional=true, performance=true, advertising=false)
        const category4 = noActionCookies.length > 0; // Has websites with action taken = no

        // Process each cookie with action taken
        for (const cookie of actionTakenCookies) {
          if (!cookie.domain) continue;

          let preferences = null;

          // Try to get preferences from the cookie
          if (cookie.categories && typeof cookie.categories === 'object') {
            preferences = {
              functional: cookie.categories.functional === true,
              performance: cookie.categories.performance === true,
              advertising: cookie.categories.advertising === true
            };
          } else if ('functional' in cookie && 'performance' in cookie && 'advertising' in cookie) {
            preferences = {
              functional: cookie.functional === "Yes" || cookie.functional === true,
              performance: cookie.performance === "Yes" || cookie.performance === true,
              advertising: cookie.advertising === "Yes" || cookie.advertising === true
            };
          }

          // Categorize based on preferences
          if (preferences &&
            preferences.functional !== undefined &&
            preferences.performance !== undefined &&
            preferences.advertising !== undefined) {

            if (preferences.functional === true && preferences.performance === true && preferences.advertising === true) {
              category1.push(cookie.domain);
            } else if (preferences.functional === false && preferences.performance === false && preferences.advertising === false) {
              category2.push(cookie.domain);
            } else if (preferences.functional === true && preferences.performance === true && preferences.advertising === false) {
              category3.push(cookie.domain);
            }
          }
        }

        console.log('Category 1 (Accept all) count:', category1.length);
        console.log('Category 2 (Reject all) count:', category2.length);
        console.log('Category 3 (Mixed) count:', category3.length);
        console.log('Category 4 (Default) has data:', category4);

        return {
          hasAllAccepted: category1.length > 0,
          hasAllRejected: category2.length > 0,
          hasAdvertisingRejected: category3.length > 0,
          hasDefaultCookies: category4
        };
      }

      // Wrap in async function to use await
      (async () => {
        try {
          const result = await ext.storage.local.get(null);

          const cookieData =
            result.cookieData ||
            result.consentCookies ||
            result.cookies ||
            result.fetchedCookies ||
            [];

          const eligibleSites = cookieData.filter(site =>
            isActionTakenYes(site?.actionTaken)
          );

          const uniqueDomains = new Set();
          const { extractMainDomainName } =
            await import(browser.runtime.getURL("helper_functions.js"));

          for (let i = 0; i < eligibleSites.length; i++) {
            const domain = eligibleSites[i].domain;
            if (!domain) continue;

            const mainDomain = extractMainDomainName(domain);
            if (mainDomain) uniqueDomains.add(mainDomain);
          }

          const uniqueDomainsArray = Array.from(uniqueDomains);

          const websiteTypes = categorizeWebsites(cookieData);
          const eligibilityPending = cookieData.length === 0;

          const isEligible = uniqueDomainsArray.length >= 10;

          const payload = {
            eligibleSitesCount: uniqueDomainsArray.length,
            isEligible,
            totalSites: cookieData.length,
            uniqueDomains: uniqueDomainsArray,
            websiteTypes,
            eligibilityPending,
            eligibilityReason: eligibilityPending ? "cookieDataNotReady" : null
          };

          window.postMessage(
            {
              type: "FROM_EXTENSION_ELIGIBILITY",
              payload
            },
            "*"
          );

          if (isEligible) {
            console.log("[ELIGIBILITY] User eligible, refreshing familiarity candidates...");
            try {
              await ext.runtime.sendMessage({
                action: "getScenarioFamiliarityCandidates",
                forceRefresh: true
              });
            } catch (candidateError) {
              console.warn("[ELIGIBILITY] Unable to precompute familiarity candidates:", candidateError);
            }
          }

        } catch (error) {
          console.error("[ELIGIBILITY] Error in eligibility check:", error);
        }
      })();

      return;
    }

    if (event.data.payload?.action === "checkDiscrepancies") {

      console.log("Content script: Starting discrepancy check");

      (async () => {
        try {

          console.log("Content script: Fetching stored preference and cookie data");

          // Retrieve stored preferences and cookie data in parallel
          const [cookieResult] = await Promise.all([
            ext.storage.local.get(["cookieData", "selectedDomainsForHistory"])
          ]);

          const module = await import(browser.runtime.getURL("helper_functions.js"));
          const userPreferences = await module.getParticipantCookiesPreferences();

          // Extract stored values with fallbacks
          const cookieData = cookieResult.cookieData || [];
          const selectedDomains = cookieResult.selectedDomainsForHistory || [];

          console.log("Content script: Preferences count:", userPreferences.length);
          console.log("Content script: Cookie data count:", cookieData.length);
          console.log("Content script: Selected domains count:", selectedDomains.length);

          let hasDiscrepancies = false;

          // No preferences → nothing to compare
          if (!userPreferences.length) {
            console.log("Content script: No user preferences found. Skipping check.");

            await ext.storage.local.set({
              hasDiscrepancies: false,
              hasDiscrepanciesCheckedAt: new Date().toISOString()
            });

            window.postMessage({
              type: "FROM_EXTENSION_DISCREPANCIES",
              payload: { hasDiscrepancies: false }
            }, "*");

            return;
          }

          // Convert preferences array to Map for faster lookups
          const prefsMap = new Map(
            userPreferences.map(pref => [pref.domain, {
              functional: pref.functional,
              performance: pref.performance,
              advertising: pref.advertising
            }])
          );
          console.log("Content script: Preferences map created. Size:", prefsMap.size);

          // Determine domains that should be evaluated
          const domainsToCheck =
            selectedDomains.length > 0
              ? selectedDomains
              : cookieData.filter(site => site.actionTaken === "Yes");

          console.log("Content script: Domains selected for checking:", domainsToCheck.length);

          // Helper: generate possible domain variations
          const normalizeDomainFormats = (domain) => {
            const clean = domain.replace(/^\./, "").replace(/^www\./, "");
            const formats = [
              domain,
              domain.startsWith('.') ? domain.substring(1) : '.' + domain,
              clean,
              'www.' + clean
            ];

            console.log("Content script: Generated domain formats for", domain, formats);
            return formats;
          };

          // Helper: extract actual cookie consent state
          const getActualPrefs = (domainObj) => {

            if (domainObj.categories) {
              console.log("Content script: Using categories directly from domain object", domainObj);

              return {
                functional: domainObj.categories.functional === true,
                performance: domainObj.categories.performance === true,
                advertising: domainObj.categories.advertising === true
              };
            }

            const domain = domainObj.originalDomain || domainObj.domain;

            console.log("Content script: Searching cookieData for domain match:", domain);

            const match = cookieData.find(c =>
              c.domain === domain ||
              c.domain === domainObj.originalDomain ||
              c.domain.replace(/^\./, '') === domain.replace(/^\./, '')
            );

            if (!match?.categories) {
              console.log("Content script: No cookie categories found for", domain);
              return { functional: false, performance: false, advertising: false };
            }

            console.log("Content script: Cookie categories found for", domain, match.categories);

            return {
              functional: match.categories.functional === true,
              performance: match.categories.performance === true,
              advertising: match.categories.advertising === true
            };
          };

          // Iterate through domains to check
          for (const domainObj of domainsToCheck) {

            const domain = domainObj.originalDomain || domainObj.domain;
            if (!domain) {
              console.log("Content script: Skipping domain with no valid identifier", domainObj);
              continue;
            }

            console.log("Content script: Checking domain:", domain);

            const formats = normalizeDomainFormats(domain);

            let userPref = null;
            let matchedFormat = null;

            // Try to match stored user preference with domain formats
            for (const f of formats) {
              if (prefsMap.has(f)) {
                userPref = prefsMap.get(f);
                matchedFormat = f;
                break;
              }
            }

            if (!userPref) {
              console.log("Content script: No user preference found for domain:", domain);
              continue;
            }

            console.log("Content script: Matched preference format:", matchedFormat);
            console.log("Content script: User preference:", userPref);

            // Get observed cookie state
            const actualPrefs = getActualPrefs(domainObj);

            console.log("Content script: Actual cookie preferences:", actualPrefs);

            // Compare each category
            for (const category of ["functional", "performance", "advertising"]) {

              const userValue = userPref[category];
              const actualAccepted = actualPrefs[category];

              console.log(`Content script: Comparing category "${category}"`);
              console.log("User value:", userValue, "Actual accepted:", actualAccepted);

              if (
                typeof userValue === "number" &&
                ((actualAccepted && userValue <= 2) ||
                  (!actualAccepted && userValue >= 4))
              ) {
                console.log("Content script: DISCREPANCY DETECTED", {
                  domain,
                  category,
                  userValue,
                  actualAccepted
                });

                hasDiscrepancies = true;
                break;
              }
            }

            // Stop after first discrepancy
            if (hasDiscrepancies) {
              console.log("Content script: Stopping further checks due to discrepancy");
              break;
            }
          }

          console.log("Content script: Final discrepancy result:", hasDiscrepancies);

          // Persist result
          await ext.storage.local.set({
            hasDiscrepancies,
            hasDiscrepanciesCheckedAt: new Date().toISOString()
          });

          console.log("Content script: Result stored in extension storage");

          // Send result to page
          window.postMessage({
            type: "FROM_EXTENSION_DISCREPANCIES",
            payload: { hasDiscrepancies }
          }, "*");

          console.log("Content script: Result posted to page");

        } catch (error) {

          console.error("Content script: Error during discrepancy check:", error);

          // Fallback result
          await ext.storage.local.set({
            hasDiscrepancies: false,
            hasDiscrepanciesCheckedAt: new Date().toISOString()
          });

          window.postMessage({
            type: "FROM_EXTENSION_DISCREPANCIES",
            payload: { hasDiscrepancies: false }
          }, "*");

          console.log("Content script: Fallback result sent after error");
        }

      })();

      return;
    }

    if (event.data.payload?.action === "resetStudyData") {
      (async () => {
        try {
          const response = await ext.runtime.sendMessage({ action: "resetStudyData" });
          window.postMessage(
            {
              type: "FROM_EXTENSION_RESET",
              payload: { ok: response?.ok === true }
            },
            "*"
          );
        } catch (error) {
          console.error("Content script: Error resetting extension study data:", error);
          window.postMessage(
            {
              type: "FROM_EXTENSION_RESET",
              payload: { ok: false, error: String(error) }
            },
            "*"
          );
        }
      })();
      return;
    }

    // Forward message to the background script
    ext.runtime.sendMessage(event.data).then((response) => {
      if (response) { // Ensure response exists before sending it back
        console.log("Received response from background:", response);
        window.postMessage(
          { type: "FROM_EXTENSION", payload: response, tabId: event.data.tabId || null },
          "*"
        );
      } else {
        console.warn("No response received from background script.");
      }
    }).catch((err) => {
      console.error("Error sending message to background:", err);
    });
  });

  const nonScrollableEmbedIds = new Set([
    "pricrumbs_preferred_cookie_choices_functional",
    "pricrumbs_preferred_cookie_choices_performance",
    "pricrumbs_preferred_cookie_choices_advertising",
    "pricrumbs_consent_history_top_websites",
    "pricrumbs_websites_with_discrepancies",
    "pricrumbs_website_all_cookies_accepted",
    "pricrumbs_website_all_cookies_rejected",
    "pricrumbs_website_advertising_cookies_rejected",
    "pricrumbs_website_all_cookies_default",
  ]);

  const autoResizeEmbedIds = new Set([
    "pricrumbs_preferred_cookie_choices_functional",
    "pricrumbs_preferred_cookie_choices_performance",
    "pricrumbs_preferred_cookie_choices_advertising",
    "pricrumbs_consent_history_top_websites",
    "pricrumbs_websites_with_discrepancies",
  ]);

  // Listen for messages from the background script
  ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
    //   // Handle direct injection commands (background -> content -> DOM)
    //   // Handle direct injection commands (background -> content -> DOM)
    // if (request.action === "injectHTML") {

    //   const { elementId, htmlFile, height } = request;

    //   const targetElement = document.getElementById(elementId);

    //   if (targetElement && !targetElement.querySelector(".ext-shadow-host")) {

    //     const host = document.createElement("div");
    //     host.className = "ext-shadow-host";
    //     host.style.width = "100%";
    //     host.style.height = height || "600px";

    //     if (nonScrollableEmbedIds.has(elementId)) {
    //       host.style.overflow = "hidden";
    //     }

    //     targetElement.appendChild(host);

    //     const shadow = host.attachShadow({ mode: "open" });

    //     (async () => {
    //       try {
    //         const url = ext.runtime.getURL(htmlFile);
    //         const htmlText = await fetch(url).then(r => r.text());

    //         const parser = new DOMParser();
    //         const doc = parser.parseFromString(htmlText, "text/html");

    //         /* move <style> tags */
    //         doc.querySelectorAll("style").forEach(style => {
    //           shadow.appendChild(style.cloneNode(true));
    //         });

    //         /* move body content */
    //         const bodyWrapper = document.createElement("div");
    //         bodyWrapper.innerHTML = doc.body.innerHTML;
    //         shadow.appendChild(bodyWrapper);

    //         /* load scripts */
    //         doc.querySelectorAll("script[src]").forEach(script => {
    //           const s = document.createElement("script");
    //           s.src = ext.runtime.getURL(script.getAttribute("src"));
    //           shadow.appendChild(s);
    //         });

    //         /* expose root if scripts need access */
    //         window.__EXT_SHADOW_ROOT__ = shadow;

    //         console.log(`Injected shadow DOM for ${htmlFile} into #${elementId}`);
    //         sendResponse && sendResponse({ success: true });

    //       } catch (err) {
    //         console.error("Shadow injection failed:", err);
    //         sendResponse && sendResponse({ success: false, error: "fetch-failed" });
    //       }
    //     })();

    //   } else if (!targetElement) {
    // Request should include elementId, htmlFile, height
    // Handle direct injection commands (background -> content -> DOM)
    if (request.action === "injectHTML") {
      const { elementId, htmlFile, height } = request;

      const targetElement = document.getElementById(elementId);
      if (targetElement && !targetElement.querySelector("iframe")) {
        const iframe = document.createElement("iframe");
        iframe.src = ext.runtime.getURL(htmlFile);
        iframe.style.width = "100%";
        iframe.style.height = height || "600px";
        iframe.style.border = "none";
        if (nonScrollableEmbedIds.has(elementId)) {
          iframe.style.overflow = "hidden";
          iframe.setAttribute("scrolling", "no");
        }
        targetElement.appendChild(iframe);

        console.log(`Injected iframe for ${htmlFile} into #${elementId}`);
        sendResponse && sendResponse({ success: true });
      } else if (!targetElement) {

        console.error("Injection failed - element not found:", elementId);
        sendResponse && sendResponse({ success: false, error: "element-not-found" });

      } else {

        sendResponse && sendResponse({ success: true, note: "already-present" });

      }

      return true;
    }

    // Listen for requests from background to run the survey element checker (on tab update)
    if (request && request.action === "runSurveyElementCheck") {
      try {
        // Run the checker that looks for elements and posts messages back to the page
        if (typeof checkForSurveyElement === "function") {
          checkForSurveyElement();
          sendResponse({ success: true });
        } else {
          console.warn("checkForSurveyElement not defined in content script");
          sendResponse({ success: false, error: "checker-not-defined" });
        }
      } catch (err) {
        console.error("Error running survey element checker:", err);
        sendResponse({ success: false, error: err.message || err });
      }
      return true;
    }

    // Default: no action matched
    return false;
  });

  window.addEventListener("message", (event) => {
    if (!event || event.data?.type !== "PRICRUMBS_EMBED_HEIGHT") return;

    const origin = event.origin || "";
    const isAllowedOrigin =
      origin === "null" ||
      origin === "" ||
      origin.startsWith("chrome-extension://") ||
      origin.startsWith("moz-extension://");
    if (!isAllowedOrigin) return;

    const payload = event.data?.payload || {};
    const elementId = payload.elementId;
    if (!autoResizeEmbedIds.has(elementId)) return;

    const requestedHeight = Number(payload.height);
    if (!Number.isFinite(requestedHeight)) return;

    const hostElement = document.getElementById(elementId);
    const iframe = hostElement?.querySelector("iframe");
    if (!iframe) return;

    const minHeight = (
      elementId === "pricrumbs_consent_history_top_websites" ||
      elementId === "pricrumbs_websites_with_discrepancies"
    ) ? 180 : 360;
    const clampedHeight = Math.max(minHeight, Math.min(3000, Math.ceil(requestedHeight) + 8));
    iframe.style.height = `${clampedHeight}px`;
    iframe.style.overflow = "hidden";
    iframe.setAttribute("scrolling", "no");
  });

  // Looks for specific survey elements (found in elementMap)
  function checkForSurveyElement() {

    if (window.__pricrumbs_checker_installed) {
      console.log("pricrumbs checker already installed - skipping re-install.");
      return;
    }
    window.__pricrumbs_checker_installed = true;

    async function injectScenarioFamiliarityWidget(target) {
      const module = await import(browser.runtime.getURL("pricrumbs_scenario_familiarity.js"));
      await module.injectScenarioFamiliarityWidget(target);
    }

    async function injectScenarioFollowupTrustworthinessWidget(target) {
      const module = await import(browser.runtime.getURL("pricrumbs_scenario_familiarity.js"));
      await module.injectScenarioFollowupWidget(
        target,
        "pricrumbs_website_followup_trustworthiness"
      );
    }

    async function injectScenarioFollowupUtilityWidget(target) {
      const module = await import(browser.runtime.getURL("pricrumbs_scenario_familiarity.js"));
      await module.injectScenarioFollowupWidget(
        target,
        "pricrumbs_website_followup_utility"
      );
    }

    async function injectScenarioFollowupPrivacyWidget(target) {
      const module = await import(browser.runtime.getURL("pricrumbs_scenario_familiarity.js"));
      await module.injectScenarioFollowupWidget(
        target,
        "pricrumbs_website_followup_privacy_concerns"
      );
    }

    const elementMap = {
      "popup": { html: "popup.html", height: "600px" },
      "pricrumbs_popup_hidden": { html: "popup.html", height: "0px" },
      "pricrumbs_popup_welcome": { html: "popup_welcome.html", height: "400px" },
      "pricrumbs_preferred_cookie_choices_functional": { html: "pricrumbs_preferred_cookie_choices_functional.html", height: "560px" },
      "pricrumbs_preferred_cookie_choices_performance": { html: "pricrumbs_preferred_cookie_choices_performance.html", height: "560px" },
      "pricrumbs_preferred_cookie_choices_advertising": { html: "pricrumbs_preferred_cookie_choices_advertising.html", height: "560px" },
      "pricrumbs_consent_history_top_websites": { html: "pricrumbs_consent_history_top_websites.html", height: "500px" },
      "pricrumbs_consent_history_bottom_websites": { html: "pricrumbs_consent_history_bottom_websites.html", height: "600px" },
      "pricrumbs_website_familiarity_widget": { inject: injectScenarioFamiliarityWidget },
      "pricrumbs_website_followup_trustworthiness_widget": { inject: injectScenarioFollowupTrustworthinessWidget },
      "pricrumbs_website_followup_utility_widget": { inject: injectScenarioFollowupUtilityWidget },
      "pricrumbs_website_followup_privacy_concerns_widget": { inject: injectScenarioFollowupPrivacyWidget },
      "pricrumbs_website_all_cookies_accepted": { js: getPricrumbsWebsiteAllCookiesAccept },
      "pricrumbs_website_all_cookies_rejected": { js: getPricrumbsWebsiteAllCookiesReject },
      "pricrumbs_website_advertising_cookies_rejected": { js: getPricrumbsWebsiteAllCookiesMixed },
      "pricrumbs_website_all_cookies_default": { js: getPricrumbsWebsiteAllCookiesDefault },
      "pricrumbs_websites_with_discrepancies": { html: "pricrumbs_websites_with_discripincies.html", height: "950px" },
    };

    async function injectIfFound(id, opts = {}) {

      const target = document.getElementById(id);
      if (!target) return false;

      // prevent duplicate injection
      if (
        target.querySelector(".ext-injected") ||
        target.querySelector(".ext-injected-container")
      ) {
        return true;
      }

      const mapEntry = elementMap[id];
      if (!mapEntry) return false;

      try {

        if (mapEntry.inject && typeof mapEntry.inject === "function") {
          await mapEntry.inject(target);
          return true;

        } else if (mapEntry.html) {

          if (id === "pricrumbs_consent_history_top_websites") {
            const module = await import(browser.runtime.getURL("pricrumbs_consent_history.js"));

            if (target?.getAttribute('tutorial') === 'true') {
              await module.injectTopAndBottomFiveTable(target, true, false, false);
            } else {
              await module.injectTopAndBottomFiveTable(target, false, false, false);
            }
            return true;
          } else if (id === "pricrumbs_websites_with_discrepancies") {
            const module = await import(browser.runtime.getURL("pricrumbs_consent_history.js"));

            if (target?.getAttribute('tutorial') === 'true') {
              await module.injectTopAndBottomFiveTable(target, true, true, false);
            } else {
              await module.injectTopAndBottomFiveTable(target, false, true, false);
            }
            return true;
          } else if (id === "pricrumbs_websites_with_discrepancies_expiration_date") {
            const module = await import(browser.runtime.getURL("pricrumbs_consent_history.js"));

            if (target?.getAttribute('tutorial') === 'true') {
              await module.injectTopAndBottomFiveTable(target, true, true, true);
            } else {
              await module.injectTopAndBottomFiveTable(target, false, true, true);
            }
            return true;
          }

          window.postMessage(
            {
              type: "FROM_CONTENT",
              payload: { action: "injectHTML", elementId: id, ...opts }
            },
            "*"
          );

          return true;

        } else if (mapEntry.js && typeof mapEntry.js === "function") {

          const htmlContent = await mapEntry.js();

          const container = document.createElement("div");
          container.className = "ext-injected";
          container.innerHTML = htmlContent;
          container.style.width = "100%";
          container.style.height = "auto";

          target.appendChild(container);
          return true;
        }

      } catch (err) {
        console.error("Injection failed for", id, err);
      }

      return false;
    }

    // initial scan
    Object.keys(elementMap).forEach(id => injectIfFound(id, elementMap[id]));

    const observer = new MutationObserver((mutations) => {

      for (const mutation of mutations) {

        for (const node of mutation.addedNodes) {

          if (!(node instanceof HTMLElement)) continue;

          if (elementMap[node.id]) {
            injectIfFound(node.id, elementMap[node.id]);
          }

          for (const id in elementMap) {
            const found = node.querySelector(`#${id}`);
            if (found) injectIfFound(id, elementMap[id]);
          }

        }

      }

    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    window.__pricrumbs_checker_observer = observer;
  }

  // Listen for preference check requests
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "CHECK_PREFERENCES") return;

    const category = event.data.payload?.category;
    if (!category) return;

    console.log(`Extension: Checking ${category} preferences`);

    // Check preferences and respond
    checkCategoryPreferences(category).then(result => {
      window.postMessage({
        type: "PREFERENCES_STATUS",
        payload: {
          category: category,
          isComplete: result.isComplete,
          completedCount: result.completedCount,
          totalCount: result.totalCount
        }
      }, "*");
    });
  });

  async function checkCategoryPreferences(category) {
    try {
      // Get selected domains and stored participant preferences directly from local storage.
      const [domainsResult, prefsResult] = await Promise.all([
        ext.storage.local.get("selectedDomainsForHistory"),
        ext.storage.local.get("participantCookiesPreferences")
      ]);
      const selectedDomains = domainsResult.selectedDomainsForHistory || [];

      if (selectedDomains.length === 0) {
        console.warn('No selected domains found');
        return { isComplete: false, completedCount: 0, totalCount: 0 };
      }

      const prefsMap = buildNormalizedPreferenceMap(
        prefsResult?.participantCookiesPreferences
      );

      console.log(`Checking ${selectedDomains.length} domains for ${category} preferences`);

      let completedCount = 0;

      // Check each domain
      for (const domainObj of selectedDomains) {
        const domain = domainObj.originalDomain || domainObj.domain;
        const prefs = findPreferenceForDomain(domain, prefsMap);

        // Check if this category has a value set (not null/undefined)
        if (prefs && prefs[category] !== null && prefs[category] !== undefined) {
          completedCount++;
          console.log(` ${domain}: ${category} = ${prefs[category]}`);
        } else {
          console.log(` ${domain}: ${category} = NOT SET`);
        }
      }

      console.log(`Result: ${completedCount}/${selectedDomains.length} complete`);

      return {
        isComplete: completedCount === selectedDomains.length && selectedDomains.length >= 10,
        completedCount: completedCount,
        totalCount: selectedDomains.length
      };
    } catch (error) {
      console.error('Error checking preferences:', error);
      return { isComplete: false, completedCount: 0, totalCount: 0 };
    }
  }

  function injectIframeAndRead(url) {
    const old = document.getElementById("pricrumbs_iframe");
    if (old) old.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "pricrumbs_iframe";
    iframe.src = url;

    iframe.style.width = "0px";
    iframe.style.height = "0px";
    iframe.style.border = "0";
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";
    iframe.setAttribute("aria-hidden", "true");

    iframe.onload = () => {
      let payload = { url };

      try {
        payload.title = iframe.contentWindow.document.title;
        payload.localStorageValue = iframe.contentWindow.localStorage.getItem("anything");
      } catch (e) {
        console.error(e);
      }

      window.postMessage({ type: "FROM_EXTENSION", payload: { loadIframe: payload } }, "*");
    };

    iframe.onerror = (e) => {
      console.error(e);
      window.postMessage({ type: "FROM_EXTENSION", payload: { loadIframe: { url } } }, "*");
    };

    document.documentElement.appendChild(iframe);
  }

  async function buildAndStoreThreePerCategory() {
  try {
    const cookieData = await getCookieData();
    if (!cookieData || cookieData.length === 0) {
      console.error('[STORE] No cookie data available.');
      return;
    }

    const { formatDomainForDisplay, getFavicon, sendExtensionMessage } =
      await import(browser.runtime.getURL("helper_functions.js"));

    const categories = {
      category1: [], // Accept all
      category2: [], // Reject all
      category3: [], // Accept, Accept, Reject
      category4: []  // Action taken = No
    };

    const allValidEntries = [];

    // Prepare favicon promises concurrently
    const faviconPromises = cookieData.map(async (cookie) => {
      if (!cookie.domain) return null;

      const action = cookie.actionTaken?.toLowerCase();
      const formattedDomain = formatDomainForDisplay(cookie.domain);

      const favicon = await getFavicon(formattedDomain, cookie, { actionTaken: action || "Unknown" });

      if (!favicon) return null; // Skip if favicon not found

      let preferences = null;
      if (action === "yes") {
        if (cookie.categories && typeof cookie.categories === "object") {
          preferences = {
            functional: cookie.categories.functional === true,
            performance: cookie.categories.performance === true,
            advertising: cookie.categories.advertising === true
          };
        } else if ("functional" in cookie && "performance" in cookie && "advertising" in cookie) {
          preferences = {
            functional: cookie.functional === "Yes" || cookie.functional === true,
            performance: cookie.performance === "Yes" || cookie.performance === true,
            advertising: cookie.advertising === "Yes" || cookie.advertising === true
          };
        }
      }

      const entryBase = {
        domain: formattedDomain,
        originalDomain: cookie.domain,
        favicon,
        cookie
      };

      allValidEntries.push(entryBase);

      if (action === "no") {
        categories.category4.push({ ...entryBase, actionTaken: "No" });
      } else if (action === "yes" && preferences) {
        const p = preferences;
        const entry = { ...entryBase, preferences: p };
        if (p.functional && p.performance && p.advertising) categories.category1.push(entry);
        else if (!p.functional && !p.performance && !p.advertising) categories.category2.push(entry);
        else if (p.functional && p.performance && !p.advertising) categories.category3.push(entry);
      }

      return null;
    });

    await Promise.all(faviconPromises);

    // Pick up to 3 random domains per category
    const pickThree = (arr) => {
      if (!arr || arr.length === 0) return [];
      const shuffled = [...arr].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 3);
    };

    let arrayToStore = {
      "accept-all": pickThree(categories.category1),
      "reject-all": pickThree(categories.category2),
      "mixed": pickThree(categories.category3),
      "default": pickThree(categories.category4)
    };

    // Fill categories with random entries if fewer than 3 found
    for (const key of ["accept-all", "reject-all", "mixed", "default"]) {
      const current = arrayToStore[key];
      if (current.length < 3) {
        const missing = 3 - current.length;
        const extras = allValidEntries
          .filter(e => !current.includes(e))
          .sort(() => 0.5 - Math.random())
          .slice(0, missing);
        arrayToStore[key] = [...current, ...extras];
      }
    }

    // Store via your extension messaging
    await sendExtensionMessage({
      type: "STORAGE_SET",
      key: "selectedCookieDomains",
      value: arrayToStore
    });

    console.log('[STORE] Stored three domains per category:', arrayToStore);

  } catch (error) {
    console.error('[STORE] Error building category domains:', error);
  }
}

  // Find websites matching each criteria based only on cookie data
  async function findMatchingWebsites(cookieData) {
    console.log('[MATCH] All cookies count:', cookieData.length);

    const { formatDomainForDisplay, getFavicon } =
      await import(browser.runtime.getURL("helper_functions.js"));

    const categories = {
      category1: [], // Accept all
      category2: [], // Reject all
      category3: [], // Accept, Accept, Reject
      category4: []  // Action taken = No
    };

    // Build favicon promises first
    const faviconPromises = cookieData.map(async (cookie) => {
      if (!cookie.domain) return null;

      const action = cookie.actionTaken?.toLowerCase();
      const formattedDomain = formatDomainForDisplay(cookie.domain);

      // Prepare favicon promise without blocking loop
      const faviconPromise = getFavicon(formattedDomain, cookie, { actionTaken: action || "Unknown" });

      let preferences = null;
      if (action === "yes") {
        if (cookie.categories && typeof cookie.categories === "object") {
          preferences = {
            functional: cookie.categories.functional === true,
            performance: cookie.categories.performance === true,
            advertising: cookie.categories.advertising === true
          };
        } else if ("functional" in cookie && "performance" in cookie && "advertising" in cookie) {
          preferences = {
            functional: cookie.functional === "Yes" || cookie.functional === true,
            performance: cookie.performance === "Yes" || cookie.performance === true,
            advertising: cookie.advertising === "Yes" || cookie.advertising === true
          };
        }
      }

      return { cookie, formattedDomain, action, preferences, faviconPromise };
    });

    const results = await Promise.all(faviconPromises);

    for (const res of results) {
      if (!res) continue;

      const favicon = await res.faviconPromise;

      const entryBase = {
        domain: res.formattedDomain,
        originalDomain: res.cookie.domain,
        favicon,
        cookie: res.cookie
      };

      if (res.action === "no") {
        categories.category4.push({ ...entryBase, actionTaken: "No" });
      } else if (res.action === "yes" && res.preferences) {
        const p = res.preferences;
        const entry = { ...entryBase, preferences: p };
        if (p.functional && p.performance && p.advertising) categories.category1.push(entry);
        else if (!p.functional && !p.performance && !p.advertising) categories.category2.push(entry);
        else if (p.functional && p.performance && !p.advertising) categories.category3.push(entry);
      }
    }

    const random = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;

    return {
      acceptAll: random(categories.category1),
      rejectAll: random(categories.category2),
      mixed: random(categories.category3),
      default: random(categories.category4)
    };
  }

  async function loadCookieDataAndSelectWebsites(categoryType) {
    try {
      const groupName = SCENARIO_GROUP_BY_CATEGORY_TYPE[categoryType];
      if (!groupName) {
        console.error("[COOKIE] Unknown category type:", categoryType);
        return "";
      }

      const storageResult = await ext.storage.local.get([
        SCENARIO_FAMILIARITY_CANDIDATES_KEY,
        SELECTED_SCENARIO_DOMAIN_HASHES_KEY
      ]);
      let candidatesByCondition = normalizeScenarioCandidatesByCondition(
        storageResult?.[SCENARIO_FAMILIARITY_CANDIDATES_KEY]
      );
      const selectedScenarioDomainHashes = normalizeSelectedScenarioDomainHashes(
        storageResult?.[SELECTED_SCENARIO_DOMAIN_HASHES_KEY]
      );

      if (SCENARIO_GROUP_NAMES.every((name) => (candidatesByCondition[name] || []).length === 0)) {
        try {
          const response = await ext.runtime.sendMessage({ action: "getScenarioFamiliarityCandidates" });
          candidatesByCondition = normalizeScenarioCandidatesByCondition(response?.candidatesByCondition);
        } catch (candidateError) {
          console.warn("[COOKIE] Unable to fetch scenario familiarity candidates:", candidateError);
        }
      }

      const selectedDomainHash = normalizeDomainHash(selectedScenarioDomainHashes[groupName]);
      const website = (candidatesByCondition[groupName] || []).find(
        (candidate) => normalizeDomainHash(candidate?.domainHash) === selectedDomainHash
      ) || null;

      const payload = {
        websiteTypes: buildScenarioWebsiteFlags(selectedScenarioDomainHashes),
        [groupName]: website ? {
          domain: website.rawDomain,
          originalDomain: website.rawDomain,
          domainHash: website.domainHash
        } : null
      };

      window.postMessage(
        {
          type: "WEBSITE_DATA",
          payload
        },
        "*"
      );

      if (!website) {
        console.warn(`[COOKIE] No selected familiar website available for category: ${categoryType}`);
        return `
          <div style="padding:8px 0;">
            <p style="margin:0;">No website available for this question.</p>
          </div>
        `;
      }

      let faviconSource = website.faviconDataUrl || "";
      if (!faviconSource) {
        try {
          const { getFavicon } = await import(browser.runtime.getURL("helper_functions.js"));
          faviconSource = await getFavicon(website.rawDomain);
        } catch (_error) {
          faviconSource = "";
        }
      }
      faviconSource = faviconSource || SCENARIO_FALLBACK_FAVICON;
      const displayDomain = website.displayDomain || website.rawDomain;
      return `
        <div style="display:flex;align-items:center;gap:8px;">
          <img
            src="${escapeHtml(faviconSource)}"
            alt=""
            aria-hidden="true"
            style="width:32px;height:32px;object-fit:contain;border-radius:6px;flex:0 0 32px;"
          >
          <h3 style="margin:0;font-size:1.5rem;">${escapeHtml(displayDomain)}</h3>
        </div>
      `;

    } catch (error) {
      console.error("[COOKIE] loadCookieDataAndSelectWebsites error:", error);
      return `
        <div style="padding:8px 0;">
          <p style="margin:0;">Unable to load website information.</p>
        </div>
      `;
    }
  }

  // Get cookie data from storage
  async function getCookieData() {
    try {
      const result = await ext.storage.local.get("cookieData");
      return result.cookieData || [];
    } catch (err) {
      console.error("Error retrieving cookie data:", err);
      return [];
    }
  }

  async function getPricrumbsWebsiteAllCookiesDefault() {
    return await loadCookieDataAndSelectWebsites("default");
  }

  async function getPricrumbsWebsiteAllCookiesReject() {
    return await loadCookieDataAndSelectWebsites("reject-all");
  }

  async function getPricrumbsWebsiteAllCookiesMixed() {
    return await loadCookieDataAndSelectWebsites("mixed");
  }

  async function getPricrumbsWebsiteAllCookiesAccept() {
    return await loadCookieDataAndSelectWebsites("accept-all");
  }

  window.addEventListener("message", (event) => {

    if (event.source !== window) return;
    if (event.data?.type !== "EXTENSION_MESSAGE") return;

    const { id, payload } = event.data;

    Promise.resolve(ext.runtime.sendMessage(payload))
      .then((response) => {
        window.postMessage({
          type: "EXTENSION_MESSAGE_RESPONSE",
          id,
          response
        }, "*");
      })
      .catch((error) => {
        window.postMessage({
          type: "EXTENSION_MESSAGE_RESPONSE",
          id,
          response: {
            error: error?.message || String(error)
          }
        }, "*");
      });

  });

  // Run checker on initial load
  checkForSurveyElement();
}
