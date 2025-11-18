// Store user preferences and websites with discrepancies
let userPreferences = new Map();
let websitesWithDiscrepancies = []; // Array to store all domains with discrepancies

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM content loaded, automatically refreshing cookie data...');
    
    // Automatically trigger popup.html to refresh cookie data
    automaticRefreshOnLoad();
});

// Automatically refresh cookie data when page loads
async function automaticRefreshOnLoad() {
    try {
        console.log('Auto-refreshing cookie data for discrepancy detection...');
        
        // Set up a listener for completion message from popup
        let cookieProcessingComplete = false;
        const messageListener = (message) => {
            if (message.action === 'cookieProcessingComplete') {
                cookieProcessingComplete = true;
                console.log('Received completion signal from popup');
            }
        };
        ext.runtime.onMessage.addListener(messageListener);
        
        // Open popup.html in background to refresh cookie data
        const popupURL = ext.runtime.getURL('popup.html');
        const popupTab = await ext.tabs.create({ 
            url: popupURL, 
            active: false  // Opens silently in background
        });
        
        console.log('Popup opened in background, waiting for cookie processing...');
        
        // Wait for either completion message or timeout (max 3 seconds)
        const startTime = Date.now();
        while (!cookieProcessingComplete && (Date.now() - startTime) < 3000) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
        }
        
        // Remove the listener
        ext.runtime.onMessage.removeListener(messageListener);
        
        const processingTime = Date.now() - startTime;
        console.log(`Cookie processing took ${processingTime}ms`);
        
        // Close the popup tab
        if (popupTab && popupTab.id) {
            await ext.tabs.remove(popupTab.id);
            console.log('Background popup closed');
        }
        
        // Now load preferences with fresh data
        loadSavedPreferences();
        
    } catch (error) {
        console.error('Error during automatic refresh:', error);
        // Continue loading even if refresh fails
        loadSavedPreferences();
    }
}

// Function to refresh cookie data by querying browser cookies directly
async function refreshCookieDataFromBrowser() {
    console.log('Refreshing cookie data from browser...');
    
    try {
        // Send message to background script to check cookies
        const response = await ext.runtime.sendMessage({ 
            action: "checkCookies", 
            cookieNames: [
                "OptanonConsent", "cookieyes-consent", "wscrCookieConsent",
                "cmplz_rt_functional", "cmplz_rt_marketing", "cmplz_rt_preferences",
                "cmplz_rt_statistics", "cmplz_rt_banner-status", "uc_userconsent",
                "quantcast_consent", "CookieConsent", "osano_consent", "cookie_notice",
                "cookie_law_info", "TrustArcConsent", "CONSENT", "NID", "1P_JAR",
                "euconsent-v2", "eupubconsent-v2", "TVPtcs22", "TcString",
                "__cmpconsent25759", "cookiebotTcfConsentString",
                "mychannels-consentData", "sas_euconsent_v2", "EuConsent"
            ]
        });
        
        if (response && response.cookies && response.cookies.length > 0) {
            console.log(`Refreshed ${response.cookies.length} cookies from browser`);
            
            // Update cookieData in storage with fresh data
            await ext.storage.local.set({ cookieData: response.cookies });
            console.log('Cookie data updated in storage');
            
            return response.cookies;
        } else {
            console.warn('No cookies returned from browser refresh');
            return [];
        }
    } catch (error) {
        console.error('Error refreshing cookies from browser:', error);
        throw error;
    }
}

async function loadSavedPreferences() {
    try {
        const result = await ext.storage.local.get('userCookiePreferences');
        if (result && result.userCookiePreferences) {
            // Try to handle both old and new format of preferences
            if (Array.isArray(result.userCookiePreferences)) {
                // This is likely the new format (Map serialized to array)
                userPreferences = new Map(result.userCookiePreferences);
                console.log('Loaded saved preferences (new format):', userPreferences);
            } else if (typeof result.userCookiePreferences === 'object') {
                // This might be the old format (array of objects with domain and preferences)
                // Convert it to the Map format expected by the current code
                userPreferences = new Map();
                result.userCookiePreferences.forEach(item => {
                    if (item.domain && item.preferences) {
                        userPreferences.set(item.domain, item.preferences);
                    }
                });
                console.log('Loaded saved preferences (old format, converted):', userPreferences);
            }
            
            // Debug: Print the contents of userPreferences
            console.log('User preferences map contents:');
            userPreferences.forEach((prefs, domain) => {
                console.log(`Domain: ${domain}`, prefs);
            });
        } else {
            console.warn('No user preferences found in storage');
            userPreferences = new Map(); // Initialize with empty Map
            console.log('No saved preferences found. Continuing without discrepancy detection.');
        }
        
        // Always proceed to load cookies regardless of whether preferences exist
        loadCookiesAndFindDiscrepancies();
    } catch (error) {
        console.error('Error loading saved preferences:', error);
        // Still try to load cookies even if there was an error with preferences
        loadCookiesAndFindDiscrepancies();
    }
}

