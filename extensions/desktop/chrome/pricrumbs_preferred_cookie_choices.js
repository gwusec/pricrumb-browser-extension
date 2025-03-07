// pricrumbs_preferred_cookie_choices.js
// Handles cookie preferences across three separate standalone HTML pages

// Store user preferences and domain data
let userPreferences = new Map();
let allDomains = [];
let currentDomainIndex = 0;
let currentCookieCategory = 'functional'; //Will be overridden by the page type
let domainSelections = {}; // Track current session selections that haven't been saved yet

// DOM content loaded event listener
document.addEventListener('DOMContentLoaded', () => {
    // Check which category page we're on
    if (window.cookieCategory) {
        currentCookieCategory = window.cookieCategory;
        console.log("Current cookie category set to:", currentCookieCategory);
    }
    
    loadCookies();
    loadSavedPreferences();
    
    // Set up navigation listeners
    const previousButton = document.getElementById('previousButton');
    if (previousButton) {
        previousButton.addEventListener('click', showPreviousDomain);
    }
});

// Load saved user preferences
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

// Load cookie data
async function loadCookies() {
    try {
        const result = await chrome.storage.local.get('cookieData');
        console.log('Retrieved cookie data:', result.cookieData);

        if (result.cookieData && Array.isArray(result.cookieData)) {
            // Log the number of cookies with action taken = yes
            const actionTakenCount = result.cookieData.filter(cookie => 
                cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
            ).length;
            console.log(`Found ${actionTakenCount} cookies with action taken = yes`);
            
            const { mostRecentDomains, leastRecentDomains } = getRecentActionDomains(result.cookieData);
            console.log('Most recent domains:', mostRecentDomains);
            console.log('Least recent domains:', leastRecentDomains);
            
            // Add favicon URLs to domains
            mostRecentDomains.forEach(domain => {
                domain.favicon = `https://www.google.com/s2/favicons?domain=${formatDomainForDisplay(domain.domain)}&sz=32`;
            });
            
            leastRecentDomains.forEach(domain => {
                domain.favicon = `https://www.google.com/s2/favicons?domain=${formatDomainForDisplay(domain.domain)}&sz=32`;
            });
            
            // Combine all domains
            allDomains = [...mostRecentDomains, ...leastRecentDomains];
            
            // Hide loading and show question view directly
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
            
            const questionView = document.getElementById('questionView');
            if (questionView) {
                questionView.style.display = 'block';
            }
            
            // Update total domains counter
            const totalDomainsEl = document.getElementById('totalDomains');
            if (totalDomainsEl) {
                totalDomainsEl.textContent = allDomains.length;
            }
            
            // Initialize domain selections tracking
            initializeSelectionTracking();
            
            // Start showing domains
            updateDomainDisplay();
        } else {
            const loadingEl = document.getElementById('loading');
            if (loadingEl) {
                loadingEl.textContent = 'No cookie data found. Please visit the Cookie Checker first.';
            }
        }
    } catch (error) {
        console.error('Error loading cookies:', error);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.textContent = 'Error loading cookie data.';
        }
    }
}

