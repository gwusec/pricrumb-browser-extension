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
    
    // Helper function to categorize websites based on preferences
    function categorizeWebsites(cookieData) {
      console.log('Categorizing websites, total cookies:', cookieData.length);
      
      // Filter for cookies where actionTaken = "Yes"
      const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
      );
      
      // Filter for default cookies
      const defaultActionCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'default'
      );
      
      console.log('Cookies with action taken:', actionTakenCookies.length);
      console.log('Cookies with default action:', defaultActionCookies.length);
      
      // Arrays to store categorized domains
      const category1 = []; // Accept all (functional=true, performance=true, advertising=true)
      const category2 = []; // Reject all (functional=false, performance=false, advertising=false)
      const category3 = []; // Mixed (functional=true, performance=true, advertising=false)
      const category4 = defaultActionCookies.length > 0; // Has default action cookies
      
      // Process each cookie with action taken
      for (const cookie of actionTakenCookies) {
        if (!cookie.domain) continue;
        
        let preferences = null;
        
        // Try to get preferences from the cookie
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
        
        // Categorize based on preferences
        if (preferences && 
            preferences.functional !== undefined && 
            preferences.performance !== undefined && 
            preferences.advertising !== undefined) {
          
          if (preferences.functional === true && preferences.performance === true && preferences.advertising === true) {
            category1.push(cookie.domain);
          } else if (preferences.functional === false && preferences.performance === false && preferences.advertising === false) {
            category2.push(cookie.domain);
          } else if (preferences.functional === true && preferences.performance === true && preferences.advertising === false) {
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
    
    // Wrap in async function to use await
    (async () => {
      try {
        // Convert chrome.storage.local.get to promise
        const result = await new Promise((resolve) => {
          chrome.storage.local.get(null, (result) => resolve(result));
        });
        
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

        // Categorize websites to determine which types are available
        const websiteTypes = categorizeWebsites(cookieData);
        console.log("Content script: Website types available:", websiteTypes);

        // Create payload (WITHOUT hasDiscrepancies - that will be checked later)
        const payload = {
          eligibleSitesCount: uniqueDomainsArray.length,
          isEligible: uniqueDomainsArray.length >= 10,
          totalSites: cookieData.length,
          uniqueDomains: uniqueDomainsArray,
          websiteTypes: websiteTypes
        };
        
        console.log("Content script: Sending eligibility response:", payload);
        
        window.postMessage({
          type: "FROM_EXTENSION_ELIGIBILITY",
          payload: payload
        }, "*");
        
      } catch (error) {
        console.error("Content script: Error in eligibility check:", error);
      }
    })(); // Immediately invoke the async function
    
    return;
  }

  // Check for discrepancies after user sets preferences
  if(event.data.payload?.action === "checkDiscrepancies") {
    console.log("Content script: Received discrepancy check request");
    
    (async () => {
      try {
        // Get user preferences
        const prefsResult = await new Promise((resolve) => {
          chrome.storage.local.get('userCookiePreferences', (result) => resolve(result));
        });
        
        // Get cookie data and selected domains
        const cookieResult = await new Promise((resolve) => {
          chrome.storage.local.get(['cookieData', 'selectedDomainsForHistory'], (result) => resolve(result));
        });
        
        const userPreferences = prefsResult.userCookiePreferences;
        const cookieData = cookieResult.cookieData || [];
        const selectedDomains = cookieResult.selectedDomainsForHistory || [];
        
        console.log("Content script: User preferences count:", userPreferences?.length || 0);
        console.log("Content script: Cookie data count:", cookieData.length);
        console.log("Content script: Selected domains count:", selectedDomains.length);
        
        let hasDiscrepancies = false;
        
        if (userPreferences && userPreferences.length > 0) {
          const prefsMap = new Map(userPreferences);
          console.log("Content script: Preferences map size:", prefsMap.size);
          
          // Use selected domains if available, otherwise use all eligible sites
          const domainsToCheck = selectedDomains.length > 0 
            ? selectedDomains 
            : cookieData.filter(site => site.actionTaken === "Yes");
          
          console.log("Content script: Checking", domainsToCheck.length, "domains for discrepancies");
          
          // Check for discrepancies
          for (const domainObj of domainsToCheck) {
            const domain = domainObj.originalDomain || domainObj.domain;
            if (!domain) continue;
            
            console.log(`Content script: Checking domain: ${domain}`);
            
            // Try to find matching user preference with multiple formats
            const possibleFormats = [
              domain,
              domain.startsWith('.') ? domain.substring(1) : '.' + domain,
              domain.replace(/^\./, ''),
              domain.replace(/^www\./, ''),
              'www.' + domain.replace(/^\./, '')
            ];
            
            let userPref = null;
            let matchedFormat = null;
            for (const format of possibleFormats) {
              if (prefsMap.has(format)) {
                userPref = prefsMap.get(format);
                matchedFormat = format;
                break;
              }
            }
            
            if (!userPref) {
              console.log(`Content script: No preferences found for ${domain}`);
              continue;
            }
            
            console.log(`Content script: Found preferences for ${matchedFormat}:`, userPref);
            
            // Get actual cookie preferences
            let actualPrefs = {
              functional: false,
              performance: false,
              advertising: false
            };
            
            if (domainObj.categories) {
              actualPrefs = {
                functional: domainObj.categories.functional === true,
                performance: domainObj.categories.performance === true,
                advertising: domainObj.categories.advertising === true
              };
            } else {
              // Try to find in cookieData
              const cookieMatch = cookieData.find(c => 
                c.domain === domain || 
                c.domain === domainObj.originalDomain ||
                c.domain.replace(/^\./, '') === domain.replace(/^\./, '')
              );
              
              if (cookieMatch && cookieMatch.categories) {
                actualPrefs = {
                  functional: cookieMatch.categories.functional === true,
                  performance: cookieMatch.categories.performance === true,
                  advertising: cookieMatch.categories.advertising === true
                };
              }
            }
            
            console.log(`Content script: Actual preferences for ${domain}:`, actualPrefs);
            
            // Check for discrepancies using 5-point scale logic
            const categories = ['functional', 'performance', 'advertising'];
            for (const category of categories) {
              const userValue = userPref[category];
              if (typeof userValue === 'number') {
                const actualAccepted = actualPrefs[category];
                // Discrepancy = accepted but user chose 1-2, OR rejected but user chose 4-5
                if ((actualAccepted && userValue <= 2) || (!actualAccepted && userValue >= 4)) {
                  hasDiscrepancies = true;
                  console.log(` Content script: DISCREPANCY FOUND for ${domain}, category ${category}`);
                  console.log(`   User value: ${userValue}, Actual: ${actualAccepted ? 'Allowed' : 'Not Allowed'}`);
                  break;
                }
              }
            }
            
            if (hasDiscrepancies) break; // Stop checking once we find one
          }
        } else {
          console.log("Content script: No user preferences found");
        }
        
        console.log("Content script: Final discrepancy result:", hasDiscrepancies);
        
        window.postMessage({
          type: "FROM_EXTENSION_DISCREPANCIES",
          payload: { hasDiscrepancies: hasDiscrepancies }
        }, "*");
        
      } catch (error) {
        console.error("Content script: Error checking discrepancies:", error);
        window.postMessage({
          type: "FROM_EXTENSION_DISCREPANCIES",
          payload: { hasDiscrepancies: false }
        }, "*");
      }
    })();
    
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
    "pricrumbs_preferred_cookie_choices_functional": { html: "pricrumbs_preferred_cookie_choices_functional.html", height: "480px" },
    "pricrumbs_preferred_cookie_choices_performance": { html: "pricrumbs_preferred_cookie_choices_performance.html", height: "480px" },
    "pricrumbs_preferred_cookie_choices_advertising": { html: "pricrumbs_preferred_cookie_choices_advertising.html", height: "480px" },
    "pricrumbs_consent_history_top_websites": { html: "pricrumbs_consent_history_top_websites.html", height: "1020px" },
    "pricrumbs_consent_history_bottom_websites": { html: "pricrumbs_consent_history_bottom_websites.html", height: "600px" },
    "pricrumbs_website_all_cookies_accepted": { html: "pricrumbs_website_all_cookies_accepted.html", height: "245px" },
    "pricrumbs_website_all_cookies_rejected": { html: "pricrumbs_website_all_cookies_rejected.html", height: "245px" },
    "pricrumbs_website_advertising_cookies_rejected": { html: "pricrumbs_website_advertising_cookies_rejected.html", height: "245px" },
    "pricrumbs_website_all_cookies_default": { html: "pricrumbs_website_all_cookies_default.html", height: "245px" },
    "pricrumbs_websites_with_discripincies": { html: "pricrumbs_websites_with_discripincies.html", height: "950px" },
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

// Listen for preference check requests
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "CHECK_PREFERENCES") return;
  
  const category = event.data.payload?.category;
  if (!category) return;
  
  console.log(`Extension: Checking ${category} preferences`);
  
  // Check preferences and respond
  checkCategoryPreferences(category).then(result => {
    window.postMessage({
      type: "PREFERENCES_STATUS",
      payload: {
        category: category,
        isComplete: result.isComplete,
        completedCount: result.completedCount,
        totalCount: result.totalCount
      }
    }, "*");
  });
});

