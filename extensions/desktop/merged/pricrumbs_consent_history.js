import {
    generateWebsiteRows,
    extractMainDomainName,
    calculateDaysRemaining,
    sendExtensionMessage,
    addExtensionMessageListener,
    getDiscrepancyInfo,
    getFavicon,
    getWebsitesWithDiscrepancies,
    setWebsitesWithDiscrepancies,
    getParticipantCookiesPreferences,
    setUserPreferences,
    getSelectionStatus
} from './helper_functions.js';

/**
 * Injects the Top and Bottom Five Websites table into a target DOM element.
 *
 * This function:
 * 1. Creates a container with a Shadow DOM inside the target element to isolate styles.
 * 2. Loads the extension CSS for the table.
 * 3. Renders a temporary "Loading..." table while the full table is generated.
 * 4. Retrieves the table HTML from storage or generates it if needed, first without favicons,
 *    then updates it with favicons.
 * 5. Inserts the final table HTML into the Shadow DOM.
 *
 * @param {HTMLElement} target - The DOM element where the table will be injected.
 */
export async function injectTopAndBottomFiveTable(target = null, tutorial = false, showDiscrepancies = false) {

    // Find or create the container element for the shadow DOM
    let container = target.querySelector('.ext-injected-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'ext-injected-container';

        // Clear any existing content in the target and append the container
        target.innerHTML = "";
        target.appendChild(container);
    }

    // Create a shadow root if it does not already exist
    let shadow = container.shadowRoot;
    if (!shadow) {
        shadow = container.attachShadow({ mode: 'open' });
    }

    // Load the CSS file for the table from the extension
    let cssContent = "";
    try {
        const cssURL = browser.runtime.getURL("css/button-toggle.css");
        const response = await fetch(cssURL);
        cssContent = await response.text();
    } catch (err) {
        console.warn("Failed to load table CSS:", err);
    }

    // Render a temporary "Loading..." table to show immediately
    shadow.innerHTML = `
        <style>${cssContent}</style>
        <table class="ext-injected-table ext-loading">
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
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
                <tr><td colspan="5">Loading...</td></tr>
            </tbody>
        </table>
    `;

    // Because favicons take long to render, we first get the table HTML without favicons from storage or generate it
    shadow.innerHTML = await getTopAndBottomFiveTableHTML(false, showDiscrepancies);

    // Show tutorial if we want to
    if (tutorial) {
        startTableTutorial(shadow);
    }

    // Then, retrieve or generate the table HTML with favicons and update the shadow DOM
    shadow.innerHTML = await getTopAndBottomFiveTableHTML(true, showDiscrepancies);
}

/**
 * Generates the HTML for the Top and Bottom Five Websites table.
 *
 * @param {boolean} includeFavIcons - Whether to include website favicons in the table.
 * @returns {Promise<string>} The full HTML string for the table, ready to inject into the page.
 */
export async function createTopAndBottomFiveTableHTML(includeFavIcons, showDiscrepancies) {

    // Retrieve the value from storage
    const { STORAGE_KEYS } = await import(browser.runtime.getURL("helper_functions.js"));
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: STORAGE_KEYS.DOMAIN_HISTORY
    });
    const cookieHistory = result?.[STORAGE_KEYS.DOMAIN_HISTORY];

    if (showDiscrepancies) {
        findDiscrepanciesAndRender();
    }

    // Generate HTML rows for top five and bottom five domains
    const rows = await generateWebsiteRows(
        cookieHistory,
        includeFavIcons ? getFavicon : null,
        showDiscrepancies ? getDiscrepancyInfo : null,
        getSelectionStatus
    );

    // Combine all rows into a single HTML string
    const allRowsHTML = [...rows]
        .map(row => row.outerHTML)
        .join("");

    // Load the table CSS from the extension
    let cssContent = "";
    try {
        const cssURL = browser.runtime.getURL("css/button-toggle.css");
        const response = await fetch(cssURL);
        cssContent = await response.text();
    } catch (err) {
        console.warn("Failed to load table CSS:", err);
    }

    // Return the full HTML for the table, including CSS and all rows
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

