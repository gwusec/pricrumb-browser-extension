//prefered_choices1.js
// Store user preferences and domain data
let userPreferences = new Map();
let allDomains = [];
let currentDomainIndex = 0;
let currentCookieCategory = 'functional';
let domainSelections = {}; // Track current session selections that haven't been saved yet

// DOM content loaded event listener
document.addEventListener('DOMContentLoaded', () => {
    loadCookies();
    loadSavedPreferences();
    
    // Set up event listeners for based on
    document.getElementById('startFunctional').addEventListener('click', () => startCategory('functional'));
    document.getElementById('startPerformance').addEventListener('click', () => startCategory('performance'));
    document.getElementById('startAdvertising').addEventListener('click', () => startCategory('advertising'));
    
    // Set up navigation listeners
    document.getElementById('previousButton').addEventListener('click', showPreviousDomain);
    // document.getElementById('nextButton').addEventListener('click', showNextDomain);
    document.getElementById('nextCategoryButton').addEventListener('click', moveToNextCategory);
    document.getElementById('finishButton').addEventListener('click', finishAndSave);
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
            
            // Hide loading and show intro view
            document.getElementById('loading').style.display = 'none';
            document.getElementById('introView').style.display = 'block';
            
            // Update total domains counter
            document.getElementById('totalDomains').textContent = allDomains.length;
            
            // Initialize domain selections tracking
            initializeSelectionTracking();
        } else {
            document.getElementById('loading').textContent = 'No cookie data found. Please visit the Cookie Checker first.';
        }
    } catch (error) {
        console.error('Error loading cookies:', error);
        document.getElementById('loading').textContent = 'Error loading cookie data.';
    }
}

// Update the domain question display to include favicon


