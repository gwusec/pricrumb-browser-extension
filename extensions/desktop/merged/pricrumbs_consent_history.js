import {
    generateDiscrepancyWebsiteRows,
    generateGeneralWebsiteRows,
    formatDomainForDisplay,
    calculateDaysRemaining,
    sendExtensionMessage,
    addExtensionMessageListener,
    getDiscrepancyInfo,
    getFavicon,
    getWebsitesWithDiscrepancies,
    setWebsitesWithDiscrepancies,
    getUserPreferences,
    setUserPreferences,
    getSelectionStatus
} from './generic.js';

export async function injectTopAndBottomFiveTable(target) {
    // Check if a container already exists
    let container = target.querySelector('.ext-injected-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'ext-injected-container';
        target.appendChild(container);
    }

    // Reuse existing shadow root if present
    let shadow = container.shadowRoot;
    if (!shadow) {
        shadow = container.attachShadow({ mode: 'open' });
    }

    // Get table HTML including CSS
    const tableHTML = await getTopAndBottomFiveTableHTML();

    // Inject HTML into shadow root
    shadow.innerHTML = tableHTML;
}

export async function getTopAndBottomFiveTableHTML() {
    const { selectedDomains, cookieData } = await fetchDomainsAndCookies();
    const domainsToRender = selectedDomains.length > 0 ? selectedDomains : cookieData;
    const { mostRecentDomains, leastRecentDomains } = processStoredCookieData(domainsToRender);

    const topFiveRows = await generateGeneralWebsiteRows(mostRecentDomains, getFavicon, getSelectionStatus);
    const bottomFiveRows = await generateGeneralWebsiteRows(leastRecentDomains, getFavicon, getSelectionStatus);

    const allRowsHTML = [...topFiveRows, ...bottomFiveRows].map(row => row.outerHTML).join("");

    // Load CSS file from extension
    let cssContent = "";
    try {
        const cssURL = browser.runtime.getURL("css/button-toggle.css");
        const response = await fetch(cssURL);
        cssContent = await response.text();
    } catch (err) {
        console.warn("Failed to load table CSS:", err);
    }

    return `
    <style>${cssContent}</style>
    <table class="ext-injected-table">
      <thead>
        <tr>
          <th class="website-cell">Website</th>
          <th>Extra Functionality Cookies</th>
          <th>Performance Cookies</th>
          <th>Personalized Advertising Cookies</th>
          <th>Cookie Settings Will Be Stored For:</th>
        </tr>
      </thead>
      <tbody>
        ${allRowsHTML}
      </tbody>
    </table>
  `;
}

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

        const removeListener = addExtensionMessageListener(messageListener);

        // Open popup.html in background to refresh cookie data
        const popupTab = await sendExtensionMessage({
            type: "OPEN_TAB",
            options: {
                url: "popup.html",
                active: false
            }
        });

        console.log('Popup opened in background, waiting for cookie processing...');

        // Wait for either completion message or timeout (max 3 seconds)
        const startTime = Date.now();
        while (!cookieProcessingComplete && (Date.now() - startTime) < 3000) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
        }

        // Remove the listener
        removeListener();

        const processingTime = Date.now() - startTime;
        console.log(`Cookie processing took ${processingTime}ms`);

        // Close the popup tab
        if (popupTab && popupTab.id) {
            await sendExtensionMessage({
                type: "CLOSE_TAB",
                tabId: popupTab.id
            });
            console.log('Background popup closed');
        }

        // Now load preferences with fresh data
        loadUserPreferences();

    } catch (error) {
        console.error('Error during automatic refresh:', error);
        // Continue loading even if refresh fails
        loadUserPreferences();
    }
}

// Load user preferences and render tables
async function loadUserPreferences() {
    try {
        const prefs = await getUserPreferences();
        console.log("Loaded user preferences:", prefs);
        await renderTopAndBottomFive(prefs);
    } catch (error) {
        console.error("Error loading user preferences:", error);
    }
}

