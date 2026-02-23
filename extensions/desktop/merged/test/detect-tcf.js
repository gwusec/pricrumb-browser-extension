// detect-tcf.js
const tcfConfig = require('../tcf_strings.json');

function detectTCF({ cookies = {}, localStorage = {}, sessionStorage = {} }) {
  const result = {
    cookies: [],
    localStorage: [],
    sessionStorage: []
  };

  for (const key of tcfConfig.tcfCookies || []) {
    if (cookies[key]) result.cookies.push(key);
  }

  for (const key of tcfConfig.localStorage || []) {
    if (localStorage[key]) result.localStorage.push(key);
  }

  for (const key of tcfConfig.sessionStorage || []) {
    if (sessionStorage[key]) result.sessionStorage.push(key);
  }

  return result;
}

module.exports = { detectTCF };
