// Undecided Websites JS
// Shows websites where the user chose "Undecided" (value=3) for a category
// but the browser has a stored consent decision (Allowed or Not Allowed)
let userPreferences = new Map();
let websitesUndecided = [];

document.addEventListener('DOMContentLoaded', () => {
    console.log('Undecided page loaded, refreshing cookie data...');
    automaticRefreshOnLoad();
});

async function automaticRefreshOnLoad() {
    try {
        console.log('Auto-refreshing cookie data...');

        let cookieProcessingComplete = false;
        const messageListener = (message) => {
            if (message.action === 'cookieProcessingComplete') {
                cookieProcessingComplete = true;
            }
        };
        ext.runtime.onMessage.addListener(messageListener);

        const popupURL = ext.runtime.getURL('popup.html');
        const popupTab = await ext.tabs.create({ url: popupURL, active: false });

        const startTime = Date.now();
        while (!cookieProcessingComplete && (Date.now() - startTime) < 3000) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        ext.runtime.onMessage.removeListener(messageListener);

        if (popupTab && popupTab.id) {
            await ext.tabs.remove(popupTab.id);
        }

        loadSavedPreferences();

    } catch (error) {
        console.error('Error during automatic refresh:', error);
        loadSavedPreferences();
    }
}

async function loadSavedPreferences() {
    try {
        const result = await ext.storage.local.get('userCookiePreferences');
        if (result && result.userCookiePreferences) {
            if (Array.isArray(result.userCookiePreferences)) {
                userPreferences = new Map(result.userCookiePreferences);
            } else if (typeof result.userCookiePreferences === 'object') {
                userPreferences = new Map();
                result.userCookiePreferences.forEach(item => {
                    if (item.domain && item.preferences) {
                        userPreferences.set(item.domain, item.preferences);
                    }
                });
            }
        } else {
            userPreferences = new Map();
        }

        loadCookiesAndFindUndecided();

    } catch (error) {
        console.error('Error loading preferences:', error);
        loadCookiesAndFindUndecided();
    }
}

async function loadCookiesAndFindUndecided() {
    try {
        const selectedDomainsResult = await ext.storage.local.get('selectedDomainsForHistory');

        let domains = [];

        if (selectedDomainsResult && selectedDomainsResult.selectedDomainsForHistory &&
            Array.isArray(selectedDomainsResult.selectedDomainsForHistory) &&
            selectedDomainsResult.selectedDomainsForHistory.length > 0) {

            domains = selectedDomainsResult.selectedDomainsForHistory;

            // Refresh with fresh cookie categories
            const cookieDataResult = await ext.storage.local.get('cookieData');
            if (cookieDataResult && cookieDataResult.cookieData) {
                domains = domains.map(domain => {
                    const freshCookie = cookieDataResult.cookieData.find(c =>
                        c.domain === domain.domain ||
                        c.domain === domain.originalDomain ||
                        formatDomainForDisplay(c.domain) === domain.domain
                    );
                    if (freshCookie && freshCookie.categories) {
                        return { ...domain, categories: freshCookie.categories };
                    }
                    return domain;
                });
            }

        } else {
            // Fallback to cookieData
            const result = await ext.storage.local.get('cookieData');
            if (result && result.cookieData && Array.isArray(result.cookieData)) {
                domains = result.cookieData.filter(c =>
                    c.actionTaken && c.actionTaken.toLowerCase() === 'yes'
                );
            }
        }

        // Find undecided websites
        websitesUndecided = findUndecidedWebsites(domains, userPreferences);
        console.log('Undecided websites found:', websitesUndecided.length);

        displayUndecidedWebsites(domains);

        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.style.display = 'none';

    } catch (error) {
        console.error('Error loading cookies:', error);
        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.textContent = 'Error loading cookie data: ' + error.message;
    }
}

// Find websites where user chose Undecided (value=3) but browser has a stored decision
function findUndecidedWebsites(domains, userPreferences) {
    const undecided = [];

    if (!userPreferences || userPreferences.size === 0) return undecided;

    for (const domain of domains) {
        if (!domain.domain) continue;

        const formattedDomain = formatDomainForDisplay(domain.domain);

        // Try to find matching user preference using domain variations
        const possibleFormats = [
            domain.domain,
            domain.domain.startsWith('.') ? domain.domain.substring(1) : null,
            !domain.domain.startsWith('.') ? '.' + domain.domain : null,
            formattedDomain,
            formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : null,
            !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null,
            formattedDomain.replace('www.', '')
        ].filter(Boolean);

        let statedPreferences = null;
        for (const format of possibleFormats) {
            if (userPreferences.has(format)) {
                statedPreferences = userPreferences.get(format);
                break;
            }
        }

        if (!statedPreferences) continue;

        // Check each category: is the user undecided (value=3) but browser has a decision?
        const undecidedCategories = { functional: false, performance: false, advertising: false };
        const categories = ['functional', 'performance', 'advertising'];
        let hasUndecided = false;

        for (const category of categories) {
            const userValue = statedPreferences[category];
            if (typeof userValue !== 'number' || userValue !== 3) continue; // only undecided

            // Check what browser actually stored
            let isAccepted = false;
            if (domain.categories && domain.categories[category] !== undefined) {
                isAccepted = domain.categories[category];
            } else if (domain[category] !== undefined) {
                isAccepted = domain[category] === true || domain[category] === 'Yes' || domain[category] === 'Accepted';
            }

            // If user is undecided but browser made a decision → flag it
            undecidedCategories[category] = true;
            hasUndecided = true;
        }

        if (hasUndecided) {
            undecided.push({
                domain: formattedDomain,
                originalDomain: domain.domain,
                statedPreferences,
                undecidedCategories,
                domainData: domain
            });
        }
    }

    return undecided;
}

