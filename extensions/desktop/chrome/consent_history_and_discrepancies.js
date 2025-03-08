// Store user preferences and websites with discrepancies
let userPreferences = new Map();
let websitesWithDiscrepancies = []; // Array to store all domains with discrepancies

document.addEventListener('DOMContentLoaded', () => {
    loadSavedPreferences();
    loadCookiesAndFindDiscrepancies();
});

async function loadSavedPreferences() {
    try {
        const result = await chrome.storage.local.get('userCookiePreferences');
        if (result.userCookiePreferences) {
            userPreferences = new Map(result.userCookiePreferences);
            console.log('Loaded saved preferences:', userPreferences);
        }
    } catch (error) {
        console.error('Error loading saved preferences:', error);
    }
}

async function loadCookiesAndFindDiscrepancies() {
    try {
        // Load cookie data
        const result = await chrome.storage.local.get('cookieData');
        console.log('Retrieved cookie data:', result.cookieData);

        if (result.cookieData && Array.isArray(result.cookieData)) {
            // First find all domains with discrepancies
            websitesWithDiscrepancies = findDiscrepancyWebsites(result.cookieData, userPreferences);
            console.log('Websites with discrepancies:', websitesWithDiscrepancies);
            
            // Then process the cookie data for display
            const { mostRecentDomains, leastRecentDomains } = processStoredCookieData(result.cookieData);
            
            // Display domains in their respective tables
            displayWebsites(mostRecentDomains, 'mostRecentWebsitesList');
            displayWebsites(leastRecentDomains, 'leastRecentWebsitesList');
            
            // Hide loading message and show tables
            const loadingElement = document.getElementById('loading');
            if (loadingElement) loadingElement.style.display = 'none';
            
            const mostRecentTable = document.getElementById('mostRecentTable');
            if (mostRecentTable) mostRecentTable.style.display = 'table';
            
            const leastRecentTable = document.getElementById('leastRecentTable');
            if (leastRecentTable) leastRecentTable.style.display = 'table';
        } else {
            const loadingElement = document.getElementById('loading');
            if (loadingElement) {
                loadingElement.textContent = 'No cookie data found. Please visit the Cookie Checker first.';
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

// Find websites with discrepancies between stated and actual preferences
// This uses the logic from your discrepancy detection code
function findDiscrepancyWebsites(cookieData, userPreferences) {
    const discrepancies = [];
    
    // Process each cookie with ActionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Cookies with action taken:', actionTakenCookies.length);
    
    // For each cookie, check if user has stated a different preference in Option 1
    for (const cookie of actionTakenCookies) {
        if (!cookie.domain) continue;
        
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const originalDomain = cookie.domain;
        
        // Try to extract actual preferences from the cookie
        let actualPreferences = null;
        
        // First try from cookie.categories
        if (cookie.categories && typeof cookie.categories === 'object') {
            actualPreferences = {
                functional: cookie.categories.functional === true,
                performance: cookie.categories.performance === true,
                advertising: cookie.categories.advertising === true
            };
        } 
        // Then try from direct columns 
        else if ('functional' in cookie && 'performance' in cookie && 'advertising' in cookie) {
            actualPreferences = {
                functional: cookie.functional === "Yes" || cookie.functional === true,
                performance: cookie.performance === "Yes" || cookie.performance === true,
                advertising: cookie.advertising === "Yes" || cookie.advertising === true
            };
        }
        
        // Skip if we couldn't extract actual preferences
        if (!actualPreferences) continue;
        
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
            !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null
        ].filter(Boolean);
        
        // Try each possible format
        for (const format of possibleFormats) {
            if (userPreferences.has(format)) {
                const prefs = userPreferences.get(format);
                
                // Only use if all preference types are set
                if (prefs.functional !== null && 
                    prefs.performance !== null && 
                    prefs.advertising !== null) {
                    
                    statedPreferences = prefs;
                    matchedDomain = format;
                    break;
                }
            }
        }
        
        // Skip if no stated preferences found
        if (!statedPreferences) continue;
        
        // Compare preferences
        const hasDifference = 
            statedPreferences.functional !== actualPreferences.functional ||
            statedPreferences.performance !== actualPreferences.performance ||
            statedPreferences.advertising !== actualPreferences.advertising;
        
        if (hasDifference) {
            discrepancies.push({
                domain: formattedDomain,
                originalDomain: originalDomain,
                favicon: `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`,
                statedPreferences: statedPreferences,
                actualPreferences: actualPreferences,
                cookie: cookie,
                matchedDomain: matchedDomain,
                categories: {
                    functional: actualPreferences.functional !== statedPreferences.functional,
                    performance: actualPreferences.performance !== statedPreferences.performance,
                    advertising: actualPreferences.advertising !== statedPreferences.advertising
                }
            });
            
            console.log(`Found discrepancy for ${formattedDomain}`, {
                stated: statedPreferences,
                actual: actualPreferences
            });
        }
    }
    
    console.log('Total discrepancies found:', discrepancies.length);
    return discrepancies;
}

// Process the stored cookie data from the extension
function processStoredCookieData(cookieData) {
    // Print the raw cookie data to see what's in it
    console.log('Raw cookie data in processStoredCookieData:', cookieData);
    
    // Filter for cookies where the user has taken action
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Action taken cookies:', actionTakenCookies);

    // If we have fewer than 6 domains with action taken, use all cookies
    const cookiesToProcess = actionTakenCookies.length >= 6 ? actionTakenCookies : cookieData;
    
    // Sort by totalVisitCount (most frequent first)
    const sortedByFrequency = [...cookiesToProcess].sort((a, b) => {
        // Parse integers from totalVisitCount, defaulting to 0 if invalid
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsB - visitsA;  // Most frequent first (highest count)
    });
    
    // Get the 5 most frequently visited domains
    const mostFrequentDomains = sortedByFrequency.slice(0, 5);
    
    // Get the 5 least frequently visited domains (with at least 1 visit)
    // First filter for domains with visits > 0
    const domainsWithVisits = cookiesToProcess.filter(cookie => 
        parseInt(cookie.totalVisitCount) > 0
    );
    
    // Then sort by ascending visit count
    const sortedAscending = [...domainsWithVisits].sort((a, b) => {
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsA - visitsB;
    });
    
    // Take the 5 domains with the lowest visit counts
    const leastFrequentDomains = sortedAscending.slice(0, 5);
    
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

// Find user preferences for a specific domain, checking different domain formats
function findUserPreferenceForDomain(domain) {
    if (!domain || !userPreferences || userPreferences.size === 0) {
        return null;
    }
    
    const originalDomain = domain;
    const formattedDomain = formatDomainForDisplay(domain);
    
    // Try different domain formats to match with preferences
    const possibleFormats = [
        originalDomain,
        originalDomain.startsWith('.') ? originalDomain.substring(1) : null,
        !originalDomain.startsWith('.') ? '.' + originalDomain : null,
        formattedDomain,
        formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : null,
        !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null
    ].filter(Boolean);
    
    // Try each possible format
    for (const format of possibleFormats) {
        if (userPreferences.has(format)) {
            return userPreferences.get(format);
        }
    }
    
    return null;
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
    
    return websitesWithDiscrepancies.find(d => 
        d.domain === formattedDomain || 
        d.originalDomain === domain ||
        formatDomainForDisplay(d.originalDomain) === formattedDomain
    );
}

function displayWebsites(domains, tableId) {
    const websitesList = document.getElementById(tableId);
    if (!websitesList) {
        console.error(`Element with ID ${tableId} not found`);
        return;
    }
    
    websitesList.innerHTML = '';

    if (domains.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 6; // Span all columns (including the visit count column)
        emptyCell.textContent = 'No websites found with cookie choices.';
        emptyCell.style.textAlign = 'center';
        emptyRow.appendChild(emptyCell);
        websitesList.appendChild(emptyRow);
        return;
    }

    domains.forEach(domain => {
        console.log(`Displaying domain: ${domain.domain}, totalVisitCount: ${domain.totalVisitCount}`);
        
        const row = document.createElement('tr');
        
        // Website cell with favicon and formatted domain
        const domainCell = document.createElement('td');
        domainCell.className = 'website-cell';
        
        // Format the domain for display
        const formattedDomain = formatDomainForDisplay(domain.domain);
        
        // Create favicon image element
        const favicon = document.createElement('img');
        favicon.src = `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`;
        favicon.alt = '';
        favicon.style.marginRight = '8px';
        favicon.style.verticalAlign = 'middle';
        
        // Handle favicon loading errors
        favicon.onerror = function() {
            this.classList.add('favicon-error');
        };
        
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
        const discrepancyInfo = getDiscrepancyInfo(domain.domain);

        // Create cells for each category showing only the selected option
        const categories = ['functional', 'performance', 'advertising'];
        categories.forEach(category => {
            const cell = document.createElement('td');
            // Create the selection status with discrepancy markers if needed
            const selectionStatus = getSelectionStatus(
                domain, 
                category, 
                discrepancyInfo ? discrepancyInfo.statedPreferences : null,
                discrepancyInfo ? discrepancyInfo.categories[category] : false
            );
            cell.appendChild(selectionStatus);
            row.appendChild(cell);
        });

        // Expiration date cell
        const expirationCell = document.createElement('td');
        expirationCell.textContent = domain.expiration || "Session cookie";
        row.appendChild(expirationCell);
        
        // Freq Visit (Total) cell
        const visitCountCell = document.createElement('td');
        // Convert to number and display
        const count = parseInt(domain.totalVisitCount) || 0;
        visitCountCell.textContent = count;
        visitCountCell.style.fontWeight = 'bold';
        visitCountCell.style.color = '#4c7aaf';
        visitCountCell.style.textAlign = 'center';
        row.appendChild(visitCountCell);

        websitesList.appendChild(row);
    });
}

// Helper function to get a single button showing the selection status
function getSelectionStatus(domain, category, userPref, hasDiscrepancy) {
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
    
    // Create just the selected button
    const button = document.createElement('button');
    
    if (isAccepted) {
        button.textContent = 'Accepted';
        button.className = 'toggle-btn accept selected';
        button.style.backgroundColor = '#4c7aaf';
        button.style.color = 'white';
        button.style.borderColor = '#4c7aaf';
    } else {
        button.textContent = 'Rejected';
        button.className = 'toggle-btn reject selected';
        button.style.backgroundColor = '#919291';
        button.style.color = 'white';
        button.style.borderColor = '#919291';
    }
    
    // Make it read-only
    button.disabled = true;
    
    // If this specific category has a discrepancy, add the marker
    if (hasDiscrepancy) {
        const discrepancyMarker = document.createElement('span');
        discrepancyMarker.textContent = '!';
        discrepancyMarker.style.position = 'absolute';
        discrepancyMarker.style.top = '10px';
        discrepancyMarker.style.right = '20px';
        // discrepancyMarker.style.backgroundColor = '#ff9800';
        // discrepancyMarker.style.color = 'white';
        discrepancyMarker.style.color = '#ff9800';
        // discrepancyMarker.style.borderRadius = '50%';
        // discrepancyMarker.style.width = '20px';
        // discrepancyMarker.style.height = '20px';
        // discrepancyMarker.style.display = 'flex';
        // discrepancyMarker.style.justifyContent = 'center';
        // discrepancyMarker.style.alignItems = 'center';
        discrepancyMarker.style.fontWeight = 'bold';
        discrepancyMarker.style.fontSize = '25px';
        discrepancyMarker.style.cursor = 'pointer';
        
        // Add tooltip showing what the user preference was
        if (userPref && userPref[category] !== null) {
            const userAccepted = typeof userPref[category] === 'string'
                ? userPref[category] === "Yes" || userPref[category] === "Accepted" || userPref[category] === "Accept"
                : userPref[category];
                
            // discrepancyMarker.title = `Your preference was: ${userAccepted ? 'Accept' : 'Reject'}`;
            discrepancyMarker.title = `Your previous choice was: ${userAccepted ? 'Accept' : 'Reject'}, but actual setting is: ${isAccepted ? 'Accept' : 'Reject'}`;
        }
        
        container.appendChild(discrepancyMarker);
    }
    
    container.appendChild(button);
    return container;
}