// Content script

// if (window.location.hostname === "localhost") {
//     // dev logic
// } else if (window.location.hostname === "www.example.com") {
//     // prod logic
// } else {
//     // ignore other domains
//     return;
// }
if (window.location.hostname === "localhost" || window.location.hostname === "www.example.com") {
  console.log("[pricrumbs] content script successfully injected");

  // Notify that content script is ready
  window.postMessage(
    { type: "pricrumbs_extension_ready", payload: { extensionInstalled: true } },
    "*"
  );

  const DOMAIN_HASH_PATTERN = /^[0-9a-f]{64}$/i;

  function normalizeConsentValue(value) {
    if (value === true || value === "yes" || value === "Yes") return "yes";
    if (value === false || value === "no" || value === "No") return "no";
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

      if (!recordsByHash.has(domainHash)) {
        recordsByHash.set(domainHash, {
          domainHash,
          domainRankRange: cookie?.domainRankRange || null,
          numberOfVisits,
          dates: Array.from(new Set(dates)).sort(),
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
    });

    return Array.from(recordsByHash.values());
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
      (async () => {
        try {
          const result = await ext.storage.local.get([
            "consentDomainData",
            "cookieData",
            "browsingHistoryData",
            "hasDiscrepancies",
            "hasDiscrepanciesCheckedAt"
          ]);
          const consentDomainData = Array.isArray(result.consentDomainData) && result.consentDomainData.length > 0
            ? result.consentDomainData
            : buildDomainConsentRecords(result.cookieData || []);
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

      // Helper function to extract main domain name (e.g., "zoom" from "zoom.com" or "zoom.us")
      function extractMainDomainName(domain) {
        if (!domain) return '';

        // Remove leading dots
        let cleaned = domain.replace(/^\.+/, '');

        // Remove www. prefix
        cleaned = cleaned.replace(/^www\./, '');

        // Split by dots and get the main part (before TLD)
        const parts = cleaned.split('.');

        // Return the main domain name (second-to-last part before TLD)
        // For "zoom.com" or "zoom.us", this returns "zoom"
        // For "stackoverflow.com", this returns "stackoverflow"
        return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : cleaned.toLowerCase();
      }

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

        console.log('Cookies with action taken:', actionTakenCookies.length);
        console.log('Cookies with action taken = no:', noActionCookies.length);

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

          console.log("Content script: All storage keys:", Object.keys(result));

          // Try multiple possible keys
          const cookieData = result.cookieData ||
            result.consentCookies ||
            result.cookies ||
            result.fetchedCookies ||
            [];

          console.log("Content script: Found cookie data length:", cookieData.length);

          if (cookieData.length > 0) {
            console.log("Content script: First cookie sample:", cookieData[0]);
          }

          // Filter websites where actionTaken is "Yes" (case-insensitive, exact value).
          const eligibleSites = cookieData.filter((site) => isActionTakenYes(site?.actionTaken));

          console.log("Content script: Sites with action taken = Yes:", eligibleSites.length);

          // Extract unique domains by main domain name
          const uniqueDomains = new Set();
          eligibleSites.forEach(site => {
            if (site.domain) {
              const mainDomain = extractMainDomainName(site.domain);
              if (mainDomain) {
                uniqueDomains.add(mainDomain);
                console.log(`Content script: Added unique domain "${mainDomain}" from ${site.domain}`);
              }
            }
          });

          const uniqueDomainsArray = Array.from(uniqueDomains);
          console.log("Content script: Unique domains found:", uniqueDomainsArray);
          console.log("Content script: Unique domains count:", uniqueDomainsArray.length);

          // Categorize websites to determine which types are available
          const websiteTypes = categorizeWebsites(cookieData);
          console.log("Content script: Website types available:", websiteTypes);

          const eligibilityPending = cookieData.length === 0;

          // Create payload (WITHOUT hasDiscrepancies - that will be checked later)
          const payload = {
            eligibleSitesCount: uniqueDomainsArray.length,
            isEligible: uniqueDomainsArray.length >= 10,
            totalSites: cookieData.length,
            uniqueDomains: uniqueDomainsArray,
            websiteTypes: websiteTypes,
            eligibilityPending,
            eligibilityReason: eligibilityPending ? "cookieDataNotReady" : null
          };

          console.log("Content script: Sending eligibility response:", payload);

          window.postMessage({
            type: "FROM_EXTENSION_ELIGIBILITY",
            payload: payload
          }, "*");

        } catch (error) {
          console.error("Content script: Error in eligibility check:", error);
        }
      })(); // Immediately invoke the async function

      return;
    }

    // Check for discrepancies after user sets preferences
    if (event.data.payload?.action === "checkDiscrepancies") {
      console.log("Content script: Received discrepancy check request");

      (async () => {
        try {
          // Get user preferences
          const prefsResult = await ext.storage.local.get("participantCookiesPreferences");

          // Get cookie data and selected domains
          const cookieResult = await ext.storage.local.get(["cookieData", "selectedDomainsForHistory"]);

          const userPreferences = prefsResult.participantCookiesPreferences;
          const cookieData = cookieResult.cookieData || [];
          const selectedDomains = cookieResult.selectedDomainsForHistory || [];

          console.log("Content script: User preferences count:", userPreferences?.length || 0);
          console.log("Content script: Cookie data count:", cookieData.length);
          console.log("Content script: Selected domains count:", selectedDomains.length);

          let hasDiscrepancies = false;

          if (userPreferences && userPreferences.length > 0) {
            const prefsMap = new Map(userPreferences);
            console.log("Content script: Preferences map size:", prefsMap.size);

            // Use selected domains if available, otherwise use all eligible sites
            const domainsToCheck = selectedDomains.length > 0
              ? selectedDomains
              : cookieData.filter(site => site.actionTaken === "Yes");

            console.log("Content script: Checking", domainsToCheck.length, "domains for discrepancies");

            // Check for discrepancies
            for (const domainObj of domainsToCheck) {
              const domain = domainObj.originalDomain || domainObj.domain;
              if (!domain) continue;

              console.log(`Content script: Checking domain: ${domain}`);

              // Try to find matching user preference with multiple formats
              const possibleFormats = [
                domain,
                domain.startsWith('.') ? domain.substring(1) : '.' + domain,
                domain.replace(/^\./, ''),
                domain.replace(/^www\./, ''),
                'www.' + domain.replace(/^\./, '')
              ];

              let userPref = null;
              let matchedFormat = null;
              for (const format of possibleFormats) {
                if (prefsMap.has(format)) {
                  userPref = prefsMap.get(format);
                  matchedFormat = format;
                  break;
                }
              }

              if (!userPref) {
                console.log(`Content script: No preferences found for ${domain}`);
                continue;
              }

              console.log(`Content script: Found preferences for ${matchedFormat}:`, userPref);

              // Get actual cookie preferences
              let actualPrefs = {
                functional: false,
                performance: false,
                advertising: false
              };

              if (domainObj.categories) {
                actualPrefs = {
                  functional: domainObj.categories.functional === true,
                  performance: domainObj.categories.performance === true,
                  advertising: domainObj.categories.advertising === true
                };
              } else {
                // Try to find in cookieData
                const cookieMatch = cookieData.find(c =>
                  c.domain === domain ||
                  c.domain === domainObj.originalDomain ||
                  c.domain.replace(/^\./, '') === domain.replace(/^\./, '')
                );

                if (cookieMatch && cookieMatch.categories) {
                  actualPrefs = {
                    functional: cookieMatch.categories.functional === true,
                    performance: cookieMatch.categories.performance === true,
                    advertising: cookieMatch.categories.advertising === true
                  };
                }
              }

              console.log(`Content script: Actual preferences for ${domain}:`, actualPrefs);

              // Check for discrepancies using 5-point scale logic
              const categories = ['functional', 'performance', 'advertising'];
              for (const category of categories) {
                const userValue = userPref[category];
                if (typeof userValue === 'number') {
                  const actualAccepted = actualPrefs[category];
                  // Discrepancy = accepted but user chose 1-2, OR rejected but user chose 4-5
                  if ((actualAccepted && userValue <= 2) || (!actualAccepted && userValue >= 4)) {
                    hasDiscrepancies = true;
                    console.log(` Content script: DISCREPANCY FOUND for ${domain}, category ${category}`);
                    console.log(`   User value: ${userValue}, Actual: ${actualAccepted ? 'Allowed' : 'Not Allowed'}`);
                    break;
                  }
                }
              }

              if (hasDiscrepancies) break; // Stop checking once we find one
            }
          } else {
            console.log("Content script: No user preferences found");
          }

          console.log("Content script: Final discrepancy result:", hasDiscrepancies);

          try {
            await ext.storage.local.set({
              hasDiscrepancies,
              hasDiscrepanciesCheckedAt: new Date().toISOString()
            });
          } catch (storageError) {
            console.warn("Content script: Failed to persist discrepancy result:", storageError);
          }

          window.postMessage({
            type: "FROM_EXTENSION_DISCREPANCIES",
            payload: { hasDiscrepancies: hasDiscrepancies }
          }, "*");

        } catch (error) {
          console.error("Content script: Error checking discrepancies:", error);
          try {
            await ext.storage.local.set({
              hasDiscrepancies: false,
              hasDiscrepanciesCheckedAt: new Date().toISOString()
            });
          } catch (storageError) {
            console.warn("Content script: Failed to persist discrepancy error fallback:", storageError);
          }
          window.postMessage({
            type: "FROM_EXTENSION_DISCREPANCIES",
            payload: { hasDiscrepancies: false }
          }, "*");
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

    const elementMap = {
      "popup": { html: "popup.html", height: "600px" },
      "pricrumbs_popup_hidden": { html: "popup.html", height: "100px" },
      "pricrumbs_popup_welcome": { html: "popup_welcome.html", height: "400px" },
      "pricrumbs_preferred_cookie_choices_functional": { html: "pricrumbs_preferred_cookie_choices_functional.html", height: "560px" },
      "pricrumbs_preferred_cookie_choices_performance": { html: "pricrumbs_preferred_cookie_choices_performance.html", height: "560px" },
      "pricrumbs_preferred_cookie_choices_advertising": { html: "pricrumbs_preferred_cookie_choices_advertising.html", height: "560px" },
      "pricrumbs_consent_history_top_websites": { html: "pricrumbs_consent_history_top_websites.html", height: "500px" },
      "pricrumbs_consent_history_bottom_websites": { html: "pricrumbs_consent_history_bottom_websites.html", height: "600px" },
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

        if (mapEntry.html) {

          if (id === "pricrumbs_consent_history_top_websites") {
            const module = await import(browser.runtime.getURL("pricrumbs_consent_history.js"));

            if (target?.getAttribute('tutorial') === 'true') {
              await module.injectTopAndBottomFiveTable(target, true);
            } else {
              await module.injectTopAndBottomFiveTable(target, false);
            }
            return true;
          } else if (id === "pricrumbs_websites_with_discrepancies") {
            const module = await import(browser.runtime.getURL("pricrumbs_consent_history.js"));

            if (target?.getAttribute('tutorial') === 'true') {
              await module.injectTopAndBottomFiveTable(target, true, true);
            } else {
              await module.injectTopAndBottomFiveTable(target, false, true);
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
      // Get selected domains
      const domainsResult = await ext.storage.local.get('selectedDomainsForHistory');
      const selectedDomains = domainsResult.selectedDomainsForHistory || [];

      if (selectedDomains.length === 0) {
        console.warn('No selected domains found');
        return { isComplete: false, completedCount: 0, totalCount: 0 };
      }

      // Get user preferences
      const prefsResult = await ext.storage.local.get('participantCookiesPreferences');
      const userPreferences = prefsResult.participantCookiesPreferences || [];
      const prefsMap = new Map(userPreferences);

      console.log(`Checking ${selectedDomains.length} domains for ${category} preferences`);

      let completedCount = 0;

      // Check each domain
      for (const domainObj of selectedDomains) {
        const domain = domainObj.originalDomain || domainObj.domain;
        const prefs = prefsMap.get(domain);

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

  // Format domain for better display
  function formatDomainForDisplay(domain) {
    // If domain is empty or undefined, return "Unknown"
    if (!domain) return "Unknown";

    // Remove leading dot if present
    if (domain.startsWith('.')) {
      domain = domain.substring(1);
    }

    // If domain doesn't have a subdomain (no dots except the TLD), add www.
    const parts = domain.split('.');
    if (parts.length === 2) {
      domain = 'www.' + domain;
    }

    return domain;
  }

  // Find websites matching each criteria based only on cookie data
  function findMatchingWebsites(cookieData) {
    console.log('All cookies count:', cookieData.length);

    // STEP 1: Filter for cookies where actionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(cookie =>
      cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );

    // Filter for websites where actionTaken = "No"
    const noActionCookies = cookieData.filter(cookie =>
      cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'no'
    );

    console.log('Cookies with action taken:', actionTakenCookies.length);
    console.log('Cookies with action taken = no:', noActionCookies.length);


    // STEP 2: Create an array of all domains with their preferences
    const allDomains = [];
    const noActionDomains = [];

    // For each cookie with actionTaken = "Yes", extract its preferences
    for (const cookie of actionTakenCookies) {
      if (!cookie.domain) continue;

      const formattedDomain = formatDomainForDisplay(cookie.domain);
      let preferences = null;

      // First try to get preferences directly from the cookie
      if (cookie.categories && typeof cookie.categories === 'object') {
        // Categories directly from the cookie object (nested object)
        preferences = {
          functional: cookie.categories.functional === true,
          performance: cookie.categories.performance === true,
          advertising: cookie.categories.advertising === true
        };
        console.log(`Found preferences from cookie.categories for ${formattedDomain}:`, preferences);
      }
      // Then try to get from direct column values in table
      else if ('functional' in cookie && 'performance' in cookie && 'advertising' in cookie) {
        // Direct column values from the table (string values like "Yes" or "No")
        preferences = {
          functional: cookie.functional === "Yes" || cookie.functional === true,
          performance: cookie.performance === "Yes" || cookie.performance === true,
          advertising: cookie.advertising === "Yes" || cookie.advertising === true
        };
        console.log(`Found preferences from table columns for ${formattedDomain}:`, preferences);
      }

      // If we've got preferences, add this domain to our list
      if (preferences &&
        preferences.functional !== undefined &&
        preferences.performance !== undefined &&
        preferences.advertising !== undefined) {

        allDomains.push({
          domain: formattedDomain,
          originalDomain: cookie.domain,
          favicon: `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`,
          preferences: preferences,
          cookie: cookie
        });

        console.log(`Added ${formattedDomain} to allDomains`);
      } else {
        console.log(`Skipping ${formattedDomain} - could not determine complete preferences`);
      }
    }

    // Process cookies where actionTaken = "No"
    for (const cookie of noActionCookies) {
      if (!cookie.domain) continue;

      const formattedDomain = formatDomainForDisplay(cookie.domain);

      noActionDomains.push({
        domain: formattedDomain,
        originalDomain: cookie.domain,
        favicon: `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`,
        cookie: cookie,
        actionTaken: 'No'
      });

      console.log(`Added ${formattedDomain} to noActionDomains`);
    }

    console.log('Total domains with preferences:', allDomains.length);
    console.log('Total domains with action taken = no:', noActionDomains.length);

    // STEP 3: Categorize domains based on preferences (ignoring 'necessary')
    const category1 = []; // Accept, Accept, Accept
    const category2 = []; // Reject, Reject, Reject
    const category3 = []; // Accept, Accept, Reject
    const category4 = noActionDomains; // Action taken = no


    for (const domain of allDomains) {
      const p = domain.preferences;

      if (p.functional === true && p.performance === true && p.advertising === true) {
        category1.push(domain);
        console.log(`Added ${domain.domain} to category 1 (Accept all)`);
      } else if (p.functional === false && p.performance === false && p.advertising === false) {
        category2.push(domain);
        console.log(`Added ${domain.domain} to category 2 (Reject all)`);
      } else if (p.functional === true && p.performance === true && p.advertising === false) {
        category3.push(domain);
        console.log(`Added ${domain.domain} to category 3 (Accept, Accept, Reject)`);
      } else {
        console.log(`Domain ${domain.domain} with preferences doesn't match any target category`, p);
      }
    }

    console.log('Category 1 (Accept all):', category1.map(d => d.domain));
    console.log('Category 2 (Reject all):', category2.map(d => d.domain));
    console.log('Category 3 (Accept, Accept, Reject):', category3.map(d => d.domain));
    console.log('Category 4 (Default):', category4.map(d => d.domain));


    // STEP 4: Select one random website from each category
    return {
      acceptAll: category1.length > 0 ? category1[Math.floor(Math.random() * category1.length)] : null,
      rejectAll: category2.length > 0 ? category2[Math.floor(Math.random() * category2.length)] : null,
      mixed: category3.length > 0 ? category3[Math.floor(Math.random() * category3.length)] : null,
      default: category4.length > 0 ? category4[Math.floor(Math.random() * category4.length)] : null

    };
  }

  // Main function to load cookie data and select websites
  // categoryType must be one of 'accept-all', 'reject-all', 'mixed', 'default'
  async function loadCookieDataAndSelectWebsites(categoryType) {
    try {
      // Load only cookie data
      const cookieData = await getCookieData();

      console.log('Loaded cookie data:', cookieData?.length || 0);

      // Check if we have data
      if (!cookieData || cookieData.length === 0) {
        console.error('Missing cookie data. Please visit the Cookie Checker first.');
        return;
      }

      // Find websites matching our criteria using only cookie data
      const matchingWebsites = findMatchingWebsites(cookieData);

      let website = null;
      let containerId = null;

      switch (categoryType) {
        case 'accept-all':
          website = matchingWebsites.acceptAll;
          containerId = 'category1';
          break;
        case 'reject-all':
          website = matchingWebsites.rejectAll;
          containerId = 'category2';
          break;
        case 'mixed':
          website = matchingWebsites.mixed;
          containerId = 'category3';
          break;
        case 'default':  // Handle default category
          website = matchingWebsites.default;
          containerId = 'category4';
          break;
        default:
          console.error('Unknown category type:', categoryType);
          return;
      }

      if (matchingWebsites) {
        // Compute the booleans based on category availability
        const websiteData = {
          hasAdvertisingRejected: !!matchingWebsites.mixed,  // mixed
          hasAllAccepted: !!matchingWebsites.acceptAll,          // accept all
          hasAllRejected: !!matchingWebsites.rejectAll,          // reject all
          hasDefaultCookies: !!matchingWebsites.default        // default
        };
        // Send to the survey page
        window.postMessage({
          type: "WEBSITE_DATA",
          payload: websiteData
        }, "*");

        console.log(" Sent WEBSITE_DATA to survey:", websiteData);
      }

      return `
        <div style="display: flex; align-items: center; gap: 8px;">
            <img 
                src="${website.favicon}" 
                alt="Favicon" 
                style="width:32px; height:32px; object-fit: contain;" 
                onerror="this.style.display='none'">
            <h3 style="margin: 0; font-size: 1.5rem;">${website.domain}</h3>
        </div>
      `;
    } catch (error) {
      console.error('Error in loadCookieDataAndSelectWebsites:', error);
      showError('An error occurred while loading data: ' + error.message);
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

    ext.runtime.sendMessage(payload, (response) => {

      window.postMessage({
        type: "EXTENSION_MESSAGE_RESPONSE",
        id,
        response
      }, "*");

    });

  });

  // Run checker on initial load
  checkForSurveyElement();
}