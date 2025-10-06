// Store user preferences
let userPreferences = new Map();

document.addEventListener('DOMContentLoaded', () => {
    
    loadCookies();
    loadSavedPreferences();

    // Add event listener for the "Next" button on page 1
    document.getElementById('nextBtn1').addEventListener('click', () => {
        document.getElementById('page1').style.display = 'none';
        document.getElementById('page2').style.display = 'block';
    });
    // Add event listener for the "Next" button on page 2, to take us to option3

    // document.getElementById('nextBtn2').addEventListener('click', () => {
    //     // Redirect to next option
    //     window.location.href = 'measure_factors.html';  
    // });    
});



async function loadSavedPreferences() {
    try {
        const result = await ext.storage.local.get('userCookiePreferences');
        if (result.userCookiePreferences) {
            userPreferences = new Map(result.userCookiePreferences);
            console.log('Loaded saved preferences:', userPreferences);
        }
    } catch (error) {
        console.error('Error loading saved preferences:', error);
    }
}

async function loadCookies() {
    try {
        // This loads the cookie data stored by the popup.js script
        const result = await ext.storage.local.get('cookieData');
        console.log('Retrieved cookie data:', result.cookieData);

        if (result.cookieData && Array.isArray(result.cookieData)) {
            // Process the cookie data
            const { mostRecentDomains, leastRecentDomains } = processStoredCookieData(result.cookieData);
            
            // Display domains in their respective tables
            displayWebsites(mostRecentDomains, 'mostRecentWebsitesList');
            displayWebsites(leastRecentDomains, 'leastRecentWebsitesList');
            
            // Hide loading message and show tables
            document.getElementById('loading').style.display = 'none';
            document.getElementById('mostRecentTable').style.display = 'table';
            document.getElementById('leastRecentTable').style.display = 'table';
        } else {
            document.getElementById('loading').textContent = 'No cookie data found. Please visit the Cookie Checker first.';
        }
    } catch (error) {
        console.error('Error loading cookies:', error);
        document.getElementById('loading').textContent = 'Error loading cookie data.';
    }
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
    
    // Debug each cookie's totalVisitCount
    cookiesToProcess.forEach(cookie => {
        console.log(`Domain: ${cookie.domain}, Total Visit Count: ${cookie.totalVisitCount}, Type: ${typeof cookie.totalVisitCount}`);
    });

    // Sort by totalVisitCount (most frequent first)
    const sortedByFrequency = [...cookiesToProcess].sort((a, b) => {
        // Parse integers from totalVisitCount, defaulting to 0 if invalid
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsB - visitsA;  // Most frequent first (highest count)
    });
    
    console.log('Sorted by frequency:', sortedByFrequency.map(c => `${c.domain}: ${c.totalVisitCount}`));
    
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
    
    console.log('Most frequent domains:', mostFrequentDomains.map(c => `${c.domain}: ${c.totalVisitCount}`));
    console.log('Least frequent domains:', leastFrequentDomains.map(c => `${c.domain}: ${c.totalVisitCount}`));
    
    return { 
        mostRecentDomains: mostFrequentDomains, 
        leastRecentDomains: leastFrequentDomains 
    };
}

// Create read-only toggle buttons that show user's preference
function createToggleButtons(domain, category, preference) {
    const container = document.createElement('div');
    container.className = 'toggle-container';
    
    // Create accept and reject buttons
    const acceptBtn = document.createElement('button');
    const rejectBtn = document.createElement('button');
    
    acceptBtn.textContent = 'Accept';
    rejectBtn.textContent = 'Reject';
    
    acceptBtn.className = 'toggle-btn accept';
    rejectBtn.className = 'toggle-btn reject';
    
    // Apply the selected class based on the preference
    // In the stored data, categories are like 'functional', 'performance', 'advertising'
    // and the values are either true (Yes) or false (No)
    let isAccepted = false;
    
    // The data stored by popup.js uses capitalized keys (Functional, Performance, etc.)
    // or might store them as categories.functional
    if (domain.categories && domain.categories[category] !== undefined) {
        isAccepted = domain.categories[category];
    } else if (domain[category] !== undefined) {
        isAccepted = domain[category];
    } else if (domain[category.charAt(0).toUpperCase() + category.slice(1)] !== undefined) {
        // Try with capitalized first letter (Functional instead of functional)
        isAccepted = domain[category.charAt(0).toUpperCase() + category.slice(1)] === "Yes";
    }
    
    // Apply the appropriate selection
    if (isAccepted) {
        acceptBtn.classList.add('selected');
        acceptBtn.style.backgroundColor = '#4c7aaf';
        acceptBtn.style.color = 'white';
        acceptBtn.style.borderColor = '#4c7aaf';
    } else {
        rejectBtn.classList.add('selected');
        rejectBtn.style.backgroundColor = '#4c7aaf';
        rejectBtn.style.color = 'white';
        rejectBtn.style.borderColor = '#4c7aaf';
    }
    
    // Disable buttons (read-only)
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    
    container.appendChild(rejectBtn);
    container.appendChild(acceptBtn);
    
    return container;
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
        // favicon.width = 16;
        // favicon.height = 16;
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

        // Create cells for each category showing only the selected option
        const categories = ['functional', 'performance', 'advertising'];
        categories.forEach(category => {
            const cell = document.createElement('td');
            // Instead of toggle buttons, just display the selection status
            const selectionStatus = getSelectionStatus(domain, category);
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
// Helper function to get a single button showing the selection status
function getSelectionStatus(domain, category) {
    const container = document.createElement('div');
    container.className = 'selection-container';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    
    // Determine if accepted or rejected
    let isAccepted = false;
    
    if (domain.categories && domain.categories[category] !== undefined) {
        isAccepted = domain.categories[category];
    } else if (domain[category] !== undefined) {
        isAccepted = domain[category];
    } else if (domain[category.charAt(0).toUpperCase() + category.slice(1)] !== undefined) {
        // Try with capitalized first letter (Functional instead of functional)
        isAccepted = domain[category.charAt(0).toUpperCase() + category.slice(1)] === "Yes";
    }
    
    // Create just the selected button
    const button = document.createElement('button');
    
    if (isAccepted) {
        button.textContent = 'Accepted';
        button.className = 'toggle-btn accept selected';
    } else {
        button.textContent = 'Rejected';
        button.className = 'toggle-btn reject selected';
    }
    
    // Make it read-only
    button.disabled = true;
    
    container.appendChild(button);
    return container;
}