async function loadCookiesAndFindDiscrepancies() {
    try {
        // First, try to load the selected domains from preference pages
        const selectedDomainsResult = await ext.storage.local.get('selectedDomainsForHistory');
        
        if (selectedDomainsResult && selectedDomainsResult.selectedDomainsForHistory && 
            Array.isArray(selectedDomainsResult.selectedDomainsForHistory) &&
            selectedDomainsResult.selectedDomainsForHistory.length > 0) {
            
            console.log('Using selected domains from preference pages:', selectedDomainsResult.selectedDomainsForHistory);
            
            // Use the exact domains that were shown in the preference pages
            let selectedDomains = selectedDomainsResult.selectedDomainsForHistory;
            
            // Fetch fresh cookie data to get current cookie states
            const cookieDataResult = await ext.storage.local.get('cookieData');
            if (cookieDataResult && cookieDataResult.cookieData && Array.isArray(cookieDataResult.cookieData)) {
                console.log('Updating with fresh cookie data for accurate discrepancy detection');
                
                // Update the categories in selectedDomains with fresh data
                selectedDomains = selectedDomains.map(domain => {
                    // Find matching cookie in fresh data
                    const freshCookie = cookieDataResult.cookieData.find(c => 
                        c.domain === domain.domain || 
                        c.domain === domain.originalDomain ||
                        formatDomainForDisplay(c.domain) === domain.domain
                    );
                    
                    if (freshCookie && freshCookie.categories) {
                        console.log(`Updated ${domain.domain} with fresh categories:`, freshCookie.categories);
                        return {
                            ...domain,
                            categories: freshCookie.categories  // Use fresh categories
                        };
                    }
                    return domain;  // Keep original if no fresh data found
                });
            } else {
                console.warn('No fresh cookie data available, using cached categories');
            }
            
            // Check if we have user preferences to compare against
            if (userPreferences && userPreferences.size > 0) {
                // Find domains with discrepancies if we have user preferences
                websitesWithDiscrepancies = findDiscrepancyWebsites(selectedDomains, userPreferences);
                console.log('Websites with discrepancies found:', websitesWithDiscrepancies.length);
                console.log('Discrepancy details:', websitesWithDiscrepancies);
            } else {
                // No user preferences, so no discrepancies
                websitesWithDiscrepancies = [];
                console.log('No user preferences found, skipping discrepancy detection');
            }
            
            // Detect which page we're on and display accordingly
            const isDiscrepanciesOnlyPage = document.getElementById('WebsitesWithDiscrepancies') !== null;
            const hasTopFive = document.getElementById('mostRecentWebsitesList') !== null;
            const hasBottomFive = document.getElementById('leastRecentWebsitesList') !== null;
            
            if (isDiscrepanciesOnlyPage) {
                // Discrepancies-only page - show only websites with discrepancies
                console.log(' Page detected: Discrepancies-Only Page');
                displayWebsitesWithDiscrepanciesOnly(selectedDomains, 'WebsitesWithDiscrepancies');
            } else if (hasTopFive || hasBottomFive) {
                // Original page - show top 5 and/or bottom 5
                console.log(' Page detected: Original Page');
                const { mostRecentDomains, leastRecentDomains } = splitDomainsByVisitFrequency(selectedDomains);
                
                if (hasTopFive) {
                    displayWebsites(mostRecentDomains, 'mostRecentWebsitesList');
                    const mostRecentTable = document.getElementById('mostRecentTable');
                    if (mostRecentTable) mostRecentTable.style.display = 'table';
                }
                
                if (hasBottomFive) {
                    displayWebsites(leastRecentDomains, 'leastRecentWebsitesList');
                    const leastRecentTable = document.getElementById('leastRecentTable');
                    if (leastRecentTable) leastRecentTable.style.display = 'table';
                }
            }
            
            // Hide loading message
            const loadingElement = document.getElementById('loading');
            if (loadingElement) loadingElement.style.display = 'none';
            
        } else {
            // Fallback: Load cookie data if no selected domains found
            console.log('No selected domains found, falling back to cookie data');
            const result = await ext.storage.local.get('cookieData');
            console.log('Retrieved cookie data:', result);

            if (result && result.cookieData && Array.isArray(result.cookieData)) {
                // Check if we have user preferences to compare against
                if (userPreferences && userPreferences.size > 0) {
                    // Find domains with discrepancies if we have user preferences
                    websitesWithDiscrepancies = findDiscrepancyWebsites(result.cookieData, userPreferences);
                    console.log('Websites with discrepancies found:', websitesWithDiscrepancies.length);
                    console.log('Discrepancy details:', websitesWithDiscrepancies);
                } else {
                    // No user preferences, so no discrepancies
                    websitesWithDiscrepancies = [];
                    console.log('No user preferences found, skipping discrepancy detection');
                }
                
                // Process the cookie data for display
                const { mostRecentDomains, leastRecentDomains } = processStoredCookieData(result.cookieData);
                
                // Detect which page we're on and display accordingly
                const isDiscrepanciesOnlyPage = document.getElementById('WebsitesWithDiscrepancies') !== null;
                const hasTopFive = document.getElementById('mostRecentWebsitesList') !== null;
                const hasBottomFive = document.getElementById('leastRecentWebsitesList') !== null;
                
                if (isDiscrepanciesOnlyPage) {
                    // Discrepancies-only page
                    console.log('Page detected: Discrepancies-Only Page (Fallback)');
                    const allDomains = [...mostRecentDomains, ...leastRecentDomains];
                    displayWebsitesWithDiscrepanciesOnly(allDomains, 'WebsitesWithDiscrepancies');
                } else if (hasTopFive || hasBottomFive) {
                    // Original page
                    console.log(' Page detected: Original Page (Fallback)');
                    
                    if (hasTopFive) {
                        displayWebsites(mostRecentDomains, 'mostRecentWebsitesList');
                        const mostRecentTable = document.getElementById('mostRecentTable');
                        if (mostRecentTable) mostRecentTable.style.display = 'table';
                    }
                    
                    if (hasBottomFive) {
                        displayWebsites(leastRecentDomains, 'leastRecentWebsitesList');
                        const leastRecentTable = document.getElementById('leastRecentTable');
                        if (leastRecentTable) leastRecentTable.style.display = 'table';
                    }
                }
                
                // Hide loading message
                const loadingElement = document.getElementById('loading');
                if (loadingElement) loadingElement.style.display = 'none';
            } else {
                const loadingElement = document.getElementById('loading');
                if (loadingElement) {
                    loadingElement.textContent = 'No cookie data found. Please visit the Cookie Checker first.';
                }
            }
        }
    } catch (error) {
        console.error('Error loading cookies:', error);
        const loadingElement = document.getElementById('loading');
        if (loadingElement) {
            loadingElement.textContent = 'Error loading cookie data: ' + error.message;
        }
    }
}

