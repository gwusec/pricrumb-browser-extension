// background.js

const historyCache = {}; // Cache to store history data per domain

// Opens the popup.html when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ 
    url: chrome.runtime.getURL('popup.html') 
  });
});

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
                          meaningfulVisits.push({ url: item.url, lastVisitTime: item.lastVisitTime });
                      }
                  } catch { }
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
                                  allVisits.push(visit.visitTime);
                                  totalVisitCount++;
                                  
                                  const visitDate = new Date(visit.visitTime);
                                  const dateKey = `${visitDate.getFullYear()}-${visitDate.getMonth() + 1}-${visitDate.getDate()}`;
                                  dailyVisitMap.set(dateKey, (dailyVisitMap.get(dateKey) || 0) + 1);
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

// Match history domain with the cookie domain
function domainMatch(historyDomain, cookieDomain) {
  historyDomain = standardizeDomain(historyDomain);
  cookieDomain = standardizeDomain(cookieDomain);

  // Check for exact match or subdomain match
  return historyDomain === cookieDomain || historyDomain.endsWith(`.${cookieDomain}`);
}

// Gives a way to inject html content from this extension into a webpage as an iframe
// elementID = ID of element where iframe should be injected into
// htmlFile = name of .html file
// scriptFile = name of associated .js script
function injectHTML(elementId, htmlFile) {
      const targetElement = document.getElementById(elementId);
      if (targetElement) {
        const iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL(htmlFile);

        iframe.style.width = "100%";
        iframe.style.height = "600px";
        iframe.style.border = "none"; 

        targetElement.appendChild(iframe);
      } else {
        console.error("Error injecting iframe");
      }
}


// Listen for messages from the popup.js or content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // if (request.action === 'testHistoryAPI') {
  //   console.log("Testing history API...");
  //   chrome.history.search({ 
  //     text: '', 
  //     startTime: 0, 
  //     maxResults: 10 // Just get a few to test
  //   }, (results) => {
  //     console.log(`History API returned ${results.length} results`);
  //     if (results.length > 0) {
  //       console.log("Sample result:", {
  //         url: results[0].url,
  //         title: results[0].title,
  //         visitCount: results[0].visitCount
  //       });
  //     }
  //     sendResponse({success: true, count: results.length});
  //   });
  //   return true; // Keep message channel open
  // }
  if (request.action === 'checkCookies') {
    console.log("Received request to check cookies.");
    const cookieNames = request.cookieNames;

    // Fetch all cookies and filter them
    chrome.cookies.getAll({}, async (cookies) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching cookies:", chrome.runtime.lastError);
        sendResponse({ cookies: [] });
        return;
      }
  
      console.log(`Total cookies retrieved: ${cookies.length}`);

      const filteredCookies = cookies.filter(cookie => cookieNames.includes(cookie.name));

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

  if (request.payload?.action === "injectPreferredChoicesHTML") {
    const tabId = sender.tab ? sender.tab.id : request.tabId; // Get tab ID

    if (!tabId) {
      console.error("Invalid tabID");
      return;
    }

    // Call the inject function
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: injectHTML,
      args: ["extensionPageID", "prefered_choices1.html"] // Function parameters: elementId, htmlFile
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

  //Do We need this?
  
  // if (request.action === 'saveConsentData') {
  //       try {
  //           // Convert data to string with pretty formatting
  //           const jsonData = JSON.stringify(request.data, null, 2);
            
  //           // Create a blob from the JSON string
  //           const blob = new Blob([jsonData], { type: 'application/json' });
            
  //           // Create URL for the blob
  //           const url = URL.createObjectURL(blob);
            
  //           // Save to downloads folder
  //           chrome.downloads.download({
  //               url: url,
  //               filename: 'consent_data.json',
  //               conflictAction: 'overwrite'
  //           }, (downloadId) => {
  //               // Cleanup: Revoke the blob URL after download starts
  //               URL.revokeObjectURL(url);
                
  //               if (chrome.runtime.lastError) {
  //                   console.error("Download failed:", chrome.runtime.lastError);
  //                   sendResponse({ success: false });
  //               } else {
  //                   console.log("Consent data saved successfully");
  //                   sendResponse({ success: true });
  //               }
  //           });
  //       } catch (error) {
  //           console.error('Error saving consent data:', error);
  //           sendResponse({ success: false });
  //       }
  //       return true; // Keep the message channel open
  //   }

});

// Listens for active tab to be updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
      // Inject content script to check for the element with ID "extensionPageID"
      chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: checkForSurveyElement
      });
  }
});

// Function to check if the element with ID "extensionPageID" exists
function checkForSurveyElement() {
  const elementID = "extensionPageID";

  const observer = new MutationObserver((mutations, observer) => {
      if (document.getElementById(elementID)) {
          observer.disconnect(); // Stop observing once found
          
          // Sends message to content script from webpage to embed iframe
          window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectPreferredChoicesHTML" } }, "*");
      }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Check immediately in case the element is already present
  if (document.getElementById(elementID)) {
      observer.disconnect();

      // Sends message to content script from webpage to embed iframe
      window.postMessage({ type: "FROM_SURVEY", tabId: chrome.runtime.id, payload: { action: "injectPreferredChoicesHTML" } }, "*");
  }
}
