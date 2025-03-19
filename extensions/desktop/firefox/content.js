// Content script
console.log("Content script is running!");

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "FROM_SURVEY") return;

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

// Listen for responses from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FROM_EXTENSION") {
    window.postMessage(request, "*");
  }
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.type !== "FROM_SURVEY") return;

  if (request.action === "checkForSurveyElement") {
    checkForSurveyElement();
  }

  if (request.action === "injectHTML") {
    injectHTML(request.elementId, request.htmlFile, request.invisible);
  }
});


// Gives a way to inject html content from this extension into a webpage as an iframe
// elementID = ID of element where iframe should be injected into
// htmlFile = name of .html file
// scriptFile = name of associated .js script
function injectHTML(elementId, htmlFile, height = "600px") {
  const targetElement = document.getElementById(elementId);
  if (targetElement) {
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL(htmlFile);

    iframe.style.width = "100%";
    iframe.style.height = height;
    iframe.style.border = "none"; 

    targetElement.appendChild(iframe);
  } else {
    console.error("Error injecting iframe - Element not found:", elementId);
  }
}

// Function to check if the element with ID "extensionPageID" exists
function checkForSurveyElement() {
  const elementId_main = "popup"; // popup.html
  const elementId_main_invisible = "popup_invisible"; // popup.html (invisible)
  const elementId_1_1 = "pricrumbs_preferred_cookie_choices_functional"; // pricrumbs_preferred_cookie_choices_functional.html
  const elementId_1_2 = "pricrumbs_preferred_cookie_choices_performance"; // pricrumbs_preferred_cookie_choices_performance.html
  const elementId_1_3 = "pricrumbs_preferred_cookie_choices_advertising"; // pricrumbs_preferred_cookie_choices_advertising.html
  const elementId_2_1 = "pricrumbs_consent_history_top_websites"; // pricrumbs_consent_history_top_websites.html
  const elementId_2_2 = "pricrumbs_consent_history_bottom_websites"; // pricrumbs_consent_history_bottom_websites.html
  const elementId_3_1 = "pricrumbs_website_all_cookies_accepted"; // pricrumbs_website_all_cookies_accepted.html
  const elementId_3_2 = "pricrumbs_website_all_cookies_rejected"; // pricrumbs_website_all_cookies_rejected.html
  const elementId_3_3 = "pricrumbs_website_advertising_cookies_rejected"; // pricrumbs_website_advertising_cookies_rejected.html

  // Look for element with target ID on page
  const observer_main = new MutationObserver((mutations, observer) => {
      const targetElement = document.getElementById(elementId_main);
      if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect(); // Stop observing once found
        injectHTML("popup", "popup.html");
      }
  });
  const observer_main_invisible = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_main_invisible);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("popup_invisible", "popup.html", "0px");
    }
  });
  const observer_1_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_preferred_cookie_choices_functional", "pricrumbs_preferred_cookie_choices_functional.html");
    }
  });
  const observer_1_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_preferred_cookie_choices_performance", "pricrumbs_preferred_cookie_choices_performance.html");
    }
  });
  const observer_1_3 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_1_3);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_preferred_cookie_choices_advertising", "pricrumbs_preferred_cookie_choices_advertising.html");
    }
  });
  const observer_2_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_2_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_consent_history_top_websites", "pricrumbs_consent_history_top_websites.html");
    }
  });
  const observer_2_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_2_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_consent_history_bottom_websites", "pricrumbs_consent_history_bottom_websites.html");
    }
  });
  const observer_3_1 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_1);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_website_all_cookies_accepted", "pricrumbs_website_all_cookies_accepted.html", "265px");
    }
  });
  const observer_3_2 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_2);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_website_all_cookies_rejected", "pricrumbs_website_all_cookies_rejected.html", "265px");
    }
  });
  const observer_3_3 = new MutationObserver((mutations, observer) => {
    const targetElement = document.getElementById(elementId_3_3);
    if (targetElement && !targetElement.querySelector("iframe")) {
        observer.disconnect();
        injectHTML("pricrumbs_website_advertising_cookies_rejected", "pricrumbs_website_advertising_cookies_rejected.html", "265px");
    }
  });

  // Start the observers
  observer_main.observe(document.body, { childList: true, subtree: true });
  observer_main_invisible.observe(document.body, { childList: true, subtree: true });
  observer_1_1.observe(document.body, { childList: true, subtree: true });
  observer_1_2.observe(document.body, { childList: true, subtree: true });
  observer_1_3.observe(document.body, { childList: true, subtree: true });
  observer_2_1.observe(document.body, { childList: true, subtree: true });
  observer_2_2.observe(document.body, { childList: true, subtree: true });
  observer_3_1.observe(document.body, { childList: true, subtree: true });
  observer_3_2.observe(document.body, { childList: true, subtree: true });
  observer_3_3.observe(document.body, { childList: true, subtree: true });

  // Check immediately in case the element is already present
  const existingElement_main = document.getElementById(elementId_main);
  const existingElement_main_invisible = document.getElementById(elementId_main_invisible);
  const existingElement_1_1 = document.getElementById(elementId_1_1);
  const existingElement_1_2 = document.getElementById(elementId_1_2);
  const existingElement_1_3 = document.getElementById(elementId_1_3);
  const existingElement_2_1 = document.getElementById(elementId_2_1);
  const existingElement_2_2 = document.getElementById(elementId_2_2);
  const existingElement_3_1 = document.getElementById(elementId_3_1);
  const existingElement_3_2 = document.getElementById(elementId_3_2);
  const existingElement_3_3 = document.getElementById(elementId_3_3);

  if (existingElement_main && !existingElement_main.querySelector("iframe")) {
    observer_main.disconnect();
    injectHTML("popup", "popup.html");
  }
  if (existingElement_main_invisible && !existingElement_main_invisible.querySelector("iframe")) {
    observer_main.disconnect();
    injectHTML("popup_invisible", "popup.html", "0px");
  }
  if (existingElement_1_1 && !existingElement_1_1.querySelector("iframe")) {
    observer_1_1.disconnect();
    injectHTML("pricrumbs_preferred_cookie_choices_functional", "pricrumbs_preferred_cookie_choices_functional.html");
  }
  if (existingElement_1_2 && !existingElement_1_2.querySelector("iframe")) {
    observer_1_2.disconnect();
    injectHTML("pricrumbs_preferred_cookie_choices_performance", "pricrumbs_preferred_cookie_choices_performance.html");
  }
  if (existingElement_1_3 && !existingElement_1_3.querySelector("iframe")) {
    observer_1_3.disconnect();
    injectHTML("pricrumbs_preferred_cookie_choices_advertising", "pricrumbs_preferred_cookie_choices_advertising.html");
  }
  if (existingElement_2_1 && !existingElement_2_1.querySelector("iframe")) {
    observer_2_1.disconnect();
    injectHTML("pricrumbs_consent_history_top_websites", "pricrumbs_consent_history_top_websites.html");
  }
  if (existingElement_2_2 && !existingElement_2_2.querySelector("iframe")) {
    observer_2_2.disconnect();
    injectHTML("pricrumbs_consent_history_bottom_websites", "pricrumbs_consent_history_bottom_websites.html");
  }
  if (existingElement_3_1 && !existingElement_3_1.querySelector("iframe")) {
    observer_3_1.disconnect();
    injectHTML("pricrumbs_website_all_cookies_accepted", "pricrumbs_website_all_cookies_accepted.html", "265px");
  }
  if (existingElement_3_2 && !existingElement_3_2.querySelector("iframe")) {
    observer_3_2.disconnect();
    injectHTML("pricrumbs_website_all_cookies_rejected", "pricrumbs_website_all_cookies_rejected.html", "265px");
  }
  if (existingElement_3_3 && !existingElement_3_3.querySelector("iframe")) {
    observer_3_3.disconnect();
    injectHTML("pricrumbs_website_advertising_cookies_rejected", "pricrumbs_website_advertising_cookies_rejected.html", "265px");
  }
}