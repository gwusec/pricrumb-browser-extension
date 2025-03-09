// Script for displaying websites based on cookie preferences (single category per page)

document.addEventListener('DOMContentLoaded', () => {
    // Initialize view
    document.getElementById('loadingView').style.display = 'block';
    document.getElementById('websitesView').style.display = 'none';
    
    // Check which category container exists in the HTML to determine the category
    let categoryType = 'unknown';
    if (document.getElementById('category1')) {
        categoryType = 'accept-all';
    } else if (document.getElementById('category2')) {
        categoryType = 'reject-all';
    } else if (document.getElementById('category3')) {
        categoryType = 'mixed';
    }
    
    console.log('Detected category type based on HTML container:', categoryType);
    
    // Override with window.categoryType if it exists
    if (window.categoryType) {
        console.log('Found window.categoryType:', window.categoryType);
        categoryType = window.categoryType;
    }
    
    console.log('Using category type:', categoryType);
    
    // Store the final category type for later use
    window.finalCategoryType = categoryType;
    
    // Load data and display selected websites
    loadCookieDataAndSelectWebsites();
});

// Main function to load cookie data and select websites
async function loadCookieDataAndSelectWebsites() {
    try {
        // Load only cookie data
        const cookieData = await getCookieData();
        
        console.log('Loaded cookie data:', cookieData?.length || 0);
        
        // Check if we have data
        if (!cookieData || cookieData.length === 0) {
            showError('Missing cookie data. Please visit the Cookie Checker first.');
            return;
        }
        
        // Find websites matching our criteria using only cookie data
        const matchingWebsites = findMatchingWebsites(cookieData);
        
        // Use the category type determined at page load
        const categoryType = window.finalCategoryType || 'accept-all';
        console.log('Displaying category (final):', categoryType);
        
        // Display the selected website based on the category type
        displayWebsite(matchingWebsites, categoryType);
        
    } catch (error) {
        console.error('Error in loadCookieDataAndSelectWebsites:', error);
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

// Show error message
function showError(message) {
    const loadingView = document.getElementById('loadingView');
    loadingView.innerHTML = `<p class="error">${message}</p><button id="backToMain" class="button">Back to Main</button>`;
    
    document.getElementById('backToMain').addEventListener('click', () => {
        window.location.href = 'popup.html';
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

// Find websites matching each criteria based only on cookie data
function findMatchingWebsites(cookieData) {
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
    return {
        category1: category1.length > 0 ? category1[Math.floor(Math.random() * category1.length)] : null,
        category2: category2.length > 0 ? category2[Math.floor(Math.random() * category2.length)] : null,
        category3: category3.length > 0 ? category3[Math.floor(Math.random() * category3.length)] : null
    };
}

// Display the selected website based on category type
function displayWebsite(websites, categoryType) {
    // Hide loading view and show websites view
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('websitesView').style.display = 'block';
    
    let website = null;
    let containerId = null;
    
    // Determine which website and container to use based on category type
    switch (categoryType) {
        case 'accept-all':
            website = websites.category1;
            containerId = 'category1';
            break;
        case 'reject-all':
            website = websites.category2;
            containerId = 'category2';
            break;
        case 'mixed':
            website = websites.category3;
            containerId = 'category3';
            break;
        default:
            console.error('Unknown category type:', categoryType);
            return;
    }
    
    console.log('Looking for container:', containerId);
    console.log('Website for this category:', website ? website.domain : 'None found');
    
    // Get the container for the category
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Container with ID ${containerId} not found`);
        
        // Fallback: Try to find any section container
        const fallbackContainer = document.querySelector('#websitesView .section');
        if (fallbackContainer) {
            console.log('Using fallback container instead');
            
            // Clear previous content
            fallbackContainer.innerHTML = '';
            
            // Show error message in the fallback container
            if (website) {
                fallbackContainer.innerHTML = `
                    <div class="error">Container mismatch: Looking for #${containerId} but not found. 
                    Website for ${categoryType} is ${website.domain}</div>
                `;
                renderWebsite(website, fallbackContainer, categoryType);
            } else {
                fallbackContainer.innerHTML = '<p class="no-data">No website found for this category and container not found.</p>';
            }
        }
        return;
    }
    
    // Clear previous content
    container.innerHTML = '';
    
    // If we don't have any website to show, display a message
    if (!website) {
        container.innerHTML = '<p class="no-data">No website found that matches this category.</p>';
        return;
    }
    
    // Render the website
    renderWebsite(website, container, categoryType);
}

// Render an individual website card
function renderWebsite(website, container, categoryClass) {
    const websiteCard = document.createElement('div');
    websiteCard.className = `website-card ${categoryClass}`;
    
    // Create HTML for the website - showing only the domain name
    websiteCard.innerHTML = `
        <div class="website-header">
            <img src="${website.favicon}" alt="Favicon" class="favicon" onerror="this.style.display='none'">
            <h3>${website.domain}</h3>
        </div>
    `;
    
    container.appendChild(websiteCard);
}