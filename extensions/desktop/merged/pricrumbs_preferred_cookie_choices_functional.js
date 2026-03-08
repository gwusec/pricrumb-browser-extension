
// Store user preferences and domain data
let userPreferences = new Map();
let allDomains = [];
let currentDomainIndex = 0;
let currentCookieCategory = 'functional';
let domainSelections = {}; // Track current session selections that haven't been saved yet

const EMBED_ELEMENT_ID = 'pricrumbs_preferred_cookie_choices_functional';
let lastEmbedHeight = 0;
let embedHeightPostPending = false;

function getEmbedContentHeight() {
    const root = document.querySelector('.container') || document.body;
    if (!root) return 0;

    const rectHeight = root.getBoundingClientRect ? root.getBoundingClientRect().height : 0;
    const scrollHeight = root.scrollHeight || 0;
    const offsetHeight = root.offsetHeight || 0;

    return Math.ceil(Math.max(rectHeight, scrollHeight, offsetHeight));
}

function postEmbedHeight() {
    const nextHeight = getEmbedContentHeight();
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    if (Math.abs(nextHeight - lastEmbedHeight) < 1) return;

    lastEmbedHeight = nextHeight;
    window.parent.postMessage(
        {
            type: 'PRICRUMBS_EMBED_HEIGHT',
            payload: { elementId: EMBED_ELEMENT_ID, height: nextHeight }
        },
        '*'
    );
}

function scheduleEmbedHeightPost() {
    if (embedHeightPostPending) return;
    embedHeightPostPending = true;

    requestAnimationFrame(() => {
        embedHeightPostPending = false;
        postEmbedHeight();
    });

    setTimeout(postEmbedHeight, 150);
}

function setupEmbedAutoHeight() {
    scheduleEmbedHeightPost();
    window.addEventListener('load', scheduleEmbedHeightPost);

    const root = document.querySelector('.container') || document.body;
    if (!root) return;

    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(scheduleEmbedHeightPost);
        resizeObserver.observe(root);
    }

    const mutationObserver = new MutationObserver(scheduleEmbedHeightPost);
    mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
    });
}
// Remove the check for window.cookieCategory since we're hardcoding it
document.addEventListener('DOMContentLoaded', () => {
    console.log("Extra Functionality Cookies page loaded with category:", currentCookieCategory);
    
    loadCookies();
    loadSavedPreferences();
    
    // Set up navigation listeners
    const previousButton = document.getElementById('previousButton');
    if (previousButton) {
        previousButton.addEventListener('click', showPreviousDomain);
    }

    setupEmbedAutoHeight();
});

// Load saved user preferences
async function loadSavedPreferences() {
    try {
        const result = await ext.storage.local.get("userCookiePreferences");
        if (result && result.userCookiePreferences && Array.isArray(result.userCookiePreferences)) {
            userPreferences = new Map(result.userCookiePreferences);
            console.log("Loaded saved preferences:", userPreferences);
        } else {
            console.log("No saved preferences found. Starting fresh.");
        }
    } catch (error) {
        console.error("Error loading saved preferences:", error);
    }
}


function shuffleArray(array) {
    // Create a copy of the array to avoid modifying the original
    const shuffled = [...array];
    
    // Fisher-Yates shuffle algorithm
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Swap elements
    }
    
    return shuffled;
}
//new function to avoid dupliacate websites
// Extract the main domain name for comparison (e.g., "zoom" from "www.zoom.com" or "www.zoom.us")
function extractMainDomainName(domain) {
    if (!domain) return '';
    
    // Remove www. prefix
    let cleaned = domain.replace(/^www\./, '');
    
    // Split by dots and get the main part (before TLD)
    const parts = cleaned.split('.');
    
    // Return the main domain name (second-to-last part before TLD)
    // For "zoom.com" or "zoom.us", this returns "zoom"
    // For "stackoverflow.com", this returns "stackoverflow"
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : cleaned.toLowerCase();
}

