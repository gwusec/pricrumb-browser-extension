// Content script

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || !(event.data.type === "FROM_SURVEY" || event.data.type === "FROM_CONTENT")) return;

  // This is a check called by the survey to ask if the extension is installed
  if (event.data.payload?.action === "checkExtension") {
    window.postMessage(
      { type: "FROM_EXTENSION_CONFIRMATION", payload: { extensionInstalled: true } },
      "*"
    );
    return;
  }

  //this part is for eligibility check (if users have 10 or more unique websites where action taken = yes):
  if(event.data.payload?.action === "checkEligibility") {
    console.log("Content script: Received eligibility check request");
    
    // Helper function to extract main domain name (e.g., "zoom" from "zoom.com" or "zoom.us")
    function extractMainDomainName(domain) {
      if (!domain) return '';
      
      // Remove leading dots
      let cleaned = domain.replace(/^\.+/, '');
      
      // Remove www. prefix
      cleaned = cleaned.replace(/^www\./, '');
      
      // Split by dots and get the main part (before TLD)
      const parts = cleaned.split('.');
      
      // Return the main domain name (second-to-last part before TLD)
      // For "zoom.com" or "zoom.us", this returns "zoom"
      // For "stackoverflow.com", this returns "stackoverflow"
      return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : cleaned.toLowerCase();
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
      
      // Filter websites where actionTaken is "Yes" 
      const eligibleSites = cookieData.filter(site => {
        return site.actionTaken === "Yes";
      });
      
      console.log("Content script: Sites with action taken = Yes:", eligibleSites.length);
      
      // Extract unique domains by main domain name
      const uniqueDomains = new Set();
      eligibleSites.forEach(site => {
        if (site.domain) {
          const mainDomain = extractMainDomainName(site.domain);
          if (mainDomain) {
            uniqueDomains.add(mainDomain);
            console.log(`Content script: Added unique domain "${mainDomain}" from ${site.domain}`);
          }
        }
      });
      
      const uniqueDomainsArray = Array.from(uniqueDomains);
      console.log("Content script: Unique domains found:", uniqueDomainsArray);
      console.log("Content script: Unique domains count:", uniqueDomainsArray.length);
      
      const payload = {
        eligibleSitesCount: uniqueDomainsArray.length,  // Now counts unique domains
        isEligible: uniqueDomainsArray.length >= 10,     // TRUE if 10+ unique domains
        totalSites: cookieData.length,
        uniqueDomains: uniqueDomainsArray  // Optional: send the list of unique domains
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
  ext.runtime.sendMessage(event.data).then((response) => {
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
ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle direct injection commands (background -> content -> DOM)
  if (request.action === "injectHTML") {
    // Request should include elementId, htmlFile, height
    const { elementId, htmlFile, height } = request;

    const targetElement = document.getElementById(elementId);
    if (targetElement && !targetElement.querySelector("iframe")) {
      const iframe = document.createElement("iframe");
      iframe.src = ext.runtime.getURL(htmlFile);
      iframe.style.width = "100%";
      iframe.style.height = height || "600px";
      iframe.style.border = "none";
      targetElement.appendChild(iframe);

      console.log(`Injected iframe for ${htmlFile} into #${elementId}`);
      sendResponse && sendResponse({ success: true });
    } else if (!targetElement) {
      console.error("Injection failed - element not found:", elementId);
      sendResponse && sendResponse({ success: false, error: "element-not-found" });
    } else {
      // Iframe already present
      sendResponse && sendResponse({ success: true, note: "iframe-already-present" });
    }
    return true; // Keep channel open for async response
  }

  // Listen for requests from background to run the survey element checker (on tab update)
  if (request && request.action === "runSurveyElementCheck") {
    try {
      // Run the checker that looks for elements and posts messages back to the page
      if (typeof checkForSurveyElement === "function") {
        checkForSurveyElement();
        sendResponse({ success: true });
      } else {
        console.warn("checkForSurveyElement not defined in content script");
        sendResponse({ success: false, error: "checker-not-defined" });
      }
    } catch (err) {
      console.error("Error running survey element checker:", err);
      sendResponse({ success: false, error: err.message || err });
    }
    return true;
  }

  // Default: no action matched
  return false;
});

// Looks for specific survey elements (found in elementMap)
function checkForSurveyElement() {
  // Prevent creating multiple observers when called repeatedly
  if (window.__pricrumbs_checker_installed) {
    console.log("pricrumbs checker already installed - skipping re-install.");
    return;
  }
  window.__pricrumbs_checker_installed = true;

  const elementMap = {
    "popup": { html: "popup.html", height: "600px" },
    "popup_invisible": { html: "popup.html", height: "0px" },
    "pricrumbs_preferred_cookie_choices_functional": { html: "pricrumbs_preferred_cookie_choices_functional.html", height: "600px" },
    "pricrumbs_preferred_cookie_choices_performance": { html: "pricrumbs_preferred_cookie_choices_performance.html", height: "600px" },
    "pricrumbs_preferred_cookie_choices_advertising": { html: "pricrumbs_preferred_cookie_choices_advertising.html", height: "600px" },
    "pricrumbs_consent_history_top_websites": { html: "pricrumbs_consent_history_top_websites.html", height: "600px" },
    "pricrumbs_consent_history_bottom_websites": { html: "pricrumbs_consent_history_bottom_websites.html", height: "600px" },
    "pricrumbs_website_all_cookies_accepted": { html: "pricrumbs_website_all_cookies_accepted.html", height: "245px" },
    "pricrumbs_website_all_cookies_rejected": { html: "pricrumbs_website_all_cookies_rejected.html", height: "245px" },
    "pricrumbs_website_advertising_cookies_rejected": { html: "pricrumbs_website_advertising_cookies_rejected.html", height: "245px" },
    "pricrumbs_website_all_cookies_default": { html: "pricrumbs_website_all_cookies_default.html", height: "245px" }
  };

  function injectIfFound(id, opts) {
    const target = document.getElementById(id);
    if (target && !target.querySelector("iframe")) {
      // Post a message to the page so the page-origin script can also react if needed
      window.postMessage({ type: "FROM_CONTENT", payload: { action: "injectHTML", ...opts } }, "*");
      return true;
    }
    return false;
  }

  // Initial check (covers the case where the element is already present)
  Object.entries(elementMap).forEach(([id, opts]) => injectIfFound(id, opts));

  // Keep watching dynamically
  const observer = new MutationObserver(() => {
    Object.entries(elementMap).forEach(([id, opts]) => injectIfFound(id, opts));
  });

  // If document.body doesn't exist yet, wait for DOMContentLoaded
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Expose the observer in case something else wants to disconnect it later
  window.__pricrumbs_checker_observer = observer;
}

// Run checker on initial load
checkForSurveyElement();