// Setter: save table HTML and its configuration to storage
export async function setTopAndBottomFiveTableHTML(html, includeFavIcons, showDiscrepancies) {
    return sendExtensionMessage({
        type: "STORAGE_SET",
        key: "topAndBottomFiveTableHTML",
        value: {
            html,
            includeFavIcons,
            showDiscrepancies
        }
    });
}

/**
 * Retrieves the HTML for the Top and Bottom Five Websites table.
 *
 * This function first checks extension storage for a cached table HTML.
 * If a cached version exists and favicons are not requested, it returns the cached table.
 * Otherwise, it generates a new table HTML, optionally including favicons, and stores it in cache.
 * Handles storage errors by regenerating the table if necessary.
 *
 * @param {boolean} includeFavIcons - Whether to include website favicons in the table.
 * @returns {Promise<string>} The HTML string for the table.
 */
export async function getTopAndBottomFiveTableHTML(includeFavIcons, showDiscrepancies) {
    try {
        const response = await sendExtensionMessage({
            type: "STORAGE_GET",
            key: "topAndBottomFiveTableHTML"
        });

        const cached = response?.topAndBottomFiveTableHTML;

        const needsNewTable =
            !cached ||
            cached.includeFavIcons !== includeFavIcons ||
            cached.showDiscrepancies !== showDiscrepancies;

        let html;

        if (needsNewTable) {
            console.log("[TableHTML] Creating table", { includeFavIcons, showDiscrepancies });

            html = await createTopAndBottomFiveTableHTML(includeFavIcons, showDiscrepancies);

            await setTopAndBottomFiveTableHTML(
                html,
                includeFavIcons,
                showDiscrepancies
            );

        } else {
            console.log("[TableHTML] Loading table from cache");
            html = cached.html;
        }

        return html;

    } catch (error) {
        console.warn("Failed to get table HTML from storage:", error);

        const html = await createTopAndBottomFiveTableHTML(includeFavIcons, showDiscrepancies);

        await setTopAndBottomFiveTableHTML(
            html,
            includeFavIcons,
            showDiscrepancies
        );

        return html;
    }
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

    } catch (error) {
        console.error('Error during automatic refresh:', error);
        // Continue loading even if refresh fails
        loadUserPreferences();
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
    const TAG = "[findDiscrepanciesAndRender]";
    console.debug(`${TAG} Starting discrepancy check...`);

    // Fetch user preferences and selected domains concurrently
    const [userPreferences, { selectedDomains }] = await Promise.all([
        getParticipantCookiesPreferences(),
        fetchDomainsAndCookies()
    ]);

    console.debug(`${TAG} Fetched user preferences:`, userPreferences);
    console.debug(`${TAG} Selected domains:`, selectedDomains);

    // Exit early if either selected domains or user preferences are empty
    if (!selectedDomains.length) {
        console.debug(`${TAG} No selected domains. Exiting discrepancy check.`);
        await setWebsitesWithDiscrepancies([]);
        hideLoadingMessage();
        return;
    }

    if (!userPreferences.length) {
        console.debug(`${TAG} No user preferences. Exiting discrepancy check.`);
        await setWebsitesWithDiscrepancies([]);
        hideLoadingMessage();
        return;
    }

    // Find discrepancies
    const discrepancies = findDiscrepancyWebsites(selectedDomains, userPreferences);
    await setWebsitesWithDiscrepancies(discrepancies);
    console.debug(`${TAG} Discrepancies found:`, discrepancies);

    // Render discrepancies if on the dedicated page
    const discrepanciesPage = document.getElementById("WebsitesWithDiscrepancies");
    if (discrepanciesPage) {
        console.debug(`${TAG} Rendering discrepancies page...`);
        await displayWebsitesWithDiscrepanciesOnly(selectedDomains, "WebsitesWithDiscrepancies");
    }

    hideLoadingMessage();
    console.debug(`${TAG} Discrepancy check completed.`);
}