// Fetch selected domains and cookie data
async function fetchDomainsAndCookies() {
    const selectedDomainsResult = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "selectedDomainsForHistory"
    });

    const cookieDataResult = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "cookieData"
    });

    const selectedDomains = Array.isArray(selectedDomainsResult?.selectedDomainsForHistory)
        ? selectedDomainsResult.selectedDomainsForHistory
        : [];

    const cookieData = Array.isArray(cookieDataResult?.cookieData)
        ? cookieDataResult.cookieData
        : [];

    return { selectedDomains, cookieData };
}

/**
 * Find discrepancies and render
 */
async function findDiscrepanciesAndRender() {
    // Fetch user preferences from storage
    const userPreferences = await getUserPreferences();
    const { selectedDomains, cookieData } = await fetchDomainsAndCookies();

    let domainsToCheck = selectedDomains.length > 0 ? selectedDomains : cookieData;

    // Update categories with fresh data if available
    if (cookieData.length > 0 && selectedDomains.length > 0) {
        domainsToCheck = selectedDomains.map(domain => {
            const freshCookie = cookieData.find(c =>
                c.domain === domain.domain ||
                c.domain === domain.originalDomain ||
                formatDomainForDisplay(c.domain) === domain.domain
            );
            if (freshCookie?.categories) {
                return { ...domain, categories: freshCookie.categories };
            }
            return domain;
        });
    }

    // Only find discrepancies if user preferences exist
    if (userPreferences.size > 0) {
        const discrepancies = findDiscrepancyWebsites(domainsToCheck, userPreferences);
        await setWebsitesWithDiscrepancies(discrepancies);  // Save to storage
        console.log("Websites with discrepancies:", discrepancies);
    } else {
        await setWebsitesWithDiscrepancies([]);  // Clear storage if no preferences
        console.log("No user preferences. Skipping discrepancy detection.");
    }

    const isDiscrepanciesOnlyPage = document.getElementById("WebsitesWithDiscrepancies") !== null;
    if (isDiscrepanciesOnlyPage) {
        await displayWebsitesWithDiscrepanciesOnly(domainsToCheck, "WebsitesWithDiscrepancies");
    }

    hideLoadingMessage();
}

/**
 * Render top 5 / bottom 5 without checking discrepancies
 */
async function renderTopAndBottomFive() {
    const { selectedDomains, cookieData } = await fetchDomainsAndCookies();

    const domainsToRender = selectedDomains.length > 0 ? selectedDomains : cookieData;
    const { mostRecentDomains, leastRecentDomains } = splitDomainsByVisitFrequency(domainsToRender);

    const hasTopFive = document.getElementById("mostRecentWebsitesList") !== null;
    const hasBottomFive = document.getElementById("leastRecentWebsitesList") !== null;

    if (hasTopFive) {
        const rowsTopFive = await generateGeneralWebsiteRows(
            mostRecentDomains,
            getFavicon,          // favicon function
            getSelectionStatus   // selection status function
        );

        renderWebsiteRows(rowsTopFive, "mostRecentWebsitesList");

        const mostRecentTable = document.getElementById("mostRecentTable");
        if (mostRecentTable) mostRecentTable.style.display = "table";
    }

    if (hasBottomFive) {
        const rowsTopFive = await generateGeneralWebsiteRows(
            leastRecentDomains,
            getFavicon,          // favicon function
            getSelectionStatus   // selection status function
        );

        renderWebsiteRows(rowsTopFive, "leastRecentWebsitesList");

        const mostRecentTable = document.getElementById("mostRecentTable");
        if (mostRecentTable) mostRecentTable.style.display = "table";
    }

    hideLoadingMessage();
}

/**
 * Utility to hide the loading element
 */