// Initialize selection tracking
function initializeSelectionTracking() {
    // Create an object to track selections for each domain and cookie type
    domainSelections = {};
    
    allDomains.forEach(domain => {
        const domainKey = domain.domain;
        domainSelections[domainKey] = {
            functional: null,
            performance: null,
            advertising: null
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
    // Track the selection in our temporary store
    domainSelections[domain][category] = value;
    
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
    
    console.log(`Saving preference for ${domain} using key ${originalDomain}, category ${category}, value ${value}`);
    
    if (!userPreferences.has(originalDomain)) {
        userPreferences.set(originalDomain, {
            functional: null,
            performance: null,
            advertising: null
        });
    }
    const prefs = userPreferences.get(originalDomain);
    prefs[category] = value;
}

// Format date for display
function formatDate(dateStr) {
    try {
        const date = new Date(dateStr);
        return date.toLocaleString();
    } catch (error) {
        return dateStr || 'Unknown';
    }
}

// Start the process for a cookie category
function startCategory(category) {
    currentCookieCategory = category;
    currentDomainIndex = 0;
    
    // Update the UI
    document.getElementById('introView').style.display = 'none';
    document.getElementById('questionView').style.display = 'block';
    
    // Make sure the correct info box is showing
    document.getElementById('functionalInfo').style.display = 'none';
    document.getElementById('performanceInfo').style.display = 'none';
    document.getElementById('advertisingInfo').style.display = 'none';
    document.getElementById(`${category}Info`).style.display = 'block';
    
    // Update the domain display
    updateDomainDisplay();
}

// Update the domain question display
// Update the domain question display
// Update the domain question display
function updateDomainDisplay() {
    if (allDomains.length === 0) {
        alert("No domains found. Please try again later.");
        return;
    }
    
    const currentDomain = allDomains[currentDomainIndex];
    
    // Create favicon element
    const faviconContainer = document.createElement('div');
    faviconContainer.style.display = 'inline-flex';
    faviconContainer.style.alignItems = 'center';
    faviconContainer.style.gap = '8px';
    
    // Favicon image
    const favicon = document.createElement('img');
    favicon.src = currentDomain.favicon || `https://www.google.com/s2/favicons?domain=${currentDomain.domain}&sz=32`;
    favicon.alt = '';
    // favicon.width = 16;
    // favicon.height = 16;
    
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
    currentDomainElement.innerHTML = ''; // Clear existing content
    currentDomainElement.appendChild(faviconContainer);
    
    // Update cookie type text
    document.getElementById('currentCookieType').textContent = currentCookieCategory;
    
    // Update progress indicator
    document.getElementById('currentDomain').textContent = currentDomainIndex + 1;
    const progressPercentage = ((currentDomainIndex + 1) / allDomains.length) * 100;
    document.querySelector('.progress-fill').style.width = `${progressPercentage}%`;
    
    // Update navigation buttons
    document.getElementById('previousButton').disabled = currentDomainIndex === 0;
    
    // Update toggle buttons
    const toggleContainer = document.querySelector('#questionView .toggle-container');
    toggleContainer.innerHTML = '';
    
    // Create new toggle buttons
    const acceptBtn = document.createElement('button');
    const rejectBtn = document.createElement('button');
    
    rejectBtn.textContent = 'Reject';
    acceptBtn.textContent = 'Accept';
    
    rejectBtn.className = 'toggle-btn reject';
    acceptBtn.className = 'toggle-btn accept';
    
    // Check if there's a selection for this domain/category already made in the current session
    const currentSelection = domainSelections[currentDomain.domain][currentCookieCategory];
    
    // Only add the selected class if the user has made a selection in this session
    if (currentSelection === true) {
        acceptBtn.classList.add('selected');
    } else if (currentSelection === false) {
        rejectBtn.classList.add('selected');
    }
    
    // Function to handle domain selection
    const handleSelection = (value) => {
        // Disable buttons to prevent multiple clicks
        acceptBtn.disabled = true;
        rejectBtn.disabled = true;
        
        // Save the preference
        savePreference(currentDomain.domain, currentCookieCategory, value);
        
        // Highlight the selected button
        if (value === true) {
            acceptBtn.style.backgroundColor = '#4c7aaf';  // for consistincy, all blue
            acceptBtn.style.color = 'white';
        } else {
            rejectBtn.style.backgroundColor = '#4c7aaf';  // for consistincy, all blue
            rejectBtn.style.color = 'white';
        }
        
        // Delayed move to next domain
        setTimeout(() => {
            if (currentDomainIndex < allDomains.length - 1) {
                currentDomainIndex++;
                updateDomainDisplay();
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

// Remove or modify existing navigation buttons as they're no longer needed
function showNextDomain() {
    // No-op or remove this function
    return;
}

// Show the next domain - require a selection first
function showNextDomain() {
    const currentDomain = allDomains[currentDomainIndex];
    
    // Check if a selection has been made for this domain and category
    if (domainSelections[currentDomain.domain][currentCookieCategory] === null) {
        alert("Please make a selection (Accept or Reject) before continuing.");
        return;
    }
    
    if (currentDomainIndex < allDomains.length - 1) {
        currentDomainIndex++;
        updateDomainDisplay();
    } else {
        // We've reached the end of domains for this category
        completeCategory();
    }
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
    document.getElementById('questionView').style.display = 'none';
    
    // Update completed category text
    document.getElementById('completedCategory').textContent = currentCookieCategory;
    
    // Check if this was the last category
    if (currentCookieCategory === 'advertising') {
        // Show completion view
        document.getElementById('allCompleteView').style.display = 'block';
    } else {
        // Show category completion view
        document.getElementById('categoryCompleteView').style.display = 'block';
    }
    
    // Update the category buttons in the intro view
    if (currentCookieCategory === 'functional') {
        document.getElementById('startFunctional').disabled = true;
        document.getElementById('startPerformance').disabled = false;
        document.getElementById('categoryDescription').textContent = 'Continue with Performance cookies preferences.';
    } else if (currentCookieCategory === 'performance') {
        document.getElementById('startPerformance').disabled = true;
        document.getElementById('startAdvertising').disabled = false;
        document.getElementById('categoryDescription').textContent = 'Continue with Advertising cookies preferences.';
    }
    
    // Save preferences
    saveAllPreferences();
}

// Move to the next category
function moveToNextCategory() {
    // Hide category completion view
    document.getElementById('categoryCompleteView').style.display = 'none';
    
    // Determine next category
    if (currentCookieCategory === 'functional') {
        currentCookieCategory = 'performance';
    } else if (currentCookieCategory === 'performance') {
        currentCookieCategory = 'advertising';
    }
    
    // Reset domain index
    currentDomainIndex = 0;
    
    // Start the new category
    startCategory(currentCookieCategory);
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

// Finish and save, then redirect to the second option (option2)
function finishAndSave() {
    saveAllPreferences();
    alert('Your preferences have been saved. Thank you!');
    
    // Redirect to main page or close
    window.location.href = 'prefered_choices2.html';  
}