function findDiscrepancyWebsites(cookieData, userPreferences) {
    const discrepancies = [];
    
    // Skip if no user preferences exist
    if (!userPreferences || userPreferences.size === 0) {
        console.warn('No user preferences found when checking for discrepancies');
        return discrepancies;
    }
    
    console.log('Starting discrepancy detection...');
    console.log('Total cookies to check:', cookieData.length);
    console.log('Total user preferences:', userPreferences.size);
    
    // Process each cookie with ActionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Cookies with action taken:', actionTakenCookies.length);
    console.log('Sample cookie data:', actionTakenCookies.length > 0 ? actionTakenCookies[0] : 'No cookies');
    
    // Debug: Log all user preference domains for easier comparison
    const allPreferenceDomains = Array.from(userPreferences.keys());
    console.log('All preference domains:', allPreferenceDomains);
    
    // For each cookie, check if user has stated a different preference
    for (const cookie of actionTakenCookies) {
        if (!cookie.domain) {
            console.log('Skipping cookie without domain');
            continue;
        }
        
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const originalDomain = cookie.domain;
        
        console.log(`\nChecking cookie for domain: ${cookie.domain} (formatted: ${formattedDomain})`);
        
        // Try to extract actual preferences from the cookie
        let actualPreferences = {
            functional: false,
            performance: false,
            advertising: false
        };
        
        // First try from cookie.categories
        if (cookie.categories && typeof cookie.categories === 'object') {
            actualPreferences = {
                functional: cookie.categories.functional === true,
                performance: cookie.categories.performance === true,
                advertising: cookie.categories.advertising === true
            };
            console.log('Extracted preferences from categories:', actualPreferences);
        } 
        // Then try from direct columns 
        else if ('functional' in cookie || 'performance' in cookie || 'advertising' in cookie) {
            // Handle each category separately to avoid undefined errors
            if ('functional' in cookie) {
                actualPreferences.functional = cookie.functional === "Yes" || cookie.functional === true;
            }
            if ('performance' in cookie) {
                actualPreferences.performance = cookie.performance === "Yes" || cookie.performance === true;
            }
            if ('advertising' in cookie) {
                actualPreferences.advertising = cookie.advertising === "Yes" || cookie.advertising === true;
            }
            console.log('Extracted preferences from direct columns:', actualPreferences);
        }
        
        // Find matching domain in user preferences
        let statedPreferences = null;
        let matchedDomain = null;
        
        // Try different domain formats to match with preferences
        const possibleFormats = [
            originalDomain,
            originalDomain.startsWith('.') ? originalDomain.substring(1) : null,
            !originalDomain.startsWith('.') ? '.' + originalDomain : null,
            formattedDomain,
            formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : null,
            !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null,
            // Additional formats for better matching
            formattedDomain.startsWith('www.') ? '.' + formattedDomain.substring(4) : null, // .domain.com from www.domain.com
            originalDomain.startsWith('.') && originalDomain.includes('www.') ? originalDomain.replace('.www.', '.') : null, // .domain.com from .www.domain.com
            formattedDomain.replace('www.', '') // domain.com from www.domain.com
        ].filter(Boolean);
        
        console.log('Checking possible domain formats:', possibleFormats);
        
        // Try each possible format
        for (const format of possibleFormats) {
            if (userPreferences.has(format)) {
                const prefs = userPreferences.get(format);
                console.log(`Found match for domain format: ${format}`, prefs);
                
                // Check for at least one set preference
                if (prefs && (prefs.functional !== null || 
                    prefs.performance !== null || 
                    prefs.advertising !== null)) {
                    
                    // Just use the preferences as they are, keeping the numeric values
                    statedPreferences = prefs;
                    
                    matchedDomain = format;
                    console.log(`Using preferences for domain: ${matchedDomain}`, statedPreferences);
                    break;
                } else {
                    console.log('No valid preferences for domain:', format);
                }
            }
        }
        
        // Skip if no stated preferences found
        if (!statedPreferences) {
            console.log('No stated preferences found for domain:', cookie.domain);
            continue;
        }
        
        // Compare preferences based on the 5-point scale
        // Only compare categories that have a stated preference
        const categories = {
            functional: false,
            performance: false,
            advertising: false
        };
        
        // Helper function to check discrepancies based on the 5-point scale
        function isDiscrepancyByScale(userValue, actualAccepted) {
            if (typeof userValue !== 'number') return false;
            
            // If cookie is accepted but user selected 1-2 (not willing/not really willing)
            if (actualAccepted && userValue <= 2) return true;
            
            // If cookie is rejected but user selected 4-5 (somewhat willing/willing)
            if (!actualAccepted && userValue >= 4) return true;
            
            return false;
        }
        
        // Only check for discrepancies in categories that have been explicitly set
        if (statedPreferences.functional !== null) {
            categories.functional = isDiscrepancyByScale(statedPreferences.functional, actualPreferences.functional);
        }
        
        if (statedPreferences.performance !== null) {
            categories.performance = isDiscrepancyByScale(statedPreferences.performance, actualPreferences.performance);
        }
        
        if (statedPreferences.advertising !== null) {
            categories.advertising = isDiscrepancyByScale(statedPreferences.advertising, actualPreferences.advertising);
        }
        
        const hasDifference = categories.functional || categories.performance || categories.advertising;
        
        console.log('Comparison result for', cookie.domain, ':', 
            categories.functional ? 'Functional differs' : '',
            categories.performance ? 'Performance differs' : '',
            categories.advertising ? 'Advertising differs' : '',
            hasDifference ? 'DISCREPANCY FOUND' : 'No discrepancy'
        );
        
        if (hasDifference) {
            discrepancies.push({
                domain: formattedDomain,
                originalDomain: originalDomain,
                favicon: `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`,
                statedPreferences: statedPreferences,
                actualPreferences: actualPreferences,
                cookie: cookie,
                matchedDomain: matchedDomain,
                categories: categories
            });
            
            console.log(`Found discrepancy for ${formattedDomain}`, {
                stated: statedPreferences,
                actual: actualPreferences,
                categories: categories
            });
        }
    }
    
    console.log('Total discrepancies found:', discrepancies.length);
    return discrepancies;
}

