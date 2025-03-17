//We want to make correaltions between the factors and users choices
//we are choosing 3 websites from usrs' history; where they interacted with the cookies (actionTaken=yes) and we will choose 3 categories:
//First websites: Users' choices were Accept, Accept, Accept
//Second websites: Users' choices were Reject, Reject, Reject
//Third websites: Users' choices were Accept, Accept, Reject


//We are only showing the domain / website name ,and aaksing users specific questions about it (without showing them thier options)

document.addEventListener('DOMContentLoaded', () => {
    // Initialize view
    document.getElementById('loadingView').style.display = 'block';
    document.getElementById('websitesView').style.display = 'none';
    
    // Load data and display selected websites
    loadUserDataAndSelectWebsites();
    
    // Set up event listener for back button
    document.getElementById('backButton').addEventListener('click', () => {
        window.location.href = 'popup.html';
    });
});

// Main function to load user data and select websites
async function loadUserDataAndSelectWebsites() {
    try {
        // Load both cookie data and user preferences
        const [cookieData, userPreferences] = await Promise.all([
            getCookieData(),
            getUserPreferences()
        ]);
        
        console.log('Loaded cookie data:', cookieData);
        console.log('Loaded user preferences:', userPreferences);
        
        // Check if we have both data sources
        if (!cookieData || !userPreferences) {
            showError('Missing data. Please visit the Cookie Checker and set your preferences first.');
            return;
        }
        
        // Find websites matching our criteria
        const matchingWebsites = findMatchingWebsites(cookieData, userPreferences);
        
        // Display the websites
        displayWebsites(matchingWebsites);
        
    } catch (error) {
        console.error('Error in loadUserDataAndSelectWebsites:', error);
        showError('An error occurred while loading data: ' + error.message);
    }
}

// Get cookie data from storage
async function getCookieData() {
    return new Promise((resolve) => {
        chrome.storage.local.get('cookieData', (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error retrieving cookie data:', chrome.runtime.lastError);
                resolve(null);
            } else {
                resolve(result.cookieData || []);
            }
        });
    });
}

// Get user preferences from storage
async function getUserPreferences() {
    return new Promise((resolve) => {
        chrome.storage.local.get('userCookiePreferences', (result) => {
            if (chrome.runtime.lastError) {
                console.error('Error retrieving user preferences:', chrome.runtime.lastError);
                resolve(null);
            } else {
                // Convert array back to Map if it exists
                if (result.userCookiePreferences) {
                    resolve(new Map(result.userCookiePreferences));
                } else {
                    resolve(new Map());
                }
            }
        });
    });
}

// Show error message
function showError(message) {
    const loadingView = document.getElementById('loadingView');
    loadingView.innerHTML = `<p class="error">${message}</p><button id="backToMain" class="button">Back to Main</button>`;
    
    document.getElementById('backToMain').addEventListener('click', () => {
        window.location.href = 'popup.html';
    });
}

// Format domain for better display (consistent with prefered_choices1.js)
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

