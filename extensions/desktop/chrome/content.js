// Content script

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "FROM_SURVEY") return;

  // Forward message to the background script
  chrome.runtime.sendMessage(event.data, (response) => {
      // Send the response back to the webpage
      window.postMessage({ type: "FROM_EXTENSION", payload: response }, "*");
  });
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FROM_EXTENSION") {
      window.postMessage(message, "*");
  }
});