async function loadCookies() {
    try {
        const result = await ext.storage.local.get("cookieData");
        const cookies = (result && result.cookieData) ? result.cookieData:[];   // ensure we always get an array
        console.log("Retrieved cookie data:", cookies);

        if (cookies.length > 0) {
            // Log how many had actionTaken = yes
            const actionTakenCount = cookies.filter(c =>
                c.actionTaken && c.actionTaken.toLowerCase() === "yes"
            ).length;
            console.log(`Found ${actionTakenCount} cookies with action taken = yes`);

            const { mostRecentDomains, leastRecentDomains } = getRecentActionDomains(cookies);
            console.log("Most recent domains:", mostRecentDomains);
            console.log("Least recent domains:", leastRecentDomains);

            // Add favicons
            mostRecentDomains.forEach(d => {
                d.favicon = `https://icons.duckduckgo.com/ip3/${formatDomainForDisplay(d.domain)}.ico`;
            });
            leastRecentDomains.forEach(d => {
                d.favicon = `https://icons.duckduckgo.com/ip3/${formatDomainForDisplay(d.domain)}.ico`;
            });

            // Combine and randomize
            allDomains = shuffleArray([...mostRecentDomains, ...leastRecentDomains]);
            console.log("Domains after randomization:", allDomains.map(d => d.domain));


            // Check if domains were already selected in another preference page
            const existingDomainsResult = await ext.storage.local.get('selectedDomainsForHistory');

            if (!existingDomainsResult || !existingDomainsResult.selectedDomainsForHistory || 
                existingDomainsResult.selectedDomainsForHistory.length === 0) {
                
                // Only save if not already saved (first preference page visited)
                const domainsForHistory = allDomains.map(d => ({
                    domain: d.domain,
                    originalDomain: d.originalDomain,
                    totalVisitCount: d.totalVisitCount,
                    lastVisited: d.lastVisited,
                    categories: d.categories,
                    expiration: d.expiration,
                    actionTaken: d.actionTaken
                }));
                
                await ext.storage.local.set({
                    selectedDomainsForHistory: domainsForHistory
                });
                console.log("Saved selected domains for consent history (first time):", domainsForHistory);
            } else {
                // Use the existing saved domains instead of generating new ones
                // But shuffle them so each page shows them in a different random order
                allDomains = shuffleArray(existingDomainsResult.selectedDomainsForHistory);
                console.log("Replaced allDomains with saved domains (shuffled for this page)");
            }


            // Hide loading, show questions
            const loadingEl = document.getElementById("loading");
            if (loadingEl) loadingEl.style.display = "none";
            const questionView = document.getElementById("questionView");
            if (questionView) questionView.style.display = "block";

            // Update counter
            const totalDomainsEl = document.getElementById("totalDomains");
            if (totalDomainsEl) totalDomainsEl.textContent = allDomains.length;

            initializeSelectionTracking();
            updateDomainDisplay();
        } else {
            const loadingEl = document.getElementById("loading");
            if (loadingEl) {
                loadingEl.textContent = "No cookie data found. Please visit the Cookie Checker first.";
            }
        }
    } catch (error) {
        console.error("Error loading cookies:", error);
        const loadingEl = document.getElementById("loading");
        if (loadingEl) loadingEl.textContent = "Error loading cookie data.";
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
    
    // Track seen main domain names to ensure uniqueness
    const seenMainDomains = new Set();
    
    // Get EXACTLY 5 unique most frequently visited domains
    const mostFrequentDomains = [];
    for (const cookie of sortedByFrequency) {
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const mainName = extractMainDomainName(formattedDomain);
        
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            mostFrequentDomains.push({
                domain: formattedDomain,
                originalDomain: cookie.domain,
                lastVisited: cookie.lastVisited,
                categories: cookie.categories,
                totalVisitCount: cookie.totalVisitCount,
                expiration: cookie.expiration,
                actionTaken: cookie.actionTaken || "Yes"  // Include for discrepancy detection
            });
            
            if (mostFrequentDomains.length === 5) break;
        }
    }
    
    // Get EXACTLY 5 unique least frequently visited domains
    const domainsWithVisits = cookiesToProcess.filter(cookie => 
        parseInt(cookie.totalVisitCount) > 0
    );
    
    const sortedAscending = [...domainsWithVisits].sort((a, b) => {
        const visitsA = parseInt(a.totalVisitCount) || 0;
        const visitsB = parseInt(b.totalVisitCount) || 0;
        return visitsA - visitsB;
    });
    
    const leastFrequentDomains = [];
    for (const cookie of sortedAscending) {
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const mainName = extractMainDomainName(formattedDomain);
        
        if (!seenMainDomains.has(mainName)) {
            seenMainDomains.add(mainName);
            leastFrequentDomains.push({
                domain: formattedDomain,
                originalDomain: cookie.domain,
                lastVisited: cookie.lastVisited,
                categories: cookie.categories,
                totalVisitCount: cookie.totalVisitCount,
                expiration: cookie.expiration,
                actionTaken: cookie.actionTaken || "Yes"  // Include for discrepancy detection
            });
            
            if (leastFrequentDomains.length === 5) break;
        }
    }
    
    console.log(`Selected ${mostFrequentDomains.length} unique most frequent domains`);
    console.log(`Selected ${leastFrequentDomains.length} unique least frequent domains`);
    
    return { 
        mostRecentDomains: mostFrequentDomains, 
        leastRecentDomains: leastFrequentDomains 
    };
}

