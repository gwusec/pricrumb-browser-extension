// Add this to the beginning of your pricrumbs_preferred_cookie_choices.js file

// Store user preferences and domain data
let userPreferences = new Map();
let allDomains = [];
let currentDomainIndex = 0;
let currentCookieCategory = 'functional'; 
let domainSelections = {}; // Track current session selections that haven't been saved yet

// Remove the check for window.cookieCategory since we're hardcoding it
document.addEventListener('DOMContentLoaded', () => {
    console.log("Functional cookies page loaded with category:", currentCookieCategory);
    
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
async function savePreference(domain, category, value) {
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
    
    // Get latest preferences from storage to ensure we have the most up-to-date data
    try {
        const result = await chrome.storage.local.get('userCookiePreferences');
        let storedPrefs = new Map();
        
        if (result.userCookiePreferences && Array.isArray(result.userCookiePreferences)) {
            storedPrefs = new Map(result.userCookiePreferences);
        }
        
        // Get existing preferences for this domain or create new ones
        let domainPrefs = storedPrefs.has(originalDomain) 
            ? storedPrefs.get(originalDomain) 
            : { functional: null, performance: null, advertising: null };
        
        // Update only the current category
        domainPrefs[category] = value;
        
        // Update the stored preferences
        storedPrefs.set(originalDomain, domainPrefs);
        
        // Update our local cache
        userPreferences = storedPrefs;
        
        // Save back to storage
        chrome.storage.local.set({
            'userCookiePreferences': Array.from(storedPrefs.entries())
        }, () => {
            console.log(`Preference for ${domain}, category ${category} saved successfully!`);
            console.log('Updated preferences:', domainPrefs);
        });
    } catch (error) {
        console.error('Error saving preference:', error);
    }
}

// Update the domain question display - Fixed to prevent selection inheritance
// Update the domain question display - Fixed to prevent selection inheritance and ensure buttons are visible
// function updateDomainDisplay() {
//     if (allDomains.length === 0) {
//         alert("No domains found. Please try again later.");
//         return;
//     }
    
//     const currentDomain = allDomains[currentDomainIndex];
//     console.log("Displaying domain:", currentDomain.domain, "at index", currentDomainIndex);
    
//     // Create favicon element
//     const faviconContainer = document.createElement('div');
//     faviconContainer.style.display = 'inline-flex';
//     faviconContainer.style.alignItems = 'center';
//     faviconContainer.style.gap = '8px';
    
//     // Favicon image
//     const favicon = document.createElement('img');
//     favicon.src = currentDomain.favicon || `https://www.google.com/s2/favicons?domain=${formatDomainForDisplay(currentDomain.domain)}&sz=32`;
//     favicon.alt = '';
    
//     // Handle favicon loading errors
//     favicon.onerror = function() {
//         this.style.display = 'none'; // Hide if favicon fails to load
//     };
    
//     // Domain name container
//     const domainNameSpan = document.createElement('span');
//     domainNameSpan.textContent = currentDomain.domain;
    
//     // Combine favicon and domain name
//     faviconContainer.appendChild(favicon);
//     faviconContainer.appendChild(domainNameSpan);
    
//     // Update domain name with favicon
//     const currentDomainElement = document.getElementById('currentDomainName');
//     if (currentDomainElement) {
//         currentDomainElement.innerHTML = ''; // Clear existing content
//         currentDomainElement.appendChild(faviconContainer);
//     } else {
//         console.error("Element with ID 'currentDomainName' not found");
//     }
    
//     // Update cookie type text if element exists
//     const currentCookieTypeElement = document.getElementById('currentCookieType');
//     if (currentCookieTypeElement) {
//         currentCookieTypeElement.textContent = currentCookieCategory;
//     }
    
//     // Update progress indicator
//     const currentDomainEl = document.getElementById('currentDomain');
//     if (currentDomainEl) {
//         currentDomainEl.textContent = currentDomainIndex + 1;
//     }
    
//     const progressFill = document.querySelector('.progress-fill');
//     if (progressFill) {
//         const progressPercentage = ((currentDomainIndex + 1) / allDomains.length) * 100;
//         progressFill.style.width = `${progressPercentage}%`;
//     }
    
//     // Update navigation buttons
//     const previousButton = document.getElementById('previousButton');
//     if (previousButton) {
//         previousButton.disabled = currentDomainIndex === 0;
//     }
    
//     // Update toggle buttons
//     const toggleContainer = document.querySelector('#questionView .toggle-container');
//     if (!toggleContainer) {
//         console.error("Toggle container not found");
//         return;
//     }
    
//     toggleContainer.innerHTML = '';
    
//     // Create new toggle buttons
//     const acceptBtn = document.createElement('button');
//     const rejectBtn = document.createElement('button');
    
//     rejectBtn.textContent = 'Reject';
//     acceptBtn.textContent = 'Accept';
    
//     // Set classes and initial styles for buttons
//     rejectBtn.className = 'toggle-btn reject';
//     acceptBtn.className = 'toggle-btn accept';
    
//     // Initial button styles to ensure they are visible (overriding any conflicting CSS)
//     const defaultButtonStyle = {
//         padding: '10px 30px',
//         margin: '0 5px',
//         fontSize: '16px',
//         fontWeight: 'bold',
//         border: 'none',
//         borderRadius: '4px',
//         cursor: 'pointer',
//         backgroundColor: '#f0f0f0',
//         color: '#333'
//     };
    
//     // Apply default styles
//     Object.assign(rejectBtn.style, defaultButtonStyle);
//     Object.assign(acceptBtn.style, defaultButtonStyle);
    
//     // Check if there's a selection for this domain/category already made in the current session
//     let currentSelection = null;
    
//     // First check if domainSelections has been initialized for this domain
//     if (domainSelections[currentDomain.domain] && 
//         typeof domainSelections[currentDomain.domain][currentCookieCategory] !== 'undefined') {
//         currentSelection = domainSelections[currentDomain.domain][currentCookieCategory];
//         console.log(`Found selection for ${currentDomain.domain}/${currentCookieCategory}:`, currentSelection);
//     }
    
//     // Apply selection styling if a choice was previously made
//     if (currentSelection === true) {
//         acceptBtn.style.backgroundColor = '#4c7aaf';
//         acceptBtn.style.color = 'white';
//     } else if (currentSelection === false) {
//         rejectBtn.style.backgroundColor = '#4c7aaf';
//         rejectBtn.style.color = 'white';
//     }
    
//     // Function to handle domain selection
//     const handleSelection = (value) => {
//         console.log(`User selected ${value ? "Accept" : "Reject"} for ${currentDomain.domain} in category ${currentCookieCategory}`);
        
//         // Disable buttons to prevent multiple clicks
//         acceptBtn.disabled = true;
//         rejectBtn.disabled = true;
        
//         // Save the preference
//         savePreference(currentDomain.domain, currentCookieCategory, value);
        
//         // Highlight the selected button
//         if (value === true) {
//             acceptBtn.style.backgroundColor = '#4c7aaf';
//             acceptBtn.style.color = 'white';
//             rejectBtn.style.backgroundColor = '#f0f0f0';
//             rejectBtn.style.color = '#333';
//         } else {
//             rejectBtn.style.backgroundColor = '#4c7aaf';
//             rejectBtn.style.color = 'white';
//             acceptBtn.style.backgroundColor = '#f0f0f0';
//             acceptBtn.style.color = '#333';
//         }
        
//         // Delayed move to next domain
//         setTimeout(() => {
//             if (currentDomainIndex < allDomains.length - 1) {
//                 currentDomainIndex++;
//                 updateDomainDisplay();
//             } else {
//                 // We've reached the end of domains for this category
//                 completeCategory();
//             }
//         }, 500);  // 500ms delay to show the selection
//     };
    
//     // Add click event listeners
//     acceptBtn.addEventListener('click', () => {
//         handleSelection(true);
//     });
    
//     rejectBtn.addEventListener('click', () => {
//         handleSelection(false);
//     });
    
//     // Add buttons to container
//     toggleContainer.appendChild(rejectBtn);
//     toggleContainer.appendChild(acceptBtn);
    
//     console.log("Buttons added to container:", toggleContainer);
// }
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
    } else {
        console.error("Element with ID 'currentDomainName' not found");
    }
    
    // Update cookie type text if element exists
    const currentCookieTypeElement = document.getElementById('currentCookieType');
    if (currentCookieTypeElement) {
        currentCookieTypeElement.textContent = currentCookieCategory;
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
    
    // Define the 5-point willingness scale
    const scaleValues = [
        { value: 1, text: 'Not willing' },
        { value: 2, text: 'Not really willing' },
        { value: 3, text: 'Undecided' },
        { value: 4, text: 'Somewhat willing' },
        { value: 5, text: 'Willing' }
    ];
    
    // Initial button styles to ensure they are visible
    const defaultButtonStyle = {
        padding: '10px 15px',
        margin: '0 3px',
        fontSize: '14px',
        fontWeight: 'bold',
        border: '1px solid #ddd',
        borderRadius: '4px',
        cursor: 'pointer',
        backgroundColor: '#f0f0f0',
        color: '#333',
        textAlign: 'center',
        minWidth: '70px'
    };
    
    // Check if there's a selection for this domain/category already made in the current session
    let currentSelection = null;
    
    // First check if domainSelections has been initialized for this domain
    if (domainSelections[currentDomain.domain] && 
        typeof domainSelections[currentDomain.domain][currentCookieCategory] !== 'undefined') {
        currentSelection = domainSelections[currentDomain.domain][currentCookieCategory];
        console.log(`Found selection for ${currentDomain.domain}/${currentCookieCategory}:`, currentSelection);
    }
    
    // Function to handle domain selection (scale)
    const handleSelection = (value) => {
        console.log(`User selected ${value} for ${currentDomain.domain} in category ${currentCookieCategory}`);

        // Disable all buttons to prevent multiple clicks
        const buttons = toggleContainer.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.disabled = true;
        });
        
        // Save the preference (passing the numeric value)
        savePreference(currentDomain.domain, currentCookieCategory, value);
        
        // Highlight the selected button
        buttons.forEach(btn => {
            if (parseInt(btn.dataset.value) === value) {
                btn.style.backgroundColor = '#4c7aaf';
                btn.style.color = 'white';
                btn.style.borderColor = '#4c7aaf';
            } else {
                btn.style.backgroundColor = '#f0f0f0';
                btn.style.color = '#333';
            }
        });
        
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
    
    // Create buttons for each scale point
    scaleValues.forEach(item => {
        const button = document.createElement('button');
        button.textContent = item.text;
        button.className = 'scale-btn';
        button.dataset.value = item.value;
        
        // Apply styles
        Object.assign(button.style, defaultButtonStyle);
        
        // Apply selection styling if a choice was previously made
        if (currentSelection === item.value) {
            button.style.backgroundColor = '#4c7aaf';
            button.style.color = 'white';
            button.style.borderColor = '#4c7aaf';
        }
        
        // Add click event
        button.addEventListener('click', () => {
            handleSelection(item.value);
        });
        
        // Add to container
        toggleContainer.appendChild(button);
    });
    
    console.log("Scale buttons added to container:", toggleContainer);
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
    
    console.log(`Completed category: ${currentCookieCategory}`);
    
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