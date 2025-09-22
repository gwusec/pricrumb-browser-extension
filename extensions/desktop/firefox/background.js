// background.js

const historyCache = {}; // Cache to store history data per domain
const visitedDomainsCache = new Set(); // Cache to store domains the user has visited
let visitedDomainsCacheLastUpdated = 0; // Timestamp of last update to visitedDomainsCache

// Opens the popup.html when the extension icon is clicked
browser.browserAction.onClicked.addListener(() => {
  browser.tabs.create({ 
    url: browser.runtime.getURL('popup.html') 
  });
});

// Fetch all domains the user has directly visited
async function getVisitedDomains() {
  // Check if we have a recent cache (less than 1 hour old)
  const cacheAge = Date.now() - visitedDomainsCacheLastUpdated;
  if (visitedDomainsCacheLastUpdated > 0 && cacheAge < 3600000 && visitedDomainsCache.size > 0) {
    console.log(`Using cached visited domains (${visitedDomainsCache.size} domains, cache age: ${Math.round(cacheAge/60000)} minutes)`);
    return Array.from(visitedDomainsCache);
  }

  return new Promise((resolve) => {
    // Get history for past year (or adjust as needed)
    const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
    
    chrome.history.search({
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

      chrome.history.search(
          { text: '', startTime: 0, endTime: lastEndTime, maxResults: 5000 },
          (results) => {
              if (chrome.runtime.lastError) {
                  console.error("History API error:", chrome.runtime.lastError);
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
                          chrome.history.getVisits({ url: item.url }, visits => {
                              if (chrome.runtime.lastError) {
                                  console.error("Error fetching visit details:", chrome.runtime.lastError);
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

// Gives a way to inject html content from this extension into a webpage as an iframe
// elementID = ID of element where iframe should be injected into
// htmlFile = name of .html file
function injectHTML(elementId, htmlFile, height = "600px") {
      const targetElement = document.getElementById(elementId);
      if (targetElement) {
        const iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL(htmlFile);

        iframe.style.width = "100%";
        iframe.style.height = height;
        iframe.style.border = "none"; 

        targetElement.appendChild(iframe);
      } else {
        console.error("Error injecting iframe - Element not found:", elementId);
      }
}

// Listen for messages from the popup.js or content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCookies') {
    console.log("Received request to check cookies.");
    const cookieNames = request.cookieNames;

    // First get all domains the user has visited directly
    getVisitedDomains().then(visitedDomains => {
      console.log(`Found ${visitedDomains.length} visited domains in history`);
      
      // Fetch all cookies and filter them
      chrome.cookies.getAll({}, async (cookies) => {
        if (chrome.runtime.lastError) {
          console.error("Error fetching cookies:", chrome.runtime.lastError);
          sendResponse({ cookies: [] });
          return;
        }
    
        console.log(`Total cookies retrieved: ${cookies.length}`);

        // Filter cookies by both name AND visited domains
        const filteredCookies = cookies.filter(cookie => {
          // First check if it's a consent cookie we're interested in
          if (!cookieNames.includes(cookie.name)) {
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

        console.log("Waiting for promises to resolve...");

        // Wait for all domain promises to resolve
        Promise.all(domainPromises).then(cookiesWithHistory => {
          console.log("Promises resolved! Sending response with cookies...")
          sendResponse({ cookies: cookiesWithHistory });
        });
      });
    });

    return true; // Keep the message channel open
  }

  if (request.payload?.action === "fetchAllCookies" || request.action === 'fetchAllCookies') {
    // Fetch all cookies
    chrome.cookies.getAll({}, (cookies) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching cookies:", chrome.runtime.lastError);
        sendResponse({ cookies: [] });
      } else {
        console.log("Sending cookies response:", cookies); // Debugging statement
        sendResponse({ cookies });
      }
    });
    return true; // Keep the message channel open
  }
  
  if (request.payload?.action === "injectHTML") {
    const tabId = sender.tab ? sender.tab.id : request.tabId; // Get tab ID

    if(!request.payload.html) {
      console.error("No html file provided");
      return;
    }

    if (!tabId) {
      console.error("Invalid tabID");
      return;
    }

    // Remove the ".html" portion of the page name to get the element ID
    elementId = request.payload.html.slice(0, -5);

    height = request.payload.height ? request.payload.height : "600px";

    // Small exception if popup_invisible is used
    if(height === "0px") {
      elementId = "popup_invisible";
    }

    // Call the inject function with Firefox-compatible API
    browser.tabs.executeScript(tabId, {
      code: `(${injectHTML.toString()})(${JSON.stringify(elementId)}, ${JSON.stringify(request.payload.html)}, ${JSON.stringify(height)})`
    }).then(() => {
        // Send success message back to content script
        sendResponse({ success: true });
    }).catch(error => {
        // Send failure message back to content script
        console.error("Error injecting script:", error);
        sendResponse({ success: false, error });
    });
    
    return true; // Keep the message channel open
  }
});

// Store cookies in chrome.storage.local when they're fetched
function storeCookiesInStorage(cookies) {
  // Log visit counts before saving to storage
  console.log('Saving cookies to storage with visit counts:', 
    cookies.map(c => `${c.domain}: ${c.totalVisitCount}`));
    
  // Only call chrome.storage.local.set once
  chrome.storage.local.set({ 'cookieData': cookies }, function() {
    if (chrome.runtime.lastError) {
      console.error('Error saving cookies:', chrome.runtime.lastError);
    } else {
      console.log('Cookies saved to storage successfully');
      
      // Verify storage by retrieving it
      chrome.storage.local.get('cookieData', function(result) {
        if (chrome.runtime.lastError) {
          console.error('Error verifying storage:', chrome.runtime.lastError);
        } else if (result.cookieData) {
          console.log('Verified storage - visit counts:', 
            result.cookieData.map(c => `${c.domain}: ${c.totalVisitCount}`));
        }
      });
    }
  });
}

// Listens for active tab to be updated
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
      // Inject content script to check for the element with ID "extensionPageID"
      browser.tabs.executeScript(tabId, {
          code: `(${checkForSurveyElement.toString()})()`
      }).catch(err => {
        // Silently handle errors for restricted sites
        console.log(`Could not inject script into tab ${tabId}: ${err.message}`);
      });
  }
});


// Function to check if the element with ID "extensionPageID" exists
function checkForSurveyElement() {
  const elementId_main = "popup"; // popup.html
  const elementId_main_invisible = "popup_invisible"; // popup.html (invisible)
  const elementId_1_1 = "pricrumbs_preferred_cookie_choices_functional"; // pricrumbs_preferred_cookie_choices_functional.html
  const elementId_1_2 = "pricrumbs_preferred_cookie_choices_performance"; // pricrumbs_preferred_cookie_choices_performance.html
  const elementId_1_3 = "pricrumbs_preferred_cookie_choices_advertising"; // pricrumbs_preferred_cookie_choices_advertising.html
  const elementId_2_1 = "pricrumbs_consent_history_top_websites"; // pricrumbs_consent_history_top_websites.html
  const elementId_2_2 = "pricrumbs_consent_history_bottom_websites"; // pricrumbs_consent_history_bottom_websites.html
  const elementId_3_1 = "pricrumbs_website_all_cookies_accepted"; // pricrumbs_website_all_cookies_accepted.html
  const elementId_3_2 = "pricrumbs_website_all_cookies_rejected"; // pricrumbs_website_all_cookies_rejected.html
  const elementId_3_3 = "pricrumbs_website_advertising_cookies_rejected"; // pricrumbs_website_advertising_cookies_rejected.html
  const elementId_3_4 = "pricrumbs_website_all_cookies_default"; // pricrumbs_website_all_cookies_default.html


  // Look for element with target ID on page
  const observer_main = new MutationObserver((mutations, observer) => {
      const targetElement = document.getElementById(elementId_main);
      if (targetElement && !targetElement.querySelector("iframe")) {
          observer.disconnect(); // Stop observing once found

          // Sends message to content script from webpage to embed iframe
          window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "popup.html" } }, "*");
      }
  });
  const observer_main_invisible = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_main_invisible);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "popup.html", height: "0px"} }, "*");
    }
  });
  const observer_1_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_functional.html" } }, "*");
    }
  });
  const observer_1_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_performance.html" } }, "*");
    }
  });
  const observer_1_3 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_3);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_advertising.html" } }, "*");
    }
  });
  const observer_2_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_2_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_consent_history_top_websites.html" } }, "*");
    }
  });
  const observer_2_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_2_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_consent_history_bottom_websites.html" } }, "*");
    }
  });
  const observer_3_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_accepted.html", height: "245px" } }, "*");
    }
  });
  const observer_3_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_rejected.html", height: "245px" } }, "*");
    }
  });
  const observer_3_3 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_3);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_advertising_cookies_rejected.html", height: "245px" } }, "*");
    }
  });
   // Observer for default cookies
  const observer_3_4 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_4);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_default.html", height: "245px" } }, "*");
    }
  });

  // Start the observers
  observer_main.observe(document.body, { childList: true, subtree: true });
  observer_main_invisible.observe(document.body, { childList: true, subtree: true });
  observer_1_1.observe(document.body, { childList: true, subtree: true });
  observer_1_2.observe(document.body, { childList: true, subtree: true });
  observer_1_3.observe(document.body, { childList: true, subtree: true });
  observer_2_1.observe(document.body, { childList: true, subtree: true });
  observer_2_2.observe(document.body, { childList: true, subtree: true });
  observer_3_1.observe(document.body, { childList: true, subtree: true });
  observer_3_2.observe(document.body, { childList: true, subtree: true });
  observer_3_3.observe(document.body, { childList: true, subtree: true });
  observer_3_4.observe(document.body, { childList: true, subtree: true }); //start observer for default


  // Check immediately in case the element is already present
  const existingElement_main = document.getElementById(elementId_main);
  const existingElement_main_invisible = document.getElementById(elementId_main_invisible);
  const existingElement_1_1 = document.getElementById(elementId_1_1);
  const existingElement_1_2 = document.getElementById(elementId_1_2);
  const existingElement_1_3 = document.getElementById(elementId_1_3);
  const existingElement_2_1 = document.getElementById(elementId_2_1);
  const existingElement_2_2 = document.getElementById(elementId_2_2);
  const existingElement_3_1 = document.getElementById(elementId_3_1);
  const existingElement_3_2 = document.getElementById(elementId_3_2);
  const existingElement_3_3 = document.getElementById(elementId_3_3);
  const existingElement_3_4 = document.getElementById(elementId_3_4); // Check for default element


  if (existingElement_main && !existingElement_main.querySelector("iframe")) {
      observer_main.disconnect();
      window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "popup.html" } }, "*");
  }
  if (existingElement_main_invisible && !existingElement_main_invisible.querySelector("iframe")) {
    observer_main.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "popup.html", height: "0px" } }, "*");
  }
  if (existingElement_1_1 && !existingElement_1_1.querySelector("iframe")) {
    observer_1_1.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_functional.html" } }, "*");
  }
  if (existingElement_1_2 && !existingElement_1_2.querySelector("iframe")) {
    observer_1_2.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_performance.html" } }, "*");
  }
  if (existingElement_1_3 && !existingElement_1_3.querySelector("iframe")) {
    observer_1_3.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_preferred_cookie_choices_advertising.html" } }, "*");
  }
  if (existingElement_2_1 && !existingElement_2_1.querySelector("iframe")) {
    observer_2_1.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_consent_history_top_websites.html" } }, "*");
  }
  if (existingElement_2_2 && !existingElement_2_2.querySelector("iframe")) {
    observer_2_2.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_consent_history_bottom_websites.html" } }, "*");
  }
  if (existingElement_3_1 && !existingElement_3_1.querySelector("iframe")) {
    observer_3_1.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_accepted.html", height: "245px" } }, "*");
  }
  if (existingElement_3_2 && !existingElement_3_2.querySelector("iframe")) {
    observer_3_2.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_rejected.html", height: "245px" } }, "*");
  }
  if (existingElement_3_3 && !existingElement_3_3.querySelector("iframe")) {
    observer_3_3.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_advertising_cookies_rejected.html", height: "245px" } }, "*");
  }
    // Check for default element
  if (existingElement_3_4 && !existingElement_3_4.querySelector("iframe")) {
    observer_3_4.disconnect();
    window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectHTML", html: "pricrumbs_website_all_cookies_default.html", height: "245px" } }, "*");
  }
}