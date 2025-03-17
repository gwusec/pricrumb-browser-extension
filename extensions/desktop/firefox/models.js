chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkCookies") {
    chrome.cookies.getAll({}, (cookies) => {
      const filteredCookies = cookies.filter(cookie => message.cookieNames.includes(cookie.name));
      sendResponse({ cookies: filteredCookies });
    });
    return true; // Keep the message channel open for async response
  }

  if (message.action === "downloadCookies") {
    const data = JSON.stringify(message.cookies, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url,
      filename: 'cookies.json',
    });
  }
});