// Split the selected 10 domains into most visited (top 5) and least visited (bottom 5)
function splitDomainsByVisitFrequency(domains) {
    console.log('Splitting domains by visit frequency:', domains);
    
    // Sort by totalVisitCount (most frequent first)
    const sortedDomains = [...domains].sort((a, b) => {
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsB - visitsA;  // Descending order
    });
    
    // Split into top 5 and bottom 5
    const mostRecentDomains = sortedDomains.slice(0, 5);
    const leastRecentDomains = sortedDomains.slice(5, 10);
    
    console.log('Most visited (top 5):', mostRecentDomains.map(d => `${d.domain} (${d.totalVisitCount} visits)`));
    console.log('Least visited (bottom 5):', leastRecentDomains.map(d => `${d.domain} (${d.totalVisitCount} visits)`));
    
    return {
        mostRecentDomains,
        leastRecentDomains
    };
}

// Process the stored cookie data from the extension
function processStoredCookieData(cookieData) {
    // Filter for cookies where the user has taken action
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Action taken cookies for tables:', actionTakenCookies.length);

    // If we have fewer than 6 domains with action taken, use all cookies
    const cookiesToProcess = actionTakenCookies.length >= 6 ? actionTakenCookies : cookieData;
    
    // Sort by totalVisitCount (most frequent first)
    const sortedByFrequency = [...cookiesToProcess].sort((a, b) => {
        // Parse integers from totalVisitCount, defaulting to 0 if invalid
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsB - visitsA;  // Most frequent first (highest count)
    });
    
    // Track seen main domain names to ensure uniqueness
    const seenMainDomains = new Set();
    
    // Get EXACTLY 5 unique most frequently visited domains
    const mostFrequentDomains = [];
    for (const cookie of sortedByFrequency) {
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const mainName = extractMainDomainName(formattedDomain);
        
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            mostFrequentDomains.push(cookie);
            
            if (mostFrequentDomains.length === 5) break;
        }
    }
    
    // Get EXACTLY 5 unique least frequently visited domains
    const domainsWithVisits = cookiesToProcess.filter(cookie => 
        parseInt(cookie.totalVisitCount) > 0
    );
    
    // Then sort by ascending visit count
    const sortedAscending = [...domainsWithVisits].sort((a, b) => {
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsA - visitsB;
    });
    
    const leastFrequentDomains = [];
    for (const cookie of sortedAscending) {
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const mainName = extractMainDomainName(formattedDomain);
        
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            leastFrequentDomains.push(cookie);
            
            if (leastFrequentDomains.length === 5) break;
        }
    }
    
    console.log(`Selected ${mostFrequentDomains.length} unique most frequent domains`);
    console.log(`Selected ${leastFrequentDomains.length} unique least frequent domains`);
    
    return { 
        mostRecentDomains: mostFrequentDomains, 
        leastRecentDomains: leastFrequentDomains 
    };
}

