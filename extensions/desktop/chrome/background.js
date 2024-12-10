// background.js

// Opens the popup.html when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

// Fetch all browsing history for a specific cookie domain
function getAllHistoryForDomain(cookieDomain, callback) {
  fetchPaginatedHistory(cookieDomain, callback);
}

// Recursive function to fetch paginated history for a domain
function fetchPaginatedHistory(cookieDomain, callback) {
  let allVisits = [];
  let lastEndTime = Date.now(); // Start from the current time
  let previousEndTime = null; // Track progress

  function fetchNextBatch() {
    chrome.history.search({ text: '', startTime: 0, endTime: lastEndTime, maxResults: 1000 }, (results) => {
      if (results.length === 0 || lastEndTime === previousEndTime) {
        // Terminate if no results or no progress
        callback({
          firstVisited: allVisits.length > 0 ? Math.min(...allVisits) : null,
          lastVisited: allVisits.length > 0 ? Math.max(...allVisits) : null,
        });
        return;
      }

      previousEndTime = lastEndTime;

      // Filter results for matching domains
      const visits = results
        .filter(item => {
          try {
            const url = new URL(item.url);
            return domainMatch(url.hostname, cookieDomain);
          } catch {
            return false; // Ignore invalid URLs
          }
        })
        .map(item => item.lastVisitTime);

      allVisits.push(...visits);

      // Update `lastEndTime` to fetch older entries
      lastEndTime = Math.min(...results.map(r => r.lastVisitTime)) - 1;

      fetchNextBatch(); // Fetch the next batch
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

// Listen for messages from the popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

  if (request.action === 'fetchAllCookies') {
    // Fetch all cookies
    chrome.cookies.getAll({}, (cookies) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching cookies:", chrome.runtime.lastError);
        sendResponse({ cookies: [] });
      } else {
        sendResponse({ cookies });
      }
    });
    return true; // Keep the message channel open
  }
});