function getUndecidedInfo(domain) {
    const formattedDomain = formatDomainForDisplay(domain);
    return websitesUndecided.find(d =>
        d.domain === formattedDomain ||
        d.originalDomain === domain ||
        d.domain.replace('www.', '') === formattedDomain.replace('www.', '')
    );
}

function displayUndecidedWebsites(domains) {
    const tbody = document.getElementById('undecidedWebsitesList');
    const table = document.getElementById('undecidedTable');
    const noMsg = document.getElementById('noUndecidedMessage');

    if (!tbody) return;
    tbody.innerHTML = '';

    // Filter to only domains that have at least one undecided category
    const toDisplay = domains.filter(domain => getUndecidedInfo(domain.domain));

    if (toDisplay.length === 0) {
        if (table) table.style.display = 'none';
        if (noMsg) noMsg.style.display = 'block';
        return;
    }

    if (table) table.style.display = 'table';
    if (noMsg) noMsg.style.display = 'none';

    toDisplay.forEach(domain => {
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
        favicon.src = `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`;

        const domainContainer = document.createElement('div');
        domainContainer.style.display = 'flex';
        domainContainer.style.alignItems = 'center';
        domainContainer.appendChild(favicon);
        domainContainer.appendChild(document.createTextNode(formattedDomain));
        domainCell.appendChild(domainContainer);
        row.appendChild(domainCell);

        const undecidedInfo = getUndecidedInfo(domain.domain);

        // Category cells
        ['functional', 'performance', 'advertising'].forEach(category => {
            const cell = document.createElement('td');
            const container = buildCategoryCell(domain, category, undecidedInfo);
            cell.appendChild(container);
            row.appendChild(cell);
        });

        // Expiration cell
        const expirationCell = document.createElement('td');
        if (domain.expiration && domain.expiration !== 'Session cookie') {
            expirationCell.textContent = calculateDaysRemaining(domain.expiration);
        } else {
            expirationCell.textContent = 'Session cookie';
        }
        row.appendChild(expirationCell);

        tbody.appendChild(row);
    });
}

function buildCategoryCell(domain, category, undecidedInfo) {
    const container = document.createElement('div');
    container.className = 'selection-container';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.position = 'relative';

    // Determine actual stored consent value
    let isAccepted = false;
    if (domain.categories && domain.categories[category] !== undefined) {
        isAccepted = domain.categories[category];
    } else if (domain[category] !== undefined) {
        isAccepted = domain[category] === true || domain[category] === 'Yes' || domain[category] === 'Accepted';
    }

    // Build the button showing actual stored consent
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
    container.appendChild(button);

    // Add purple ! marker if this category is undecided
    if (undecidedInfo && undecidedInfo.undecidedCategories[category]) {
        const marker = document.createElement('span');
        marker.textContent = '!';
        marker.className = 'undecided-marker';

        const tooltip = document.createElement('span');
        tooltip.className = 'undecided-tooltiptext';
        tooltip.innerHTML = `Your preference: "<strong>Undecided</strong>"<br>Actual: <strong>${isAccepted ? 'Allowed' : 'Not Allowed'}</strong>`;

        marker.appendChild(tooltip);
        container.appendChild(marker);
        container.style.overflow = 'visible';
        container.style.marginTop = '15px';
    }

    return container;
}

// ── Shared helpers (same as consent_history_and_discrepancies.js) ──────────

function formatDomainForDisplay(domain) {
    if (!domain) return 'Unknown';
    if (domain.startsWith('.')) domain = domain.substring(1);
    const parts = domain.split('.');
    // if (parts.length === 2) domain = 'www.' + domain;
    domain = domain.replace(/^www\./, '');
    return domain;
}

function calculateDaysRemaining(expirationDate) {
    if (!expirationDate || expirationDate === 'Session cookie') return 'Session cookie';
    try {
        const diffMs = new Date(expirationDate) - new Date();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return 'Expired';
        if (diffDays === 0) return 'Expires today';
        if (diffDays === 1) return '1 day';
        return `${diffDays} more days`;
    } catch {
        return expirationDate;
    }
}