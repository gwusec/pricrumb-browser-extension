document.addEventListener('DOMContentLoaded', () => {
  const cookieNames = [
    "cookieyes-consent",
    "CookieConsent",
    "CookieConsentBulkTicket",
    "OptanonConsent",
    "OptanonAlertBoxClosed",
    "cookiescriptaccept",
    "cookiescriptreject",
    "TRUSTe",
    "TRUSTeConsent",
    "__qca",
    "__qcb",
    "CivicCookieControl",
    "CivicCookieControlBulkTicket",
    "usercentrics_consent",
    "usercentrics_bulk_ticket",
    "cookieyes-consent",
    "cookieyes-reject",
    "consentmanager",
    "consentmanager_bulk_ticket",
    "_pk_id",
    "_pk_ses",
    "axeptio_consent",
    "axeptio_bulk_ticket",
    "didomi_token",
    "didomi_bulk_ticket",
    "clym_consent",
    "clym_bulk_ticket",
    "cp_consent",
    "cp_bulk_ticket",
    "termly_consent",
    "termly_bulk_ticket",
    "iubenda_consent",
    "iubenda_bulk_ticket",
    "osano_consent",
    "osano_bulk_ticket",
    "secureprivacy_consent",
    "secureprivacy_bulk_ticket",
    "privacytools_consent",
    "privacytools_bulk_ticket",
    "seers_consent",
    "seers_bulk_ticket",
    "cookiepro_consent",
    "cookiepro_bulk_ticket",
    "civicuk_consent",
    "civicuk_bulk_ticket",
    "trustcommander_consent",
    "trustcommander_bulk_ticket",
    "consentmanager_net_consent",
    "consentmanager_net_bulk_ticket",
    "cookiehub_consent",
    "cookiehub_bulk_ticket",
    "cookiefirst_consent",
    "cookiefirst_bulk_ticket",
    "cookielawinfo_consent",
    "cookielawinfo_bulk_ticket",
    "cookiecontrol_consent",
    "cookiecontrol_bulk_ticket",
    "cookieconsent_consent",
    "cookieconsent_bulk_ticket",
    "cookiguard_consent",
    "cookiguard_bulk_ticket",
    "cookienotice_consent",
    "cookienotice_bulk_ticket",
    "cookiemanager_consent",
    "cookiemanager_bulk_ticket",
    "cookiepolicy_consent",
    "cookiepolicy_bulk_ticket",
    "cookiesettings_consent",
    "cookiesettings_bulk_ticket",
    "cookiebanner_consent",
    "cookiebanner_bulk_ticket",
    "cookiecompliance_consent",
    "cookiecompliance_bulk_ticket",
    "cookiepreferences_consent",
    "cookiepreferences_bulk_ticket",
    "cookiesettingsmanager_consent",
    "cookiesettingsmanager_bulk_ticket",
    "cookieconsentmanager_consent",
    "cookieconsentmanager_bulk_ticket",
    "cookiecontrolmanager_consent",
    "cookiecontrolmanager_bulk_ticket",
    "cookiepolicymanager_consent",
    "cookiepolicymanager_bulk_ticket",
    "cookienoticemanager_consent",
    "cookienoticemanager_bulk_ticket",
    "cookiemanagerpro_consent",
    "cookiemanagerpro_bulk_ticket",
    "cookiesettingspro_consent",
    "cookiesettingspro_bulk_ticket",
    "cookieconsentpro_consent",
    "cookieconsentpro_bulk_ticket",
    "cookiecontrolpro_consent",
    "cookiecontrolpro_bulk_ticket",
    "cookiepolicypro_consent",
    "cookiepolicypro_bulk_ticket",
    "cookienoticepro_consent",
    "cookienoticepro_bulk_ticket",
    "cookiemanagerplus_consent",
    "cookiemanagerplus_bulk_ticket",
    "cookiesettingsplus_consent",
    "cookiesettingsplus_bulk_ticket"
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

  fetchAndDisplayCookies();

  // Refresh button
  document.getElementById('refresh').addEventListener('click', fetchAndDisplayCookies);

  // Download cookies button
  document.getElementById('download').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'downloadCookies', cookies: fetchedCookies });
  });
});
