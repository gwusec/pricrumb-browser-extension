// popup.js

document.addEventListener('DOMContentLoaded', () => {
  // Define the consent and alert box cookie names to look for
  const cookieNames = [
    "OptanonConsent",          // OneTrust
    "OptanonAlertBoxClosed",   // OneTrust Alert Box Closed
    "cookieyes-consent",       // CookieYes
    "wscrCookieConsent",       // WSCR
    "cmplz_rt_functional",     // Complianz (functional)
    "cmplz_rt_marketing",      // Complianz (marketing)
    "cmplz_rt_preferences",    // Complianz (preferences)
    "cmplz_rt_statistics",     // Complianz (statistics)
    "cmplz_rt_banner-status",  // Complianz (banner status)
    "uc_userconsent",          // Usercentrics
    "quantcast_consent",       // Quantcast
    "CookieConsent",           // Cookiebot
    "osano_consent",           // Osano
    "cookie_notice",           // Cookie Notice
    "cookie_law_info",         // Cookie Law Info
    "TrustArcConsent"          // TrustArc
  ];

  let fetchedCookies = [];

  /**
   * Parses a cookie string into an object.
   * @param {string} value - The cookie string.
   * @returns {Object} - Parsed key-value pairs.
   */
  function parseCookieString(value) {
    try {
      // Handle different encoding schemes if necessary
      return value.split('&').reduce((obj, pair) => {
        const [key, val] = pair.split('=');
        obj[key] = decodeURIComponent(val || '');
        return obj;
      }, {});
    } catch (err) {
      console.error("Error parsing cookie string:", value, err);
      return {};
    }
  }

  /**
   * Adds formatted date fields to a cookie object.
   * @param {Object} cookie - The cookie object.
   * @returns {Object} - Cookie object with date fields.
   */
  function addDateFields(cookie) {
    return {
      timestamp: cookie.creationDate
        ? new Date(cookie.creationDate * 1000).toLocaleString()
        : "Unknown",
      expiration: cookie.expirationDate
        ? new Date(cookie.expirationDate * 1000).toLocaleString()
        : "Session Cookie",
      firstVisited: cookie.firstVisited
        ? new Date(cookie.firstVisited).toLocaleString()
        : "Unknown",
      lastVisited: cookie.lastVisited
        ? new Date(cookie.lastVisited).toLocaleString()
        : "Unknown",
    };
  }

  /**
   * Decodes OneTrust consent cookie data.
   * @param {string} value - The OptanonConsent cookie value.
   * @param {Object} alertBoxClosedCookie - The OptanonAlertBoxClosed cookie object.
   * @param {Object} cookie - The original OptanonConsent cookie object.
   * @returns {Object} - Decoded consent information including actionTaken.
   */
  function decodeOneTrust(value, alertBoxClosedCookie, cookie) {
    const data = parseCookieString(value);

    // Define mappings for group identifiers to categories
    const groupMappings = {};

    if (data.groups) {
      // Split groups by comma
      const groups = data.groups.split(',');

      groups.forEach(pair => {
        const [group, val] = pair.split(':');
        const consentGiven = val === '1';

        // Check if group starts with 'C' (e.g., 'C0001') or is numeric
        if (group.startsWith('C')) {
          // Standard OneTrust group identifiers
          switch (group) {
            case 'C0001':
              groupMappings['necessary'] = consentGiven;
              break;
            case 'C0002':
              groupMappings['performance'] = consentGiven;
              break;
            case 'C0003':
              groupMappings['functional'] = consentGiven;
              break;
            case 'C0004':
              groupMappings['advertising'] = consentGiven;
              break;
            // Add more cases if there are additional categories
            default:
              console.warn(`Unknown OneTrust group identifier: ${group}`);
          }
        } else {
          // Numeric group identifiers
          switch (group) {
            case '1':
              groupMappings['necessary'] = consentGiven;
              break;
            case '3':
              groupMappings['functional'] = consentGiven;
              break;
            case '4':
              groupMappings['advertising'] = consentGiven;
              break;
            // Add more cases based on your specific OneTrust configuration
            default:
              console.warn(`Unknown numeric OneTrust group identifier: ${group}`);
          }
        }
      });
    }

    let parsedTimestamp = "Unknown";

    // Parse the datestamp if available
    if (data.datestamp) {
      try {
        const normalizedDatestamp = data.datestamp.replace(/\+/g, ' ');
        const parsedDate = new Date(normalizedDatestamp);
        if (!isNaN(parsedDate)) {
          parsedTimestamp = parsedDate.toLocaleString();
        }
      } catch (error) {
        console.error("Error parsing datestamp:", data.datestamp, error);
      }
    }

    // Determine actionTaken based on the presence of OptanonAlertBoxClosed cookie and interactionCount > 0
    let actionTaken = "No";
    if (alertBoxClosedCookie && data.interactionCount && parseInt(data.interactionCount) > 0) {
      actionTaken = "Yes";
    }

    console.log("OneTrust Decoded:", {
      cmpName: "OneTrust",
      timestamp: parsedTimestamp,
      necessary: groupMappings['necessary'] || false,
      performance: groupMappings['performance'] || false,
      functional: groupMappings['functional'] || false,
      advertising: groupMappings['advertising'] || false,
      actionTaken: actionTaken,
      misc: {
        consentId: data.consentId || null,
        interactionCount: data.interactionCount || 0,
      },
    });

    return {
      cmpName: "OneTrust",
      ...addDateFields(cookie),
      timestamp: parsedTimestamp,
      necessary: groupMappings['necessary'] || false,
      functional: groupMappings['functional'] || false,
      performance: groupMappings['performance'] || false,
      advertising: groupMappings['advertising'] || false,
      misc: {
        consentId: data.consentId || null,
        interactionCount: data.interactionCount || 0,
      },
      actionTaken, // Add actionTaken field based on OptanonAlertBoxClosed and interactionCount
    };
  }

  /**
   * Decodes CookieYes consent cookie data.
   * @param {string} value - The cookie value.
   * @param {Object} cookie - The original cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeCookieYes(value, cookie) {
    const data = value.split(',').reduce((acc, pair) => {
      const [key, val] = pair.split(':');
      acc[key] = val || null;
      return acc;
    }, {});

    console.log("CookieYes Decoded:", {
      cmpName: "CookieYes",
      necessary: data.necessary === 'yes',
      functional: data.functional === 'yes',
      analytics: data.analytics === 'yes',
      performance: data.performance === 'yes',
      advertising: data.advertisement === 'yes',
      consent: data.consent === 'yes' ? "Full" : data.consent === 'no' ? "Partial" : "Unknown",
      actionTaken: data.action === 'yes' ? "Yes" : "No",
      misc: {
        consentId: data.consentid || null,
      },
    });

    return {
      cmpName: "CookieYes",
      ...addDateFields(cookie),
      necessary: data.necessary === 'yes',
      functional: data.functional === 'yes',
      analytics: data.analytics === 'yes',
      performance: data.performance === 'yes',
      advertising: data.advertisement === 'yes',
      consent: data.consent === 'yes' ? "Full" : data.consent === 'no' ? "Partial" : "Unknown",
      actionTaken: data.action === 'yes' ? "Yes" : "No", // Assuming 'action' key signifies action taken
      misc: {
        consentId: data.consentid || null,
      },
    };
  }

  /**
   * Decodes WSCR consent cookie data.
   * @param {string} value - The wscrCookieConsent cookie value.
   * @param {Object} cookie - The original wscrCookieConsent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeWSCR(value, cookie) {
    try {
      // Assuming WSCR stores consent data in JSON format
      const data = JSON.parse(value);

      console.log("WSCR Decoded:", {
        cmpName: "WSCR",
        necessary: data.necessary || false,
        functional: data.functional || false,
        performance: data.performance || false,
        advertising: data.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        },
      });

      return {
        cmpName: "WSCR",
        ...addDateFields(cookie),
        necessary: data.necessary || false,
        functional: data.functional || false,
        performance: data.performance || false,
        advertising: data.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No", // Assuming a boolean flag
        misc: {
          consentId: data.consentId || null,
        },
      };
    } catch (error) {
      console.error("Error parsing WSCR cookie:", value, error);
      return {
        cmpName: "WSCR",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Usercentrics consent cookie data.
   * @param {string} value - The uc_userconsent cookie value.
   * @param {Object} cookie - The original uc_userconsent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeUsercentrics(value, cookie) {
    try {
      // Usercentrics stores consent data as a JSON string
      const data = JSON.parse(value);
      
      // Example structure, adjust according to actual data
      return {
        cmpName: "Usercentrics",
        ...addDateFields(cookie),
        necessary: data.consents.necessary || false,
        functional: data.consents.functional || false,
        performance: data.consents.performance || false,
        advertising: data.consents.advertising || false,
        consent: data.consents.consentStatus || "Unknown",
        actionTaken: data.consents.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Usercentrics cookie:", value, error);
      return {
        cmpName: "Usercentrics",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Quantcast consent cookie data.
   * @param {string} value - The quantcast_consent cookie value.
   * @param {Object} cookie - The original quantcast_consent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeQuantcast(value, cookie) {
    try {
      // Quantcast might store consent as a base64-encoded JSON string
      const decodedValue = atob(value); // Decode from base64
      const data = JSON.parse(decodedValue);
      
      // Example structure, adjust according to actual data
      return {
        cmpName: "Quantcast",
        ...addDateFields(cookie),
        necessary: data.necessary || false,
        functional: data.functional || false,
        performance: data.performance || false,
        advertising: data.advertising || false,
        consent: data.consentStatus || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Quantcast cookie:", value, error);
      return {
        cmpName: "Quantcast",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Cookiebot consent cookie data.
   * @param {string} value - The CookieConsent cookie value.
   * @param {Object} cookie - The original CookieConsent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeCookiebot(value, cookie) {
    try {
      // Preprocess the CookieConsent value to convert it into valid JSON
      const jsonStr = convertToJSON(value);
      const data = JSON.parse(jsonStr);
      
      // Example structure, adjust according to actual data
      return {
        cmpName: "Cookiebot",
        ...addDateFields(cookie),
        necessary: data.necessary || false,
        functional: data.preferences || false,
        performance: data.statistics || false,
        advertising: data.marketing || false,
        consent: data.consent || "Unknown",
        actionTaken: data.method && data.method !== 'implied' ? "Yes" : "No",
        misc: {
          consentId: data.id || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Cookiebot cookie:", value, error);
      return {
        cmpName: "Cookiebot",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Osano consent cookie data.
   * @param {string} value - The osano_consent cookie value.
   * @param {Object} cookie - The original osano_consent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeOsano(value, cookie) {
    try {
      // Osano stores consent data as a JSON string
      const data = JSON.parse(value);

      console.log("Osano Decoded:", {
        cmpName: "Osano",
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        },
      });

      return {
        cmpName: "Osano",
        ...addDateFields(cookie),
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Osano cookie:", value, error);
      return {
        cmpName: "Osano",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Cookie Notice consent cookie data.
   * @param {string} value - The cookie_notice cookie value.
   * @param {Object} cookie - The original cookie_notice cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeCookieNotice(value, cookie) {
    try {
      // Cookie Notice stores consent data as a JSON string
      const data = JSON.parse(value);

      console.log("Cookie Notice Decoded:", {
        cmpName: "Cookie Notice",
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        },
      });

      return {
        cmpName: "Cookie Notice",
        ...addDateFields(cookie),
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Cookie Notice cookie:", value, error);
      return {
        cmpName: "Cookie Notice",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes Cookie Law Info consent cookie data.
   * @param {string} value - The cookie_law_info cookie value.
   * @param {Object} cookie - The original cookie_law_info cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeCookieLawInfo(value, cookie) {
    try {
      // Cookie Law Info stores consent data as a JSON string
      const data = JSON.parse(value);

      console.log("Cookie Law Info Decoded:", {
        cmpName: "Cookie Law Info",
        necessary: data.necessary || false,
        functional: data.functional || false,
        performance: data.performance || false,
        advertising: data.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        },
      });

      return {
        cmpName: "Cookie Law Info",
        ...addDateFields(cookie),
        necessary: data.necessary || false,
        functional: data.functional || false,
        performance: data.performance || false,
        advertising: data.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing Cookie Law Info cookie:", value, error);
      return {
        cmpName: "Cookie Law Info",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Decodes TrustArc consent cookie data.
   * @param {string} value - The TrustArcConsent cookie value.
   * @param {Object} cookie - The original TrustArcConsent cookie object.
   * @returns {Object} - Decoded consent information.
   */
  function decodeTrustArc(value, cookie) {
    try {
      // TrustArc stores consent data as a JSON string
      const data = JSON.parse(value);

      console.log("TrustArc Decoded:", {
        cmpName: "TrustArc",
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        },
      });

      return {
        cmpName: "TrustArc",
        ...addDateFields(cookie),
        necessary: data.categories.necessary || false,
        functional: data.categories.functional || false,
        performance: data.categories.performance || false,
        advertising: data.categories.advertising || false,
        consent: data.consent || "Unknown",
        actionTaken: data.actionTaken ? "Yes" : "No",
        misc: {
          consentId: data.consentId || null,
        }
      };
    } catch (error) {
      console.error("Error parsing TrustArc cookie:", value, error);
      return {
        cmpName: "TrustArc",
        ...addDateFields(cookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Converts a non-JSON string to a valid JSON string.
   * Specifically tailored for Cookiebot's CookieConsent format.
   * @param {string} str - The original cookie string.
   * @returns {string} - The JSON-compliant string.
   */
  function convertToJSON(str) {
    // Step 1: Decode URL encoding
    let decodedStr = decodeURIComponent(str);

    // Step 2: Replace single quotes with double quotes
    decodedStr = decodedStr.replace(/'/g, '"');

    // Step 3: Add double quotes around property names
    decodedStr = decodedStr.replace(/(\w+):/g, '"$1":');

    return decodedStr;
  }

  /**
   * Decodes CMP-specific consent cookies.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Decoded consent information or null if not applicable.
   */
  function decodeCMPValue(cookies, currentCookie) {
    switch (currentCookie.name) {
      case "OptanonConsent":
        // Find the corresponding OptanonAlertBoxClosed cookie for the same domain
        const alertBoxClosedCookie = cookies.find(cookie => 
          cookie.name === "OptanonAlertBoxClosed" && cookie.domain === currentCookie.domain
        );
        return decodeOneTrust(currentCookie.value, alertBoxClosedCookie, currentCookie);
      case "cookieyes-consent":
        return decodeCookieYes(currentCookie.value, currentCookie);
      case "wscrCookieConsent":
        return decodeWSCR(currentCookie.value, currentCookie);
      case "cmplz_rt_functional":
      case "cmplz_rt_marketing":
      case "cmplz_rt_preferences":
      case "cmplz_rt_statistics":
      case "cmplz_rt_banner-status":
        // Only decode Complianz once per domain by processing the banner-status cookie
        if (currentCookie.name === "cmplz_rt_banner-status") {
          return decodeComplianz(cookies, currentCookie);
        }
        return null; // Skip other Complianz cookies to prevent duplicates
      case "uc_userconsent":
        return decodeUsercentrics(currentCookie.value, currentCookie);
      case "quantcast_consent":
        return decodeQuantcast(currentCookie.value, currentCookie);
      case "CookieConsent":
        return decodeCookiebot(currentCookie.value, currentCookie);
      case "osano_consent":
        return decodeOsano(currentCookie.value, currentCookie);
      case "cookie_notice":
        return decodeCookieNotice(currentCookie.value, currentCookie);
      case "cookie_law_info":
        return decodeCookieLawInfo(currentCookie.value, currentCookie);
      case "TrustArcConsent":
        return decodeTrustArc(currentCookie.value, currentCookie);
      default:
        return {
          cmpName: "Unknown",
          rawCookie: currentCookie.value,
          ...addDateFields(currentCookie),
          actionTaken: "No interaction recorded", // Default value for unknown CMPs
        };
    }
  }

  /**
   * Creates a consent object for display purposes.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Consent object with necessary fields or null.
   */
  function createConsentObject(cookies, currentCookie) {
    const decoded = decodeCMPValue(cookies, currentCookie);
    if (!decoded) return null; // Skip if the decoder returns null (handled separately)

    console.log("Creating Consent Object:", decoded);

    return {
      cmpName: decoded.cmpName,
      domain: currentCookie.domain,
      categories: {
        necessary: decoded.necessary,
        functional: decoded.functional,
        performance: decoded.performance,
        advertising: decoded.advertising,
      },
      timestamp: decoded.timestamp,
      expiration: decoded.expiration,
      firstVisited: decoded.firstVisited,
      lastVisited: decoded.lastVisited,
      totalVisitCount: currentCookie.totalVisitCount || 0,
      avgDailyVisits: currentCookie.avgDailyVisits || 0,
      rawCookie: decoded.rawCookie || currentCookie.value,
      actionTaken: decoded.actionTaken, // Add actionTaken to the object
      misc: decoded.misc || {},
    };
  }

  /**
   * Displays the fetched cookies in the popup table.
   * @param {Array} cookies - Array of consent objects.
   */
  function displayCookies(cookies) {
    console.log(`Displaying ${cookies.length} cookies in the table.`);

    const tableBody = document.getElementById("cookieTableBody");
    tableBody.innerHTML = "";

    cookies.forEach(cookie => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${cookie.domain || "Unknown"}</td>
        <td>${cookie.cmpName || "Unknown"}</td>
        <td>${cookie.categories.necessary ? "Yes" : "No"}</td>
        <td>${cookie.categories.functional ? "Yes" : "No"}</td>
        <td>${cookie.categories.performance ? "Yes" : "No"}</td>
        <td>${cookie.categories.advertising ? "Yes" : "No"}</td>
        <td>${cookie.timestamp || "Unknown"}</td>
        <td>${cookie.expiration || "Unknown"}</td>
        <td>${cookie.firstVisited || "Unknown"}</td>
        <td>${cookie.lastVisited || "Unknown"}</td>
        <td>${cookie.avgDailyVisits || 0}</td>
        <td>${cookie.totalVisitCount || 0}</td>
        <td>${cookie.actionTaken || "No"}</td> <!-- Display Action Taken as "No" by default -->
        <td>${cookie.rawCookie || "Unknown"}</td>
      `;
      tableBody.appendChild(row);
    });

    console.log("Cookies Displayed:", cookies);
  }

  /**
   * Fetches cookies and displays them in the popup.
   */
  function fetchAndDisplayCookies() {
    console.log("Sending message to background.js to check cookies...");

    chrome.runtime.sendMessage({ action: "checkCookies", cookieNames }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching cookies:", chrome.runtime.lastError);
      } else {
        if (!response || !response.cookies) {
          console.warn("No cookies received from background.js");
          alert("No cookies received.");
          return;
        }
        
        const allFetchedCookies = response.cookies;
        console.log("Fetched Cookies:", allFetchedCookies);
        // Filter consent cookies (excluding OptanonAlertBoxClosed and Complianz ancillary cookies)
        const consentCookies = allFetchedCookies.filter(cookie => 
          ["OptanonConsent", "cookieyes-consent", "wscrCookieConsent", "cmplz_rt_functional", "cmplz_rt_marketing", "cmplz_rt_preferences", "cmplz_rt_statistics", "cmplz_rt_banner-status", "uc_userconsent", "quantcast_consent", "CookieConsent", "osano_consent", "cookie_notice", "cookie_law_info", "TrustArcConsent"].includes(cookie.name)
        );

        console.log("Consent Cookies to Process:", consentCookies);

        // Create consent objects by processing each consent cookie
        fetchedCookies = consentCookies.map(consentCookie => createConsentObject(allFetchedCookies, consentCookie)).filter(Boolean);

        console.log("Fetched Consent Objects:", fetchedCookies);
         // DEBUG: Log the totalVisitCount values before storing
        console.log('Visit counts before storing:', 
        fetchedCookies.map(c => `${c.domain}: ${c.totalVisitCount}`));

      // Store the cookies in chrome.storage.local
        storeCookiesInStorage(fetchedCookies);

        displayCookies(fetchedCookies);
      }
    });
  }

  /**
   * Converts an HTML table to CSV format.
   * @param {HTMLElement} table - The HTML table element.
   * @returns {string} - CSV formatted string.
   */
  function convertTableToCSV(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    return rows.map(row => {
      const cols = Array.from(row.querySelectorAll("th, td"));
      return cols.map(col => {
        let data = col.textContent.trim();
        // Escape double quotes by doubling them
        data = data.replace(/"/g, '""');
        // If the data contains a comma, newline, or double quote, wrap it in double quotes
        if (data.search(/("|,|\n)/g) >= 0) {
          data = `"${data}"`;
        }
        return data;
      }).join(",");
    }).join("\n");
  }

  /**
   * Initiates the download of the table data as a CSV file.
   */
  function downloadCSV() {
    const table = document.getElementById("cookieTable");
    const csvData = convertTableToCSV(table);
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: 'cookie_table.csv',
      saveAs: true, // Show the "Save As" dialog for user selection
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError.message);
        alert("Failed to start download. Check the console for details.");
      } else {
        console.log("Download initiated:", downloadId);
        alert("Download started successfully!");
      }
    });

    // Revoke the object URL after a short delay to free up memory
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000); // 10 seconds
  }

  /**
   * Event listener for the "Download Cookies" button.
   * Handles downloading the cookies as a JSON file.
   */
  function setupDownloadCookiesListener() {
    document.getElementById("download").addEventListener("click", () => {
      if (fetchedCookies.length === 0) {
        alert("No cookies available to download.");
        return;
      }

      try {
        // Convert fetchedCookies to a JSON string
        const data = JSON.stringify(fetchedCookies, null, 2);

        // Create a Blob from the JSON string
        const blob = new Blob([data], { type: 'application/json' });

        // Generate a temporary URL for the Blob
        const url = URL.createObjectURL(blob);

        // Initiate the download using chrome.downloads.download
        chrome.downloads.download({
          url: url,
          filename: 'cookies.json',
          saveAs: true, // Show the "Save As" dialog for user selection
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error("Download failed:", chrome.runtime.lastError.message);
            alert("Failed to start download. Check the console for details.");
          } else {
            console.log("Download initiated:", downloadId);
            alert("Download started successfully!");
          }
        });

        // Revoke the object URL after a short delay to free up memory
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 10000); // 10 seconds
      } catch (error) {
        console.error("Error during download:", error);
        alert("An error occurred while trying to download the cookies.");
      }
    });
  }

  /**
   * Event listener for the "Download Table" button.
   * Handles downloading the table data as a CSV file.
   */
  function setupDownloadTableListener() {
    document.getElementById("downloadTable").addEventListener("click", () => {
      if (fetchedCookies.length === 0) {
        alert("No cookies available to download.");
        return;
      }

      try {
        downloadCSV();
      } catch (error) {
        console.error("Error during table download:", error);
        alert("An error occurred while trying to download the table.");
      }
    });
  }

  /**
   * Decodes Complianz consent cookie data.
   * Aggregates multiple Complianz cookies into a single consent object.
   * Ensures merging only when they share the same timestamp and domain.
   * @param {Array} cookies - Array of all cookies.
   * @param {Object} currentCookie - The current Complianz consent cookie being processed.
   * @returns {Object} - Decoded consent information.
   */
  function decodeComplianz(cookies, currentCookie) {
    try {
      // Complianz uses multiple cookies for different categories
      const functional = cookies.find(cookie => cookie.name === "cmplz_rt_functional");
      const marketing = cookies.find(cookie => cookie.name === "cmplz_rt_marketing");
      const preferences = cookies.find(cookie => cookie.name === "cmplz_rt_preferences");
      const statistics = cookies.find(cookie => cookie.name === "cmplz_rt_statistics");
      const bannerStatus = cookies.find(cookie => cookie.name === "cmplz_rt_banner-status");

      // Ensure that all Complianz cookies have the same domain and timestamp
      const domain = currentCookie.domain;
      const timestamp = addDateFields(currentCookie).timestamp;

      const allSameDomain = [functional, marketing, preferences, statistics, bannerStatus].every(cookie => 
        !cookie || cookie.domain === domain
      );

      const allSameTimestamp = [functional, marketing, preferences, statistics, bannerStatus].every(cookie => 
        !cookie || addDateFields(cookie).timestamp === timestamp
      );

      if (!allSameDomain || !allSameTimestamp) {
        console.warn("Complianz cookies do not share the same domain and timestamp. Skipping merge.");
        return null;
      }

      // Determine if action was taken based on the presence of cmplz_rt_banner-status
      let actionTaken = "No";
      if (bannerStatus) {
        actionTaken = "Yes";
      }

      // Determine consent status
      let consentStatus = "Unknown";
      // Check if only banner-status is present
      const hasOnlyBannerStatus = bannerStatus && 
        !functional && 
        !marketing && 
        !preferences && 
        !statistics;

      if (hasOnlyBannerStatus) {
        // Only banner-status found implies user rejected all except necessary
        consentStatus = "No";
      } else if (preferences) {
        // If preferences are present, determine consent based on their value
        if (preferences.value === 'allow') {
          consentStatus = "Partial"; // Assuming 'allow' implies partial consent
        } else if (preferences.value === 'deny') {
          consentStatus = "No"; // 'deny' implies no consent
        } else {
          consentStatus = "Unknown";
        }
      }

      console.log("Complianz Decoded:", {
        cmpName: "Complianz",
        timestamp: timestamp,
        necessary: true,
        functional: functional ? (functional.value === 'allow') : false,
        performance: statistics ? (statistics.value === 'allow') : false,
        advertising: marketing ? (marketing.value === 'allow') : false,
        consent: consentStatus,
        actionTaken: actionTaken,
        misc: {
          consentId: currentCookie.value || null,
        },
      });

      return {
        cmpName: "Complianz",
        ...addDateFields(currentCookie),
        timestamp: timestamp,
        necessary: true, // Usually, 'necessary' is always true
        functional: functional ? (functional.value === 'allow') : false,
        performance: statistics ? (statistics.value === 'allow') : false,
        advertising: marketing ? (marketing.value === 'allow') : false,
        consent: consentStatus,
        actionTaken: actionTaken, // Set to "Yes" or "No" based on bannerStatus
        misc: {
          consentId: currentCookie.value || null,
        },
      };
    } catch (error) {
      console.error("Error parsing Complianz cookies:", error);
      return {
        cmpName: "Complianz",
        ...addDateFields(currentCookie),
        necessary: "Unknown",
        functional: "Unknown",
        performance: "Unknown",
        advertising: "Unknown",
        consent: "Unknown",
        actionTaken: "Unknown",
        misc: {},
      };
    }
  }

  /**
   * Converts a non-JSON string to a valid JSON string.
   * Specifically tailored for Cookiebot's CookieConsent format.
   * @param {string} str - The original cookie string.
   * @returns {string} - The JSON-compliant string.
   */
  function convertToJSON(str) {
    // Step 1: Decode URL encoding
    let decodedStr = decodeURIComponent(str);

    // Step 2: Replace single quotes with double quotes
    decodedStr = decodedStr.replace(/'/g, '"');

    // Step 3: Add double quotes around property names
    decodedStr = decodedStr.replace(/(\w+):/g, '"$1":');

    return decodedStr;
  }

  /**
   * Decodes CMP-specific consent cookies.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Decoded consent information or null if not applicable.
   */
  function decodeCMPValue(cookies, currentCookie) {
    switch (currentCookie.name) {
      case "OptanonConsent":
        // Find the corresponding OptanonAlertBoxClosed cookie for the same domain
        const alertBoxClosedCookie = cookies.find(cookie => 
          cookie.name === "OptanonAlertBoxClosed" && cookie.domain === currentCookie.domain
        );
        return decodeOneTrust(currentCookie.value, alertBoxClosedCookie, currentCookie);
      case "cookieyes-consent":
        return decodeCookieYes(currentCookie.value, currentCookie);
      case "wscrCookieConsent":
        return decodeWSCR(currentCookie.value, currentCookie);
      case "cmplz_rt_functional":
      case "cmplz_rt_marketing":
      case "cmplz_rt_preferences":
      case "cmplz_rt_statistics":
      case "cmplz_rt_banner-status":
        // Only decode Complianz once per domain by processing the banner-status cookie
        if (currentCookie.name === "cmplz_rt_banner-status") {
          return decodeComplianz(cookies, currentCookie);
        }
        return null; // Skip other Complianz cookies to prevent duplicates
      case "uc_userconsent":
        return decodeUsercentrics(currentCookie.value, currentCookie);
      case "quantcast_consent":
        return decodeQuantcast(currentCookie.value, currentCookie);
      case "CookieConsent":
        return decodeCookiebot(currentCookie.value, currentCookie);
      case "osano_consent":
        return decodeOsano(currentCookie.value, currentCookie);
      case "cookie_notice":
        return decodeCookieNotice(currentCookie.value, currentCookie);
      case "cookie_law_info":
        return decodeCookieLawInfo(currentCookie.value, currentCookie);
      case "TrustArcConsent":
        return decodeTrustArc(currentCookie.value, currentCookie);
      default:
        return {
          cmpName: "Unknown",
          rawCookie: currentCookie.value,
          ...addDateFields(currentCookie),
          actionTaken: "No interaction recorded", // Default value for unknown CMPs
        };
    }
  }

  /**
   * Creates a consent object for display purposes.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Consent object with necessary fields or null.
   */
  // This function is repeated and already in line 689
  // function createConsentObject(cookies, currentCookie) {
  //   const decoded = decodeCMPValue(cookies, currentCookie);
  //   if (!decoded) return null; // Skip if the decoder returns null (handled separately)

  //   console.log("Creating Consent Object:", decoded);

  //   return {
  //     cmpName: decoded.cmpName,
  //     domain: currentCookie.domain,
  //     categories: {
  //       necessary: decoded.necessary,
  //       functional: decoded.functional,
  //       performance: decoded.performance,
  //       advertising: decoded.advertising,
  //     },
  //     timestamp: decoded.timestamp,
  //     expiration: decoded.expiration,
  //     firstVisited: decoded.firstVisited,
  //     lastVisited: decoded.lastVisited,
  //     rawCookie: decoded.rawCookie || currentCookie.value,
  //     actionTaken: decoded.actionTaken, // Add actionTaken to the object
  //     misc: decoded.misc || {},
  //   };
  // }

  /**
   * Displays the fetched cookies in the popup table.
   * @param {Array} cookies - Array of consent objects.
   */
      //-> This function is repeated and already in line 720?
  // function displayCookies(cookies) {
  //   const tableBody = document.getElementById("cookieTableBody");
  //   tableBody.innerHTML = "";

  //   cookies.forEach(cookie => {
  //     const row = document.createElement("tr");
  //     row.innerHTML = `
  //       <td>${cookie.domain || "Unknown"}</td>
  //       <td>${cookie.cmpName || "Unknown"}</td>
  //       <td>${cookie.categories.necessary ? "Yes" : "No"}</td>
  //       <td>${cookie.categories.functional ? "Yes" : "No"}</td>
  //       <td>${cookie.categories.performance ? "Yes" : "No"}</td>
  //       <td>${cookie.categories.advertising ? "Yes" : "No"}</td>
  //       <td>${cookie.timestamp || "Unknown"}</td>
  //       <td>${cookie.expiration || "Unknown"}</td>
  //       <td>${cookie.firstVisited || "Unknown"}</td>
  //       <td>${cookie.lastVisited || "Unknown"}</td>
  //       <td>${cookie.actionTaken || "No"}</td> <!-- Display Action Taken as "No" by default -->
  //       <td>${cookie.rawCookie || "Unknown"}</td>
  //     `;
  //     tableBody.appendChild(row);
  //   });

  //   console.log("Cookies Displayed:", cookies);
  // }

  //***************  updates to the code for Option 1:
  // Store cookies in chrome.storage.local when they're fetched
  function storeCookiesInStorage(cookies) {
    // Log visit counts before saving to storage
    console.log('Saving cookies to storage with visit counts:', 
      cookies.map(c => `${c.domain}: ${c.totalVisitCount}`));
      
    // Only call chrome.storage.local.set once
    chrome.storage.local.set({ 'cookieData': cookies }, function() {
      if (chrome.runtime.lastError) {
        console.error('Error saving cookies:', chrome.runtime.lastError);
      } else {
        console.log('Cookies saved to storage successfully');
        
        // Verify storage by retrieving it
        chrome.storage.local.get('cookieData', function(result) {
          if (chrome.runtime.lastError) {
            console.error('Error verifying storage:', chrome.runtime.lastError);
          } else if (result.cookieData) {
            console.log('Verified storage - visit counts:', 
              result.cookieData.map(c => `${c.domain}: ${c.totalVisitCount}`));
          }
        });
      }
    });
  }
    //***************  Change ended for Option 1:



  /**
   * Fetches cookies and displays them in the popup.
   */
    // This function is repeated and already in line 751
  // function fetchAndDisplayCookies() {
  //   chrome.runtime.sendMessage({ action: "checkCookies", cookieNames }, (response) => {
  //     if (chrome.runtime.lastError) {
  //       console.error("Error fetching cookies:", chrome.runtime.lastError);
  //     } else {
  //       const allFetchedCookies = response.cookies;
  //       console.log("Fetched Cookies:", allFetchedCookies);
  //       // Filter consent cookies (excluding OptanonAlertBoxClosed and Complianz ancillary cookies)
  //       const consentCookies = allFetchedCookies.filter(cookie => 
  //         ["OptanonConsent", "cookieyes-consent", "wscrCookieConsent", "cmplz_rt_functional", "cmplz_rt_marketing", "cmplz_rt_preferences", "cmplz_rt_statistics", "cmplz_rt_banner-status", "uc_userconsent", "quantcast_consent", "CookieConsent", "osano_consent", "cookie_notice", "cookie_law_info", "TrustArcConsent"].includes(cookie.name)
  //       );
  //       console.log("Consent Cookies to Process:", consentCookies);

  //       // Create consent objects by processing each consent cookie
  //       fetchedCookies = consentCookies.map(consentCookie => createConsentObject(allFetchedCookies, consentCookie)).filter(Boolean);

  //       //console.log("Fetched Consent Objects:", fetchedCookies);


  //       displayCookies(fetchedCookies);
  //     }
  //   });
  // }

  /**
   * Converts an HTML table to CSV format.
   * @param {HTMLElement} table - The HTML table element.
   * @returns {string} - CSV formatted string.
   */
  function convertTableToCSV(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    return rows.map(row => {
      const cols = Array.from(row.querySelectorAll("th, td"));
      return cols.map(col => {
        let data = col.textContent.trim();
        // Escape double quotes by doubling them
        data = data.replace(/"/g, '""');
        // If the data contains a comma, newline, or double quote, wrap it in double quotes
        if (data.search(/("|,|\n)/g) >= 0) {
          data = `"${data}"`;
        }
        return data;
      }).join(",");
    }).join("\n");
  }

  /**
   * Initiates the download of the table data as a CSV file.
   */
  function downloadCSV() {
    const table = document.getElementById("cookieTable");
    const csvData = convertTableToCSV(table);
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: 'cookie_table.csv',
      saveAs: true, // Show the "Save As" dialog for user selection
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError.message);
        alert("Failed to start download. Check the console for details.");
      } else {
        console.log("Download initiated:", downloadId);
        alert("Download started successfully!");
      }
    });

    // Revoke the object URL after a short delay to free up memory
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000); // 10 seconds
  }

  /**
   * Event listener for the "Download Cookies" button.
   * Handles downloading the cookies as a JSON file.
   */
  function setupDownloadCookiesListener() {
    document.getElementById("download").addEventListener("click", () => {
      if (fetchedCookies.length === 0) {
        alert("No cookies available to download.");
        return;
      }

      try {
        // Convert fetchedCookies to a JSON string
        const data = JSON.stringify(fetchedCookies, null, 2);

        // Create a Blob from the JSON string
        const blob = new Blob([data], { type: 'application/json' });

        // Generate a temporary URL for the Blob
        const url = URL.createObjectURL(blob);

        // Initiate the download using chrome.downloads.download
        chrome.downloads.download({
          url: url,
          filename: 'cookies.json',
          saveAs: true, // Show the "Save As" dialog for user selection
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error("Download failed:", chrome.runtime.lastError.message);
            alert("Failed to start download. Check the console for details.");
          } else {
            console.log("Download initiated:", downloadId);
            alert("Download started successfully!");
          }
        });

        // Revoke the object URL after a short delay to free up memory
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 10000); // 10 seconds
      } catch (error) {
        console.error("Error during download:", error);
        alert("An error occurred while trying to download the cookies.");
      }
    });
  }

  /**
   * Event listener for the "Download Table" button.
   * Handles downloading the table data as a CSV file.
   */
  function setupDownloadTableListener() {
    document.getElementById("downloadTable").addEventListener("click", () => {
      if (fetchedCookies.length === 0) {
        alert("No cookies available to download.");
        return;
      }

      try {
        downloadCSV();
      } catch (error) {
        console.error("Error during table download:", error);
        alert("An error occurred while trying to download the table.");
      }
    });
  }

  /**
   * Sets up event listeners for the popup buttons.
   */
  function setupEventListeners() {
    // Refresh button to fetch and display cookies
    document.getElementById("refresh").addEventListener("click", fetchAndDisplayCookies);
    
    // Download Cookies button to download cookies as JSON
    setupDownloadCookiesListener();
    
    // Download Table button to download table as CSV
    setupDownloadTableListener();
  }

  // Initialize the popup by setting up event listeners and fetching cookies
  setupEventListeners();
  fetchAndDisplayCookies();
  
  //Added for the openConsentPage:
    document.getElementById('openConsentPage')?.addEventListener('click', () => {
      window.location.href = 'prefered_choices.html';
  });
 //Added for Option1 openConsentPage: If we want to open it in new tap:
//  document.getElementById('openConsentPage1')?.addEventListener('click', () => {
//   chrome.tabs.create({ 
//       url: chrome.runtime.getURL('prefered_choices1.html')
//To open it on the same window
document.getElementById('openConsentPage1')?.addEventListener('click', () => {
  window.location.href ='prefered_choices1.html';
  });
document.getElementById('pricrumbs_preferred_cookie_choices_functional')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_preferred_cookie_choices_functional.html';
  });
document.getElementById('pricrumbs_preferred_cookie_choices_performance')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_preferred_cookie_choices_performance.html';
  });
document.getElementById('pricrumbs_preferred_cookie_choices_advertising')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_preferred_cookie_choices_advertising.html';
  });

document.getElementById('pricrumbs_consent_history_top_websites')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_consent_history_top_websites.html';
  });
  
document.getElementById('openConsentPage2')?.addEventListener('click', () => {
  window.location.href ='prefered_choices2.html';
  })
document.getElementById('openConsentPage3')?.addEventListener('click', () => {
  window.location.href ='measure_factors.html';
  })
document.getElementById('openConsentPage4')?.addEventListener('click', () => {
  window.location.href ='discrepancy_between_choices.html';
  })
      

});
  // // Download buttons
  // setupDownloadCookiesListener();
  // setupDownloadTableListener();



