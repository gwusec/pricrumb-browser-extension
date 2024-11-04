document.addEventListener('DOMContentLoaded', () => {
  const cookieNames = [
    "cookieyes-consent", "CookieConsent", "CookieConsentBulkTicket", "OptanonConsent",
  ];

  let fetchedCookies = [];

  // fetch and display cookies
  function fetchAndDisplayCookies() {
    chrome.runtime.sendMessage({ action: 'checkCookies', cookieNames: cookieNames }, (response) => {
      fetchedCookies = response.cookies;
      let cookieListDiv = document.getElementById('cookieList');
      cookieListDiv.innerHTML = '';

      response.cookies.forEach(cookie => {
        let cookieDiv = document.createElement('div');
        cookieDiv.className = 'cookie';

        let formattedValue = cookie.value.split(',').join('<br>');

        let creationDate = cookie.hasOwnProperty('creationDate') ? 
          new Date(cookie.creationDate * 1000).toLocaleString() : 'Unknown';

        let expirationDate = cookie.hasOwnProperty('expirationDate') ? 
          new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session Cookie';

        cookieDiv.innerHTML = `
          <strong>Name:</strong> ${cookie.name}<br>
          <strong>Domain:</strong> ${cookie.domain}<br>
          <strong>Value:</strong><br>${formattedValue}<br>
          <strong>Creation Date:</strong> ${creationDate}<br>
          <strong>Expiration Date:</strong> ${expirationDate}<br>
        `;
        cookieListDiv.appendChild(cookieDiv);

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

  // Function to display both CookieYes and CookieBot consent cookies
  function fetchAndDisplayConsentCookies() {
    chrome.runtime.sendMessage({ action: 'checkConsent' }, (response) => {
      let consentDiv = document.getElementById('consentList');
      consentDiv.innerHTML = '';

      const cookieYesCategories = ['necessary', 'functional', 'analytics', 'advertisement'];
      const cookieBotCategories = ['necessary', 'preferences', 'statistics', 'marketing'];

      // Function to format consent details for CookieYes
      function formatCookieYesConsent(parsedValues) {
        const consentedCookies = [];
        const notConsentedCookies = [];

        cookieYesCategories.forEach(category => {
          if (parsedValues[category] === 'yes') {
            consentedCookies.push(category);
          } else if (parsedValues[category] === 'no') {
            notConsentedCookies.push(category);
          }
        });

        return {
          consented: consentedCookies.length > 0 ? consentedCookies.join(', ') : 'none',
          notConsented: notConsentedCookies.length > 0 ? notConsentedCookies.join(', ') : 'none'
        };
      }

      // Function to format consent details for CookieBot (correctly parse values)
      function formatCookieBotConsent(parsedValues) {
        const consentedCookies = [];
        const notConsentedCookies = [];

        // Log the parsed values for debugging
        console.log("Parsed CookieBot Consent Values:", parsedValues);

        cookieBotCategories.forEach(category => {
          // Parse as true/false, ensuring correct comparison for values
          if (parsedValues[category] === 'true' || parsedValues[category] === true) {
            consentedCookies.push(category);
          } else if (parsedValues[category] === 'false' || parsedValues[category] === false) {
            notConsentedCookies.push(category);
          }
        });

        return {
          consented: consentedCookies.length > 0 ? consentedCookies.join(', ') : 'none',
          notConsented: notConsentedCookies.length > 0 ? notConsentedCookies.join(', ') : 'none'
        };
      }

      // Display CookieYes consent cookies
      response.cookieyesList.forEach(cookie => {
        let cookieDiv = document.createElement('div');
        cookieDiv.className = 'consent';

        const parsedValues = cookie.parsed_values || {};
        const consentDetails = formatCookieYesConsent(parsedValues);

        const creationDate = cookie.hasOwnProperty('creationDate') ? 
          new Date(cookie.creationDate * 1000).toLocaleString() : 'Unknown';
        const expirationDate = cookie.hasOwnProperty('expirationDate') ? 
          new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session Cookie';

        cookieDiv.innerHTML = `
          <strong>CookieYes Consent Cookie:</strong> ${cookie.name}<br>
          <strong>Domain:</strong> ${cookie.domain}<br>
          <strong>Creation Date:</strong> ${creationDate}<br>
          <strong>Expiration Date:</strong> ${expirationDate}<br>
          <strong>Consented to:</strong> ${consentDetails.consented}<br>
          <strong>Not Consented to:</strong> ${consentDetails.notConsented}<br>
        `;
        consentDiv.appendChild(cookieDiv);
      });

      // Display CookieBot consent cookies
      response.cookiebotList.forEach(cookie => {
        let cookieDiv = document.createElement('div');
        cookieDiv.className = 'consent';

        // Decode the value if it's URL-encoded
        const decodedValue = decodeURIComponent(cookie.value);
        console.log("CookieBot Decoded Value:", decodedValue); // Debugging

        // Split the decoded value and extract key-value pairs (assuming format like 'necessary:true, preferences:false,...')
        const parsedValues = decodedValue.split(',').reduce((acc, item) => {
          const [key, value] = item.split(':');
          acc[key.trim()] = value.trim();
          return acc;
        }, {});
        
        const consentDetails = formatCookieBotConsent(parsedValues);

        const creationDate = cookie.hasOwnProperty('creationDate') ? 
          new Date(cookie.creationDate * 1000).toLocaleString() : 'Unknown';
        const expirationDate = cookie.hasOwnProperty('expirationDate') ? 
          new Date(cookie.expirationDate * 1000).toLocaleString() : 'Session Cookie';

        cookieDiv.innerHTML = `
          <strong>CookieBot Consent Cookie:</strong> ${cookie.name}<br>
          <strong>Domain:</strong> ${cookie.domain}<br>
          <strong>Creation Date:</strong> ${creationDate}<br>
          <strong>Expiration Date:</strong> ${expirationDate}<br>
          <strong>Consented to:</strong> ${consentDetails.consented}<br>
          <strong>Not Consented to:</strong> ${consentDetails.notConsented}<br>
        `;
        consentDiv.appendChild(cookieDiv);
      });
    });
  }

  fetchAndDisplayCookies();
  fetchAndDisplayConsentCookies();

  document.getElementById('refresh').addEventListener('click', () => {
    fetchAndDisplayCookies();
    fetchAndDisplayConsentCookies();
  });

  document.getElementById('download').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCookies', cookies: fetchedCookies });
  });
});
