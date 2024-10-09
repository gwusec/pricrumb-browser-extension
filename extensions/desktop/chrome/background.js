chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCookies') {
    const cookieNames = request.cookieNames;
    chrome.cookies.getAll({}, (cookies) => {
      let filteredCookies = cookies.filter(cookie => cookieNames.includes(cookie.name));
      sendResponse({ cookies: filteredCookies });
    });
    return true; 
  } else if (request.action === 'downloadCookies') {
    const cookieList = request.cookies.map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      value: cookie.value
    }));
    let blob = new Blob([JSON.stringify(cookieList, null, 2)], { type: 'application/json' });
    let reader = new FileReader();
    reader.onload = function() {
      let url = reader.result;
      chrome.downloads.download({
        url: url,
        filename: 'cookies.json'
      });
    };
    reader.readAsDataURL(blob);
  } else if (request.action === 'getHistory') {
    const domain = standardizeDomain(request.domain);
    const timeframe = request.timeframe || 365 * 24 * 60 * 60 * 1000; // Default to 1 year if no timeframe

    getAllHistory(domain, timeframe, sendResponse);
    return true; 
  }
});

// Function to retrieve the entire history
function getAllHistory(cookieDomain, timeframe, sendResponse, endTime = Date.now(), allVisits = null) {
  if (!allVisits) {
    allVisits = {
      domain: cookieDomain,
      firstVisited: null,
      lastVisited: null,
      totalVisits: 0
    };
  }

  chrome.history.search({ text: '', startTime: Date.now() - timeframe, endTime: endTime, maxResults: 1000000 }, (historyItems) => {
    let domainHistory = historyItems.filter(item => {
      try {
        let url = new URL(item.url);
        let standardizedHostname = standardizeDomain(url.hostname);
        return domainMatch(standardizedHostname, cookieDomain);
      } catch (e) {
        return false;
      }
    });

    if (domainHistory.length > 0) {
      let visitPromises = domainHistory.map(item => {
        return new Promise((resolve) => {
          chrome.history.getVisits({ url: item.url }, (visits) => {
            resolve(visits);
          });
        });
      });

      Promise.all(visitPromises).then((allVisitDetails) => {
        allVisitDetails.forEach(visitArray => {
          visitArray.forEach(visit => {
            if (!allVisits.firstVisited || visit.visitTime < allVisits.firstVisited) {
              allVisits.firstVisited = visit.visitTime;
            }
            if (!allVisits.lastVisited || visit.visitTime > allVisits.lastVisited) {
              allVisits.lastVisited = visit.visitTime;
            }
            allVisits.totalVisits += 1;
          });
        });

        // Check if there's more history to fetch
        if (historyItems.length === 1000) {
          let newEndTime = historyItems[historyItems.length - 1].lastVisitTime;
          getAllHistory(cookieDomain, timeframe, sendResponse, newEndTime, allVisits);
        } else {
          sendResponse({ visits: [allVisits] });
        }
      });
    } else {
      // If no more history found, finalize the response
      if (allVisits.totalVisits > 0) {
        sendResponse({ visits: [allVisits] });
      } else {
        sendResponse({ visits: [] });
      }
    }
  });
}

function standardizeDomain(domain) {
  if (!domain) return '';
  return domain.replace(/^\.+/, '').toLowerCase();
}

function domainMatch(historyDomain, cookieDomain) {
  historyDomain = historyDomain.toLowerCase();
  cookieDomain = cookieDomain.toLowerCase();

  // Remove leading dots from domains
  historyDomain = historyDomain.replace(/^\.+/, '');
  cookieDomain = cookieDomain.replace(/^\.+/, '');

  if (historyDomain === cookieDomain) return true;

  // Check the match is for subdomains
  return historyDomain.endsWith('.' + cookieDomain);
}