// Initialize selection tracking
function initializeSelectionTracking() {
    // Create an object to track selections for each domain and cookie type
    domainSelections = {};
    
    allDomains.forEach(domain => {
        const domainKey = domain.domain;
        domainSelections[domainKey] = {
            [currentCookieCategory]: null // Only track the current category
        };
    });
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

// Get 5 most recent and 5 least recent domains
function getRecentActionDomains(cookies) {
    // Filter for cookies where the user has taken action
    const actionTakenCookies = cookies.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    // If we have fewer than 6 domains with action taken, use all cookies
    const cookiesToProcess = actionTakenCookies.length >= 6 ? actionTakenCookies : cookies;
    
    // Sort by totalVisitCount (most frequent first)
    const sortedByFrequency = [...cookiesToProcess].sort((a, b) => {
        // Parse integers from totalVisitCount, defaulting to 0 if invalid
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsB - visitsA;  // Most frequent first (highest count)
    });
    
    // Get the 5 most frequently visited domains
    const mostFrequentDomains = sortedByFrequency.slice(0, 5).map(cookie => ({
        domain: formatDomainForDisplay(cookie.domain),
        originalDomain: cookie.domain,
        lastVisited: cookie.lastVisited,
        categories: cookie.categories,
        totalVisitCount: cookie.totalVisitCount
    }));
    
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
    const leastFrequentDomains = sortedAscending.slice(0, 5).map(cookie => ({
        domain: formatDomainForDisplay(cookie.domain),
        originalDomain: cookie.domain,
        lastVisited: cookie.lastVisited,
        categories: cookie.categories,
        totalVisitCount: cookie.totalVisitCount
    }));
    
    return { 
        mostRecentDomains: mostFrequentDomains, 
        leastRecentDomains: leastFrequentDomains 
    };
}

// Save preference for a domain and category
function savePreference(domain, category, value) {
    console.log(`Saving preference for domain ${domain}, category ${category}: ${value ? "Accept" : "Reject"}`);
    
    // Make sure the domain exists in our tracking object
    if (!domainSelections[domain]) {
        domainSelections[domain] = {};
    }
    
    // Save the selection for this specific domain and category only
    domainSelections[domain][category] = value;
    
    // Find the original domain format if needed
    const domainObject = allDomains.find(d => d.domain === domain);
    let originalDomain = domain;
    
    // Use original domain if available
    if (domainObject && domainObject.originalDomain) {
        originalDomain = domainObject.originalDomain;
    }
    // Otherwise check if we need to transform the domain
    else if (domain.startsWith('www.')) {
        // Check if we need to remove www and add a leading dot based on existing preferences
        const domainWithoutWWW = domain.substring(4);
        const domainWithDot = '.' + domainWithoutWWW;
        
        // If we already have a preference for the domain with dot, use that
        if (userPreferences.has(domainWithDot)) {
            originalDomain = domainWithDot;
        } else if (userPreferences.has(domainWithoutWWW)) {
            originalDomain = domainWithoutWWW;
        }
    }
    
    console.log(`Using storage key ${originalDomain} for domain ${domain}`);
    
    // Create or update the preference object for this domain
    if (!userPreferences.has(originalDomain)) {
        userPreferences.set(originalDomain, {
            functional: null,
            performance: null,
            advertising: null
        });
    }
    
    // Get the current preferences and update only the specified category
    const prefs = userPreferences.get(originalDomain);
    prefs[category] = value;
    
    // Immediately save to storage to persist the change
    saveAllPreferences();
}

// Update the domain question display - Fixed to prevent selection inheritance
function updateDomainDisplay() {
    if (allDomains.length === 0) {
        alert("No domains found. Please try again later.");
        return;
    }
    
    const currentDomain = allDomains[currentDomainIndex];
    console.log("Displaying domain:", currentDomain.domain, "at index", currentDomainIndex);
    
    // Create favicon element
    const faviconContainer = document.createElement('div');
    faviconContainer.style.display = 'inline-flex';
    faviconContainer.style.alignItems = 'center';
    faviconContainer.style.gap = '8px';
    
    // Favicon image
    const favicon = document.createElement('img');
    favicon.src = currentDomain.favicon || `https://www.google.com/s2/favicons?domain=${formatDomainForDisplay(currentDomain.domain)}&sz=32`;
    favicon.alt = '';
    
    // Handle favicon loading errors
    favicon.onerror = function() {
        this.style.display = 'none'; // Hide if favicon fails to load
    };
    
    // Domain name container
    const domainNameSpan = document.createElement('span');
    domainNameSpan.textContent = currentDomain.domain;
    
    // Combine favicon and domain name
    faviconContainer.appendChild(favicon);
    faviconContainer.appendChild(domainNameSpan);
    
    // Update domain name with favicon
    const currentDomainElement = document.getElementById('currentDomainName');
    if (currentDomainElement) {
        currentDomainElement.innerHTML = ''; // Clear existing content
        currentDomainElement.appendChild(faviconContainer);
    }
    
    // Update progress indicator
    const currentDomainEl = document.getElementById('currentDomain');
    if (currentDomainEl) {
        currentDomainEl.textContent = currentDomainIndex + 1;
    }
    
    const progressFill = document.querySelector('.progress-fill');
    if (progressFill) {
        const progressPercentage = ((currentDomainIndex + 1) / allDomains.length) * 100;
        progressFill.style.width = `${progressPercentage}%`;
    }
    
    // Update navigation buttons
    const previousButton = document.getElementById('previousButton');
    if (previousButton) {
        previousButton.disabled = currentDomainIndex === 0;
    }
    
    // Update toggle buttons
    const toggleContainer = document.querySelector('#questionView .toggle-container');
    if (!toggleContainer) {
        console.error("Toggle container not found");
        return;
    }
    
    toggleContainer.innerHTML = '';
    
    // Create new toggle buttons
    const acceptBtn = document.createElement('button');
    const rejectBtn = document.createElement('button');
    
    rejectBtn.textContent = 'Reject';
    acceptBtn.textContent = 'Accept';
    
    rejectBtn.className = 'toggle-btn reject';
    acceptBtn.className = 'toggle-btn accept';
    
    // Check ONLY for this specific domain's selection - do not inherit from previous
    let currentSelection = null;
    
    // First check if this specific domain has a selection in current session
    if (domainSelections[currentDomain.domain] && 
        domainSelections[currentDomain.domain][currentCookieCategory] !== null) {
        currentSelection = domainSelections[currentDomain.domain][currentCookieCategory];
        console.log(`Domain ${currentDomain.domain} has selection in current session:`, 
                  currentSelection ? "Accept" : "Reject");
    } 
    // Then check if this specific domain has a saved preference
    else {
        // Get the original domain format if available
        let originalDomain = currentDomain.originalDomain || currentDomain.domain;
        
        // Check for saved preferences for this specific domain only
        if (userPreferences.has(originalDomain)) {
            const prefs = userPreferences.get(originalDomain);
            if (prefs && prefs[currentCookieCategory] !== null) {
                currentSelection = prefs[currentCookieCategory];
                console.log(`Domain ${currentDomain.domain} has saved preference:`, 
                          currentSelection ? "Accept" : "Reject");
            }
        }
    }
    
    // Add selected class based ONLY on this domain's specific selection
    if (currentSelection === true) {
        console.log(`Setting Accept button as selected for ${currentDomain.domain}`);
        acceptBtn.classList.add('selected');
    } else if (currentSelection === false) {
        console.log(`Setting Reject button as selected for ${currentDomain.domain}`);
        rejectBtn.classList.add('selected');
    } else {
        console.log(`No selection for ${currentDomain.domain}, buttons start unselected`);
    }
    
    // Function to handle domain selection
    const handleSelection = (value) => {
        console.log(`User selected ${value ? "Accept" : "Reject"} for ${currentDomain.domain}`);
        
        // Save the preference for THIS SPECIFIC DOMAIN ONLY
        savePreference(currentDomain.domain, currentCookieCategory, value);
        
        // Highlight the selected button
        if (value === true) {
            acceptBtn.style.backgroundColor = '#4c7aaf';
            acceptBtn.style.color = 'white';
            rejectBtn.style.backgroundColor = '#f0f0f0';
            rejectBtn.style.color = '#333';
        } else {
            rejectBtn.style.backgroundColor = '#4c7aaf';
            rejectBtn.style.color = 'white';
            acceptBtn.style.backgroundColor = '#f0f0f0';
            acceptBtn.style.color = '#333';
        }
        
        // Disable buttons briefly to prevent double-clicks
        acceptBtn.disabled = true;
        rejectBtn.disabled = true;
        
        // Delayed move to next domain
        setTimeout(() => {
            if (currentDomainIndex < allDomains.length - 1) {
                currentDomainIndex++;
                updateDomainDisplay(); // This will refresh with no selection for the new domain
            } else {
                // We've reached the end of domains for this category
                completeCategory();
            }
        }, 500);  // 500ms delay to show the selection
    };
    
    acceptBtn.addEventListener('click', () => {
        handleSelection(true);
    });
    
    rejectBtn.addEventListener('click', () => {
        handleSelection(false);
    });
    
    toggleContainer.appendChild(rejectBtn);
    toggleContainer.appendChild(acceptBtn);
}
// Show the previous domain
function showPreviousDomain() {
    if (currentDomainIndex > 0) {
        currentDomainIndex--;
        updateDomainDisplay();
    }
}

// Complete the current category
function completeCategory() {
    // Hide question view
    const questionView = document.getElementById('questionView');
    if (questionView) {
        questionView.style.display = 'none';
    }
    
    // Show completion view
    const completionView = document.getElementById('completionView');
    if (completionView) {
        completionView.style.display = 'block';
    }
    
    // Save preferences
    saveAllPreferences();
}

// Save all preferences
function saveAllPreferences() {
    // Ensure we save the latest preferences
    chrome.storage.local.set({
        'userCookiePreferences': Array.from(userPreferences.entries())
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error saving all preferences:', chrome.runtime.lastError);
        } else {
            console.log('All preferences saved successfully');
        }
    });
}