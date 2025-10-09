// Content script

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "FROM_SURVEY") return;

  // This is a check called by the survey to ask if the extension is installed
  if (event.data.payload?.action === "checkExtension") {
    window.postMessage(
      { type: "FROM_EXTENSION_CONFIRMATION", payload: { extensionInstalled: true } },
      "*"
    );
    return;
  }

  //this part is for eligibility check (if users have 10 or more websites action taken =yes):
  if(event.data.payload?.action === "checkEligibility") {
    console.log("Content script: Received eligibility check request");
    
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
      
      // Filter websites where actionTaken is "Yes" 
      const eligibleSites = cookieData.filter(site => {
        const isEligible = site.actionTaken === "Yes";
        if (isEligible) {
          console.log("Content script: Eligible site found:", site.domain);
        }
        return isEligible;
      });
      
      console.log("Content script: Eligible sites count:", eligibleSites.length);
      console.log("Content script: Total sites:", cookieData.length);
      
      const payload = {
        eligibleSitesCount: eligibleSites.length,
        isEligible: eligibleSites.length >= 10,
        totalSites: cookieData.length
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
  browser.runtime.sendMessage(event.data).then((response) => {
    if (response) { // Ensure response exists before sending it back
      console.log("Received response from background:", response);
      window.postMessage(
        { type: "FROM_EXTENSION", payload: response, tabId: event.data.tabId || null },
        "*"
      );
    } else {
      console.warn("No response received from background script.");
    }
  }).catch((err) => {
    console.error("Error sending message to background:", err);
  });
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FROM_EXTENSION") {
    window.postMessage(request, "*");
  }
});