// Format domain for better display
function formatDomainForDisplay(domain) {
    // If domain is empty or undefined, return "Unknown"
    if (!domain) return "Unknown";
    
    // Remove leading dot if present
    if (domain.startsWith('.')) {
        domain = domain.substring(1);
    }
    
    // If domain doesn't have a subdomain (no dots except the TLD), add www.
    const parts = domain.split('.');
    if (parts.length === 2) {
        domain = 'www.' + domain;
    }
    
    return domain;
}

// Extract the main domain name for comparison (e.g., "zoom" from "www.zoom.com" or "www.zoom.us")
function extractMainDomainName(domain) {
    if (!domain) return '';
    
    // Remove www. prefix
    let cleaned = domain.replace(/^www\./, '');
    
    // Split by dots and get the main part (before TLD)
    const parts = cleaned.split('.');
    
    // Return the main domain name (second-to-last part before TLD)
    // For "zoom.com" or "zoom.us", this returns "zoom"
    // For "stackoverflow.com", this returns "stackoverflow"
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : cleaned.toLowerCase();
}

// Calculate days remaining until cookie expiration
function calculateDaysRemaining(expirationDate) {
    if (!expirationDate || expirationDate === "Session cookie") {
        return "Session cookie";
    }
    
    try {
        // Parse the expiration date
        const expDate = new Date(expirationDate);
        const currentDate = new Date();
        
        // Calculate the difference in milliseconds
        const diffMs = expDate - currentDate;
        
        // Convert to days and round down
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        // Handle cases where the cookie has already expired or expires today
        if (diffDays < 0) {
            return "Expired";
        } else if (diffDays === 0) {
            return "Expires today";
        } else if (diffDays === 1) {
            return "1 day";
        } else {
            return `${diffDays} days`;
        }
    } catch (error) {
        console.error('Error parsing expiration date:', error);
        return expirationDate; // Return original if parsing fails
    }
}

