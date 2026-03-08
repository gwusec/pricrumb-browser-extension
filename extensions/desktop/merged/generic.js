// Returns an array of <tr> elements for given domains, without appending
// General website rows (top/bottom 5, no discrepancy highlighting)
export async function generateGeneralWebsiteRows(domains, getFaviconFunc, getSelectionStatusFunc) {
    const rowPromises = domains.map(async (domain) => {
        const row = document.createElement('tr');

        // Website cell
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';
        const formattedDomain = formatDomainForDisplay(domain.domain);

        const favicon = document.createElement('img');
        favicon.alt = '';
        favicon.style.marginRight = '8px';
        favicon.style.verticalAlign = 'middle';
        favicon.style.height = '32px';
        favicon.onerror = () => { favicon.style.display = 'none'; };
        favicon.src = await getFaviconFunc(formattedDomain);

        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'inline-flex';
        domainContainer.style.alignItems = 'center';
        domainContainer.style.justifyContent = 'center';
        domainContainer.style.margin = '0 auto';
        domainContainer.appendChild(favicon);
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        row.appendChild(domainCell);

        // Categories (no discrepancy highlighting)
        const categories = ['functional', 'performance', 'advertising'];
        for (const category of categories) {
            const cell = document.createElement('td');
            const selectionStatus = getSelectionStatusFunc(domain, category, null, false, false);
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        }

        // Expiration
        const expirationCell = document.createElement('td');
        expirationCell.textContent = (domain.expiration && domain.expiration !== "Session cookie")
            ? calculateDaysRemaining(domain.expiration)
            : "Session cookie";
        row.appendChild(expirationCell);

        return row;
    });

    return Promise.all(rowPromises);
}

// Discrepancy-specific rows (only used on discrepancies page)
export async function generateDiscrepancyWebsiteRows(domains, getFaviconFunc, getDiscrepancyInfoFunc, getSelectionStatusFunc) {
    const rowPromises = domains.map(async (domain) => {
        const row = document.createElement('tr');

        // Website cell
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';
        const formattedDomain = formatDomainForDisplay(domain.domain);

        const favicon = document.createElement('img');
        favicon.alt = '';
        favicon.style.marginRight = '8px';
        favicon.style.verticalAlign = 'middle';
        favicon.style.height = '32px';
        favicon.onerror = () => { favicon.style.display = 'none'; };
        favicon.src = await getFaviconFunc(formattedDomain);

        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'inline-flex';
        domainContainer.style.alignItems = 'center';
        domainContainer.style.justifyContent = 'center';
        domainContainer.style.margin = '0 auto';
        domainContainer.appendChild(favicon);
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        row.appendChild(domainCell);

        // Get discrepancy info
        const discrepancyInfo = await getDiscrepancyInfoFunc(domain.domain);
        const categories = ['functional', 'performance', 'advertising'];

        for (const category of categories) {
            const cell = document.createElement('td');
            const selectionStatus = getSelectionStatusFunc(
                domain,
                category,
                discrepancyInfo?.statedPreferences ?? null,
                discrepancyInfo?.categories?.[category] ?? false,
                true // show discrepancies
            );
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        }

        // Expiration
        const expirationCell = document.createElement('td');
        expirationCell.textContent = (domain.expiration && domain.expiration !== "Session cookie")
            ? calculateDaysRemaining(domain.expiration)
            : "Session cookie";
        row.appendChild(expirationCell);

        return row;
    });

    return Promise.all(rowPromises);
}

export function formatDomainForDisplay(domain) {
    if (!domain) return "Unknown";
    if (domain.startsWith('.')) domain = domain.substring(1);
    return domain.replace(/^www\./, '');
}

export function calculateDaysRemaining(expirationDate) {
    if (!expirationDate || expirationDate === "Session cookie") return "Session cookie";
    const expDate = new Date(expirationDate);
    const diffMs = expDate - new Date();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "Expired";
    if (diffDays === 0) return "Expires today";
    if (diffDays === 1) return "1 day";
    return `${diffDays} more days`;
}

