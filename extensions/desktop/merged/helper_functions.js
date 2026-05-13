export const STORAGE_KEYS = {
    PREFS: "participantCookiesPreferences",
    COOKIE_DATA: "cookieData",
    DOMAIN_HISTORY: "selectedDomainsForHistory"
};

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
export async function generateWebsiteRows(domains, getFaviconFunc, getDiscrepancyInfoFunc, getSelectionStatusFunc, showExpirationDate = false) {

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
                favicon.src = await getFaviconFunc(formattedDomain);
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

            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        }

        // -----------------------
        // Expiration Cell
        // -----------------------
        if(showExpirationDate){
            const expirationCell = document.createElement('td');
            expirationCell.textContent =  calculateDaysRemaining(domain.expiration);
            row.appendChild(expirationCell);
        }

        return row;
    });

    // Wait for all async rows to complete
    return Promise.all(rowPromises);
}

// Helper function to extract main domain name (e.g., "zoom" from "zoom.com" or "zoom.us")
export function extractMainDomainName(domain) {
    const second_level_domains = [
        "com", "net", "org", "edu", "gov", "mil", "us", "ca", "ny", "tx", "k12", "co", "org", "ac", "mod",
        "nhs", "de", "fr", "asso", "gouv", "nom", "or", "gv", "priv", "it", "nl", "be", "ch", "es", "se",
        "no", "fi", "id", "tv", "gen", "ind", "ernet", "mil", "tsk", "k12", "av", "dr", "bel", "pol", "kep",
        "bbs", "biz", "tel", "web", "name"
    ];

    if (!domain) return '';

    // Remove protocol, leading dots, www.
    let cleaned = domain.toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^\.+/, '')
        .replace(/^www\./, '')
        .split('/')[0]; // remove path if present

    const parts = cleaned.split('.');
    if (parts.length < 2) return cleaned; // localhost or single-label domains

    // Check if the last part or second-to-last part is in the suffix list
    let suffixIndex = parts.length - 1;
    if (second_level_domains.includes(parts[parts.length - 2])) {
        // second-to-last label matches suffix list
        suffixIndex = parts.length - 2;
    }

    // Main domain is the label immediately before the suffix
    const mainDomainIndex = suffixIndex - 1;
    return mainDomainIndex >= 0 ? parts[mainDomainIndex] : parts[0];
}

export function calculateDaysRemaining(expirationDate) {
    if (!expirationDate || expirationDate === "Session cookie") {
        return "These settings usually do not expire and will stay saved unless you clear your browser data.";
    }
    const expDate = new Date(expirationDate);

    if (Number.isNaN(expDate.getTime())) {
        return expirationDate;
    }

    const diffMs = expDate - new Date();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return "These settings have already expired.";
    if (diffDays === 0) return "Expires today";
    if (diffDays === 1) return "1 more day";
    return `${diffDays} more days`;
}

const PARTICIPANT_PREFERENCE_CATEGORIES = ["functional", "performance", "advertising"];

