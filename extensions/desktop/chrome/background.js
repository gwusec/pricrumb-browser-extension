chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkCookies') {
    const cookieDictionary = request.cookieDictionary;
    chrome.cookies.getAll({}, (cookies) => {
      let filteredCookies = cookies.filter(cookie => cookieDictionary.hasOwnProperty(cookie.name));
      sendResponse({cookies: filteredCookies});
    });
    return true; // Keep the message channel open for sendResponse
  } else if (request.action === 'downloadCookies') {
    const cookieDictionary = request.cookieDictionary;
    const cookieList = request.cookies.map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      value: cookie.value.split(',').filter((_, index) => index !== cookieDictionary[cookie.name]).join('\n')
    }));
    let blob = new Blob([JSON.stringify(cookieList, null, 2)], {type: 'application/json'});
    let reader = new FileReader();
    reader.onload = function() {
      let url = reader.result;
      chrome.downloads.download({
        url: url,
        filename: 'cookies.json'
      });
    };
    reader.readAsDataURL(blob);
  }
});
