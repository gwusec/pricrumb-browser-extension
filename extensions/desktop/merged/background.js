// background.js

// Load polyfill and shim in MV3 background service worker
try {
  console.log("Importing shims");
  importScripts("ext-shim.js", "browser-polyfill.min.js");
} catch (e) {
  console.warn("Could not import shims, may already be included.");
}

const historyCache = {}; // Cache to store history data per domain
const visitedDomainsCache = new Set(); // Cache to store domains the user has visited
let visitedDomainsCacheLastUpdated = 0; // Timestamp of last update to visitedDomainsCache
let top1mDomainRankMapPromise = null;
const domainHashCache = new Map();
let browsingHistoryDataCache = null;
let browsingHistoryDataCacheLastUpdated = 0;
const DOMAIN_HASH_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_SURVEY_API_BASE_URL = "https://nets.gwusec.seas.gwu.edu";
const DEFAULT_DOMAIN_HASH_SERVICE_PATH = "/postsurvey/hash-domains";

/*
 * Extension lifecycle: installation / update phase
 *
 * This handler runs when the browser installs or updates the extension.
 * Use it for one-time setup, migrations, or default configuration.
 *
 * Runs in the background context (service worker), not in content scripts.
 */
ext.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("Extension installed");
  }

  if (details.reason === "update") {
    console.log("Extension updated");
  }
});

// Parse top-1m-websites.csv once and cache the Map<domain, rank_range>
async function getTop1mDomainRankMap() {
  if (top1mDomainRankMapPromise) {
    return top1mDomainRankMapPromise;
  }

  top1mDomainRankMapPromise = (async () => {
    const response = await fetch(ext.runtime.getURL("top-1m-websites.csv"));
    const text = await response.text();
    const map = new Map();

    text.split(/\r?\n/).forEach(line => {
      if (!line) return;
      const commaIndex = line.indexOf(",");
      if (commaIndex === -1) return;
      const rankRange = line.slice(0, commaIndex).trim();
      const domain = line.slice(commaIndex + 1).trim().toLowerCase();
      if (domain && !map.has(domain)) {
        map.set(domain, rankRange);
      }
    });

    console.log(`Loaded top-1m domain map with ${map.size} entries`);
    return map;
  })();

  return top1mDomainRankMapPromise;
}

function canonicalizeDomain(domain) {
  let d = (domain || "").trim().toLowerCase();
  if (d.startsWith(".")) d = d.slice(1);
  if (d.endsWith(".")) d = d.slice(0, -1);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
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

function normalizeServicePath(value) {
  if (typeof value !== "string") return DEFAULT_DOMAIN_HASH_SERVICE_PATH;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_DOMAIN_HASH_SERVICE_PATH;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function buildDomainHashServiceEndpoint(baseUrl) {
  const normalizedBase = normalizeHttpUrl(baseUrl) || DEFAULT_SURVEY_API_BASE_URL;
  const path = normalizeServicePath(DEFAULT_DOMAIN_HASH_SERVICE_PATH);
  return `${normalizedBase}${path}`;
}

async function resolveDomainHashServiceEndpoint() {
  try {
    const stored = await ext.storage.local.get([
      "domainHashServiceEndpoint",
      "surveyApiBaseUrl"
    ]);

    const configuredEndpoint = normalizeHttpUrl(stored.domainHashServiceEndpoint);
    if (configuredEndpoint) return configuredEndpoint;

    const configuredBase = normalizeHttpUrl(stored.surveyApiBaseUrl);
    if (configuredBase) {
      return buildDomainHashServiceEndpoint(configuredBase);
    }
  } catch (error) {
    console.warn("Failed to load service config from storage:", error);
  }

  return buildDomainHashServiceEndpoint(DEFAULT_SURVEY_API_BASE_URL);
}

function isHexDomainHash(value, lengths = [64]) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) return false;
  return lengths.includes(normalized.length);
}