function hideLoadingMessage() {
    const loadingElement = document.getElementById("loading");
    if (loadingElement) loadingElement.style.display = "none";
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
                favicon: `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`,
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

// Original function preserved for backward compatibility
async function displayWebsites(domains, tableId) {
    const rows = await buildWebsiteRows(domains);
    renderWebsiteRows(rows, tableId);
}

// Build the table rows
async function buildWebsiteRows(domains) {
    return await generateWebsiteRows(
        domains,
        getFavicon,          // favicon function
        getDiscrepancyInfo,  // discrepancy function
        getSelectionStatus   // selection status function
    );
}

// Render the rows into a table
function renderWebsiteRows(rows, tableId) {
    const container = document.getElementById(tableId);
    if (!container) {
        console.error(`Element with ID ${tableId} not found`);
        return;
    }

    container.innerHTML = ''; // Clear existing content
    rows.forEach(row => container.appendChild(row));
}

// NEW FUNCTION: Display only websites with discrepancies (for discrepancies-only page)
async function displayWebsitesWithDiscrepanciesOnly(domains, tableId) {
    const websitesList = document.getElementById(tableId);
    const table = document.getElementById('leastRecentTable');
    const noDiscrepanciesMessage = document.getElementById('noDiscrepanciesMessage');

    if (!websitesList) {
        console.error(`Element with ID ${tableId} not found`);
        return;
    }

    websitesList.innerHTML = '';

    // Fetch discrepancies from storage
    const allDiscrepancies = await getWebsitesWithDiscrepancies();
    console.log('Total discrepancies stored:', allDiscrepancies.length);

    // Filter to show only domains with discrepancies
    const domainsWithDiscrepancies = [];
    for (const domain of domains) {
        const discrepancyInfo = await getDiscrepancyInfo(domain.domain);
        if (!discrepancyInfo || !discrepancyInfo.statedPreferences) continue;

        const categories = ['functional', 'performance', 'advertising'];
        const hasDiscrepancy = categories.some(category => {
            const userValue = discrepancyInfo.statedPreferences[category];
            if (typeof userValue !== 'number') return false;

            let isAccepted = false;
            if (domain.categories && domain.categories[category] !== undefined) {
                isAccepted = domain.categories[category];
            }

            return (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);
        });

        if (hasDiscrepancy) domainsWithDiscrepancies.push(domain);
    }

    console.log(`Filtered result: ${domainsWithDiscrepancies.length} websites with discrepancies`);

    // Show message or table
    if (domainsWithDiscrepancies.length === 0) {
        if (table) table.style.display = 'none';
        if (noDiscrepanciesMessage) noDiscrepanciesMessage.style.display = 'block';
        return;
    }

    if (table) table.style.display = 'table';
    if (noDiscrepanciesMessage) noDiscrepanciesMessage.style.display = 'none';

    // Render each domain row
    for (const domain of domainsWithDiscrepancies) {
        const row = document.createElement('tr');

        // Website cell
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';

        const formattedDomain = formatDomainForDisplay(domain.domain);

        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.width = '100%';

        const leftDiv = document.createElement('div');
        leftDiv.style.width = '32px';
        leftDiv.style.minWidth = '32px';

        const favicon = document.createElement('img');
        favicon.alt = '';
        favicon.width = 32;
        favicon.height = 32;
        favicon.onerror = function () { this.style.display = 'none'; };
        favicon.src = `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`;

        leftDiv.appendChild(favicon);

        const rightDiv = document.createElement('div');
        rightDiv.style.flex = '1';
        rightDiv.style.paddingLeft = '8px';
        rightDiv.textContent = formattedDomain;

        container.appendChild(leftDiv);
        container.appendChild(rightDiv);
        domainCell.appendChild(container);
        row.appendChild(domainCell);

        const discrepancyInfo = await getDiscrepancyInfo(domain.domain);

        ['functional', 'performance', 'advertising'].forEach(category => {
            const cell = document.createElement('td');
            const selectionStatus = getSelectionStatus(
                domain,
                category,
                discrepancyInfo ? discrepancyInfo.statedPreferences : null,
                discrepancyInfo ? discrepancyInfo.categories[category] : false,
                true
            );
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        });

        const expirationCell = document.createElement('td');
        expirationCell.textContent = domain.expiration && domain.expiration !== "Session cookie"
            ? calculateDaysRemaining(domain.expiration)
            : "Session cookie";

        row.appendChild(expirationCell);
        websitesList.appendChild(row);
    }
}