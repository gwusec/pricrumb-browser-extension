// Content script

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "FROM_SURVEY") return;

  // This is a check called by the survey to ask if the extension is installed
  if(event.data.payload?.action === "checkExtension") {
    window.postMessage(
      { type: "FROM_EXTENSION_CONFIRMATION", payload: { extensionInstalled: true } },
      "*"
    );
    return;
  }

    //this part is for eligibility check (if users have 10 or more websites action taken =yes):
  if(event.data.payload?.action === "checkEligibility") {
    console.log("Content script: Received eligibility check request");
    
    // Helper to compute which website types are available (for survey visibility)
    function categorizeWebsites(cookieData) {
      console.log('Categorizing websites, total cookies:', cookieData.length);
      
      const actionTakenCookies = cookieData.filter(cookie =>
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
      );
      const defaultActionCookies = cookieData.filter(cookie =>
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'default'
      );

      const category1 = []; // Accept all
      const category2 = []; // Reject all
      const category3 = []; // Mixed (accept functional/performance, reject advertising)
      const category4 = defaultActionCookies.length > 0; // Has default action cookies

      for (const cookie of actionTakenCookies) {
        let preferences = null;

        if (cookie.categories && typeof cookie.categories === 'object') {
          preferences = {
            functional: cookie.categories.functional === true,
            performance: cookie.categories.performance === true,
            advertising: cookie.categories.advertising === true
          };
        } else if ('functional' in cookie && 'performance' in cookie && 'advertising' in cookie) {
          preferences = {
            functional: cookie.functional === "Yes" || cookie.functional === true,
            performance: cookie.performance === "Yes" || cookie.performance === true,
            advertising: cookie.advertising === "Yes" || cookie.advertising === true
          };
        }

        if (preferences &&
            preferences.functional !== undefined &&
            preferences.performance !== undefined &&
            preferences.advertising !== undefined) {
          if (preferences.functional && preferences.performance && preferences.advertising) {
            category1.push(cookie.domain);
          } else if (!preferences.functional && !preferences.performance && !preferences.advertising) {
            category2.push(cookie.domain);
          } else if (preferences.functional && preferences.performance && !preferences.advertising) {
            category3.push(cookie.domain);
          }
        }
      }

      console.log('Category 1 (Accept all) count:', category1.length);
      console.log('Category 2 (Reject all) count:', category2.length);
      console.log('Category 3 (Mixed) count:', category3.length);
      console.log('Category 4 (Default) has data:', category4);

      return {
        hasAllAccepted: category1.length > 0,
        hasAllRejected: category2.length > 0,
        hasAdvertisingRejected: category3.length > 0,
        hasDefaultCookies: category4
      };
    }
    
    // Check ALL possible storage keys
    chrome.storage.local.get(null, (result) => {
      console.log("Content script: All storage keys:", Object.keys(result));
      
      // Try multiple possible keys
      const cookieData = result.cookieData || 
                        result.consentCookies || 
                        result.cookies ||
                        result.fetchedCookies ||
                        [];
      
      console.log("Content script: Found cookie data length:", cookieData.length);
      
      if (cookieData.length > 0) {
        console.log("Content script: First cookie sample:", cookieData[0]);
      }
      
      // Filter websites where actionTaken is "Yes" (case-insensitive)
      const eligibleSites = cookieData.filter(site => {
        const isEligible = site.actionTaken && site.actionTaken.toLowerCase() === "yes";
        if (isEligible) {
          console.log("Content script: Eligible site found:", site.domain);
        }
        return isEligible;
      });
      
      console.log("Content script: Eligible sites count:", eligibleSites.length);
      console.log("Content script: Total sites:", cookieData.length);

      const websiteTypes = categorizeWebsites(cookieData);
      console.log("Content script: Website types available:", websiteTypes);
      
      const payload = {
        eligibleSitesCount: eligibleSites.length,
        isEligible: eligibleSites.length >= 10,
        totalSites: cookieData.length,
        websiteTypes
      };
      
      console.log("Content script: Sending eligibility response:", payload);
      
      window.postMessage({
        type: "FROM_EXTENSION_ELIGIBILITY",
        payload: payload
      }, "*");
    });
    return;
  }

  // Forward message to the background script
  chrome.runtime.sendMessage(event.data, (response) => {
    if (response) { // Ensure response exists before sending it back
      console.log("Received response from background:", response);
      window.postMessage({ type: "FROM_EXTENSION", payload: response, tabId: event.data.tabId || null }, "*");
    } else {
      console.warn("No response received from background script.");
    }
  });
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FROM_EXTENSION") {
      window.postMessage(request, "*");
  }
});