async function hashDomains(domains, { strict = false } = {}) {
  const canonicalDomains = Array.from(
    new Set(
      (Array.isArray(domains) ? domains : [])
        .map(canonicalizeDomain)
        .filter(Boolean)
    )
  );

  if (!canonicalDomains.length) {
    return new Map();
  }

  const uncachedDomains = canonicalDomains.filter((domain) => !domainHashCache.has(domain));
  if (uncachedDomains.length) {
    const domainHashServiceEndpoint = await resolveDomainHashServiceEndpoint();
    if (!domainHashServiceEndpoint) {
      throw new Error("Domain hash service endpoint is not configured.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOMAIN_HASH_REQUEST_TIMEOUT_MS);
    let response = null;

    try {
      response = await fetch(domainHashServiceEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: uncachedDomains }),
        signal: controller.signal
      });
    } catch (error) {
      if (strict) {
        throw new Error(`Failed to reach domain hash service: ${error.message}`);
      }
      console.warn("Domain hash service request failed:", error);
      return new Map(
        canonicalDomains
          .filter((domain) => domainHashCache.has(domain))
          .map((domain) => [domain, domainHashCache.get(domain)])
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Domain hash service responded ${response.status}: ${text}`);
    }

    const payload = await response.json();
    const hashes = Array.isArray(payload?.hashes) ? payload.hashes : [];

    hashes.forEach((entry) => {
      const domain = canonicalizeDomain(entry?.domain);
      const domainHash = String(entry?.domainHash || "").trim().toLowerCase();
      if (!domain || !isHexDomainHash(domainHash, [64])) return;
      domainHashCache.set(domain, domainHash);
    });
  }

  const result = new Map();
  canonicalDomains.forEach((domain) => {
    const hash = domainHashCache.get(domain);
    if (hash) {
      result.set(domain, hash);
    }
  });

  if (strict) {
    const missing = canonicalDomains.filter((domain) => !result.has(domain));
    if (missing.length) {
      throw new Error(`Domain hash service did not return hashes for ${missing.length} domain(s).`);
    }
  }

  return result;
}

// Opens the popup.html when the extension icon is clicked
(ext.action || ext.browserAction).onClicked.addListener(() => {
  ext.tabs.create({
    url: ext.runtime.getURL("popup_welcome.html")
  });
});

// Cross-browser executeScript wrapper for MV3
// DEPRECATED - ONLY FOR USE IN DEBUGGING
async function executeScriptWrapper(tabId, details) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return chrome.scripting.executeScript({
      target: { tabId },
      // Expects details.code as a string
      func: new Function(details.code)  // wrap string into a function
    });
  } else if (ext.tabs && ext.tabs.executeScript) {
    // Firefox
    return ext.tabs.executeScript(tabId, { code: details.code });
  } else {
    console.error("No compatible executeScript API available");
  }
}


// Fetch all domains the user has directly visited
// async function getVisitedDomains() {
//   // Check if we have a recent cache (less than 1 hour old)
//   const cacheAge = Date.now() - visitedDomainsCacheLastUpdated;
//   if (visitedDomainsCacheLastUpdated > 0 && cacheAge < 3600000 && visitedDomainsCache.size > 0) {
//     console.log(`Using cached visited domains (${visitedDomainsCache.size} domains, cache age: ${Math.round(cacheAge / 60000)} minutes)`);
//     return Array.from(visitedDomainsCache);
//   }

//   return new Promise((resolve) => {
//     // Get history for past year (or adjust as needed)
//     const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);

//     ext.history.search({
//       text: '',
//       startTime: oneYearAgo,
//       maxResults: 10000  // Get a large number of history entries
//     }, (historyItems) => {
//       // Clear and rebuild the cache
//       visitedDomainsCache.clear();

//       historyItems.forEach(item => {
//         try {
//           const url = new URL(item.url);
//           // Store domain in various formats for better matching
//           const domain = url.hostname.toLowerCase();
//           visitedDomainsCache.add(domain);

//           // Also add domain without 'www.' if it exists
//           if (domain.startsWith('www.')) {
//             visitedDomainsCache.add(domain.substring(4));
//           } else {
//             // Also add with 'www.' prefix
//             visitedDomainsCache.add(`www.${domain}`);
//           }

//           // Add with leading dot for subdomain matching
//           visitedDomainsCache.add(`.${domain}`);

//           // Add root domain
//           const parts = domain.split('.');
//           if (parts.length >= 2) {
//             const rootDomain = parts.slice(-2).join('.');
//             visitedDomainsCache.add(rootDomain);
//             visitedDomainsCache.add(`.${rootDomain}`);
//           }
//         } catch (e) {
//           // Skip invalid URLs
//         }
//       });

//       // Update cache timestamp
//       visitedDomainsCacheLastUpdated = Date.now();
//       console.log(`Built visited domains cache with ${visitedDomainsCache.size} entries`);
//       resolve(Array.from(visitedDomainsCache));
//     });
//   });
// }

// Fetch all domains the user has directly visited (handles >10k entries)
async function getVisitedDomains() {
  // Use cache if it's less than 1 hour old
  const cacheAge = Date.now() - visitedDomainsCacheLastUpdated;
  if (visitedDomainsCacheLastUpdated > 0 && cacheAge < 3600000 && visitedDomainsCache.size > 0) {
    console.log(`Using cached visited domains (${visitedDomainsCache.size} domains, cache age: ${Math.round(cacheAge / 60000)} minutes)`);
    return Array.from(visitedDomainsCache);
  }

  visitedDomainsCache.clear();
  const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
  let endTime = Date.now();
  const windowMs = 30 * 24 * 60 * 60 * 1000; // 30-day windows

  while (endTime > oneYearAgo) {
    const startTime = Math.max(oneYearAgo, endTime - windowMs);

    const historyItems = await new Promise((resolve) => {
      ext.history.search({
        text: '',
        startTime,
        endTime,
        maxResults: 60000
      }, resolve);
    });

    historyItems.forEach(item => {
      try {
        const url = new URL(item.url);
        const domain = url.hostname.toLowerCase();

        visitedDomainsCache.add(domain);

        if (domain.startsWith('www.')) {
          visitedDomainsCache.add(domain.substring(4));
        } else {
          visitedDomainsCache.add(`www.${domain}`);
        }

        visitedDomainsCache.add(`.${domain}`);

        const parts = domain.split('.');
        if (parts.length >= 2) {
          const rootDomain = parts.slice(-2).join('.');
          visitedDomainsCache.add(rootDomain);
          visitedDomainsCache.add(`.${rootDomain}`);
        }
      } catch (e) {
        // Skip invalid URLs
      }
    });

    endTime = startTime - 1; // move to previous window
  }

  visitedDomainsCacheLastUpdated = Date.now();
  console.log(`Built visited domains cache with ${visitedDomainsCache.size} entries`);
  let visitedDomainsCacheArr = Array.from(visitedDomainsCache);

  ext.runtime.sendMessage({
    type: 'visitedDomainsCount',
    count: visitedDomainsCacheArr.length,
  });

  return visitedDomainsCacheArr;
}

// Check if a cookie domain matches any visited domain
function isVisitedDomain(cookieDomain, visitedDomains) {
  cookieDomain = standardizeDomain(cookieDomain);

  // Direct match check
  if (visitedDomains.includes(cookieDomain)) {
    return true;
  }

  // Check for subdomain relationships
  return visitedDomains.some(visitedDomain => {
    visitedDomain = standardizeDomain(visitedDomain);
    return cookieDomain.endsWith(`.${visitedDomain}`) ||
      visitedDomain.endsWith(`.${cookieDomain}`);
  });
}

// Fetch all browsing history for a specific cookie domain
function getAllHistoryForDomain(cookieDomain, callback) {
  fetchPaginatedHistory(cookieDomain, callback);
}

// Recursive function to fetch paginated history for a domain
function fetchPaginatedHistory(cookieDomain, callback) {
  if (historyCache[cookieDomain]) {
    callback(historyCache[cookieDomain]);
    return;
  }

  let totalVisitCount = 0;
  let dailyVisitMap = new Map();
  let uniqueDates = new Set();
  let allVisits = [];
  let processedVisitIds = new Set();

  let lastEndTime = Date.now();
  let previousEndTime = null;
  let fetchAttempts = 0;
  const MAX_FETCH_ATTEMPTS = 5;

  function fetchNextBatch() {
    if (fetchAttempts >= MAX_FETCH_ATTEMPTS) {
      finalizeHistory();
      return;
    }
    fetchAttempts++;

    ext.history.search(
      { text: '', startTime: 0, endTime: lastEndTime, maxResults: 5000 },
      (results) => {
        if (ext.runtime.lastError) {
          finalizeHistory();
          return;
        }

        if (results.length === 0 || lastEndTime === previousEndTime) {
          finalizeHistory();
          return;
        }

        previousEndTime = lastEndTime;

        // Filter relevant URLs for the domain
        let meaningfulVisits = results.filter(item => {
          try {
            const url = new URL(item.url);
            return domainMatch(url.hostname, cookieDomain);
          } catch {
            return false;
          }
        }).map(item => ({ url: item.url, lastVisitTime: item.lastVisitTime }));

        if (meaningfulVisits.length === 0) {
          finalizeHistory();
          return;
        }

        // Process visits in parallel
        Promise.all(
          meaningfulVisits.map(item =>
            new Promise(resolve => {
              ext.history.getVisits({ url: item.url }, visits => {
                if (ext.runtime.lastError) {
                  resolve();
                  return;
                }

                visits
                  .filter(v => !['auto_redirect', 'auto_subframe', 'reload'].includes(v.transition))
                  .forEach(v => {
                    if (!processedVisitIds.has(v.visitId)) {
                      processedVisitIds.add(v.visitId);
                      allVisits.push(v.visitTime);
                      totalVisitCount++;

                      const dateKey = new Date(v.visitTime).toISOString().slice(0, 10);
                      dailyVisitMap.set(dateKey, (dailyVisitMap.get(dateKey) || 0) + 1);
                      uniqueDates.add(dateKey);
                    }
                  });

                resolve();
              });
            })
          )
        ).then(() => {
          lastEndTime = Math.min(...meaningfulVisits.map(v => v.lastVisitTime)) - 1;
          fetchNextBatch();
        }).catch(() => finalizeHistory());
      }
    );
  }

  function finalizeHistory() {
    const avgDailyVisits = dailyVisitMap.size
      ? Math.round((totalVisitCount / dailyVisitMap.size) * 10) / 10
      : 0;

    const historyData = {
      firstVisited: allVisits.length > 0 ? Math.min(...allVisits) : null,
      lastVisited: allVisits.length > 0 ? Math.max(...allVisits) : null,
      totalVisitCount,
      avgDailyVisits,
      daysVisited: dailyVisitMap.size,
      visitedDates: Array.from(uniqueDates).sort(),
    };

    historyCache[cookieDomain] = historyData;
    callback(historyData);
  }

  fetchNextBatch();
}

// Standardize domain by removing leading dots and converting to lowercase
function standardizeDomain(domain) {
  if (!domain) return '';
  return domain.replace(/^\.+/, '').toLowerCase();
}

// Improved domain matching for better history correlation
function domainMatch(historyDomain, cookieDomain) {
  // First standardize both domains
  historyDomain = standardizeDomain(historyDomain);
  cookieDomain = standardizeDomain(cookieDomain);

  // Remove 'www.' from both for better matching
  const historyDomainNoWWW = historyDomain.replace(/^www\./, '');
  const cookieDomainNoWWW = cookieDomain.replace(/^www\./, '');

  // Check for exact match
  if (historyDomain === cookieDomain || historyDomainNoWWW === cookieDomainNoWWW) {
    return true;
  }

  // Check for subdomain relationships
  return historyDomain.endsWith(`.${cookieDomain}`) ||
    historyDomainNoWWW.endsWith(`.${cookieDomainNoWWW}`) ||
    cookieDomain.endsWith(`.${historyDomain}`) ||
    cookieDomainNoWWW.endsWith(`.${historyDomainNoWWW}`);
}

function historySearchAsync(query) {
  return new Promise((resolve) => {
    ext.history.search(query, (results) => {
      if (ext.runtime.lastError) {
        console.error("History search error:", ext.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(Array.isArray(results) ? results : []);
    });
  });
}

function historyGetVisitsAsync(url) {
  return new Promise((resolve) => {
    ext.history.getVisits({ url }, (visits) => {
      if (ext.runtime.lastError) {
        console.error(`History getVisits error for ${url}:`, ext.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(Array.isArray(visits) ? visits : []);
    });
  });
}

function getPreferenceVariants(domain) {
  const standardized = standardizeDomain(domain);
  if (!standardized) return [];

  const variants = new Set([standardized]);
  variants.add(`.${standardized}`);

  if (standardized.startsWith("www.")) {
    const withoutWww = standardized.slice(4);
    variants.add(withoutWww);
    variants.add(`.${withoutWww}`);
  } else {
    variants.add(`www.${standardized}`);
    variants.add(`.www.${standardized}`);
  }

  return Array.from(variants);
}

function findDomainPreferences(domain, prefsMap) {
  const variants = getPreferenceVariants(domain);
  for (const key of variants) {
    if (prefsMap.has(key)) return prefsMap.get(key);
  }
  return null;
}

function findCookieMetadataForDomain(domain, cookies) {
  const variants = new Set(getPreferenceVariants(domain));
  for (const cookie of cookies) {
    const cookieDomain = standardizeDomain(cookie?.domain);
    if (!cookieDomain) continue;

    if (variants.has(cookieDomain) || variants.has(`.${cookieDomain}`)) {
      return cookie;
    }
  }
  return null;
}

async function getBrowsingHistoryData(forceRefresh = false) {
  const cacheAge = Date.now() - browsingHistoryDataCacheLastUpdated;
  if (!forceRefresh && browsingHistoryDataCache && browsingHistoryDataCacheLastUpdated > 0 && cacheAge < 3600000) {
    console.log(`Using cached browsingHistoryData (${browsingHistoryDataCache.length} domains, age ${Math.round(cacheAge / 60000)}m)`);
    return browsingHistoryDataCache;
  }

  const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
  const maxResultsPerBatch = 5000;
  const maxFetchAttempts = 30;
  const historyItemsByUrl = new Map();
  let endTime = Date.now();
  let previousEndTime = null;
  let fetchAttempts = 0;

  while (fetchAttempts < maxFetchAttempts) {
    fetchAttempts += 1;
    const results = await historySearchAsync({
      text: "",
      startTime: oneYearAgo,
      endTime,
      maxResults: maxResultsPerBatch
    });

    if (!results.length || endTime === previousEndTime) {
      break;
    }

    results.forEach((item) => {
      if (item?.url) {
        historyItemsByUrl.set(item.url, item);
      }
    });

    const timestamps = results
      .map((item) => item?.lastVisitTime)
      .filter((value) => typeof value === "number");
    if (!timestamps.length) {
      break;
    }

    previousEndTime = endTime;
    endTime = Math.min(...timestamps) - 1;
    if (endTime <= oneYearAgo) {
      break;
    }
  }

  const domainStats = new Map();

  for (const url of historyItemsByUrl.keys()) {
    let canonicalDomain = "";
    try {
      const parsedUrl = new URL(url);
      canonicalDomain = canonicalizeDomain(parsedUrl.hostname);
    } catch (_error) {
      continue;
    }
    if (!canonicalDomain) continue;

    const visits = await historyGetVisitsAsync(url);
    const relevantVisits = visits.filter((visit) =>
      typeof visit?.visitTime === "number" &&
      visit.visitTime >= oneYearAgo &&
      !["auto_redirect", "auto_subframe", "reload"].includes(visit.transition)
    );
    if (!relevantVisits.length) continue;

    if (!domainStats.has(canonicalDomain)) {
      domainStats.set(canonicalDomain, {
        numberOfVisits: 0,
        datesSet: new Set()
      });
    }

    const stats = domainStats.get(canonicalDomain);
    relevantVisits.forEach((visit) => {
      stats.numberOfVisits += 1;
      const date = new Date(visit.visitTime);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      stats.datesSet.add(`${date.getFullYear()}-${month}-${day}`);
    });
  }

  const rankMap = await getTop1mDomainRankMap();
  const domains = Array.from(domainStats.keys());
  const hashMap = await hashDomains(domains, { strict: true });
  const browsingHistoryData = Array.from(domainStats.entries()).map(([domain, stats]) => ({
    domainHash: hashMap.get(domain) || null,
    domainRankRange: rankMap.get(domain) || "100000+",
    numberOfVisits: stats.numberOfVisits,
    dates: Array.from(stats.datesSet).sort()
  }));

  browsingHistoryData.sort((a, b) => (b.numberOfVisits || 0) - (a.numberOfVisits || 0));
  browsingHistoryDataCache = browsingHistoryData;
  browsingHistoryDataCacheLastUpdated = Date.now();
  console.log(`Built browsingHistoryData for ${browsingHistoryData.length} domains`);

  return browsingHistoryData;
}

// Send message to content script to run the DOM-checker when a tab finishes loading.
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    ext.tabs.sendMessage(tabId, { action: "runSurveyElementCheck" })
      .catch(err => {
        console.log(`Could not message content script on tab ${tabId}: ${err && err.message ? err.message : err}`);
      });
  }
});

async function getCookieData() {
  const result = await ext.storage.local.get("cookieData");
  return result.cookieData || [];
}

// Listen for messages from the popup.js or content.js
ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCookieData") {
    getCookieData().then(sendResponse);
    return true;
  } else if (request.action === 'checkCookies') {
    console.log(`[pricrumbs] checkCookies`);

    const cookieNames = request.cookieNames || [];
    const cookieNameSet = new Set(cookieNames);
    const cookiePatterns = request.cookiePatterns || [];
    const compiledPatterns = cookiePatterns.map(p => new RegExp(p));

    // Step 1: get visited domains
    getVisitedDomains()
      .then(visitedDomains => {
        console.log(`Found ${visitedDomains.length} visited domains in history`);
        return ext.cookies.getAll({}).then(cookies => ({ cookies, visitedDomains }));
      })
      .then(({ cookies, visitedDomains }) => {
        console.log(`Total cookies retrieved: ${cookies.length}`);

        // Step 2: filter cookies by name and visited domains
        const filteredCookies = cookies.filter(cookie => {
          const nameMatch =
            cookieNameSet.has(cookie.name) ||
            compiledPatterns.some(regex => regex.test(cookie.name));
          return nameMatch && isVisitedDomain(cookie.domain, visitedDomains);
        });
        console.log(`Filtered to ${filteredCookies.length} cookies from visited domains`);

        ext.runtime.sendMessage({
          type: 'supportedVisitedDomainsCount',
          count: filteredCookies.length
        });

        // Step 3: extract unique domains
        const uniqueDomains = [...new Set(filteredCookies.map(c => c.domain))];

        // Step 4: fetch domain histories
        const domainHistoryPromises = uniqueDomains.map(domain =>
          new Promise(resolve => {
            if (historyCache[domain]) {
              resolve(historyCache[domain]);
              return;
            }

            let resolved = false;
            getAllHistoryForDomain(domain, historyData => {
              if (!resolved) {
                resolved = true;
                const safeData = {
                  firstVisited: historyData.firstVisited ?? null,
                  lastVisited: historyData.lastVisited ?? null,
                  totalVisitCount: historyData.totalVisitCount ?? 0,
                  avgDailyVisits: historyData.avgDailyVisits ?? 0,
                  visitedDates: Array.isArray(historyData.visitedDates) ? historyData.visitedDates : []
                };
                historyCache[domain] = safeData;
                resolve(safeData);
              }
            });

            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                console.warn(`Timeout fetching history for ${domain}, using defaults.`);
                const defaultData = {
                  firstVisited: null,
                  lastVisited: null,
                  totalVisitCount: 0,
                  avgDailyVisits: 0,
                  visitedDates: []
                };
                historyCache[domain] = defaultData;
                resolve(defaultData);
              }
            }, 60000);
          })
        );

        return Promise.all(domainHistoryPromises).then(histories => ({ filteredCookies, uniqueDomains, histories }));
      })
      .then(({ filteredCookies, uniqueDomains, histories }) => {
        // Step 5: build history map
        const historyMap = {};
        uniqueDomains.forEach((domain, i) => {
          historyMap[domain] = histories[i];
        });

        // Step 6: merge history into cookies
        const cookiesWithHistory = filteredCookies.map(cookie => ({
          ...cookie,
          ...historyMap[cookie.domain]
        }));

        return cookiesWithHistory;
      })
      .then(cookiesWithHistory => {
        // Step 7: get rank and hash maps
        return Promise.all([getTop1mDomainRankMap(), hashDomains(
          Array.from(new Set(
            cookiesWithHistory.map(c => canonicalizeDomain(c.domain)).filter(Boolean)
          )),
          { strict: true }
        )]).then(([rankMap, hashMap]) => ({ cookiesWithHistory, rankMap, hashMap }));
      })
      .then(({ cookiesWithHistory, rankMap, hashMap }) => {
        // Step 8: merge metadata
        const cookiesWithMetadata = cookiesWithHistory.map(cookie => {
          const canonicalDomain = canonicalizeDomain(cookie.domain);
          return {
            ...cookie,
            domainRankRange: canonicalDomain ? (rankMap.get(canonicalDomain) || "100000+") : null,
            domainHash: canonicalDomain ? (hashMap.get(canonicalDomain) || null) : null
          };
        });

        console.log("Cookies with history and metadata ready, sending response...");
        sendResponse({ cookies: cookiesWithMetadata });
      })
      .catch(err => {
        console.error("Error in checkCookies flow:", err);
        sendResponse({ cookies: [] });
      });

    return true; // keep the message channel open
  }

  if (request.payload?.action === "fetchAllCookies" || request.action === 'fetchAllCookies') {
    // Fetch all cookies
    ext.cookies.getAll({})
      .then((cookies) => {
        console.log("Sending cookies response:", cookies);
        sendResponse({ cookies });
      })
      .catch((err) => {
        console.error("Error fetching cookies:", err);
        sendResponse({ cookies: [] });
      });
    return true; // Keep the message channel open
  }

  if (request.payload?.action === "injectHTML") {
    const tabId = sender.tab ? sender.tab.id : request.tabId;

    if (!request.payload.html) {
      console.error("No html file provided");
      sendResponse({ success: false, error: "No html file provided" });
      return true;
    }
    if (!tabId) {
      console.error("Invalid tabID");
      sendResponse({ success: false, error: "Invalid tabID" });
      return true;
    }

    // Prefer explicit elementId from content script; fallback to html filename.
    let elementId = request.payload.elementId || request.payload.html.slice(0, -5);
    let height = request.payload.height ? request.payload.height : "600px";

    if (height === "0px") {
      elementId = "pricrumbs_popup_hidden";
    }

    // Send message to content script to inject the iframe
    ext.tabs.sendMessage(tabId, {
      action: "injectHTML",
      elementId,
      htmlFile: request.payload.html,
      height
    })
      .then(() => {
        console.log(`Sent injectHTML command for ${request.payload.html} to tab ${tabId}`);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Error sending injectHTML to content script:", error);
        sendResponse({ success: false, error });
      });

    return true; // Keep channel open for async response
  }

  if (request.action === "getBrowsingHistoryData") {
    getBrowsingHistoryData(Boolean(request.forceRefresh))
      .then((browsingHistoryData) => {
        sendResponse({ browsingHistoryData });
      })
      .catch((error) => {
        console.error("Failed to build browsingHistoryData:", error);
        sendResponse({ browsingHistoryData: [] });
      });
    return true;
  }

  if (request.action === "getConsentChoices") {
    (async () => {
      try {
        const category = request.category || request.payload?.category || null;
        const result = await ext.storage.local.get([
          "selectedDomainsForHistory",
          "userCookiePreferences",
          "cookieData"
        ]);

        const selectedDomains = Array.isArray(result.selectedDomainsForHistory)
          ? result.selectedDomainsForHistory
          : [];
        const userPreferences = Array.isArray(result.userCookiePreferences)
          ? result.userCookiePreferences
          : [];
        const cookieData = Array.isArray(result.cookieData) ? result.cookieData : [];
        const rankMap = await getTop1mDomainRankMap();
        const prefsMap = new Map(userPreferences);

        const canonicalDomains = Array.from(
          new Set(
            selectedDomains
              .map((domainObj) => canonicalizeDomain(domainObj?.originalDomain || domainObj?.domain || ""))
              .filter(Boolean)
          )
        );
        const hashMap = await hashDomains(canonicalDomains, { strict: true });

        const records = selectedDomains.map((domainObj) => {
          const rawDomain = domainObj?.originalDomain || domainObj?.domain || "";
          const canonicalDomain = canonicalizeDomain(rawDomain);
          if (!canonicalDomain) return null;

          const prefs = findDomainPreferences(rawDomain, prefsMap) || {};
          const matchedCookie = findCookieMetadataForDomain(rawDomain, cookieData);
          const domainHash = hashMap.get(canonicalDomain) || null;

          return {
            domainHash: domainHash || matchedCookie?.domainHash || null,
            trancoRank: rankMap.get(canonicalDomain) || matchedCookie?.domainRankRange || "100000+",
            functional: prefs.functional ?? null,
            performance: prefs.performance ?? null,
            advertising: prefs.advertising ?? null
          };
        });

        sendResponse({
          category,
          choices: records.filter(Boolean)
        });
      } catch (error) {
        console.error("Failed to build consent choices payload:", error);
        sendResponse({
          category: request.category || request.payload?.category || null,
          choices: [],
          error: error.message
        });
      }
    })();

    return true;
  }

  if (request.action === "resetStudyData" || request.payload?.action === "resetStudyData") {
    (async () => {
      try {
        await ext.storage.local.remove([
          "userCookiePreferences",
          "selectedDomainsForHistory",
          "consentDomainData",
          "browsingHistoryData",
          "cookieData",
          "hasDiscrepancies",
          "hasDiscrepanciesCheckedAt",
          "participantId"
        ]);

        visitedDomainsCache.clear();
        visitedDomainsCacheLastUpdated = 0;
        domainHashCache.clear();
        browsingHistoryDataCache = null;
        browsingHistoryDataCacheLastUpdated = 0;

        Object.keys(historyCache).forEach((key) => {
          delete historyCache[key];
        });

        sendResponse({ ok: true });
      } catch (error) {
        console.error("Failed to reset study data:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.payload?.action === "autoUninstallExtension" || request.action === "autoUninstallExtension") {
    console.log("Background script automatic uninstallation triggered by event payload.");

    if (!ext.management || !ext.management.uninstallSelf) {
      console.warn("Uninstall not supported");
      sendResponse({ success: false, fallback: true, error: "management.uninstallSelf unavailable" });
      return false;
    }

    // Support both Chrome callback-style and Firefox Promise-style uninstallSelf.
    try {
      ext.management.uninstallSelf({ showConfirmDialog: true }, () => {
        if (ext.runtime.lastError) {
          console.error("Error uninstalling:", ext.runtime.lastError);
          sendResponse({ success: false, error: ext.runtime.lastError.message });
        } else {
          console.log("Extension uninstalled successfully.");
          sendResponse({ success: true });
        }
      });
      return true;
    } catch (_callbackStyleError) {
      try {
        const maybePromise = ext.management.uninstallSelf({ showConfirmDialog: true });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise
            .then(() => {
              console.log("Extension uninstall request completed.");
              sendResponse({ success: true });
            })
            .catch((error) => {
              const message = error?.message || String(error);
              console.error("Error uninstalling:", error);
              sendResponse({ success: false, error: message });
            });
          return true;
        }
      } catch (promiseStyleError) {
        const message = promiseStyleError?.message || String(promiseStyleError);
        console.error("Error uninstalling:", promiseStyleError);
        sendResponse({ success: false, error: message });
        return false;
      }
    }
  }

});

// Store cookies in ext.storage.local when they're fetched
function storeCookiesInStorage(cookies) {
  // Log visit counts before saving to storage
  console.log('Saving cookies to storage with visit counts:',
    cookies.map(c => `${c.domain}: ${c.totalVisitCount}`));

  // Only call ext.storage.local.set once
  ext.storage.local.set({ 'cookieData': cookies }, function () {
    if (ext.runtime.lastError) {
      console.error('Error saving cookies:', ext.runtime.lastError);
    } else {
      console.log('Cookies saved to storage successfully');

      // Verify storage by retrieving it
      ext.storage.local.get('cookieData', function (result) {
        if (ext.runtime.lastError) {
          console.error('Error verifying storage:', ext.runtime.lastError);
        } else if (result.cookieData) {
          console.log('Verified storage - visit counts:',
            result.cookieData.map(c => `${c.domain}: ${c.totalVisitCount}`));
        }
      });
    }
  });
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_FAVICON") {

    const domain = msg.domain;

    // 1. Try open tabs
    ext.tabs.query({}, async (tabs) => {
      const tab = tabs.find(t => t.url && t.url.includes(domain));
      if (tab?.favIconUrl) {
        sendResponse({ favicon: tab.favIconUrl });
        return;
      }

      // 2. Fetch HTML and parse <link rel="icon">
      try {
        const response = await fetch(`https://${domain}`);
        const html = await response.text();
        const match = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/i);
        if (match) {
          const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
          if (hrefMatch) {
            let url = hrefMatch[1];
            if (!url.startsWith('http')) {
              url = `https://${domain}${url.startsWith('/') ? '' : '/'}${url}`;
            }
            sendResponse({ favicon: url });
            return;
          }
        }
      } catch (e) {
        // Ignore fetch errors
      }

      // 3. Fallback to standard /favicon.ico
      sendResponse({ favicon: `https://${domain}/favicon.ico` });
    });

    return true; // Indicates async response
  }

  if (msg.type === "STORAGE_GET") {

    ext.storage.local.get(msg.key).then(data => {
      sendResponse(data);
    });

    return true;
  }

  if (msg.type === "STORAGE_SET") {

    ext.storage.local.set(msg.data).then(() => {
      sendResponse(true);
    });

    return true;
  }

  if (msg.type === "OPEN_TAB") {

    ext.tabs.create(msg.options).then(tab => {
      sendResponse(tab);
    });

    return true;
  }

  if (msg.type === "CLOSE_TAB") {

    ext.tabs.remove(msg.tabId).then(() => {
      sendResponse(true);
    });

    return true;
  }

});


ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "GET_FAVICON") return;


});