// background.js

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
  let allVisits = [];
  let lastEndTime = Date.now();
  let previousEndTime = null;
  let totalVisitCount = 0;
  let dailyVisitMap = new Map();

  function fetchNextBatch() {
    chrome.history.search({ text: '', startTime: 0, endTime: lastEndTime, maxResults: 1000 }, (results) => {
      if (results.length === 0 || lastEndTime === previousEndTime) {
        // Calculate average visits per day
        let dailyVisitCounts = Array.from(dailyVisitMap.values());
        let avgDailyVisits = 0;
        if (dailyVisitCounts.length > 0) {
          avgDailyVisits = Math.round((dailyVisitCounts.reduce((sum, count) => sum + count, 0) / dailyVisitCounts.length) * 10) / 10;
        }
        
        callback({
          firstVisited: allVisits.length > 0 ? Math.min(...allVisits) : null,
          lastVisited: allVisits.length > 0 ? Math.max(...allVisits) : null,
          totalVisitCount: totalVisitCount,
          avgDailyVisits: avgDailyVisits,
          daysVisited: dailyVisitMap.size,
        });
        return;
      }

      previousEndTime = lastEndTime;

      // Filter results for matching domains first
      const matchingItems = results.filter(item => {
        try {
          const url = new URL(item.url);
          return domainMatch(url.hostname, cookieDomain);
        } catch {
          return false; // Ignore invalid URLs
        }
      });

      // Now further filter to remove background/asset requests
      const meaningfulItems = matchingItems.filter(item => {
        try {
          const url = new URL(item.url);
          
          // Filter out likely background/asset requests
          const pathLowerCase = url.pathname.toLowerCase();
          const isAssetOrApi = 
            pathLowerCase.includes('/api/') || 
            pathLowerCase.includes('/assets/') ||
            pathLowerCase.endsWith('.js') ||
            pathLowerCase.endsWith('.css') ||
            pathLowerCase.endsWith('.jpg') ||
            pathLowerCase.endsWith('.png') ||
            pathLowerCase.endsWith('.gif') ||
            pathLowerCase.endsWith('.svg') ||
            pathLowerCase.endsWith('.woff') ||
            pathLowerCase.endsWith('.json');
          
          return !isAssetOrApi;
        } catch {
          return false;
        }
      });

      // Process each meaningful URL
      const visitPromises = meaningfulItems.map(item => {
        return new Promise(resolve => {
          // Get detailed visit information
          chrome.history.getVisits({ url: item.url }, visits => {
            // Filter redirects and background transitions
            const meaningfulVisits = visits.filter(visit => {
              // Exclude auto redirects and reloads
              return !(
                visit.transition === 'auto_redirect' ||
                visit.transition === 'auto_subframe' ||
                visit.transition === 'reload'
              );
            });
            
            // Add visit times to allVisits array
            meaningfulVisits.forEach(visit => {
              allVisits.push(visit.visitTime);
            });
            
            // Count meaningful visits
            totalVisitCount += meaningfulVisits.length;
            
            // Group visits by day
            meaningfulVisits.forEach(visit => {
              const visitDate = new Date(visit.visitTime);
              const dateKey = `${visitDate.getFullYear()}-${visitDate.getMonth() + 1}-${visitDate.getDate()}`;
              
              if (dailyVisitMap.has(dateKey)) {
                dailyVisitMap.set(dateKey, dailyVisitMap.get(dateKey) + 1);
              } else {
                dailyVisitMap.set(dateKey, 1);
              }
            });
            
            resolve();
          });
        });
      });

      // Wait for all visit processing to complete
      Promise.all(visitPromises).then(() => {
        // Update lastEndTime for next batch
        if (results.length > 0) {
          lastEndTime = Math.min(...results.map(r => r.lastVisitTime)) - 1;
          fetchNextBatch();
        }
      });
    });
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
    const cookieNames = request.cookieNames;

    // Fetch all cookies and filter them
    chrome.cookies.getAll({}, async (cookies) => {
      const filteredCookies = cookies.filter(cookie => cookieNames.includes(cookie.name));

      // Add domain history to cookies
      const domainPromises = filteredCookies.map(cookie => {
        return new Promise(resolve => {
          getAllHistoryForDomain(cookie.domain, (historyData) => {
            resolve({
              ...cookie,
              firstVisited: historyData.firstVisited,
              lastVisited: historyData.lastVisited,
              totalVisitCount: historyData.totalVisitCount,
              avgDailyVisits: historyData.avgDailyVisits
            });
          });
        });
      });

      // Wait for all domain promises to resolve
      Promise.all(domainPromises).then(cookiesWithHistory => {
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