/**
 * Utility to hide the loading element
 */
function hideLoadingMessage() {
    const loadingElement = document.getElementById("loading");
    if (loadingElement) loadingElement.style.display = "none";
}

function findDiscrepancyWebsites(cookieData, userPreferences) {
    const TAG = '[DISCREPANCY]';
    const discrepancies = [];

    if (!userPreferences || userPreferences.length === 0) {
        console.warn(`${TAG} No user preferences found.`);
        return discrepancies;
    }

    console.debug(`${TAG} Starting discrepancy detection. Cookies to check: ${cookieData.length}, User prefs: ${userPreferences.length}`);

    // Only cookies with actionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(c => c.actionTaken?.toLowerCase() === 'yes');
    console.debug(`${TAG} Cookies with action taken: ${actionTakenCookies.length}`);

    // Assuming userPreferences is an array of objects like { domain, functional, performance, advertising }
    const userPrefMap = new Map(userPreferences.map(p => [p.domain, p]));

    for (const cookie of actionTakenCookies) {
        if (!cookie.domain) {
            console.debug(`${TAG} Skipping cookie without domain`);
            continue;
        }

        const formattedDomain = extractMainDomainName(cookie.domain);
        const originalDomain = cookie.domain;

        // Extract actual preferences
        let actualPreferences = { functional: false, performance: false, advertising: false };

        if (cookie.categories && typeof cookie.categories === 'object') {
            actualPreferences = {
                functional: cookie.categories.functional === true,
                performance: cookie.categories.performance === true,
                advertising: cookie.categories.advertising === true
            };
        } else {
            actualPreferences.functional = cookie.functional === "Yes" || cookie.functional === true;
            actualPreferences.performance = cookie.performance === "Yes" || cookie.performance === true;
            actualPreferences.advertising = cookie.advertising === "Yes" || cookie.advertising === true;
        }

        // Match domain in userPreferences
        const possibleFormats = [
            originalDomain,
            originalDomain.startsWith('.') ? originalDomain.slice(1) : null,
            !originalDomain.startsWith('.') ? '.' + originalDomain : null,
            formattedDomain,
            formattedDomain.startsWith('www.') ? formattedDomain.slice(4) : null,
            !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null
        ].filter(Boolean);

        let statedPreferences = null;
        let matchedDomain = null;

        for (const fmt of possibleFormats) {
            if (userPrefMap.has(fmt)) {
                const prefs = userPrefMap.get(fmt);
                if (prefs && (prefs.functional !== null || prefs.performance !== null || prefs.advertising !== null)) {
                    statedPreferences = prefs;
                    matchedDomain = fmt;
                    break;
                }
            }
        }

        if (!statedPreferences) {
            console.debug(`${TAG} No stated preferences found for domain: ${cookie.domain}`);
            continue;
        }

        // Compare preferences
        const categories = { functional: false, performance: false, advertising: false };
        const isDiscrepancyByScale = (userValue, actualAccepted) => {
            if (typeof userValue !== 'number') return false;
            if (actualAccepted && userValue <= 2) return true;
            if (!actualAccepted && userValue >= 4) return true;
            return false;
        };

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

        if (hasDifference) {
            discrepancies.push({
                domain: formattedDomain,
                originalDomain,
                favicon: `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`,
                statedPreferences,
                actualPreferences,
                cookie,
                matchedDomain,
                categories
            });
            console.debug(`${TAG} Discrepancy found for ${formattedDomain}`, { categories, statedPreferences, actualPreferences });
        }
    }

    console.debug(`${TAG} Total discrepancies found: ${discrepancies.length}`);
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
    // Normalize visit counts and filter action taken
    const normalizedCookies = cookieData.map(cookie => ({
        ...cookie,
        totalVisits: parseInt(cookie.totalVisitCount) || 0,
        actionTakenYes: cookie.actionTaken?.toLowerCase() === 'yes'
    }));

    // Prefer cookies with action taken if >= 6, else use all
    const filteredCookies =
        normalizedCookies.filter(c => c.actionTakenYes).length >= 6
            ? normalizedCookies.filter(c => c.actionTakenYes)
            : normalizedCookies;

    // Track seen main domains to ensure uniqueness
    const seenMainDomains = new Set();

    const mostFrequentDomains = [];
    const leastFrequentDomains = [];

    // Sort once by descending visits for most frequent
    const sortedByVisitsDesc = [...filteredCookies].sort((a, b) => b.totalVisits - a.totalVisits);

    for (const cookie of sortedByVisitsDesc) {
        if (mostFrequentDomains.length >= 5) break;

        const mainName = extractMainDomainName(extractMainDomainName(cookie.domain));
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            mostFrequentDomains.push(cookie);
        }
    }

    // For least frequent, filter those with >0 visits and sort ascending
    const sortedByVisitsAsc = filteredCookies
        .filter(c => c.totalVisits > 0)
        .sort((a, b) => a.totalVisits - b.totalVisits);

    for (const cookie of sortedByVisitsAsc) {
        if (leastFrequentDomains.length >= 5) break;

        const mainName = extractMainDomainName(extractMainDomainName(cookie.domain));
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            leastFrequentDomains.push(cookie);
        }
    }

    console.log('Selected', mostFrequentDomains.length, 'unique most frequent domains');
    console.log('Selected', leastFrequentDomains.length, 'unique least frequent domains');

    return {
        mostRecentDomains: mostFrequentDomains,
        leastRecentDomains: leastFrequentDomains
    };
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

        const formattedDomain = extractMainDomainName(domain.domain);

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

