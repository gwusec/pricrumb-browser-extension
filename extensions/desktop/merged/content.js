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
  if (request.type === "FROM_EXTENSION") {
    window.postMessage(request, "*");
  }
});