export function normalizeDomainForMatching(domain) {
    if (typeof domain !== "string") return "";

    let normalized = domain.trim().toLowerCase();
    if (!normalized) return "";

    normalized = normalized.replace(/^https?:\/\//, "");
    normalized = normalized.split("/")[0];
    normalized = normalized.replace(/^\.+/, "");
    normalized = normalized.replace(/\.+$/, "");
    if (normalized.startsWith("www.")) {
        normalized = normalized.slice(4);
    }

    return normalized;
}

export function getDomainVariantsForMatching(domain) {
    const normalized = normalizeDomainForMatching(domain);
    if (!normalized) return [];

    return Array.from(new Set([
        normalized,
        `.${normalized}`,
        `www.${normalized}`,
        `.www.${normalized}`
    ]));
}

export function domainsMatchForLookup(left, right) {
    const normalizedLeft = normalizeDomainForMatching(left);
    const normalizedRight = normalizeDomainForMatching(right);
    return normalizedLeft !== "" && normalizedLeft === normalizedRight;
}

export function findRecordByDomain(domain, records, candidateFields = ["domain", "originalDomain"]) {
    if (!Array.isArray(records)) return null;

    return records.find((record) =>
        candidateFields.some((field) => domainsMatchForLookup(domain, record?.[field]))
    ) || null;
}

function normalizeParticipantPreferenceValue(value) {
    if (value === null || value === undefined || value === "") return null;

    const numericValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeParticipantPreferenceEntry(entry) {
    let domain = "";
    let preferences = null;

    if (Array.isArray(entry)) {
        domain = entry[0];
        preferences = entry[1];
    } else if (entry && typeof entry === "object") {
        domain = entry.domain;
        preferences = entry;
    } else {
        return null;
    }

    const canonicalDomain = normalizeDomainForMatching(domain);
    if (!canonicalDomain) return null;

    const normalized = { domain: canonicalDomain };

    PARTICIPANT_PREFERENCE_CATEGORIES.forEach((category) => {
        normalized[category] = normalizeParticipantPreferenceValue(preferences?.[category]);
    });

    return normalized;
}

function normalizeParticipantCookiesPreferences(preferences) {
    const normalizedByDomain = new Map();

    (Array.isArray(preferences) ? preferences : []).forEach((entry) => {
        const normalizedEntry = normalizeParticipantPreferenceEntry(entry);
        if (!normalizedEntry) return;

        const existingEntry = normalizedByDomain.get(normalizedEntry.domain) || {
            domain: normalizedEntry.domain,
            functional: null,
            performance: null,
            advertising: null
        };

        PARTICIPANT_PREFERENCE_CATEGORIES.forEach((category) => {
            if (normalizedEntry[category] !== null) {
                existingEntry[category] = normalizedEntry[category];
            }
        });

        normalizedByDomain.set(normalizedEntry.domain, existingEntry);
    });

    return Array.from(normalizedByDomain.values());
}

export function sendExtensionMessage(payload) {

    // Extension page context
    if (typeof ext !== "undefined" && ext.runtime?.sendMessage) {
        return ext.runtime.sendMessage(payload);
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
    // Await the stored discrepancies
    const discrepanciesList = await getWebsitesWithDiscrepancies();
    return findRecordByDomain(domain, discrepanciesList, [
        "domain",
        "originalDomain",
        "matchedDomain",
        "canonicalDomain"
    ]);
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

    if (shouldShowDiscrepancy(hasDiscrepancy, isAccepted, category, userPref, showDiscrepancies)) {
        const marker = createDiscrepancyMarker(isAccepted, userPref[category], category);
        container.appendChild(marker);
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

function shouldShowDiscrepancy(hasDiscrepancy, isAccepted, category, userPref, showDiscrepancies) {
    if (!showDiscrepancies) return false;
    if (!userPref || typeof userPref[category] !== 'number') return false;
    if (typeof hasDiscrepancy === 'boolean') return hasDiscrepancy;

    const userValue = userPref[category];

    return (isAccepted && userValue <= 2) ||
        (!isAccepted && userValue >= 4);
}

function createDiscrepancyMarker(isAccepted, userValue, category) {
    const marker = document.createElement('span');
    marker.textContent = '!';
    marker.className = 'discrepancy-marker';

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
        `You said that you "<strong>${valueText}</strong>"<br> 
        but it's currently set to <strong>${isAccepted ? 'Allowed' : 'Not Allowed'}</strong>`;

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

// Helper function to get text for willingness level
function getWillingnessText(value, category) {
    const categoryLabel = {
        functional: 'functional',
        performance: 'performance',
        advertising: 'advertising'
    }[category];

    if (categoryLabel) {
        switch (value) {
            case 1: return `strongly prefer this website NOT use ${categoryLabel} cookies`;
            case 2: return `prefer this website NOT use ${categoryLabel} cookies`;
            case 3: return "no preference";
            case 4: return `prefer this website to use ${categoryLabel} cookies`;
            case 5: return `strongly prefer this website to use ${categoryLabel} cookies`;
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

export async function getParticipantCookiesPreferences() {
    try {
        const result = await sendExtensionMessage({
            type: "STORAGE_GET",
            key: STORAGE_KEYS.PREFS
        });
        const storedPreferences = result?.[STORAGE_KEYS.PREFS] || [];
        const normalizedPreferences = normalizeParticipantCookiesPreferences(storedPreferences);

        if (JSON.stringify(storedPreferences) !== JSON.stringify(normalizedPreferences)) {
            await sendExtensionMessage({
                type: "STORAGE_SET",
                key: STORAGE_KEYS.PREFS,
                value: normalizedPreferences
            });
        }

        return normalizedPreferences;
    } catch (e) {
        console.error("Failed to get stored preferences", e);
        return [];
    }
}

/**
 * Save user preferences to storage
 * @param {Map<string, Object>} preferencesMap 
 */
export async function setUserPreferences(preferencesMap) {
    const arrayToStore = normalizeParticipantCookiesPreferences(Array.from(preferencesMap.entries()));
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "participantCookiesPreferences",
        value: arrayToStore
    });
}


// Format domain for better display
export function formatDomainForDisplay(domain) {
    if (!domain) return "Unknown";

    if (domain.startsWith(".")) {
        domain = domain.slice(1);
    }

    const main = extractMainDomainName(domain);
    if (!main) return domain;

    const parts = domain.split(".");
    const mainIndex = parts.indexOf(main);

    if (mainIndex === -1) return domain;

    // Everything after the main domain is the suffix (TLD or multi-part TLD)
    const suffix = parts.slice(mainIndex + 1).join(".");

    return suffix ? `${main}.${suffix}` : main;
}

// Store cookies and domains using extension storage
export async function storeCookiesAndDomainsInStorage(cookiesAndDomains) {
    try {
        await sendExtensionMessage({
            type: "STORAGE_SET",
            key: "cookiesAndDomains",
            value: JSON.stringify(cookiesAndDomains) // serialize before storing
        });
    } catch (error) {
        console.error("Failed to store cookiesAndDomains via extension message:", error);
    }
}

// Retrieve cookies and domains from extension storage
export async function getCookiesAndDomainsFromStorage() {
    try {
        const result = await sendExtensionMessage({
            type: "STORAGE_GET",
            key: "cookiesAndDomains"
        });

        if (!result || !result.cookiesAndDomains) {
            console.log("No cookiesAndDomains found in storage");
            return null;
        }

        return JSON.parse(result.cookiesAndDomains); // deserialize back to original structure
    } catch (error) {
        console.error("Failed to retrieve cookiesAndDomains via extension message:", error);
        return null;
    }
}

// Cookies
export async function getCookieData() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "cookieData"
    });
    return result?.cookieData || [];
}

export async function setCookieData(cookies) {
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "cookieData",
        value: cookies
    });
}

// Consent records
export async function getConsentRecords() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "consentDomainData"
    });
    return result?.consentDomainData || [];
}

export async function setConsentRecords(records) {
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "consentDomainData",
        value: records
    });
}

// Browsing history
export async function getBrowsingHistory() {
    const result = await sendExtensionMessage({
        type: "STORAGE_GET",
        key: "browsingHistoryData"
    });
    return result?.browsingHistoryData || [];
}

export async function setBrowsingHistory(historyData) {
    await sendExtensionMessage({
        type: "STORAGE_SET",
        key: "browsingHistoryData",
        value: historyData
    });
}

export function buildDomain(rawDomain) {
    const parts = rawDomain.toLowerCase().split(".");

    const main = extractMainDomainName(rawDomain);

    const mainIndex = parts.lastIndexOf(main);

    if (mainIndex === -1) {
        return rawDomain.toLowerCase();
    }

    const suffix = parts.slice(mainIndex + 1).join(".");

    return suffix ? `${main}.${suffix}` : main;
}