export function sendExtensionMessage(payload) {

    // Extension page context
    if (typeof ext !== "undefined" && ext.runtime?.sendMessage) {
        return new Promise(resolve => {
            ext.runtime.sendMessage(payload, resolve);
        });
    }

    // Page / injected script context
    return new Promise(resolve => {

        const id = "msg_" + Math.random();

        function handler(event) {
            if (event.source !== window) return;
            if (event.data?.type !== "EXTENSION_MESSAGE_RESPONSE") return;
            if (event.data?.id !== id) return;

            window.removeEventListener("message", handler);
            resolve(event.data.response);
        }

        window.addEventListener("message", handler);

        window.postMessage({
            type: "EXTENSION_MESSAGE",
            id,
            payload
        }, "*");
    });
}

export function addExtensionMessageListener(listener) {

    // Extension / content script context
    if (typeof ext !== "undefined" && ext.runtime?.onMessage) {

        ext.runtime.onMessage.addListener(listener);

        return () => {
            ext.runtime.onMessage.removeListener(listener);
        };
    }

    // Page context
    const handler = (event) => {

        if (event.source !== window) return;
        if (event.data?.type !== "EXTENSION_MESSAGE_RESPONSE") return;

        listener(event.data.response);
    };

    window.addEventListener("message", handler);

    return () => {
        window.removeEventListener("message", handler);
    };
}

export async function getFavicon(domain) {
    const response = await sendExtensionMessage({
        type: "GET_FAVICON",
        domain
    });

    return response?.favicon || `https://${domain}/favicon.ico`;
}

export async function getDiscrepancyInfo(domain) {
    const formattedDomain = formatDomainForDisplay(domain);

    const domainVariations = [
        domain,
        formattedDomain,
        domain.startsWith('.') ? domain.substring(1) : domain,
        formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : formattedDomain,
        domain.startsWith('.') ? domain.substring(1) : '.' + domain
    ];

    // Await the stored discrepancies
    const discrepanciesList = await getWebsitesWithDiscrepancies();

    const discrepancy = discrepanciesList.find(d => {
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

    return discrepancy;
}

// Setter: save discrepancies to storage
export async function setWebsitesWithDiscrepancies(discrepancies) {
    if (!Array.isArray(discrepancies)) discrepancies = [];
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "websitesWithDiscrepancies",
        value: discrepancies
    });
}

// Getter: retrieve discrepancies from storage
export async function getWebsitesWithDiscrepancies() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "websitesWithDiscrepancies"
    });
    return Array.isArray(result?.websitesWithDiscrepancies) ? result.websitesWithDiscrepancies : [];
}

