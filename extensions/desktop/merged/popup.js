// popup.js

document.addEventListener('DOMContentLoaded', async () => {

  //load TCF cookie names from JSON file
  let tcfCookieNames = [];
  let tcfLocalStorageNames = [];
  

  try {
    const response = await fetch(ext.runtime.getURL('tcf_strings.json'));
    const tcfData = await response.json();
    tcfCookieNames = tcfData.tcfCookies || [];
    tcfLocalStorageNames = tcfData.localStorage || [];
    console.log(`Loaded ${tcfCookieNames.length} TCF cookie names and ${tcfLocalStorageNames.length} localStorage names`);
  } catch (error) {
    console.error("Error loading TCF strings:", error);
    // Fallback to hardcoded list:
    tcfCookieNames = [
    "TVPtcs22","TcString","__cmpconsent25759", "cookiebotTcfConsentString","euconsent-v2",
    "eupubconsent-v2","mychannels-consentData", 
    "sas_euconsent_v2","EuConsent",
    //local storage:
    "VWD6_ENSIGHTEN_PRIVACY_euconsent-v2"
    ]
  }
  // for tcf defaul values, loading the JSON file with default values:
  let defaultTCFData = [];
  // for websites without default TCF values, will use it as a refrence where findinging these websites with TCF values mean users made an action (because it is not set by default) 
  let noStoreBeforeInteractionSites = [];

  try {
    const defaultResponse = await fetch(ext.runtime.getURL('tcf_default_decoded_js.json'));
    defaultTCFData = await defaultResponse.json();
    console.log(`Loaded ${defaultTCFData.length} default TCF entries for comparison`);
  } catch (error) {
    console.error("Error loading default TCF data:", error);
    // Continue without default comparison if file not found
  }

  // Load websites that don't store TCF before user interaction
try {
  const noStoreResponse = await fetch(ext.runtime.getURL('tcf_no_store_before_interaction.json'));
  const noStoreData = await noStoreResponse.json();
  noStoreBeforeInteractionSites = noStoreData.websites || [];
  console.log(`Loaded ${noStoreBeforeInteractionSites.length} no-store-before-interaction websites`);
} catch (error) {
  console.error("Error loading no-store-before-interaction data:", error);
  // Continue without this detection if file not found
}



  // Define the (base) consent and alert box cookie names to look for
  const baseCookieNames = [
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
    "TrustArcConsent",         // TrustArc
    "CONSENT",                 // Google Consent
    "NID",                     // Google Ads
    "1P_JAR",                  // Google Ads Personalization
    "AEC",                     // Google Session integrity
    "SOCS",                    // Google Consent metadata
    // //adding TCF cookies (strings):
    // "TVPtcs22",
    // "TcString",
    // "__cmpconsent25759",
    // "cookiebotTcfConsentString",
    // "euconsent-v2",
    // "eupubconsent-v2",
    // "mychannels-consentData", 
    // "sas_euconsent_v2",
    // "EuConsent",
    // //local storage:
    // "VWD6_ENSIGHTEN_PRIVACY_euconsent-v2"
  ];

  //combine base cookie names with the loaded TCF cookie names
  const cookieNames = [...baseCookieNames, ...tcfCookieNames, ...tcfLocalStorageNames];
  // Create Sets for faster lookup performance (ADD THESE LINES)
  const cookieNameSet = new Set(cookieNames);
  const tcfCookieSet = new Set(tcfCookieNames);

  //to chcek all cookienames (tcf & cmp) are loaded!
  console.log(`Total cookie names to monitor: ${cookieNames.length}`);

  let fetchedCookies = [];

  /**
   * Checks if a cookie name is a TCF cookie
   * @param {string} cookieName - The name of the cookie to check
   * @returns {boolean} - True if the cookie is a TCF cookie, false otherwise
   */
  function isTCFCookie(cookieName) {
    return tcfCookieSet.has(cookieName)
  }

// Function to find default TCF data for a domain
function findDefaultTCFData(domain, tcfKeyName) {
  // Clean domain for comparison - remove leading dots and convert to lowercase
  const cleanDomain = domain.replace(/^\.+/, '').toLowerCase();
  const cleanDomainNoWWW = cleanDomain.replace(/^www\./, '');
  
  return defaultTCFData.find(entry => {
    const entryDomain = entry.domain.toLowerCase();
    const entryDomainNoWWW = entryDomain.replace(/^www\./, '');
    
    // Check if domains match (with or without www. or leading dot)
    const domainsMatch = entryDomain === cleanDomain || 
                         entryDomainNoWWW === cleanDomainNoWWW ||
                         entryDomain === cleanDomainNoWWW ||
                         entryDomainNoWWW === cleanDomain;
    
    if (!domainsMatch) return false;
    
    if (tcfKeyName && entry.tcf_string_key_name !== "undefined") {
      return entry.tcf_string_key_name === tcfKeyName;
    }
    
    if (!tcfKeyName && entry.tcf_string_key_name === "undefined") {
      return true;
    }
    
    if (tcfKeyName && entry.tcf_string_key_name === "undefined") {
      return true;
    }
    
    return false;
  });
}

// Compare purposes 1-11 only
function compareTCFPurposes11(userPurposes, defaultPurposes) {
  if (!userPurposes || !defaultPurposes) return false;
  
  for (let i = 1; i <= 11; i++) {
    const userConsent = userPurposes[i] || false;
    const defaultConsent = defaultPurposes[i] || false;
    
    if (userConsent !== defaultConsent) {
      return false;
    }
  }
  
  return true;
}

// Compare legitimate interests 1-11 only
function compareTCFLegitimateInterests11(userLI, defaultLI) {
  if (!userLI || !defaultLI) return false;
  
  for (let i = 1; i <= 11; i++) {
    const userLI_value = userLI[i] || false;
    const defaultLI_value = defaultLI[i] || false;
    
    if (userLI_value !== defaultLI_value) {
      return false;
    }
  }
  
  return true;
}

// Add default comparison to already decoded TCF
  function addDefaultComparisonToTCF(decodedTCF, domain, cookieName) {
    const defaultData = findDefaultTCFData(domain, cookieName);
    
    if (!defaultData || !defaultData.decoded_default_string || defaultData.decoded_default_string.error) {
      console.log(`${domain}: No default data found - keeping original actionTaken`);
      return decodedTCF;
    }
    
    const defaultTCF = defaultData.decoded_default_string;
    
    console.log(`Comparing already-decoded TCF for ${domain}:`);
    
    const purposesMatch = compareTCFPurposes11(
      decodedTCF.misc.purposeConsents, 
      defaultTCF.purposes
    );
    
    const liMatch = compareTCFLegitimateInterests11(
      decodedTCF.misc.purposeLegitimateInterests, 
      defaultTCF.purposeLegitimateInterests
    );
    
    const isDefault = purposesMatch && liMatch;
    
    let newActionTaken;
    if (isDefault) {
      newActionTaken = "Default";
      console.log(`${domain}: User TCF matches default - Action: Default`);
    } else {
      newActionTaken = "Yes";
      console.log(`${domain}: User TCF differs from default - Action: Yes (Modified)`);
    }
    
    return {
      ...decodedTCF,
      actionTaken: newActionTaken,
      misc: {
        ...decodedTCF.misc,
        defaultComparison: {
          hasDefaultData: true,
          purposesMatch: purposesMatch,
          legitimateInterestsMatch: liMatch,
          isExactDefault: isDefault,
          defaultKeyName: defaultData.tcf_string_key_name,
          defaultCMP: defaultTCF.cmpName,
          originalActionTaken: decodedTCF.actionTaken
        }
      }
    };
  }

  // Check if domain is in no-store-before-interaction list
  function isNoStoreBeforeInteractionSite(domain) {
  // Clean the domain: remove leading dots and convert to lowercase
  const cleanDomain = domain.replace(/^\.+/, '').toLowerCase();
  
  // Also create a version without www. for comparison
  const cleanDomainNoWWW = cleanDomain.replace(/^www\./, '');
  
  return noStoreBeforeInteractionSites.some(entry => {
    const entryDomain = entry.domain.toLowerCase();
    // Also create a version of the entry domain without www.
    const entryDomainNoWWW = entryDomain.replace(/^www\./, '');
    
    // Match if either:
    // 1. Exact match (with or without www.)
    // 2. Both normalize to the same domain when www. is removed
    return entryDomain === cleanDomain || 
           entryDomainNoWWW === cleanDomainNoWWW ||
           entryDomain === cleanDomainNoWWW ||
           entryDomainNoWWW === cleanDomain;
  });
  }

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

  function decodeGoogleUnified(cookies, domain) {
    // Unifies the 3 relevant cookies from Google
    const cookieMap = {};
    cookies.forEach(c => {
      cookieMap[c.name] = c;
    });
  
    const consent = cookieMap["CONSENT"];
    const nid = cookieMap["NID"];
    const jar = cookieMap["1P_JAR"];
  
    const base = consent || nid || jar;
  
    const addFields = base ? addDateFields(base) : {
      timestamp: "Unknown",
      expiration: "Unknown",
      firstVisited: "Unknown",
      lastVisited: "Unknown"
    };
    
    // Consent cookie format: PENDING+<region.lang>+<version>+<flags>
    const status = consent?.value?.split('+')[0] || "Unknown";
    const flags = consent?.value?.split('+').slice(3).join(', ') || "None";

    const cookiesEnabled = (!!nid && nid.value.length > 0) || (!!jar && jar.value.length > 0);
  
    return {
      cmpName: "Google",
      domain,
      ...addFields,
      necessary: true,
      functional: cookiesEnabled,
      performance: cookiesEnabled,
      advertising: cookiesEnabled,
      consent: status,
      actionTaken: status === "YES" ? "Yes" : "No",
      rawCookie: consent?.value || nid?.value || jar?.value || "Unavailable",
      misc: {
        hasCONSENT: !!consent,
        hasNID: !!nid,
        has1P_JAR: !!jar,
        flags
      }
    };
  }
  
  

  /**
 Enhanced TCF v2.0 decoder based on the TCF v2 documintation: https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md
 */

 /**
 * Decodes a TCF v2.0 consent string to extract all relevant information
 * @param {string} tcString - The base64url encoded TCF string
 * @returns {Object} - Complete decoded TCF data
 */
function decodeTCFString(tcString) {
  try {
    console.log('Decoding TCF string:', tcString.substring(0, 50) + '...');
    
    // Split by '.' and decode only the core segment
    // TCF strings contain multiple segments separated by dots
    const coreSegment = tcString.split('.')[0];
    
    // Clean and prepare the string
    const cleanTCString = coreSegment.trim().replace(/\s/g, '');
    
    // Convert base64url to base64
    let base64String = cleanTCString.replace(/-/g, '+').replace(/_/g, '/');
    
    // Add padding if needed
    while (base64String.length % 4) {
      base64String += '=';
    }
    
    // Decode base64 to binary
    const binaryString = atob(base64String);
    
    // Convert to bit string
    let bitString = '';
    for (let i = 0; i < binaryString.length; i++) {
      bitString += binaryString.charCodeAt(i).toString(2).padStart(8, '0');
    }
    
    console.log('Bit string length:', bitString.length);
    
    // Parse the TCF structure according to IAB spec
    const result = parseCoreSegmentIAB(bitString);
    
    if (!result) {
      throw new Error('Failed to parse core segment per IAB specification');
    }
    
    return result;
    
  } catch (error) {
    console.error('Error decoding TCF string:', error);
    return null;
  }
}

/**
 * Parses core segment following official IAB TCF v2.2 specification
 * @param {string} bitString - Binary representation of the TCF string
 * @returns {Object} - Parsed core segment data per IAB spec
 */
function parseCoreSegmentIAB(bitString) {
  let offset = 0;
  
  // Helper function to read bits and advance offset
  const readBits = (length) => {
    if (offset + length > bitString.length) {
      throw new Error(`Not enough bits: need ${length}, have ${bitString.length - offset}`);
    }
    const bits = bitString.substr(offset, length);
    offset += length;
    return bits;
  };
  
  // Helper function to convert bits to integer
  const bitsToInt = (bits) => parseInt(bits, 2);
  
  // Helper function to convert bits to boolean
  const bitsToBool = (bits) => bits === '1';
  
  try {
    // Core segment fields per IAB TCF v2.2 specification
    
    // Version (6 bits) - should be 2 for TCF v2.0/v2.2
    const version = bitsToInt(readBits(6));
    console.log('TCF Version:', version);
    
    if (version !== 2) {
      console.warn('Warning: TCF version is not 2, found:', version);
    }
    
    // Created timestamp (36 bits) - deciseconds since epoch
    const created = bitsToInt(readBits(36));
    const createdDate = new Date(created * 100);
    
    // Last updated timestamp (36 bits) - deciseconds since epoch
    const lastUpdated = bitsToInt(readBits(36));
    const lastUpdatedDate = new Date(lastUpdated * 100);
    
    // CMP ID (12 bits) - IAB assigned CMP ID
    const cmpId = bitsToInt(readBits(12));
    
    // CMP Version (12 bits) - CMP's own version
    const cmpVersion = bitsToInt(readBits(12));
    
    // Consent screen (6 bits) - Which screen was shown
    const consentScreen = bitsToInt(readBits(6));
    
    // Consent language (12 bits - 2 characters per IAB spec)
    const lang1 = bitsToInt(readBits(6)) + 65;
    const lang2 = bitsToInt(readBits(6)) + 65;
    const consentLanguage = String.fromCharCode(lang1, lang2);
    
    // Vendor list version (12 bits) - GVL version used
    const vendorListVersion = bitsToInt(readBits(12));
    
    // TCF Policy Version (6 bits) - Should be 4 for v2.2
    const tcfPolicyVersion = bitsToInt(readBits(6));
    
    // IsServiceSpecific (1 bit) - per IAB spec
    const isServiceSpecific = bitsToBool(readBits(1));
    
    // UseNonStandardStacks (1 bit) - per IAB spec
    const useNonStandardStacks = bitsToBool(readBits(1));
    
    // SpecialFeatureOptins (12 bits) - Special features 1-12
    const specialFeatureOptinsBits = readBits(12);
    
    // Purpose consents (24 bits) - Purposes 1-24
    const purposeConsentsBits = readBits(24);
    
    // Purpose legitimate interests (24 bits) - Purposes 1-24
    const purposeLegitimateInterestsBits = readBits(24);
    
    // Purpose one treatment and Publisher CC
    const purposeOneTreatment = bitsToBool(readBits(1));
    const publisherCC = String.fromCharCode(
      bitsToInt(readBits(6)) + 65,
      bitsToInt(readBits(6)) + 65
    );
    
    // Parse purposes (1-24) per IAB specification
    const purposes = {};
    const purposeLegitimateInterests = {};
    
    for (let i = 0; i < 24; i++) {
      const purposeId = i + 1;
      purposes[purposeId] = purposeConsentsBits[i] === '1';
      purposeLegitimateInterests[purposeId] = purposeLegitimateInterestsBits[i] === '1';
    }
    
    // Parse special features (1-12) per IAB specification
    const specialFeatureOptins = {};
    for (let i = 0; i < 12; i++) {
      const featureId = i + 1;
      specialFeatureOptins[featureId] = specialFeatureOptinsBits[i] === '1';
    }
    
    // Vendor consent and legitimate interest sections
    let vendorConsents = {};
    let vendorLegitimateInterests = {};
    
    try {
      // Parse vendor consents section
      const vendorSection = parseVendorSection(bitString, offset);
      offset = vendorSection.newOffset;
      vendorConsents = vendorSection.consents;
      
      // Parse vendor legitimate interests section
      const vendorLISection = parseVendorLegitimateInterestsSection(bitString, offset);
      offset = vendorLISection.newOffset;
      vendorLegitimateInterests = vendorLISection.legitimateInterests;
    } catch (error) {
      console.warn('Error parsing vendor sections:', error);
      // Continue with empty vendor data per IAB spec graceful handling
    }
    
    // Determine event status based on TCF content analysis
    const eventStatus = determineEventStatus({
      created,
      lastUpdated,
      purposeConsentsBits,
      purposeLegitimateInterestsBits,
      specialFeatureOptinsBits,
      vendorConsents,
      vendorLegitimateInterests,
      consentScreen
    });
    
    const result = {
      // Core TCF data per IAB specification
      version,
      created: createdDate.toISOString(),
      lastUpdated: lastUpdatedDate.toISOString(),
      cmpId,
      cmpVersion,
      consentScreen,
      consentLanguage,
      vendorListVersion,
      tcfPolicyVersion,
      isServiceSpecific,
      useNonStandardStacks,
      purposeOneTreatment,
      publisherCC,
      
      // Parsed consent data
      purposes,
      purposeLegitimateInterests,
      specialFeatureOptins,
      vendorConsents,
      vendorLegitimateInterests,
      
      // Event status determination
      eventStatus,
      
      // Raw data for debugging
      rawPurposeConsents: purposeConsentsBits,
      rawPurposeLegitimateInterests: purposeLegitimateInterestsBits,
      rawSpecialFeatures: specialFeatureOptinsBits
    };
    
    console.log('Parsed TCF data per IAB spec:', result);
    return result;
    
  } catch (error) {
    console.error('Error parsing core segment per IAB spec:', error);
    return null;
  }
}

/**
 * Determine eventStatus 
 * Per IAB documintation: 'useractioncomplete' indicates user confirmed choices
 */
function determineEventStatus(tcfData) {
  const {
    created,
    lastUpdated,
    purposeConsentsBits,
    purposeLegitimateInterestsBits,
    specialFeatureOptinsBits,
    vendorConsents,
    vendorLegitimateInterests,
    consentScreen
  } = tcfData;
  
  // Per IAB spec analysis for event status determination
  
  // Check if user has made specific choices (not all defaults)
  const hasSpecificPurposeChoices = (() => {
    const purposes = purposeConsentsBits;
    if (purposes.length === 0) return false;
    
    // Not all true and not all false = selective choices made
    const allTrue = purposes.split('').every(p => p === '1');
    const allFalse = purposes.split('').every(p => p === '0');
    const hasAnyTrue = purposes.includes('1');
    
    return !allTrue && !allFalse && hasAnyTrue;
  })();
  
  // Special feature opt-ins indicate explicit user action
  const hasSpecialFeatureOptins = specialFeatureOptinsBits.includes('1');
  
  // Vendor-specific choices indicate user interaction
  const hasVendorChoices = Object.keys(vendorConsents).length > 0 && 
                          Object.values(vendorConsents).some(consent => consent === true);
  
  // Legitimate interest choices indicate user review
  const hasLegitimateInterestChoices = purposeLegitimateInterestsBits.includes('1') ||
                                      Object.values(vendorLegitimateInterests).some(li => li === true);
  
  // Timestamp difference indicates user modification
  const wasModified = created !== lastUpdated;
  
  // Consent screen shown indicates UI interaction
  const uiWasShown = consentScreen > 0;
  
  // Per IAB TCF v2.2 specification:
  // 'useractioncomplete' = user has confirmed or re-confirmed their choices
  
  // Strong indicators of user action completion per IAB policy
  const strongIndicators = [
    hasSpecialFeatureOptins,      // Explicit special feature choices
    hasSpecificPurposeChoices,    // Selective purpose decisions
    hasVendorChoices              // Vendor-specific choices
  ];
  
  // Medium indicators of user interaction
  const mediumIndicators = [
    hasLegitimateInterestChoices, // LI basis choices
    wasModified,                  // Modified after creation
    uiWasShown                    // UI was presented
  ];
  
  const strongIndicatorCount = strongIndicators.filter(Boolean).length;
  const mediumIndicatorCount = mediumIndicators.filter(Boolean).length;
  
  // Per IAB specification logic:
  if (strongIndicatorCount >= 2 || (strongIndicatorCount >= 1 && mediumIndicatorCount >= 2)) {
    return 'useractioncomplete'; // User confirmed choices per IAB spec
  } else if (strongIndicatorCount >= 1 || mediumIndicatorCount >= 2) {
    return 'cmpuishown'; // UI was shown but action not fully complete
  } else {
    return 'tcloaded'; // TC string loaded but minimal user interaction
  }
}

/**
 * Enhanced vendor section parser following IAB specification
 */
function parseVendorSection(bitString, startOffset) {
  let offset = startOffset;
  
  try {
    // Max vendor ID (16 bits) per IAB spec
    const maxVendorId = parseInt(bitString.substr(offset, 16), 2);
    offset += 16;
    
    // Encoding type (1 bit) - 0 = BitField, 1 = Range per IAB spec
    const encodingType = bitString.substr(offset, 1) === '1';
    offset += 1;
    
    const vendorConsents = {};
    
    if (!encodingType) {
      // BitField encoding per IAB specification
      for (let i = 1; i <= maxVendorId && offset < bitString.length; i++) {
        vendorConsents[i] = bitString.substr(offset, 1) === '1';
        offset += 1;
      }
    } else {
      // Range encoding per IAB specification
      const numEntries = parseInt(bitString.substr(offset, 12), 2);
      offset += 12;
      
      for (let i = 0; i < numEntries && offset < bitString.length - 16; i++) {
        const isRange = bitString.substr(offset, 1) === '1';
        offset += 1;
        
        const startVendorId = parseInt(bitString.substr(offset, 16), 2);
        offset += 16;
        
        if (isRange && offset < bitString.length - 16) {
          const endVendorId = parseInt(bitString.substr(offset, 16), 2);
          offset += 16;
          
          // Set consent for range per IAB spec
          for (let vendorId = startVendorId; vendorId <= endVendorId; vendorId++) {
            vendorConsents[vendorId] = true;
          }
        } else {
          vendorConsents[startVendorId] = true;
        }
      }
    }
    
    return {
      consents: vendorConsents,
      newOffset: offset
    };
    
  } catch (error) {
    console.error('Error parsing vendor section per IAB spec:', error);
    return {
      consents: {},
      newOffset: offset
    };
  }
}

/**
 * Parse vendor legitimate interests section per IAB specification
 */
function parseVendorLegitimateInterestsSection(bitString, startOffset) {
  let offset = startOffset;
  
  try {
    // Check if we have enough bits for legitimate interests section
    if (offset >= bitString.length - 17) {
      return {
        legitimateInterests: {},
        newOffset: offset
      };
    }
    
    // Max vendor ID (16 bits) per IAB spec
    const maxVendorId = parseInt(bitString.substr(offset, 16), 2);
    offset += 16;
    
    // Encoding type (1 bit) per IAB spec
    const encodingType = bitString.substr(offset, 1) === '1';
    offset += 1;
    
    const vendorLegitimateInterests = {};
    
    if (!encodingType) {
      // BitField encoding per IAB specification
      for (let i = 1; i <= maxVendorId && offset < bitString.length; i++) {
        vendorLegitimateInterests[i] = bitString.substr(offset, 1) === '1';
        offset += 1;
      }
    } else {
      // Range encoding per IAB specification
      if (offset < bitString.length - 12) {
        const numEntries = parseInt(bitString.substr(offset, 12), 2);
        offset += 12;
        
        for (let i = 0; i < numEntries && offset < bitString.length - 16; i++) {
          const isRange = bitString.substr(offset, 1) === '1';
          offset += 1;
          
          const startVendorId = parseInt(bitString.substr(offset, 16), 2);
          offset += 16;
          
          if (isRange && offset < bitString.length - 16) {
            const endVendorId = parseInt(bitString.substr(offset, 16), 2);
            offset += 16;
            
            // Set LI for range per IAB spec
            for (let vendorId = startVendorId; vendorId <= endVendorId; vendorId++) {
              vendorLegitimateInterests[vendorId] = true;
            }
          } else {
            vendorLegitimateInterests[startVendorId] = true;
          }
        }
      }
    }
    
    return {
      legitimateInterests: vendorLegitimateInterests,
      newOffset: offset
    };
    
  } catch (error) {
    console.error('Error parsing vendor LI section per IAB spec:', error);
    return {
      legitimateInterests: {},
      newOffset: offset
    };
  }
}

/**
 * Map TCF purposes to standard 4 categories 
 * Based on official IAB TCF v2.2 purpose definitions & the research team agreement
 */
function mapTCFPurposesToCategories(tcfData) {
  if (!tcfData || !tcfData.purposes) {
    return {
      necessary: true,
      functional: false,
      performance: false,
      advertising: false
    };
  }
  
  const { purposes, purposeLegitimateInterests } = tcfData;
  
  // Helper function to check if purpose has consent OR legitimate interest
  const hasPurpose = (id) => purposes[id] || purposeLegitimateInterests[id];
  
  // Official IAB TCF v2.2 purpose mapping:
  // Purpose 1: Store and/or access information on a device - FUNCTIONAL
  // Purpose 2: Select basic ads - ADVERTISING  
  // Purpose 3: Create a personalised ads profile - ADVERTISING
  // Purpose 4: Select personalised ads - ADVERTISING
  // Purpose 5: Create a personalised content profile - FUNCTIONAL
  // Purpose 6: Select personalised content - FUNCTIONAL
  // Purpose 7: Measure ad performance - ADVERTISING
  // Purpose 8: Measure content performance - PERFORMANCE
  // Purpose 9: Apply market research to generate audience insights - ADVERTISING
  // Purpose 10: Develop and improve products - PERFORMANCE
  // Purpose 11: Use limited data to select advertising - PERFORMANCE
  
  const functional = hasPurpose(1) || hasPurpose(5) || hasPurpose(6);
  const performance = hasPurpose(8) || hasPurpose(10) || hasPurpose(11);
  const advertising = hasPurpose(2) || hasPurpose(3) || hasPurpose(4) ||hasPurpose(7) || hasPurpose(9);
  
  const necessary = true;

  
  return {
    necessary,
    functional,
    performance,
    advertising
  };
}

//Function to get CMP name from ID found in the TCF string (the IDs for CMPs are defined by IAB: http://iabeurope.eu/cmp-list/)  
function getCMPNameFromId(cmpId) {
  // IAB CMP ID registry
  const cmpRegistry = {
    28: "OneTrust",
    134: "Cookiebot", 
    7: "Didomi",
    332: "Complianz",
    300: "Google",
    10: "InMobi",
    6: "Sourcepoint",
    68: "Transfon",
    // Add more from IAB registry
  };
  
  return cmpRegistry[cmpId] || `CMP ID ${cmpId}`;
}

/**
 * Complete IAB TCF v2.2 compliant decoder for the extension
 */
function decodeTCF(value, cookie, allCookies) { 
  try {
    console.log('Enhanced TCF decoding with CMP pattern analysis');
    
    const tcfData = decodeTCFString(value);
    
    if (!tcfData) {
      throw new Error('Failed to decode TCF string per IAB specification');
    }
    
    // action detection using CMP patterns
    const enhancedActionAnalysis = enhancedTCFActionDetection(value, cookie, allCookies);
    
    // Use enhanced results 
    const actionTaken = enhancedActionAnalysis.actionTaken;
    const confidence = enhancedActionAnalysis.confidence;
    
    const categories = mapTCFPurposesToCategories(tcfData);
    
    // Determine overall consent status with IAB-compliant logic
    const totalPurposes = 11; // IAB purposes 1-11 are most relevant
    const consentedPurposes = Object.keys(tcfData.purposes || {})
      .filter(id => parseInt(id) <= 11 && tcfData.purposes[id])
      .length;
    const legitimateInterestPurposes = Object.keys(tcfData.purposeLegitimateInterests || {})
      .filter(id => parseInt(id) <= 11 && tcfData.purposeLegitimateInterests[id])
      .length;
    
    const totalConsented = consentedPurposes + legitimateInterestPurposes;
    
    let consentStatus = "No";
    if (totalConsented === 0) {
      consentStatus = "No";
    } else if (consentedPurposes >= Math.floor(totalPurposes * 0.8)) { // 80% threshold for "Full"
      consentStatus = "Full";
    } else {
      consentStatus = "Partial";
    }
    
    console.log("Enhanced IAB TCF v2.2 Decoded:", {
      cmpName: "TCF v2.2",
      consentStatus,
      actionTaken,
      confidence,
      eventStatus: tcfData.eventStatus,
      categories
    });
    
    return {
      cmpName: tcfData.cmpId ? 
      `${getCMPNameFromId(tcfData.cmpId)} (TCF v2.2)` : 
      "TCF v2.2",
      ...addDateFields(cookie),
      timestamp: tcfData.lastUpdated 
      ? new Date(tcfData.lastUpdated).toLocaleString() 
      : "Unknown",
      necessary: categories.necessary,
      functional: categories.functional,
      performance: categories.performance,
      advertising: categories.advertising,
      consent: consentStatus,
      // actionTaken: actionTaken, 
      actionTaken: isNoStoreBeforeInteractionSite(cookie.domain) ? "Yes" : actionTaken,
      rawCookie: value,
      misc: {
        // IAB specification fields
        tcfVersion: tcfData.version,
        tcfPolicyVersion: tcfData.tcfPolicyVersion,
        cmpId: tcfData.cmpId,
        cmpVersion: tcfData.cmpVersion,
        consentLanguage: tcfData.consentLanguage,
        vendorListVersion: tcfData.vendorListVersion,
        isServiceSpecific: tcfData.isServiceSpecific,
        useNonStandardStacks: tcfData.useNonStandardStacks,
        purposeOneTreatment: tcfData.purposeOneTreatment,
        publisherCC: tcfData.publisherCC,
        
        // Event status per IAB specification
        eventStatus: tcfData.eventStatus,
        confidence: confidence,
        
        // Purpose analysis per IAB spec
        purposeConsents: Object.fromEntries(
          Object.entries(tcfData.purposes || {}).filter(([id]) => parseInt(id) <= 11)
        ),
        purposeLegitimateInterests: Object.fromEntries(
          Object.entries(tcfData.purposeLegitimateInterests || {}).filter(([id]) => parseInt(id) <= 11)
        ),
        specialFeatureOptins: tcfData.specialFeatureOptins || {},
        
        // Vendor counts per IAB spec
        vendorConsentCount: Object.keys(tcfData.vendorConsents || {}).length,
        vendorLICount: Object.keys(tcfData.vendorLegitimateInterests || {}).length,
        
        // Consent screen and interaction data
        consentScreen: tcfData.consentScreen,
        
        // Timestamps per IAB spec
        createdAt: tcfData.created,
        lastUpdatedAt: tcfData.lastUpdated,
        
        // Action analysis
        actionConfidence: confidence,
        actionMethod: enhancedActionAnalysis.method,
        actionReasoning: enhancedActionAnalysis.reasoning,
        enhancedEvidence: enhancedActionAnalysis.evidence,
        noStoreBeforeInteraction: isNoStoreBeforeInteractionSite(cookie.domain),

      }
    };
    
  } catch (error) {
    console.error("Enhanced TCF parsing error:", error);
    return {
      cmpName: "TCF v2.2",
      ...addDateFields(cookie),
      necessary: true,
      functional: "Unknown",
      performance: "Unknown", 
      advertising: "Unknown",
      consent: "Unknown",
      actionTaken: "Unknown",
      rawCookie: value,
      misc: { error: error.message }
    };
  }
}
// Analysis functions to get an indicator if user action was taken
//  Cross-reference with other CMPs on same domain
function analyzeCMPCrossReference(allCookies, domain) {
  const evidence = {
    hasOtherCMP: false,
    otherCMPAction: "Unknown",
    otherCMPType: null,
    confidence: "Low",
    reasoning: []
  };
  
  const domainCookies = allCookies.filter(c => c.domain === domain);
  
  // Check for OneTrust on same domain
  const oneTrustConsent = domainCookies.find(c => c.name === "OptanonConsent");
  const oneTrustAlert = domainCookies.find(c => c.name === "OptanonAlertBoxClosed");
  
  if (oneTrustConsent && oneTrustAlert) {
    evidence.hasOtherCMP = true;
    evidence.otherCMPType = "OneTrust";
    
    const oneTrustData = parseCookieString(oneTrustConsent.value);
    if (oneTrustData.interactionCount && parseInt(oneTrustData.interactionCount) > 0) {
      evidence.otherCMPAction = "Yes";
      evidence.confidence = "High";
      evidence.reasoning.push("OneTrust shows user interaction");
    }
  }
  
  // Check for Cookiebot on same domain
  const cookiebotConsent = domainCookies.find(c => c.name === "CookieConsent");
  if (cookiebotConsent) {
    evidence.hasOtherCMP = true;
    evidence.otherCMPType = "Cookiebot";
    
    try {
      const cookiebotData = JSON.parse(convertToJSON(cookiebotConsent.value));
      if (cookiebotData.method === 'explicit') {
        evidence.otherCMPAction = "Yes";
        evidence.confidence = "High";
        evidence.reasoning.push("Cookiebot shows explicit user action");
      }
    } catch (e) {
      // Continue with other analysis
    }
  }
  
  // Check for CookieYes on same domain
  const cookieYesConsent = domainCookies.find(c => c.name === "cookieyes-consent");
  if (cookieYesConsent) {
    evidence.hasOtherCMP = true;
    evidence.otherCMPType = "CookieYes";
    
    const cookieYesData = cookieYesConsent.value.split(',').reduce((acc, pair) => {
      const [key, val] = pair.split(':');
      acc[key] = val;
      return acc;
    }, {});
    
    if (cookieYesData.action === 'yes') {
      evidence.otherCMPAction = "Yes";
      evidence.confidence = "High";
      evidence.reasoning.push("CookieYes shows user action taken");
    }
  }
  
  return evidence;
}


// COMBINE ALL EVIDENCE
function combineEvidenceSources(evidence) {
  const { tcfData, cmpCrossReference } = evidence;
  
  let actionTaken = "Unknown"; // Default to Unknown
  let confidence = "Low";
  let method = "CMP cross-reference only";
  const reasoning = [];
  
  // Only trust CMP cross-reference evidence
  if (cmpCrossReference.hasOtherCMP && cmpCrossReference.confidence === "High") {
    actionTaken = cmpCrossReference.otherCMPAction;
    confidence = "High";
    method = `Cross-referenced with ${cmpCrossReference.otherCMPType}`;
    reasoning.push(`Reliable ${cmpCrossReference.otherCMPType} evidence on same domain`);
    
  } else if (cmpCrossReference.hasOtherCMP && cmpCrossReference.confidence === "Medium") {
    actionTaken = cmpCrossReference.otherCMPAction;
    confidence = "Medium";
    method = `Cross-referenced with ${cmpCrossReference.otherCMPType}`;
    reasoning.push(`Moderate ${cmpCrossReference.otherCMPType} evidence on same domain`);
    
  } else {
    // No reliable CMP evidence - stay conservative
    actionTaken = "Unknown";
    confidence = "Low";
    method = "No reliable CMP cross-reference available";
    reasoning.push("TCF-only implementation without other CMP indicators");
  }
  
  return {
    actionTaken,
    confidence,
    method,
    reasoning,
    evidence: { cmpCrossReference }
  };
}

// MAIN ENHANCED TCF ACTION DETECTION FUNCTION
function enhancedTCFActionDetection(tcfValue, tcfCookie, allCookies) {
  // First, get the standard TCF analysis
  const tcfData = decodeTCFString(tcfValue);
  if (!tcfData) {
    return { actionTaken: "Unknown", confidence: "Low", method: "TCF parsing failed" };
  }

  // Cross-reference with other CMPs on same domain
  const cmpCrossReference = analyzeCMPCrossReference(allCookies, tcfCookie.domain);
    
  // Combine evidence
  const combinedEvidence = combineEvidenceSources({
    tcfData,
    cmpCrossReference,
  });
  
  return combinedEvidence;
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
   * Creates a consent object for display purposes.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Consent object with necessary fields or null.
   */
  function createConsentObject(cookies, currentCookie) {
      // ADD DEBUG FOR STACKOVERFLOW SPECIFICALLY
  if (currentCookie.domain && currentCookie.domain.includes('stackoverflow')) {
    console.log("STACKOVERFLOW PROCESSING STARTED:");
    console.log("Cookie name:", currentCookie.name);
    console.log("Cookie domain:", currentCookie.domain);
    console.log("Cookie value preview:", currentCookie.value.substring(0, 100));
  }

  const decoded = decodeCMPValue(cookies, currentCookie);
  
  if (currentCookie.domain && currentCookie.domain.includes('stackoverflow')) {
    console.log("STACKOVERFLOW DECODE RESULT:");
    console.log("Decoded object:", decoded);
    
    if (!decoded) {
      console.log("STACKOVERFLOW DECODE FAILED - returned null!");
      return null;
    }
  }

  if (!decoded) return null; // Skip if the decoder returns null (handled separately)

  console.log("Creating Consent Object:", decoded);

  return {
    cmpName: decoded.cmpName,
    domain: currentCookie.domain,
    domainHash: currentCookie.domainHash || null,
    domainRankRange: currentCookie.domainRankRange || null,
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
    actionTaken: decoded.actionTaken,
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
  async function fetchAndDisplayCookies() {
    console.log("************IMMEDIATE CHECK***********:");
    console.log("cookieNames exists?", typeof cookieNames !== 'undefined');
    console.log("cookieNames length:", cookieNames?.length);
    console.log("First few items:", cookieNames?.slice(0, 5));

    console.log("Sending message to background.js to check cookies...");

    try {
      const response = await ext.runtime.sendMessage({ action: "checkCookies", cookieNames });

      if (!response || !response.cookies) {
        console.warn("No cookies received from background.js");
        alert("No cookies received.");
        return;
      }
          
      const allFetchedCookies = response.cookies;
      console.log("Fetched Cookies:", allFetchedCookies);
      // Filter consent cookies (excluding OptanonAlertBoxClosed and Complianz ancillary cookies)
      const consentCookies = allFetchedCookies.filter(cookie => 
        cookieNameSet.has(cookie.name)
      );

      //   [
      //     "OptanonConsent", "cookieyes-consent", "wscrCookieConsent",
      //     "cmplz_rt_functional", "cmplz_rt_marketing", "cmplz_rt_preferences",
      //     "cmplz_rt_statistics", "cmplz_rt_banner-status", "uc_userconsent",
      //     "quantcast_consent", "CookieConsent", "osano_consent", "cookie_notice",
      //     "cookie_law_info", "TrustArcConsent",
      //     "CONSENT", "NID", "1P_JAR",
      //     "euconsent-v2", "eupubconsent-v2", 
      //     "TVPtcs22",
      //     "TcString",
      //     "__cmpconsent25759",
      //     "cookiebotTcfConsentString",
      //     "mychannels-consentData", 
      //     "sas_euconsent_v2",
      //     "EuConsent",
      //     //local storage:
      //     "VWD6_ENSIGHTEN_PRIVACY_euconsent-v2"
      //   ].includes(cookie.name)
      // );

      console.log("Consent Cookies to Process:", consentCookies);

      // Create consent objects by processing each consent cookie
      // 
            // FILTER OUT HELPER/SUPPORTING COOKIES that shouldn't be displayed
      const displayableCookies = consentCookies.filter(cookie => {
        // Define helper/supporting cookies that should NOT be displayed as separate entries
        const helperCookies = [
          "OptanonAlertBoxClosed",  // Helper for OneTrust - used by OptanonConsent
          "AEC",                    // Helper for Google - used by CONSENT/NID
          "SOCS",                   // Helper for Google - used by CONSENT/NID
          // Add any other helper cookies here
        ];
        
        // Only show cookies that are NOT helper cookies
        return !helperCookies.includes(cookie.name);
      });

      console.log("Displayable Cookies to Process:", displayableCookies);

      // Create consent objects by processing each displayable cookie
      fetchedCookies = displayableCookies.map(consentCookie => {
        const result = createConsentObject(allFetchedCookies, consentCookie);
        
        // FILTER OUT "Unknown" CMPs - only show recognized CMPs
        if (result && result.cmpName === "Unknown") {
          console.log(`Filtering out Unknown CMP: ${consentCookie.name} from ${consentCookie.domain}`);
          return null; // Filter out unknown CMPs
        }
        
        return result;
      }).filter(Boolean);

      console.log("Fetched Consent Objects:", fetchedCookies);
      // DEBUG: Log the totalVisitCount values before storing
      console.log('Visit counts before storing:', 
        fetchedCookies.map(c => `${c.domain}: ${c.totalVisitCount}`));

      // Store the cookies in ext.storage.local
      storeCookiesInStorage(fetchedCookies);

      displayCookies(fetchedCookies);

    } catch (err) {
      console.error("Message failed:", err);
    }
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

    ext.downloads.download({
      url: url,
      filename: 'cookie_table.csv',
      saveAs: true, // Show the "Save As" dialog for user selection
    }).then(downloadId => {
      console.log("Download initiated:", downloadId);
      alert("Download started successfully!");
    })
    .catch(err => {
      console.error("Download failed:", err);
      alert("Failed to start download. Check the console for details.");
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
    document.getElementById("download").addEventListener("click", async () => {
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

        // Initiate the download using ext.downloads.download
        const downloadId = await ext.downloads.download({
          url: url,
          filename: 'cookies.json',
          saveAs: true,
        });

        console.log("Download initiated:", downloadId);
        alert("Download started successfully!");

        // Revoke the object URL after a short delay to free up memory
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 10000); // 10 seconds
      } catch (error) {
        console.error("Download failed:", error);
        alert("Failed to start download. Check the console for details.");
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
   * Decodes CMP-specific consent cookies.
   * @param {Array} cookies - Array of all relevant cookies.
   * @param {Object} currentCookie - The current consent cookie being processed.
   * @returns {Object|null} - Decoded consent information or null if not applicable.
   */
  function decodeCMPValue(cookies, currentCookie) {
    const seenGoogleDomains = new Set(); // Necessary since Google uses generic cookie names
    const cookieName = currentCookie.name;

    console.log(`Processing: ${currentCookie.domain} - ${cookieName}`);
    console.log(`Cookie value preview: ${currentCookie.value.substring(0, 50)}...`);
    
    // Handle specific non-TCF cookies
    switch (cookieName) {
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
        if (cookieName === "cmplz_rt_banner-status") {
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
      // New case for TCF v2.0 consent cookie
      // Enhanced TCF v2.0 consent cookies with default comparison
      case "euconsent-v2":
      case "eupubconsent-v2": 
      case "TVPtcs22":
      case "TcString":
      case "__cmpconsent25759":
      case "cookiebotTcfConsentString":
      case "mychannels-consentData":
      case "sas_euconsent_v2":
      case "EuConsent":
      case "VWD6_ENSIGHTEN_PRIVACY_euconsent-v2":
        console.log(`Processing TCF cookie with default comparison: ${cookieName}`);
        
        // Decode TCF normally using existing function
        const decodedTCF = decodeTCF(currentCookie.value, currentCookie, cookies);
        
        // Add default comparison to the already-decoded result
        const enhancedTCF = addDefaultComparisonToTCF(decodedTCF, currentCookie.domain, cookieName);
        
        return enhancedTCF;
      case "CONSENT":
      case "NID":
      case "1P_JAR":
        const googleDomainPattern = /\.google\.com$|\.youtube\.com$|\.google\./;

        // Only decode one time for all of the google cookies
        if (
          ["CONSENT", "NID"].includes(currentCookie.name) &&
          googleDomainPattern.test(currentCookie.domain) &&
          !seenGoogleDomains.has(currentCookie.domain)
        ) {
          seenGoogleDomains.add(currentCookie.domain);
        
          const googleCookies = cookies.filter(c =>
            ["CONSENT", "NID", "1P_JAR"].includes(c.name) &&
            googleDomainPattern.test(c.domain) && // Verify each cookie's domain
            c.domain === currentCookie.domain
          );
        
          return decodeGoogleUnified(googleCookies, currentCookie.domain);
        }

      return null;
    
    default:
      // For any additional TCF cookies from JSON that aren't in the switch statement
      if (isTCFCookie(cookieName)) {
        console.log(`Identified as additional TCF cookie: ${cookieName}`);
        // Decode TCF normally using existing function
      const decodedTCF = decodeTCF(currentCookie.value, currentCookie, cookies);
      
      // Add default comparison to the already-decoded result
      const enhancedTCF = addDefaultComparisonToTCF(decodedTCF, currentCookie.domain, cookieName);
      
      return enhancedTCF;

      }
      
      console.log(`Unknown cookie type: ${cookieName}`);
      return {
        cmpName: "Unknown",
        rawCookie: currentCookie.value,
        ...addDateFields(currentCookie),
        actionTaken: "No interaction recorded",
      };
    }
  }


function normalizeConsentValue(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function buildDomainConsentRecords(cookies) {
  const recordsByKey = new Map();

  cookies.forEach(cookie => {
    const domainHash = cookie.domainHash || null;
    const domainKey = domainHash || (cookie.domain || "").toLowerCase();
    if (!domainKey) return;

    if (!recordsByKey.has(domainKey)) {
      recordsByKey.set(domainKey, {
        domainHash,
        domainRankRange: cookie.domainRankRange || null,
        consent: {
          necessary: normalizeConsentValue(cookie.categories?.necessary),
          functional: normalizeConsentValue(cookie.categories?.functional),
          performance: normalizeConsentValue(cookie.categories?.performance),
          advertising: normalizeConsentValue(cookie.categories?.advertising)
        }
      });
    }
  });

  return Array.from(recordsByKey.values());
}

async function storeCookiesInStorage(cookies) {
    // Log visit counts before saving to storage
    console.log('Saving cookies to storage with visit counts:', 
      cookies.map(c => `${c.domain}: ${c.totalVisitCount}`));
        
    try {
      // Only call ext.storage.local.set once
      await ext.storage.local.set({ cookieData: cookies });
      console.log("Cookies saved to storage successfully");

      // Verify storage by retrieving it
      const result = await ext.storage.local.get("cookieData");
      if (result.cookieData) {
        console.log("Verified storage - visit counts:",
          result.cookieData.map(c => `${c.domain}: ${c.totalVisitCount}`));
      }

      const consentDomainRecords = buildDomainConsentRecords(cookies);
      console.log("Consent payload preview:", consentDomainRecords.slice(0, 5));
      await ext.storage.local.set({ consentDomainData: consentDomainRecords });
      console.log(`Saved ${consentDomainRecords.length} consent domain records`);

      ext.runtime.sendMessage({
        action: "submitConsentData",
        payload: { records: consentDomainRecords }
      })
        .then((response) => {
          if (response?.ok) {
            console.log("Consent data upload succeeded.");
          } else if (response?.skipped) {
            console.log("Consent data upload skipped (endpoint not configured).");
          } else {
            console.warn("Consent data upload failed.", response);
          }
        })
        .catch(() => {
          console.warn("Consent data upload failed (no response).");
        });
      
      // Send completion message to consent history page (if it's listening)
      ext.runtime.sendMessage({ action: 'cookieProcessingComplete' }).catch(() => {
        // Ignore errors if no listener (consent history page not open)
      });
      console.log("Sent cookie processing completion signal");
      
    } catch (err) {
      console.error("Storage error:", err);
    }
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

document.getElementById('pricrumbs_consent_history_bottom_websites')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_consent_history_bottom_websites.html';
  });

document.getElementById('pricrumbs_website_all_cookies_accepted')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_website_all_cookies_accepted.html';
  });

document.getElementById('pricrumbs_website_all_cookies_rejected')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_website_all_cookies_rejected.html';
  });

document.getElementById('pricrumbs_website_advertising_cookies_rejected')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_website_advertising_cookies_rejected.html';
  });
document.getElementById('pricrumbs_website_all_cookies_default')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_website_all_cookies_default.html';
  });
document.getElementById('pricrumbs_websites_with_discripincies')?.addEventListener('click', () => {
  window.location.href ='pricrumbs_websites_with_discripincies.html';
  });



      

});


