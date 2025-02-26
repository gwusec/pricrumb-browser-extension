// Content script

// Listens for messages from the webpage
// NOTE: manifest.json must be updated if website url changes
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "FROM_SURVEY") return;

  // Forward message to the background script
  chrome.runtime.sendMessage(event.data, (response) => {
    if (response) { // Ensure response exists before sending it back
      console.log("Received response from background:", response);
      window.postMessage({ type: "FROM_EXTENSION", payload: response }, "*");
    } else {
      console.warn("No response received from background script.");
    }
  });
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FROM_EXTENSION") {
      window.postMessage(message, "*");
  }
});