// Helper function to get a single button showing the selection status (Updated to work with the scale)
export function getSelectionStatus(domain, category, userPref, hasDiscrepancy, showDiscrepancies = true) {
    console.log(`Creating selection status for ${domain.domain}, category ${category}, discrepancy: ${hasDiscrepancy}`);

    const container = document.createElement('div');
    container.className = 'selection-container';
    container.style.display = 'inline-flex';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'center';
    container.style.position = 'relative';
    container.style.margin = '0 auto';

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
    if (showDiscrepancies && userPref && typeof userPref[category] === 'number') {
        const userValue = userPref[category];
        const valueText = getWillingnessText(userValue, category);

        // If cookie is accepted but user selected 1-2 (not willing/not really willing)
        // OR if cookie is rejected but user selected 4-5 (somewhat willing/willing)
        const hasDiscrepancyByScale = (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);

        if (hasDiscrepancyByScale) {
            console.log(`Adding discrepancy marker for ${domain.domain}, category ${category}`);

            // Outer span acts as the tooltip trigger
            const discrepancyMarker = document.createElement('span');
            discrepancyMarker.textContent = '!';
            discrepancyMarker.className = 'discrepancy-marker';
            discrepancyMarker.style.position = 'absolute';
            discrepancyMarker.style.left = 'calc(100% + 8px)';
            discrepancyMarker.style.top = '50%';
            discrepancyMarker.style.transform = 'translateY(-50%)';
            discrepancyMarker.style.display = 'inline-flex';
            discrepancyMarker.style.alignItems = 'center';
            discrepancyMarker.style.justifyContent = 'center';
            discrepancyMarker.style.zIndex = '2';

            // Inner span is the tooltip bubble
            const tooltipText = document.createElement('span');
            tooltipText.className = 'discrepancy-tooltiptext';
            // tooltipText.textContent = `Your preference: "${valueText}" — Actual: ${isAccepted ? 'Allowed' : 'Not Allowed'}`;
            tooltipText.innerHTML = `Your preference: "<strong>${valueText}</strong>"<br>Actual setting: <strong>${isAccepted ? 'Allowed' : 'Not Allowed'}</strong>`;
            tooltipText.style.position = 'absolute';
            tooltipText.style.bottom = 'calc(100% + 8px)';
            tooltipText.style.left = '50%';
            tooltipText.style.transform = 'translateX(-50%)';
            tooltipText.style.minWidth = '240px';
            tooltipText.style.maxWidth = '300px';
            tooltipText.style.padding = '8px 10px';
            tooltipText.style.borderRadius = '6px';
            tooltipText.style.backgroundColor = '#333';
            tooltipText.style.color = '#fff';
            tooltipText.style.fontSize = '12px';
            tooltipText.style.lineHeight = '1.35';
            tooltipText.style.textAlign = 'center';
            tooltipText.style.whiteSpace = 'normal';
            tooltipText.style.visibility = 'hidden';
            tooltipText.style.opacity = '0';
            tooltipText.style.transition = 'opacity 0.15s ease';
            tooltipText.style.pointerEvents = 'none';
            tooltipText.style.zIndex = '9999';

            discrepancyMarker.addEventListener('mouseenter', () => {
                tooltipText.style.visibility = 'visible';
                tooltipText.style.opacity = '1';
            });
            discrepancyMarker.addEventListener('mouseleave', () => {
                tooltipText.style.visibility = 'hidden';
                tooltipText.style.opacity = '0';
            });
            discrepancyMarker.addEventListener('focus', () => {
                tooltipText.style.visibility = 'visible';
                tooltipText.style.opacity = '1';
            });
            discrepancyMarker.addEventListener('blur', () => {
                tooltipText.style.visibility = 'hidden';
                tooltipText.style.opacity = '0';
            });

            discrepancyMarker.appendChild(tooltipText);
            container.appendChild(discrepancyMarker);
            container.style.overflow = 'visible';
            container.style.marginTop = '15px';
        }
    }

    return container;
}

// Helper function to get text for willingness level
function getWillingnessText(value, category) {
    const categoryLabel = {
        functional: 'functional',
        performance: 'performance',
        advertising: 'advertising'
    }[category];

    if (categoryLabel) {
        switch (value) {
            case 1: return `1 - I strongly prefer this website NOT use ${categoryLabel} cookies`;
            case 2: return `2 - I prefer this website NOT use ${categoryLabel} cookies`;
            case 3: return "3 - No preference";
            case 4: return `4 - I prefer this website TO use ${categoryLabel} cookies`;
            case 5: return `5 - I strongly prefer this website TO use ${categoryLabel} cookies`;
            default: return "Unknown";
        }
    }

    // Fallback wording for unexpected categories.
    switch (value) {
        case 1: return "Not willing";
        case 2: return "Not really willing";
        case 3: return "Undecided";
        case 4: return "Somewhat willing";
        case 5: return "Willing";
        default: return "Unknown";
    }
}

/**
 * Get user preferences from storage
 * @returns {Promise<Map<string, Object>>}
 */
export async function getUserPreferences() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "userCookiePreferences"
    });

    const prefs = new Map();

    if (result?.userCookiePreferences) {
        if (Array.isArray(result.userCookiePreferences)) {
            result.userCookiePreferences.forEach(([domain, preference]) => {
                prefs.set(domain, preference);
            });
        } else if (typeof result.userCookiePreferences === "object") {
            Object.entries(result.userCookiePreferences).forEach(([domain, preference]) => {
                prefs.set(domain, preference);
            });
        }
    }

    return prefs;
}

/**
 * Save user preferences to storage
 * @param {Map<string, Object>} preferencesMap 
 */
export async function setUserPreferences(preferencesMap) {
    const arrayToStore = Array.from(preferencesMap.entries());
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "userCookiePreferences",
        value: arrayToStore
    });
}
