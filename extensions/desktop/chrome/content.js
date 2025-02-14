// Content script

// Listens for events from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("EventAPI", (event) => {
    if (event.source !== window || !event.data || event.data.type !== "FROM_WEBSITE") return;
  
    // Forward the message to the extension
    chrome.runtime.sendMessage(event.data.payload, (response) => {
      window.postMessage({ type: "FROM_EXTENSION", payload: response }, "*");
    });
  });
  