async function checkCategoryPreferences(category) {
  try {
    // Get selected domains
    const domainsResult = await ext.storage.local.get('selectedDomainsForHistory');
    const selectedDomains = domainsResult.selectedDomainsForHistory || [];
    
    if (selectedDomains.length === 0) {
      console.warn('No selected domains found');
      return { isComplete: false, completedCount: 0, totalCount: 0 };
    }
    
    // Get user preferences
    const prefsResult = await ext.storage.local.get('userCookiePreferences');
    const userPreferences = prefsResult.userCookiePreferences || [];
    const prefsMap = new Map(userPreferences);
    
    console.log(`Checking ${selectedDomains.length} domains for ${category} preferences`);
    
    let completedCount = 0;
    
    // Check each domain
    for (const domainObj of selectedDomains) {
      const domain = domainObj.originalDomain || domainObj.domain;
      const prefs = prefsMap.get(domain);
      
      // Check if this category has a value set (not null/undefined)
      if (prefs && prefs[category] !== null && prefs[category] !== undefined) {
        completedCount++;
        console.log(` ${domain}: ${category} = ${prefs[category]}`);
      } else {
        console.log(` ${domain}: ${category} = NOT SET`);
      }
    }
    
    console.log(`Result: ${completedCount}/${selectedDomains.length} complete`);
    
    return {
      isComplete: completedCount === selectedDomains.length && selectedDomains.length >= 10,
      completedCount: completedCount,
      totalCount: selectedDomains.length
    };
  } catch (error) {
    console.error('Error checking preferences:', error);
    return { isComplete: false, completedCount: 0, totalCount: 0 };
  }
}

// Run checker on initial load
checkForSurveyElement();