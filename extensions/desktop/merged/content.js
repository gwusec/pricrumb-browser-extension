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