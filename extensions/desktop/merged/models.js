// Cross-compatible message listener (both chrome and firefox)
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkCookies") {
    ext.cookies.getAll({}, (cookies) => {
      if (ext.runtime.lastError) {
        console.error("Error retrieving cookies:", ext.runtime.lastError);
        sendResponse({ cookies: [] });
        return;
      }
      const filteredCookies = cookies.filter(cookie =>
        message.cookieNames.includes(cookie.name)
      );
      sendResponse({ cookies: filteredCookies });
    });
    return true; // Keep the message channel open for async response
  }

  if (message.action === "downloadCookies") {
    try {
      const data = JSON.stringify(message.cookies, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      ext.downloads.download({
        url,
        filename: "cookies.json"
      }, (downloadId) => {
        if (ext.runtime.lastError) {
          console.error("Download failed:", ext.runtime.lastError);
        } else {
          console.log("Download started with ID:", downloadId);
        }
      });
    } catch (e) {
      console.error("Error preparing cookie download:", e);
    }
  }
});