// Save preference for a domain and category
async function savePreference(domain, category, value) {
    console.log(`Saving preference for domain ${domain}, category ${category}: ${value}`);

    // Make sure the domain exists in our tracking object
    if (!domainSelections[domain]) {
        domainSelections[domain] = {};
    }

    // Save the selection for this specific domain and category only
    domainSelections[domain][category] = value;

    // Find the original domain format if needed
    const domainObject = allDomains.find(d => d.domain === domain);
    let originalDomain = domainObject?.originalDomain || domain;

    // Use original domain if available, otherwise adjust "www." vs leading dot
    if (!domainObject && domain.startsWith("www.")) {
        const domainWithoutWWW = domain.substring(4);
        const domainWithDot = "." + domainWithoutWWW;

        if (userPreferences.has(domainWithDot)) {
            originalDomain = domainWithDot;
        } else if (userPreferences.has(domainWithoutWWW)) {
            originalDomain = domainWithoutWWW;
        }
    }

    console.log(`Using storage key ${originalDomain} for domain ${domain}`);

    // Get latest preferences from storage to ensure we have the most up-to-date data
    try {
        const result = await ext.storage.local.get("userCookiePreferences");
        let storedPrefs = new Map(
            result.userCookiePreferences && Array.isArray(result.userCookiePreferences)
                ? result.userCookiePreferences
                : []
        );

        // Get existing preferences for this domain or create new ones
        let domainPrefs = storedPrefs.get(originalDomain) || {
            functional: null,
            performance: null,
            advertising: null
        };

        // Update only the current category
        domainPrefs[category] = value;

        // Update the stored preferences
        storedPrefs.set(originalDomain, domainPrefs);

        // Update our local cache
        userPreferences = storedPrefs;

        // Save back to storage
        await ext.storage.local.set({
            userCookiePreferences: Array.from(storedPrefs.entries())
        });

        console.log(`Preference for ${domain}, category ${category} saved successfully!`);
        console.log("Updated preferences:", domainPrefs);
    } catch (error) {
        console.error("Error saving preference:", error);
    }
}

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
    faviconContainer.style.gap = '12px';
    
    // Favicon image
    const favicon = document.createElement('img');
    favicon.src = currentDomain.favicon || `https://icons.duckduckgo.com/ip3/${formatDomainForDisplay(currentDomain.domain)}.ico`;
    favicon.alt = '';
    favicon.style.width = '24px';
    favicon.style.height = '24px';
    
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
        { value: 1, text: '1 - I strongly prefer this website NOT use Extra Functionality Cookies' },
        { value: 2, text: '2 - I prefer this website NOT use Extra Functionality Cookies' },
        { value: 3, text: '3 - I have no preference' },
        { value: 4, text: '4 - I prefer this website TO use Extra Functionality Cookies' },
        { value: 5, text: '5 - I strongly prefer this website TO use Extra Functionality Cookies' }
    ];
    
    // Initial button styles to ensure they are visible
    const defaultButtonStyle = {
        padding: '10px 15px',
        margin: '0',
        fontSize: '18px',
        fontWeight: 'bold',
        border: '1px solid #ddd',
        borderRadius: '4px',
        cursor: 'pointer',
        backgroundColor: '#f0f0f0',
        color: '#333',
        textAlign: 'center',
        width: '100%',
        maxWidth: '500px'
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
async function saveAllPreferences() {
    // Ensure we save the latest preferences
    try {
        await ext.storage.local.set({
            userCookiePreferences: Array.from(userPreferences.entries())
        });
        console.log("All preferences saved successfully");
    } catch (error) {
        console.error("Error saving all preferences:", error);
    }
}