function startTableTutorial(shadow) {
    // Create overlay, box, and controls if they don't exist
    if (!document.getElementById('table-tutorial-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'table-tutorial-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.6);z-index:9999;display:none;';
        document.body.appendChild(overlay);

        const box = document.createElement('div');
        box.id = 'table-tutorial-box';
        box.style.cssText = 'position:absolute;background:white;padding:20px;border-radius:8px;max-width:400px;z-index:10000;display:none;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        document.body.appendChild(box);
    }

    // First step highlights the whole table
    const tutorialSteps = [
        { type: 'table', content: "This table shows the cookie consent choices you have made for websites you’ve visited. These choices are stored in your browser." },
        { columnIndex: 0, content: "Here you see the websites you've visited." },
        { columnIndex: 1, content: "Here you see whether the website is currently allowed to use Extra Functionality Cookies." },
        { columnIndex: 2, content: "Here you see whether the website is currently allowed to use Performance Cookies." },
        { columnIndex: 3, content: "Here you see whether the website is currently allowed to use Personalized Advertising Cookies." },
        { columnIndex: 4, content: "Here you see how long your choices for this website will be saved in your browser. Until then, the website will use cookies based on the current cookie consent settings stored in your browser." },
        { type: 'table', content: "Please take a moment to review your past cookie choices before continuing." },
    ];

    let currentStep = 0;

    function highlightStep(shadow, step) {
        // Remove previous highlights and reset cell styles
        document.querySelectorAll('.tutorial-column-highlight').forEach(el => el.remove());
        shadow.querySelectorAll('tr').forEach(row => {
            Array.from(row.children).forEach(cell => {
                cell.style.position = '';
                cell.style.zIndex = '';
            });
        });

        let top, left, right, bottom;

        if (step.type === 'table') {
            const table = shadow.querySelector('table');
            if (!table) return;
            const rect = table.getBoundingClientRect();
            top = rect.top;
            left = rect.left;
            right = rect.right;
            bottom = rect.bottom;
        } else if ('columnIndex' in step) {
            const rows = shadow.querySelectorAll('tr');
            if (!rows.length) return;

            left = Infinity; right = -Infinity; top = Infinity; bottom = -Infinity;

            rows.forEach(row => {
                const cell = row.children[step.columnIndex];
                if (!cell) return;
                const rect = cell.getBoundingClientRect();
                left = Math.min(left, rect.left);
                right = Math.max(right, rect.right);
                top = Math.min(top, rect.top);
                bottom = Math.max(bottom, rect.bottom);

                // Bring the column visually on top
                cell.style.position = 'relative';
                cell.style.zIndex = '10001';
            });
        } else return;

        const overlay = document.createElement('div');
        overlay.className = 'tutorial-column-highlight';
        overlay.style.position = 'absolute';
        overlay.style.top = `${top + window.scrollY}px`;
        overlay.style.left = `${left + window.scrollX}px`;
        overlay.style.width = `${right - left}px`;
        overlay.style.height = `${bottom - top}px`;
        overlay.style.backgroundColor = 'rgba(255, 152, 0, 0.2)';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '9999';
        document.body.appendChild(overlay);
    }

    function showStep(index) {
        const step = tutorialSteps[index];
        highlightStep(shadow, step);

        const box = document.getElementById('table-tutorial-box');
        const overlay = document.getElementById('table-tutorial-overlay');
        overlay.style.display = 'block';
        box.style.display = 'block';

        let targetRect;
        if (step.type === 'table') {
            const table = shadow.querySelector('table');
            if (!table) return;
            targetRect = table.getBoundingClientRect();
            box.style.top = `${targetRect.top + window.scrollY + targetRect.height / 2 - box.offsetHeight / 2}px`;
            box.style.left = `${targetRect.left + window.scrollX + targetRect.width / 2 - box.offsetWidth / 2}px`;
        } else if ('columnIndex' in step) {
            targetRect = shadow.querySelector(`tr th:nth-child(${step.columnIndex + 1})`)?.getBoundingClientRect();
            if (!targetRect) return;
            const margin = 10;
            box.style.top = `${targetRect.bottom + margin + window.scrollY}px`;
            let left = targetRect.right + margin + window.scrollX;
            if (left + box.offsetWidth > window.innerWidth) {
                left = targetRect.left - box.offsetWidth - margin + window.scrollX;
                if (left < 0) left = margin + window.scrollX;
            }
            box.style.left = `${left}px`;
        }

        // Render content and buttons
        box.innerHTML = `
        <div>${step.content}</div>
        <div style="margin-top:10px;text-align:right;">
            ${index > 0 ? '<button id="tutorial-prev">Prev</button>' : ''}
            ${index < tutorialSteps.length - 1 ? '<button id="tutorial-next">Next</button>' : ''}
            ${index == tutorialSteps.length - 1 ? '<button id="tutorial-close">Close</button>' : ''}
        </div>`;

        // Apply styling to buttons
        box.querySelectorAll('button').forEach(btn => {
            btn.style.backgroundColor = '#1976d2';   // blue
            btn.style.color = '#fff';                // white text
            btn.style.border = 'none';
            btn.style.padding = '6px 12px';
            btn.style.marginLeft = '6px';
            btn.style.borderRadius = '4px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '14px';
            btn.onmouseover = () => btn.style.backgroundColor = '#1565c0';
            btn.onmouseout = () => btn.style.backgroundColor = '#1976d2';
        });

        // Attach button handlers **after innerHTML**
        const nextBtn = document.getElementById('tutorial-next');
        const prevBtn = document.getElementById('tutorial-prev');
        const closeBtn = document.getElementById('tutorial-close');

        if (nextBtn) nextBtn.onclick = () => { currentStep++; showStep(currentStep); };
        if (prevBtn) prevBtn.onclick = () => { currentStep--; showStep(currentStep); };
        if (closeBtn) closeBtn.onclick = () => {
            document.querySelectorAll('.tutorial-column-highlight').forEach(el => el.remove());
            overlay.style.display = 'none';
            box.style.display = 'none';
        };
    }

    // Start tutorial
    showStep(currentStep);
}