// Find websites matching each criteria
function findMatchingWebsites(cookieData, userPreferences) {
    console.log('All cookies count:', cookieData.length);
    
    // STEP 1: Filter for cookies where actionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Cookies with action taken:', actionTakenCookies.length);
    
    // STEP 2: Create an array of all domains with their preferences
    const allDomains = [];
    
    // For each cookie with actionTaken = "Yes", extract its preferences
    for (const cookie of actionTakenCookies) {
        if (!cookie.domain) continue;
        
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        let preferences = null;
        
        // First try to get preferences directly from the cookie
        if (cookie.categories && typeof cookie.categories === 'object') {
            // Categories directly from the cookie object (nested object)
            preferences = {
                functional: cookie.categories.functional === true,
                performance: cookie.categories.performance === true,
                advertising: cookie.categories.advertising === true
            };
            console.log(`Found preferences from cookie.categories for ${formattedDomain}:`, preferences);
        } 
        // Then try to get from direct column values in table
        else if ('functional' in cookie && 'performance' in cookie && 'advertising' in cookie) {
            // Direct column values from the table (string values like "Yes" or "No")
            preferences = {
                functional: cookie.functional === "Yes" || cookie.functional === true,
                performance: cookie.performance === "Yes" || cookie.performance === true,
                advertising: cookie.advertising === "Yes" || cookie.advertising === true
            };
            console.log(`Found preferences from table columns for ${formattedDomain}:`, preferences);
        }
        
        // If we've got preferences, add this domain to our list
        if (preferences && 
            preferences.functional !== undefined && 
            preferences.performance !== undefined && 
            preferences.advertising !== undefined) {
            
            allDomains.push({
                domain: formattedDomain,
                originalDomain: cookie.domain,
                favicon: `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`,
                preferences: preferences,
                cookie: cookie
            });
            
            console.log(`Added ${formattedDomain} to allDomains`);
        } else {
            console.log(`Skipping ${formattedDomain} - could not determine complete preferences`);
        }
    }
    
    console.log('Total domains with preferences:', allDomains.length);
    
    // STEP 3: Categorize domains based on preferences (ignoring 'necessary')
    const category1 = []; // Accept, Accept, Accept
    const category2 = []; // Reject, Reject, Reject
    const category3 = []; // Accept, Accept, Reject
    
    for (const domain of allDomains) {
        const p = domain.preferences;
        
        if (p.functional === true && p.performance === true && p.advertising === true) {
            category1.push(domain);
            console.log(`Added ${domain.domain} to category 1 (Accept all)`);
        } else if (p.functional === false && p.performance === false && p.advertising === false) {
            category2.push(domain);
            console.log(`Added ${domain.domain} to category 2 (Reject all)`);
        } else if (p.functional === true && p.performance === true && p.advertising === false) {
            category3.push(domain);
            console.log(`Added ${domain.domain} to category 3 (Accept, Accept, Reject)`);
        } else {
            console.log(`Domain ${domain.domain} with preferences doesn't match any target category`, p);
        }
    }
    
    console.log('Category 1 (Accept all):', category1.map(d => d.domain));
    console.log('Category 2 (Reject all):', category2.map(d => d.domain));
    console.log('Category 3 (Accept, Accept, Reject):', category3.map(d => d.domain));
    
    // STEP 4: Select one random website from each category
    const selections = {
        category1: category1.length > 0 ? category1[Math.floor(Math.random() * category1.length)] : null,
        category2: category2.length > 0 ? category2[Math.floor(Math.random() * category2.length)] : null,
        category3: category3.length > 0 ? category3[Math.floor(Math.random() * category3.length)] : null
    };
    
    console.log('Selected websites:', {
        category1: selections.category1 ? selections.category1.domain : "None found",
        category2: selections.category2 ? selections.category2.domain : "None found",
        category3: selections.category3 ? selections.category3.domain : "None found"
    });
    
    return selections;
}

// Display the selected websites
function displayWebsites(websites) {
    // Hide loading view and show websites view
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('websitesView').style.display = 'block';
    
    // Get containers for each category
    const category1Container = document.getElementById('category1');
    const category2Container = document.getElementById('category2');
    const category3Container = document.getElementById('category3');
    
    // Clear previous content
    category1Container.innerHTML = '';
    category2Container.innerHTML = '';
    category3Container.innerHTML = '';
    
    // If we don't have any websites to show, display a message and return
    if (!websites.category1 && !websites.category2 && !websites.category3) {
        const message = document.createElement('div');
        message.className = 'no-data';
        message.textContent = 'No websites found with cookie preferences matching our criteria. Please visit more websites and set your cookie preferences.';
        document.getElementById('websitesView').insertBefore(message, document.getElementById('backButton'));
    }
    
    // Display website for category 1 (Accept all)
    if (websites.category1) {
        renderWebsite(websites.category1, category1Container, 'accept-all');
    } else {
        category1Container.innerHTML = '<p class="no-data">No website found that matches this category.</p>';
    }
    
    // Display website for category 2 (Reject all)
    if (websites.category2) {
        renderWebsite(websites.category2, category2Container, 'reject-all');
    } else {
        category2Container.innerHTML = '<p class="no-data">No website found that matches this category.</p>';
    }
    
    // Display website for category 3 (Accept, Accept, Reject)
    if (websites.category3) {
        renderWebsite(websites.category3, category3Container, 'mixed');
    } else {
        category3Container.innerHTML = '<p class="no-data">No website found that matches this category.</p>';
    }
}

// Render an individual website card
function renderWebsite(website, container, categoryClass) {
    const websiteCard = document.createElement('div');
    websiteCard.className = `website-card ${categoryClass}`;
    
    // // Format visit data
    // const lastVisit = website.cookie.lastVisited ? new Date(website.cookie.lastVisited).toLocaleDateString() : 'Unknown';
    // const visitCount = website.cookie.totalVisitCount || 'Unknown';
    
    // Create HTML for the website - showing only the domain name 
    websiteCard.innerHTML = `
        <div class="website-header">
            <img src="${website.favicon}" alt="Favicon" class="favicon" onerror="this.style.display='none'">
            <h3>${website.domain}</h3>
    `;
    
    container.appendChild(websiteCard);
}
