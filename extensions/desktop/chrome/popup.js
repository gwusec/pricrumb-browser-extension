document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('check').addEventListener('click', () => {
    const cookieDictionary = {
      "cookieyes-consent": 0
    };
    chrome.runtime.sendMessage({action: 'checkCookies', cookieDictionary: cookieDictionary}, (response) => {
      let cookieListDiv = document.getElementById('cookieList');
      cookieListDiv.innerHTML = '';
      response.cookies.forEach(cookie => {
        let cookieDiv = document.createElement('div');
        cookieDiv.className = 'cookie';
        let valueParts = cookie.value.split(',');
        valueParts.splice(cookieDictionary[cookie.name], 1); // Remove the specified index
        let formattedValue = valueParts.join('<br>');
        cookieDiv.innerHTML = `
          <strong>Name:</strong> ${cookie.name}<br>
          <strong>Domain:</strong> ${cookie.domain}<br>
          <strong>Value:</strong><br>${formattedValue}
        `;
        cookieListDiv.appendChild(cookieDiv);
      });
      document.getElementById('download').addEventListener('click', () => {
        chrome.runtime.sendMessage({action: 'downloadCookies', cookies: response.cookies, cookieDictionary: cookieDictionary});
      });
    });
  });
});
