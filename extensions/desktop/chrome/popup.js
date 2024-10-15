document.addEventListener('DOMContentLoaded', () => {
  const cookieNames = [
    "cookieyes-consent", "CookieConsent", "CookieConsentBulkTicket", "OptanonConsent",
    // (other cookie names here)
  ];

  let fetchedCookies = [];

  // fetch and display cookies
  function fetchAndDisplayCookies() {
    chrome.runtime.sendMessage({ action: 'checkCookies', cookieNames: cookieNames }, (response) => {
      fetchedCookies = response.cookies; // Store the cookies for download
      let cookieListDiv = document.getElementById('cookieList');
      cookieListDiv.innerHTML = '';

      response.cookies.forEach(cookie => {
        let cookieDiv = document.createElement('div');
        cookieDiv.className = 'cookie';

        // cookie value
        let formattedValue = cookie.value.split(',').join('<br>');

        // Creation date
        let creationDate = cookie.hasOwnProperty('creationDate') ? 
          new Date(cookie.creationDate * 1000).toLocaleString() : 'Unknown';

        // Expiration date
        let expirationDate = cookie.hasOwnProperty('expirationDate') ? 
          new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session Cookie';

        // Display cookie info
        cookieDiv.innerHTML = `
          <strong>Name:</strong> ${cookie.name}<br>
          <strong>Domain:</strong> ${cookie.domain}<br>
          <strong>Value:</strong><br>${formattedValue}<br>
          <strong>Creation Date:</strong> ${creationDate}<br>
          <strong>Expiration Date:</strong> ${expirationDate}<br>
        `;
        cookieListDiv.appendChild(cookieDiv);

        // Fetch and display browsing history
        chrome.runtime.sendMessage({ action: 'getHistory', domain: cookie.domain, timeframe: 365 * 24 * 60 * 60 * 1000 }, (historyResponse) => {
          if (historyResponse.visits.length > 0) {
            let visit = historyResponse.visits[0];
            cookieDiv.innerHTML += `
              <strong>First Visited:</strong> ${new Date(visit.firstVisited).toLocaleString()}<br>
              <strong>Last Visited:</strong> ${new Date(visit.lastVisited).toLocaleString()}<br>
              <strong>Total Visits:</strong> ${visit.totalVisits}<br>
            `;
          } else {
            cookieDiv.innerHTML += `<strong>Visit Details:</strong> No history found.`;
          }
        });
      });
    });
  }

// Fetch and display cookie consent status
function fetchAndDisplayConsentCookies() {
  chrome.runtime.sendMessage({ action: 'checkConsent' }, (response) => {
    let consentDiv = document.getElementById('consentList');
    consentDiv.innerHTML = '';

    const consentCategories = ['necessary', 'preferences', 'statistics', 'marketing'];

    // Helper function to format consent details for CookieBot cookies
    function formatConsentDetails(parsedValues) {
      const consentedCookies = [];
      const notConsentedCookies = [];
      
      // Iterate over consent categories to determine consented and non-consented cookies
      consentCategories.forEach(category => {
        if (parsedValues[category] === 'true') {
          consentedCookies.push(category);
        } else if (parsedValues[category] === 'false') {
          notConsentedCookies.push(category);
        }
      });

      return {
        consented: consentedCookies.length > 0 ? consentedCookies.join(', ') : 'none',
        notConsented: notConsentedCookies.length > 0 ? notConsentedCookies.join(', ') : 'none'
      };
    }

    // Function to parse CookieBot consent cookie
    function parseCookieBotValue(value) {
      // Decode the URL-encoded value
      const decodedValue = decodeURIComponent(value);
      const parsedValues = {};
      
      // Split the decoded string by commas
      const valueEntries = decodedValue.split(',');
      
      valueEntries.forEach(entry => {
        const [key, val] = entry.split(':', 2); // Split by the first occurrence of ":"
        if (key && val) {
          parsedValues[key.trim()] = val.trim();
        }
      });

      return parsedValues;
    }

    // Display CookieBot consent cookies
    response.cookiebotList.forEach(cookie => {
      let cookieDiv = document.createElement('div');
      cookieDiv.className = 'consent';

      // Parse the URL-encoded consent values in the CookieBot cookie
      const parsedValues = parseCookieBotValue(cookie.value);
      const consentDetails = formatConsentDetails(parsedValues);

      // Get Creation and Expiration Date
      const creationDate = cookie.hasOwnProperty('creationDate') ? 
        new Date(cookie.creationDate * 1000).toLocaleString() : 'Unknown';
      const expirationDate = cookie.hasOwnProperty('expirationDate') ? 
        new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session Cookie';

      cookieDiv.innerHTML = `
        <strong>CookieBot Consent Cookie:</strong> ${cookie.name}<br>
        <strong>Domain:</strong> ${cookie.domain}<br>
        <strong>Value:</strong> ${cookie.value}<br>
        <strong>Creation Date:</strong> ${creationDate}<br>
        <strong>Expiration Date:</strong> ${expirationDate}<br>
        <strong>Consented to:</strong> ${consentDetails.consented}<br>
        <strong>Not Consented to:</strong> ${consentDetails.notConsented}<br>
      `;
      consentDiv.appendChild(cookieDiv);

      // Fetch and append browsing history details
      appendHistoryDetails(cookieDiv, cookie.domain);
    });
  });
}

// Function to append history details to the cookie div
function appendHistoryDetails(cookieDiv, domain) {
  chrome.runtime.sendMessage({ action: 'getHistory', domain: domain, timeframe: 365 * 24 * 60 * 60 * 1000 }, (historyResponse) => {
    if (historyResponse.visits.length > 0) {
      let visit = historyResponse.visits[0];
      cookieDiv.innerHTML += `
        <strong>First Visited:</strong> ${new Date(visit.firstVisited).toLocaleString()}<br>
        <strong>Last Visited:</strong> ${new Date(visit.lastVisited).toLocaleString()}<br>
        <strong>Total Visits:</strong> ${visit.totalVisits}<br>
      `;
    } else {
      cookieDiv.innerHTML += `<strong>Visit Details:</strong> No history found.<br>`;
    }
  });
}

  // Fetch cookies and consent cookies when the popup is loaded
  fetchAndDisplayCookies();
  fetchAndDisplayConsentCookies();

  // Refresh button
  document.getElementById('refresh').addEventListener('click', () => {
    fetchAndDisplayCookies();
    fetchAndDisplayConsentCookies();
  });

  // Download cookies button
  document.getElementById('download').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCookies', cookies: fetchedCookies });
  });
});