// Check if a domain has discrepancies
function hasDiscrepancies(domain) {
    const formattedDomain = formatDomainForDisplay(domain);
    
    return websitesWithDiscrepancies.some(d => 
        d.domain === formattedDomain || 
        d.originalDomain === domain ||
        formatDomainForDisplay(d.originalDomain) === formattedDomain
    );
}

// Get specific discrepancy information for a domain
function getDiscrepancyInfo(domain) {
    const formattedDomain = formatDomainForDisplay(domain);
    console.log(`Looking for discrepancy info for: ${domain} (formatted: ${formattedDomain})`);
    
    // Try multiple domain format variations for matching
    const domainVariations = [
        domain,
        formattedDomain,
        domain.startsWith('.') ? domain.substring(1) : domain,
        formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : formattedDomain,
        domain.startsWith('.') ? domain.substring(1) : '.' + domain
    ];
    
    console.log('Trying domain variations:', domainVariations);
    console.log('Available discrepancy domains:', websitesWithDiscrepancies.map(d => `${d.domain} (orig: ${d.originalDomain})`));
    
    const discrepancy = websitesWithDiscrepancies.find(d => {
        // Check if any variation of the input domain matches any variation of the discrepancy domain
        for (const inputVar of domainVariations) {
            if (d.domain === inputVar || 
                d.originalDomain === inputVar ||
                formatDomainForDisplay(d.originalDomain) === inputVar ||
                d.domain.replace('www.', '') === inputVar.replace('www.', '') ||
                d.originalDomain.replace(/^\./, '') === inputVar.replace(/^\./, '')) {
                return true;
            }
        }
        return false;
    });
    
    if (discrepancy) {
        console.log('✓ Found discrepancy for domain:', domain, discrepancy);
    } else {
        console.log('✗ No discrepancy found for domain:', domain);
    }
    
    return discrepancy;
}

