/**
 * Generates <tr> elements for domains with discrepancy highlighting.
 *
 * Each row contains:
 *  - Website cell (with optional favicon)
 *  - Three cookie category cells (functional, performance, advertising)
 *  - Expiration cell
 *
 * If getDiscrepancyInfoFunc is null, the discrepancy-specific highlighting is skipped.
 *
 * @param {Array} domains - Array of domain objects to generate rows for
 * @param {Function|null} getFaviconFunc - Function to get a favicon URL for a domain
 * @param {Function|null} getDiscrepancyInfoFunc - Function to get discrepancy info for a domain
 * @param {Function} getSelectionStatusFunc - Function that returns the selection status element for a category
 * @returns {Promise<Array<HTMLTableRowElement>>} Array of <tr> elements
 */
export async function generateWebsiteRows(domains, getFaviconFunc, getDiscrepancyInfoFunc, getSelectionStatusFunc) {

    const rowPromises = domains.map(async (domain) => {
        const row = document.createElement('tr');

        // -----------------------
        // Website Cell
        // -----------------------
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell domain-name'; // added CSS class
        const formattedDomain = formatDomainForDisplay(domain.domain);

        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'inline-flex';
        domainContainer.style.alignItems = 'center';

        // Create favicon image
        const favicon = document.createElement('img');
        favicon.alt = '?'; // placeholder alt
        favicon.src = 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <rect width="32" height="32" fill="#ccc"/>
            <text x="16" y="22" font-size="18" text-anchor="middle" fill="#000" font-family="sans-serif">?</text>
        </svg>
        `); // simple gray box with question mark
        favicon.style.width = '32px';
        favicon.style.height = '32px';
        favicon.style.marginRight = '8px';
        favicon.style.borderRadius = '4px';
        favicon.style.objectFit = 'cover';

        domainContainer.appendChild(favicon);

        // If a favicon function is provided, try to update the src
        if (getFaviconFunc) {
            try {
                const realFavicon = await getFaviconFunc(formattedDomain);
                if (realFavicon) favicon.src = realFavicon;
            } catch (e) {
                console.warn("Failed to load favicon for", formattedDomain, e);
            }
        }

        // Add domain text
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        row.appendChild(domainCell);

        // -----------------------
        // Category Cells
        // -----------------------
        const categories = ['functional', 'performance', 'advertising'];

        // Only fetch discrepancy info if the function is provided
        let discrepancyInfo = null;
        if (getDiscrepancyInfoFunc) {
            discrepancyInfo = await getDiscrepancyInfoFunc(domain.domain);
            console.log("Discrepancy Info");
            console.log(discrepancyInfo);
        }

        for (const category of categories) {
            const cell = document.createElement('td');

            const selectionStatus = getSelectionStatusFunc(
                domain,
                category,
                discrepancyInfo?.statedPreferences ?? null,
                discrepancyInfo?.categories?.[category] ?? false,
                Boolean(getDiscrepancyInfoFunc) // only show discrepancies if function exists
            );
            console.log(selectionStatus.innerHTML);

            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        }

        // -----------------------
        // Expiration Cell
        // -----------------------
        const expirationCell = document.createElement('td');
        expirationCell.textContent = (domain.expiration && domain.expiration !== "Session cookie")
            ? calculateDaysRemaining(domain.expiration)
            : "Session cookie";
        row.appendChild(expirationCell);

        return row;
    });

    // Wait for all async rows to complete
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
    console.log(domain);
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

export function getSelectionStatus(domain, category, userPref, hasDiscrepancy, showDiscrepancies = true) {
    const container = createContainer();

    const isAccepted = resolveCategoryAcceptance(domain, category);

    const button = createStatusButton(isAccepted);
    container.appendChild(button);

    if (shouldShowDiscrepancy(isAccepted, category, userPref, showDiscrepancies)) {
        const marker = createDiscrepancyMarker(isAccepted, userPref[category], category);
        container.appendChild(marker);

        container.style.overflow = 'visible';
        container.style.marginTop = '15px';
    }

    return container;
}

function createContainer() {
    const container = document.createElement('div');
    container.className = 'selection-container';

    Object.assign(container.style, {
        display: 'inline-flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        margin: '0 auto'
    });

    return container;
}

function resolveCategoryAcceptance(domain, category) {
    const cap = category.charAt(0).toUpperCase() + category.slice(1);

    const value =
        domain?.categories?.[category] ??
        domain?.[category] ??
        domain?.[cap];

    if (typeof value === 'string') {
        return ["Yes", "Accepted", "Accept"].includes(value);
    }

    return value === true;
}

function createStatusButton(isAccepted) {
    const button = document.createElement('button');

    if (isAccepted) {
        button.textContent = 'Allowed';
        button.className = 'toggle-btn accept selected';
        button.style.backgroundColor = '#4c7aaf';
        button.style.borderColor = '#4c7aaf';
    } else {
        button.textContent = 'Not Allowed';
        button.className = 'toggle-btn reject selected';
        button.style.backgroundColor = '#919291';
        button.style.borderColor = '#919291';
    }

    button.style.color = 'white';

    return button;
}

function shouldShowDiscrepancy(isAccepted, category, userPref, showDiscrepancies) {
    if (!showDiscrepancies) return false;
    if (!userPref || typeof userPref[category] !== 'number') return false;

    const userValue = userPref[category];

    return (isAccepted && userValue <= 2) ||
        (!isAccepted && userValue >= 4);
}

function createDiscrepancyMarker(isAccepted, userValue, category) {
    const marker = document.createElement('span');
    marker.textContent = '!';
    marker.className = 'discrepancy-marker';

    Object.assign(marker.style, {
        position: 'absolute',
        left: 'calc(100% + 8px)',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '2'
    });

    const tooltip = createTooltip(isAccepted, userValue, category);
    marker.appendChild(tooltip);

    marker.addEventListener('mouseenter', () => showTooltip(tooltip));
    marker.addEventListener('mouseleave', () => hideTooltip(tooltip));
    marker.addEventListener('focus', () => showTooltip(tooltip));
    marker.addEventListener('blur', () => hideTooltip(tooltip));

    return marker;
}


function createTooltip(isAccepted, userValue, category) {
    const tooltip = document.createElement('span');
    tooltip.className = 'discrepancy-tooltiptext';

    const valueText = getWillingnessText(userValue, category);

    tooltip.innerHTML =
        `Your preference: "<strong>${valueText}</strong>"<br>
         Actual setting: <strong>${isAccepted ? 'Allowed' : 'Not Allowed'}</strong>`;

    Object.assign(tooltip.style, {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: '240px',
        maxWidth: '300px',
        padding: '8px 10px',
        borderRadius: '6px',
        backgroundColor: '#333',
        color: '#fff',
        fontSize: '12px',
        lineHeight: '1.35',
        textAlign: 'center',
        whiteSpace: 'normal',
        visibility: 'hidden',
        opacity: '0',
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none',
        zIndex: '9999'
    });

    return tooltip;
}

function showTooltip(tooltip) {
    tooltip.style.visibility = 'visible';
    tooltip.style.opacity = '1';
}

function hideTooltip(tooltip) {
    tooltip.style.visibility = 'hidden';
    tooltip.style.opacity = '0';
}

// // Helper function to get a single button showing the selection status (Updated to work with the scale)
// export function getSelectionStatus(domain, category, userPref, hasDiscrepancy, showDiscrepancies = true) {
//     console.log(`Creating selection status for ${domain.domain}, category ${category}, discrepancy: ${hasDiscrepancy}`);

//     const container = document.createElement('div');
//     container.className = 'selection-container';
//     container.style.display = 'inline-flex';
//     container.style.justifyContent = 'center';
//     container.style.alignItems = 'center';
//     container.style.position = 'relative';
//     container.style.margin = '0 auto';

//     // Determine if accepted or rejected in cookie history
//     let isAccepted = false;

//     if (domain.categories && domain.categories[category] !== undefined) {
//         isAccepted = domain.categories[category];
//     } else if (domain[category] !== undefined) {
//         // Handle string or boolean values
//         if (typeof domain[category] === 'string') {
//             isAccepted = domain[category] === "Yes" ||
//                 domain[category] === "Accepted" ||
//                 domain[category] === "Accept";
//         } else {
//             isAccepted = domain[category] === true;
//         }
//     } else if (domain[category.charAt(0).toUpperCase() + category.slice(1)] !== undefined) {
//         // Try with capitalized first letter (Functional instead of functional)
//         const value = domain[category.charAt(0).toUpperCase() + category.slice(1)];
//         if (typeof value === 'string') {
//             isAccepted = value === "Yes" ||
//                 value === "Accepted" ||
//                 value === "Accept";
//         } else {
//             isAccepted = value === true;
//         }
//     }

//     // Create the display button
//     const button = document.createElement('button');

//     if (isAccepted) {
//         button.textContent = 'Allowed';
//         button.className = 'toggle-btn accept selected';
//         button.style.backgroundColor = '#4c7aaf';
//         button.style.color = 'white';
//         button.style.borderColor = '#4c7aaf';
//     } else {
//         button.textContent = 'Not Allowed';
//         button.className = 'toggle-btn reject selected';
//         button.style.backgroundColor = '#919291';
//         button.style.color = 'white';
//         button.style.borderColor = '#919291';
//     }

//     // Add to container
//     container.appendChild(button);

//     // Check for discrepancy according to the 5-point scale logic
//     if (showDiscrepancies && userPref && typeof userPref[category] === 'number') {
//         const userValue = userPref[category];
//         const valueText = getWillingnessText(userValue, category);

//         // If cookie is accepted but user selected 1-2 (not willing/not really willing)
//         // OR if cookie is rejected but user selected 4-5 (somewhat willing/willing)
//         const hasDiscrepancyByScale = (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);

//         if (hasDiscrepancyByScale) {
//             console.log(`Adding discrepancy marker for ${domain.domain}, category ${category}`);

//             // Outer span acts as the tooltip trigger
//             const discrepancyMarker = document.createElement('span');
//             discrepancyMarker.textContent = '!';
//             discrepancyMarker.className = 'discrepancy-marker';
//             discrepancyMarker.style.position = 'absolute';
//             discrepancyMarker.style.left = 'calc(100% + 8px)';
//             discrepancyMarker.style.top = '50%';
//             discrepancyMarker.style.transform = 'translateY(-50%)';
//             discrepancyMarker.style.display = 'inline-flex';
//             discrepancyMarker.style.alignItems = 'center';
//             discrepancyMarker.style.justifyContent = 'center';
//             discrepancyMarker.style.zIndex = '2';

//             // Inner span is the tooltip bubble
//             const tooltipText = document.createElement('span');
//             tooltipText.className = 'discrepancy-tooltiptext';
//             // tooltipText.textContent = `Your preference: "${valueText}" — Actual: ${isAccepted ? 'Allowed' : 'Not Allowed'}`;
//             tooltipText.innerHTML = `Your preference: "<strong>${valueText}</strong>"<br>Actual setting: <strong>${isAccepted ? 'Allowed' : 'Not Allowed'}</strong>`;
//             tooltipText.style.position = 'absolute';
//             tooltipText.style.bottom = 'calc(100% + 8px)';
//             tooltipText.style.left = '50%';
//             tooltipText.style.transform = 'translateX(-50%)';
//             tooltipText.style.minWidth = '240px';
//             tooltipText.style.maxWidth = '300px';
//             tooltipText.style.padding = '8px 10px';
//             tooltipText.style.borderRadius = '6px';
//             tooltipText.style.backgroundColor = '#333';
//             tooltipText.style.color = '#fff';
//             tooltipText.style.fontSize = '12px';
//             tooltipText.style.lineHeight = '1.35';
//             tooltipText.style.textAlign = 'center';
//             tooltipText.style.whiteSpace = 'normal';
//             tooltipText.style.visibility = 'hidden';
//             tooltipText.style.opacity = '0';
//             tooltipText.style.transition = 'opacity 0.15s ease';
//             tooltipText.style.pointerEvents = 'none';
//             tooltipText.style.zIndex = '9999';

//             discrepancyMarker.addEventListener('mouseenter', () => {
//                 tooltipText.style.visibility = 'visible';
//                 tooltipText.style.opacity = '1';
//             });
//             discrepancyMarker.addEventListener('mouseleave', () => {
//                 tooltipText.style.visibility = 'hidden';
//                 tooltipText.style.opacity = '0';
//             });
//             discrepancyMarker.addEventListener('focus', () => {
//                 tooltipText.style.visibility = 'visible';
//                 tooltipText.style.opacity = '1';
//             });
//             discrepancyMarker.addEventListener('blur', () => {
//                 tooltipText.style.visibility = 'hidden';
//                 tooltipText.style.opacity = '0';
//             });

//             discrepancyMarker.appendChild(tooltipText);
//             container.appendChild(discrepancyMarker);
//             container.style.overflow = 'visible';
//             container.style.marginTop = '15px';
//         }
//     }

//     return container;
// }

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
export async function getParticipantCookiesPreferences() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "participantCookiesPreferences"
    });

    const prefs = new Map();

    if (result?.participantCookiesPreferences) {
        if (Array.isArray(result.participantCookiesPreferences)) {
            result.participantCookiesPreferences.forEach(([domain, preference]) => {
                prefs.set(domain, preference);
            });
        } else if (typeof result.participantCookiesPreferences === "object") {
            Object.entries(result.participantCookiesPreferences).forEach(([domain, preference]) => {
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
        key: "participantCookiesPreferences",
        value: arrayToStore
    });
}
