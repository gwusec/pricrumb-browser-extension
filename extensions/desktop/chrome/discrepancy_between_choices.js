// Compare user's stated preferences (from Option 1) with their actual browsing history data

document.addEventListener('DOMContentLoaded', () => {
    // Initialize view
    document.getElementById('loadingView').style.display = 'block';
    document.getElementById('websiteView').style.display = 'none';
    
    // Load data and display comparison
    findPreferenceDiscrepancies();
    
    // Set up event listener for back button
    document.getElementById('backButton').addEventListener('click', () => {
        window.location.href = 'popup.html';
    });
});

// Main function to find websites with preference discrepancies
async function findPreferenceDiscrepancies() {
    try {
        // Load both cookie data and user's stated preferences
        const [cookieData, userPreferences] = await Promise.all([
            getCookieData(),
            getUserPreferences()
        ]);
        
        console.log('Loaded cookie data:', cookieData?.length || 0);
        console.log('Loaded user preferences:', userPreferences?.size || 0);
        
        // Check if we have both data sources
        if (!cookieData || !userPreferences || userPreferences.size === 0) {
            showError('Missing data. Please visit the Cookie Checker first and set your preferences in Option 1.');
            return;
        }
        
        // Find websites with discrepancies
        const discrepancies = findDiscrepancyWebsites(cookieData, userPreferences);
        
        // Display the discrepancy
        if (discrepancies.length > 0) {
            // Choose one random discrepancy to display
            const selectedDiscrepancy = discrepancies[Math.floor(Math.random() * discrepancies.length)];
            displayDiscrepancy(selectedDiscrepancy);
        } else {
            showNoDiscrepanciesMessage();
        }
        
    } catch (error) {
        console.error('Error finding preference discrepancies:', error);
        showError('An error occurred while analyzing your preferences: ' + error.message);
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

// Get user preferences from storage (these are the choices made in Option 1)
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

// Show no discrepancies message
function showNoDiscrepanciesMessage() {
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('websiteView').style.display = 'block';
    
    const discrepancyContainer = document.getElementById('discrepancyContainer');
    discrepancyContainer.innerHTML = `
        <div class="no-discrepancy">
            <p>No discrepancies found between your stated preferences and actual website cookie settings.</p>
            <p>This means your cookie choices in Option 1 match what's in your browsing history.</p>
        </div>
    `;
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

// Find websites with discrepancies between stated and actual preferences
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
                matchedDomain: matchedDomain
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

// Display the discrepancy
function displayDiscrepancy(discrepancy) {
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('websiteView').style.display = 'block';
    
    const discrepancyContainer = document.getElementById('discrepancyContainer');
    
    // Format visit data
    const lastVisit = discrepancy.cookie.lastVisited 
        ? new Date(discrepancy.cookie.lastVisited).toLocaleDateString() 
        : 'Unknown';
    const visitCount = discrepancy.cookie.totalVisitCount || 'Unknown';
    
    // Create table rows for comparison
    const tableRows = [
        createComparisonRow('Functional', discrepancy.statedPreferences.functional, discrepancy.actualPreferences.functional),
        createComparisonRow('Performance', discrepancy.statedPreferences.performance, discrepancy.actualPreferences.performance),
        createComparisonRow('Advertising', discrepancy.statedPreferences.advertising, discrepancy.actualPreferences.advertising)
    ].join('');
    
    discrepancyContainer.innerHTML = `
        <div class="discrepancy-card">
            <div class="website-header">
                <img src="${discrepancy.favicon}" alt="Favicon" class="favicon" onerror="this.style.display='none'">
                <h3>${discrepancy.domain}</h3>
            </div>
            <div class="discrepancy-explanation">
      
                <table class="comparison-table">
                    <thead>
                        <tr>
                            <th>Cookie Type</th>
                            <th>Your Choice in Option 1</th>
                            <th>Actual Setting</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// Create a comparison table row
function createComparisonRow(cookieType, statedValue, actualValue) {
    const statedClass = statedValue ? 'accepted' : 'rejected';
    const actualClass = actualValue ? 'accepted' : 'rejected';
    const isDifferent = statedValue !== actualValue ? 'different' : '';
    
    return `
        <tr class="${isDifferent}">
            <td>${cookieType}</td>
            <td class="${statedClass}">${statedValue ? 'Accepted' : 'Rejected'}</td>
            <td class="${actualClass}">${actualValue ? 'Accepted' : 'Rejected'}</td>
        </tr>
    `;
}