function displayWebsites(domains, tableId) {
    const websitesList = document.getElementById(tableId);
    const table = document.getElementById('leastRecentTable');
    const noDiscrepanciesMessage = document.getElementById('noDiscrepanciesMessage');
    
    if (!websitesList) {
        console.error(`Element with ID ${tableId} not found`);
        return;
    }
    
    websitesList.innerHTML = '';

    // NO FILTERING - just display all domains passed to this function
    console.log(`Displaying ${domains.length} domains in table ${tableId}`);
    
    // Display all domains without filtering
    domains.forEach((domain, index) => {
        console.log(`Displaying domain in table: ${domain.domain}`);
        
        const row = document.createElement('tr');
        
        // Website cell with favicon and formatted domain
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';
        
        // Format the domain for display
        const formattedDomain = formatDomainForDisplay(domain.domain);
        
        // Create favicon image element
        const favicon = document.createElement('img');
        favicon.alt = '';
        favicon.style.marginRight = '8px';
        favicon.style.verticalAlign = 'middle';
        
        // Handle favicon loading errors (set before src to suppress console errors)
        favicon.onerror = function() {
            this.style.display = 'none';
        };
        
        // Set src after error handler is attached
        favicon.src = `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`;
        
        // Create a container for the favicon and domain text
        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'flex';
        domainContainer.style.alignItems = 'center';
        
        // Add favicon and domain text
        domainContainer.appendChild(favicon);
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        
        row.appendChild(domainCell);

        // Check if this domain has any discrepancies
        let discrepancyInfo = getDiscrepancyInfo(domain.domain);
        console.log(`Domain ${formattedDomain} discrepancy info:`, discrepancyInfo);

        // Create cells for each category showing only the selected option
        const categories = ['functional', 'performance', 'advertising'];
        categories.forEach(category => {
            const cell = document.createElement('td');
            // Create the selection status with discrepancy markers if needed
            const selectionStatus = getSelectionStatus(
                domain, 
                category, 
                discrepancyInfo ? discrepancyInfo.statedPreferences : null,
                discrepancyInfo ? discrepancyInfo.categories[category] : false, false // Don't show discrepancies on top websites page
            );
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        });

        // Expiration date cell - calculate days remaining
        const expirationCell = document.createElement('td');
        expirationCell.style.fontWeight = 'bold';
        if (domain.expiration && domain.expiration !== "Session cookie") {
            const daysRemaining = calculateDaysRemaining(domain.expiration);
            expirationCell.textContent = daysRemaining;
        } else {
            expirationCell.textContent = "Session cookie";
        }
        row.appendChild(expirationCell);

        websitesList.appendChild(row);
    });
}

// Helper function to get a single button showing the selection status (Updated to work with the scale)
function getSelectionStatus(domain, category, userPref, hasDiscrepancy, showDiscrepancies = true) {
    console.log(`Creating selection status for ${domain.domain}, category ${category}, discrepancy: ${hasDiscrepancy}`);
    
    const container = document.createElement('div');
    container.className = 'selection-container';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.position = 'relative';
    
    // Determine if accepted or rejected in cookie history
    let isAccepted = false;
    
    if (domain.categories && domain.categories[category] !== undefined) {
        isAccepted = domain.categories[category];
    } else if (domain[category] !== undefined) {
        // Handle string or boolean values
        if (typeof domain[category] === 'string') {
            isAccepted = domain[category] === "Yes" || 
                          domain[category] === "Accepted" || 
                          domain[category] === "Accept";
        } else {
            isAccepted = domain[category] === true;
        }
    } else if (domain[category.charAt(0).toUpperCase() + category.slice(1)] !== undefined) {
        // Try with capitalized first letter (Functional instead of functional)
        const value = domain[category.charAt(0).toUpperCase() + category.slice(1)];
        if (typeof value === 'string') {
            isAccepted = value === "Yes" || 
                          value === "Accepted" || 
                          value === "Accept";
        } else {
            isAccepted = value === true;
        }
    }
    
    // Create the display button
    const button = document.createElement('button');
    
    if (isAccepted) {
        button.textContent = 'Allowed';
        button.className = 'toggle-btn accept selected';
        button.style.backgroundColor = '#4c7aaf';
        button.style.color = 'white';
        button.style.borderColor = '#4c7aaf';
    } else {
        button.textContent = 'Not Allowed';
        button.className = 'toggle-btn reject selected';
        button.style.backgroundColor = '#919291';
        button.style.color = 'white';
        button.style.borderColor = '#919291';
    }
    
    // Add to container
    container.appendChild(button);
    
    // Check for discrepancy according to the 5-point scale logic
    if ( showDiscrepancies && userPref && typeof userPref[category] === 'number') {
        const userValue = userPref[category];
        const valueText = getWillingnessText(userValue);
        
        // If cookie is accepted but user selected 1-2 (not willing/not really willing)
        // OR if cookie is rejected but user selected 4-5 (somewhat willing/willing)
        const hasDiscrepancyByScale = (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);
        
        if (hasDiscrepancyByScale) {
            console.log(`Adding discrepancy marker for ${domain.domain}, category ${category}`);
            
            const discrepancyMarker = document.createElement('span');
            discrepancyMarker.textContent = '!';
            discrepancyMarker.style.position = 'absolute';
            discrepancyMarker.style.top = '10px';
            discrepancyMarker.style.right = '20px';
            discrepancyMarker.style.color = '#ff9800';
            discrepancyMarker.style.fontWeight = 'bold';
            discrepancyMarker.style.fontSize = '25px';
            discrepancyMarker.style.cursor = 'pointer';
            discrepancyMarker.style.zIndex = '10';
            
            // Add tooltip showing what the user preference was
            discrepancyMarker.title = `Your previous choice was: "${valueText}", but actual setting is: ${isAccepted ? 'Allowed' : 'Not Allowed'}`;
            
            container.appendChild(discrepancyMarker);
            container.style.overflow = 'visible';
            container.style.marginTop = '15px';
        }
    }
    
    return container;
}

