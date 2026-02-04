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
async function getVisitedDomains() {
  // Check if we have a recent cache (less than 1 hour old)
  const cacheAge = Date.now() - visitedDomainsCacheLastUpdated;
  if (visitedDomainsCacheLastUpdated > 0 && cacheAge < 3600000 && visitedDomainsCache.size > 0) {
    console.log(`Using cached visited domains (${visitedDomainsCache.size} domains, cache age: ${Math.round(cacheAge / 60000)} minutes)`);
    return Array.from(visitedDomainsCache);
  }

  return new Promise((resolve) => {
    // Get history for past year (or adjust as needed)
    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);

    ext.history.search({
      text: '',
      startTime: oneYearAgo,
      maxResults: 10000  // Get a large number of history entries
    }, (historyItems) => {
      // Clear and rebuild the cache
      visitedDomainsCache.clear();

      historyItems.forEach(item => {
        try {
          const url = new URL(item.url);
          // Store domain in various formats for better matching
          const domain = url.hostname.toLowerCase();
          visitedDomainsCache.add(domain);

          // Also add domain without 'www.' if it exists
          if (domain.startsWith('www.')) {
            visitedDomainsCache.add(domain.substring(4));
          } else {
            // Also add with 'www.' prefix
            visitedDomainsCache.add(`www.${domain}`);
          }

          // Add with leading dot for subdomain matching
          visitedDomainsCache.add(`.${domain}`);

          // Add root domain
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

      // Update cache timestamp
      visitedDomainsCacheLastUpdated = Date.now();
      console.log(`Built visited domains cache with ${visitedDomainsCache.size} entries`);
      resolve(Array.from(visitedDomainsCache));
    });
  });
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
  // Check if we already have cached data
  if (historyCache[cookieDomain]) {
    console.log(`Cache hit for ${cookieDomain}, returning cached history.`);
    callback(historyCache[cookieDomain]); // Return cached result immediately
    return;
  }

  let allVisits = [];
  let totalVisitCount = 0;
  let dailyVisitMap = new Map();
  let lastEndTime = Date.now();
  let previousEndTime = null;
  let fetchAttempts = 0; // Track the number of fetch attempts
  const MAX_FETCH_ATTEMPTS = 5; // Limit fetch attempts prevent infinite loops

  // Add a Set to track unique visit IDs to prevent duplicate counting
  const processedVisitIds = new Set();

  // Fetch history data in batches until all history is found, max attempts reached,
  // or no new data is found (to avoid infinite loops)
  function fetchNextBatch() {
    // Return if max fetch attempts have been reached for this cookie domain
    if (fetchAttempts >= MAX_FETCH_ATTEMPTS) {
      console.warn(`Max fetch attempts reached for ${cookieDomain}.`);
      finalizeHistory();
      return;
    }
    fetchAttempts++;

    ext.history.search(
      { text: '', startTime: 0, endTime: lastEndTime, maxResults: 5000 },
      (results) => {
        if (ext.runtime.lastError) {
          console.error("History API error:", ext.runtime.lastError);
          finalizeHistory();
          return;
        }

        // Stop fetching if no new results were found or the last fetched timestamp
        // hasn't changed (to prevent infinite loops).
        if (results.length === 0 || lastEndTime === previousEndTime) {
          finalizeHistory();
          return;
        }

        // Update to track timestamps (ensuring new data is found every loop)
        previousEndTime = lastEndTime;

        let meaningfulVisits = [];
        results.forEach(item => {
          try {
            const url = new URL(item.url);
            if (domainMatch(url.hostname, cookieDomain)) {
              // Debug log to see which URLs are being counted
              console.log(`Found matching URL for ${cookieDomain}: ${item.url}`);
              meaningfulVisits.push({ url: item.url, lastVisitTime: item.lastVisitTime });
            }
          } catch (error) {
            console.error(`Error processing URL: ${error.message}`);
          }
        });

        // If no meaningful visits were found, stop early
        if (meaningfulVisits.length === 0) {
          finalizeHistory();
          return;
        }

        // Process each meaningful visit
        Promise.all(
          meaningfulVisits.map(item =>
            new Promise(resolve => {
              ext.history.getVisits({ url: item.url }, visits => {
                if (ext.runtime.lastError) {
                  console.error("Error fetching visit details:", ext.runtime.lastError);
                  resolve();
                  return;
                }

                // Filter valid transitions (ignore redirects & reloads)
                const validVisits = visits.filter(visit =>
                  !['auto_redirect', 'auto_subframe', 'reload'].includes(visit.transition)
                );

                validVisits.forEach(visit => {
                  // Only process each visit once using the visit ID
                  if (!processedVisitIds.has(visit.visitId)) {
                    processedVisitIds.add(visit.visitId);

                    allVisits.push(visit.visitTime);
                    totalVisitCount++;

                    const visitDate = new Date(visit.visitTime);
                    const dateKey = `${visitDate.getFullYear()}-${visitDate.getMonth() + 1}-${visitDate.getDate()}`;
                    dailyVisitMap.set(dateKey, (dailyVisitMap.get(dateKey) || 0) + 1);

                    // Debug logging
                    console.log(`Counting visit ID ${visit.visitId} for ${item.url} (total: ${totalVisitCount})`);
                  } else {
                    console.log(`Skipping already counted visit ID ${visit.visitId} for ${item.url}`);
                  }
                });

                resolve();
              });
            })
          )
        ).then(() => {
          // Update `lastEndTime` and continue fetching if necessary
          if (meaningfulVisits.length > 0) {
            lastEndTime = Math.min(...meaningfulVisits.map(v => v.lastVisitTime)) - 1;
            fetchNextBatch();
          } else {
            finalizeHistory();
          }
        }).catch(error => {
          console.error("Error processing visits:", error);
          finalizeHistory();
        });
      }
    );
  }

  // Get finalized history data and cache it, preventing infinite recursion
  function finalizeHistory() {
    let dailyVisitCounts = Array.from(dailyVisitMap.values());
    let avgDailyVisits = dailyVisitCounts.length > 0
      ? Math.round((dailyVisitCounts.reduce((sum, count) => sum + count, 0) / dailyVisitCounts.length) * 10) / 10
      : 0;

    console.log(`Domain ${cookieDomain} final counts: ${totalVisitCount} visits across ${dailyVisitMap.size} days`);
    console.log(`Processed ${processedVisitIds.size} unique visit IDs`);

    // Use more descriptive values for domains with no history
    const historyData = {
      firstVisited: allVisits.length > 0 ? Math.min(...allVisits) : null,
      lastVisited: allVisits.length > 0 ? Math.max(...allVisits) : null,
      totalVisitCount: totalVisitCount,
      avgDailyVisits: avgDailyVisits,
      daysVisited: dailyVisitMap.size,
    };

    // Store in cache
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

// Send message to content script to run the DOM-checker when a tab finishes loading.
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    ext.tabs.sendMessage(tabId, { action: "runSurveyElementCheck" })
      .catch(err => {
        console.log(`Could not message content script on tab ${tabId}: ${err && err.message ? err.message : err}`);
      });
  }
});

// Listen for messages from the popup.js or content.js
ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCookies') {
    console.log("Received request to check cookies.");

    const cookieNames = request.cookieNames;
    // Get patterns from request or default to empty array
    const cookiePatterns = request.cookiePatterns || [];
    // Convert string patterns to regex objects
    const compiledPatterns = cookiePatterns.map(p => new RegExp(p));

    // First get all domains the user has visited directly
    getVisitedDomains()
      .then((visitedDomains) => {
        console.log(`Found ${visitedDomains.length} visited domains in history`);

        // Use promise API for cookies.getAll
        return ext.cookies.getAll({}).then((cookies) => ({ cookies, visitedDomains }));
      })
      .then(({ cookies, visitedDomains }) => {

        console.log(`Total cookies retrieved: ${cookies.length}`);

        // Filter cookies by both name AND visited domains
        const filteredCookies = cookies.filter(cookie => {
          // First check if it's a consent cookie we're interested in
          // via exact names or patterns
          const nameMatch = cookieNames.includes(cookie.name) || compiledPatterns.some(regex => regex.test(cookie.name));

          if (!nameMatch) {
            return false;
          }

          // Then check if it's from a domain the user has actually visited
          return isVisitedDomain(cookie.domain, visitedDomains);
        });

        console.log(`Filtered to ${filteredCookies.length} cookies from visited domains`);

        // Add domain history to cookies
        const domainPromises = filteredCookies.map(cookie => {
          return new Promise((resolve) => {
            // If cache already contains history for domain, use that data instead of fetching it again
            if (historyCache[cookie.domain]) {
              resolve({
                ...cookie,
                ...historyCache[cookie.domain] // Merge cached history data
              });
              return;
            }

            let resolved = false;

            getAllHistoryForDomain(cookie.domain, (historyData) => {
              if (!resolved) {
                resolved = true;
                historyCache[cookie.domain] = historyData; // Store in cache
                resolve({
                  ...cookie,
                  firstVisited: historyData.firstVisited ?? null,
                  lastVisited: historyData.lastVisited ?? null,
                  totalVisitCount: historyData.totalVisitCount ?? 0,
                  avgDailyVisits: historyData.avgDailyVisits ?? 0
                });
              }
            });

            // Timeout if no response received in 10 seconds
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                console.warn(`Timeout fetching history for ${cookie.domain}, resolving with defaults.`);
                resolve({
                  ...cookie, // Retain original cookie data in case of timeout
                  firstVisited: null,
                  lastVisited: null,
                  totalVisitCount: 0,
                  avgDailyVisits: 0
                });
              }
            }, 10000);
          });
        });

        return Promise.all(domainPromises);
      })
      .then((cookiesWithHistory) => {
        console.log("Promises resolved! Sending response with cookies...");
        sendResponse({ cookies: cookiesWithHistory });
      })
      .catch((err) => {
        console.error("Error in checkCookies flow:", err);
        sendResponse({ cookies: [] });
      });
    return true; // Keep the message channel open
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

    // Remove ".html" to get elementId
    let elementId = request.payload.html.slice(0, -5);
    let height = request.payload.height ? request.payload.height : "600px";

    if (height === "0px") {
      elementId = "popup_invisible";
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

  if (request.payload?.action == "autoUninstallExtension") {
    console.log("Background script automatic uninstallation triggered by event payload.");

    if (ext.management && ext.management.uninstallSelf) {
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
    } else if (typeof browser !== "undefined") {
      console.warn("Uninstall not supported");
      sendResponse({ success: false, fallback: true });
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