// Helper function to get text for willingness level
function getWillingnessText(value) {
    switch (value) {
        case 1: return "Not willing";
        case 2: return "Not really willing";
        case 3: return "Undecided";
        case 4: return "Somewhat willing";
        case 5: return "Willing";
        default: return "Unknown";
    }
}
// NEW FUNCTION: Display only websites with discrepancies (for discrepancies-only page)
function displayWebsitesWithDiscrepanciesOnly(domains, tableId) {
    const websitesList = document.getElementById(tableId);
    const table = document.getElementById('leastRecentTable');
    const noDiscrepanciesMessage = document.getElementById('noDiscrepanciesMessage');
    
    if (!websitesList) {
        console.error(`Element with ID ${tableId} not found`);
        return;
    }
    
    websitesList.innerHTML = '';
    
    console.log('==========================================');
    console.log('FILTERING FOR DISCREPANCIES ONLY');
    console.log('==========================================');
    console.log('Total domains to check:', domains.length);
    console.log('Total discrepancies found:', websitesWithDiscrepancies.length);
    
    // Filter to show only domains with discrepancies
    const domainsWithDiscrepancies = domains.filter(domain => {
        const discrepancyInfo = getDiscrepancyInfo(domain.domain);
        if (!discrepancyInfo || !discrepancyInfo.statedPreferences) {
            return false;
        }
        
        // Check if any category has a discrepancy
        const categories = ['functional', 'performance', 'advertising'];
        return categories.some(category => {
            const userValue = discrepancyInfo.statedPreferences[category];
            if (typeof userValue !== 'number') return false;
            
            let isAccepted = false;
            if (domain.categories && domain.categories[category] !== undefined) {
                isAccepted = domain.categories[category];
            }
            
            // Discrepancy = accepted but user chose 1-2, or rejected but user chose 4-5
            return (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);
        });
    });
    
    console.log(`Filtered result: ${domainsWithDiscrepancies.length} websites with discrepancies`);
    console.log('==========================================\n');
    
    // Show message or table
    if (domainsWithDiscrepancies.length === 0) {
        if (table) table.style.display = 'none';
        if (noDiscrepanciesMessage) noDiscrepanciesMessage.style.display = 'block';
        return;
    }
    
    if (table) table.style.display = 'table';
    if (noDiscrepanciesMessage) noDiscrepanciesMessage.style.display = 'none';
    
    // Display each domain with discrepancies
    domainsWithDiscrepancies.forEach(domain => {
        const row = document.createElement('tr');
        
        // Website cell
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';
        const formattedDomain = formatDomainForDisplay(domain.domain);
        
        const favicon = document.createElement('img');
        favicon.alt = '';
        favicon.style.marginRight = '8px';
        favicon.style.verticalAlign = 'middle';
        favicon.onerror = function() { this.style.display = 'none'; };
        favicon.src = `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`;
        
        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'flex';
        domainContainer.style.alignItems = 'center';
        domainContainer.appendChild(favicon);
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        row.appendChild(domainCell);
        
        // Get discrepancy info
        const discrepancyInfo = getDiscrepancyInfo(domain.domain);
        
        // Category cells
        ['functional', 'performance', 'advertising'].forEach(category => {
            const cell = document.createElement('td');
            const selectionStatus = getSelectionStatus(
                domain, 
                category, 
                discrepancyInfo ? discrepancyInfo.statedPreferences : null,
                discrepancyInfo ? discrepancyInfo.categories[category] : false, true // Show discrepancies on discrepancies page
            );
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        });
        
        // Expiration cell
        const expirationCell = document.createElement('td');
        expirationCell.style.fontWeight = 'bold';
        if (domain.expiration && domain.expiration !== "Session cookie") {
            expirationCell.textContent = calculateDaysRemaining(domain.expiration);
        } else {
            expirationCell.textContent = "Session cookie";
        }
        row.appendChild(expirationCell);
        
        websitesList.appendChild(row);
    });
}