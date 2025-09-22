// Store user preferences and websites with discrepancies
let userPreferences = new Map();
let websitesWithDiscrepancies = []; // Array to store all domains with discrepancies

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM content loaded, starting preference loading...');
    loadSavedPreferences();
});

async function loadSavedPreferences() {
    try {
        const result = await ext.storage.local.get('userCookiePreferences');
        if (result.userCookiePreferences) {
            // Try to handle both old and new format of preferences
            if (Array.isArray(result.userCookiePreferences)) {
                // This is likely the new format (Map serialized to array)
                userPreferences = new Map(result.userCookiePreferences);
                console.log('Loaded saved preferences (new format):', userPreferences);
            } else if (typeof result.userCookiePreferences === 'object') {
                // This might be the old format (array of objects with domain and preferences)
                // Convert it to the Map format expected by the current code
                userPreferences = new Map();
                if (Array.isArray(result.userCookiePreferences)) {
                    result.userCookiePreferences.forEach(item => {
                        if (item.domain && item.preferences) {
                            userPreferences.set(item.domain, item.preferences);
                        }
                    });
                }
                console.log('Loaded saved preferences (old format, converted):', userPreferences);
            }
            
            // Debug: Print the contents of userPreferences
            console.log('User preferences map contents:');
            userPreferences.forEach((prefs, domain) => {
                console.log(`Domain: ${domain}`, prefs);
            });
        } else {
            console.warn('No user preferences found in storage');
            userPreferences = new Map(); // Initialize with empty Map
            console.log('No saved preferences found. Continuing without discrepancy detection.');
        }
        
        // Always proceed to load cookies regardless of whether preferences exist
        loadCookiesAndFindDiscrepancies();
    } catch (error) {
        console.error('Error loading saved preferences:', error);
        // Still try to load cookies even if there was an error with preferences
        loadCookiesAndFindDiscrepancies();
    }
}

async function loadCookiesAndFindDiscrepancies() {
    try {
        // Load cookie data
        const result = await ext.storage.local.get('cookieData');
        const cookies = result.cookieData || [];  // Always fallback to empty array
        console.log('Retrieved cookie data:', cookies);

        if (cookies.length > 0) {
            // Check if we have user preferences to compare against
            if (userPreferences && userPreferences.size > 0) {
                // Find domains with discrepancies if we have user preferences
                websitesWithDiscrepancies = findDiscrepancyWebsites(cookies, userPreferences);
                console.log('Websites with discrepancies found:', websitesWithDiscrepancies.length);
                console.log('Discrepancy details:', websitesWithDiscrepancies);
            } else {
                // No user preferences, so no discrepancies
                websitesWithDiscrepancies = [];
                console.log('No user preferences found, skipping discrepancy detection');
            }
            
            // Then process the cookie data for display
            const { mostRecentDomains, leastRecentDomains } = processStoredCookieData(cookies);
            
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
// function findDiscrepancyWebsites(cookieData, userPreferences) {
//     const discrepancies = [];
    
//     // Skip if no user preferences exist
//     if (!userPreferences || userPreferences.size === 0) {
//         console.warn('No user preferences found when checking for discrepancies');
//         return discrepancies;
//     }
    
//     console.log('Starting discrepancy detection...');
//     console.log('Total cookies to check:', cookieData.length);
//     console.log('Total user preferences:', userPreferences.size);
    
//     // Process each cookie with ActionTaken = "Yes"
//     const actionTakenCookies = cookieData.filter(cookie => 
//         cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
//     );
    
//     console.log('Cookies with action taken:', actionTakenCookies.length);
    
//     // Debug: Log all user preference domains for easier comparison
//     const allPreferenceDomains = Array.from(userPreferences.keys());
//     console.log('All preference domains:', allPreferenceDomains);
    
//     // For each cookie, check if user has stated a different preference
//     for (const cookie of actionTakenCookies) {
//         if (!cookie.domain) {
//             console.log('Skipping cookie without domain');
//             continue;
//         }
        
//         const formattedDomain = formatDomainForDisplay(cookie.domain);
//         const originalDomain = cookie.domain;
        
//         console.log(`\nChecking cookie for domain: ${cookie.domain} (formatted: ${formattedDomain})`);
        
//         // Try to extract actual preferences from the cookie
//         let actualPreferences = {
//             functional: false,
//             performance: false,
//             advertising: false
//         };
        
//         // First try from cookie.categories
//         if (cookie.categories && typeof cookie.categories === 'object') {
//             actualPreferences = {
//                 functional: cookie.categories.functional === true,
//                 performance: cookie.categories.performance === true,
//                 advertising: cookie.categories.advertising === true
//             };
//             console.log('Extracted preferences from categories:', actualPreferences);
//         } 
//         // Then try from direct columns 
//         else if ('functional' in cookie || 'performance' in cookie || 'advertising' in cookie) {
//             // Handle each category separately to avoid undefined errors
//             if ('functional' in cookie) {
//                 actualPreferences.functional = cookie.functional === "Yes" || cookie.functional === true;
//             }
//             if ('performance' in cookie) {
//                 actualPreferences.performance = cookie.performance === "Yes" || cookie.performance === true;
//             }
//             if ('advertising' in cookie) {
//                 actualPreferences.advertising = cookie.advertising === "Yes" || cookie.advertising === true;
//             }
//             console.log('Extracted preferences from direct columns:', actualPreferences);
//         }
        
//         // Find matching domain in user preferences
//         let statedPreferences = null;
//         let matchedDomain = null;
        
//         // Try different domain formats to match with preferences
//         const possibleFormats = [
//             originalDomain,
//             originalDomain.startsWith('.') ? originalDomain.substring(1) : null,
//             !originalDomain.startsWith('.') ? '.' + originalDomain : null,
//             formattedDomain,
//             formattedDomain.startsWith('www.') ? formattedDomain.substring(4) : null,
//             !formattedDomain.startsWith('www.') ? 'www.' + formattedDomain : null
//         ].filter(Boolean);
        
//         console.log('Checking possible domain formats:', possibleFormats);
        
//         // Try each possible format
//         for (const format of possibleFormats) {
//             if (userPreferences.has(format)) {
//                 const prefs = userPreferences.get(format);
//                 console.log(`Found match for domain format: ${format}`, prefs);
                
//                 // Check for at least one set preference
//                 if (prefs && (prefs.functional !== null || 
//                     prefs.performance !== null || 
//                     prefs.advertising !== null)) {
                    
//                     // Make a copy with default values for any null preferences
//                     statedPreferences = {
//                         functional: prefs.functional !== null ? prefs.functional : false,
//                         performance: prefs.performance !== null ? prefs.performance : false,
//                         advertising: prefs.advertising !== null ? prefs.advertising : false
//                     };
                    
//                     matchedDomain = format;
//                     console.log(`Using preferences for domain: ${matchedDomain}`, statedPreferences);
//                     break;
//                 } else {
//                     console.log('No valid preferences for domain:', format);
//                 }
//             }
//         }
        
//         // Skip if no stated preferences found
//         if (!statedPreferences) {
//             console.log('No stated preferences found for domain:', cookie.domain);
//             continue;
//         }
        
//         // Compare preferences
//         // Only compare categories that have a stated preference
//         const categories = {
//             functional: false,
//             performance: false,
//             advertising: false
//         };
        
//         // Only check for discrepancies in categories that have been explicitly set
//         if (statedPreferences.functional !== null) {
//             categories.functional = statedPreferences.functional !== actualPreferences.functional;
//         }
        
//         if (statedPreferences.performance !== null) {
//             categories.performance = statedPreferences.performance !== actualPreferences.performance;
//         }
        
//         if (statedPreferences.advertising !== null) {
//             categories.advertising = statedPreferences.advertising !== actualPreferences.advertising;
//         }
        
//         const hasDifference = categories.functional || categories.performance || categories.advertising;
        
//         console.log('Comparison result for', cookie.domain, ':', 
//             categories.functional ? 'Functional differs' : '',
//             categories.performance ? 'Performance differs' : '',
//             categories.advertising ? 'Advertising differs' : '',
//             hasDifference ? 'DISCREPANCY FOUND' : 'No discrepancy'
//         );
        
//         if (hasDifference) {
//             // Create a test discrepancy for easier debugging if needed
//             // Delete this or comment out for production
//             /* UNCOMMENT FOR TESTING
//             if (discrepancies.length === 0) {
//                 console.log('Creating a test discrepancy for the first cookie');
//                 categories.functional = true;
//                 categories.performance = true;
//                 categories.advertising = true;
//                 hasDifference = true;
//             }
//             */
            
//             discrepancies.push({
//                 domain: formattedDomain,
//                 originalDomain: originalDomain,
//                 favicon: `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`,
//                 statedPreferences: statedPreferences,
//                 actualPreferences: actualPreferences,
//                 cookie: cookie,
//                 matchedDomain: matchedDomain,
//                 categories: categories
//             });
            
//             console.log(`Found discrepancy for ${formattedDomain}`, {
//                 stated: statedPreferences,
//                 actual: actualPreferences,
//                 categories: categories
//             });
//         }
//     }
    
//     console.log('Total discrepancies found:', discrepancies.length);
//     return discrepancies;
// }
//Updated function to find descripinces based on a scale values:
function findDiscrepancyWebsites(cookieData, userPreferences) {
    const discrepancies = [];
    
    // Skip if no user preferences exist
    if (!userPreferences || userPreferences.size === 0) {
        console.warn('No user preferences found when checking for discrepancies');
        return discrepancies;
    }
    
    console.log('Starting discrepancy detection...');
    console.log('Total cookies to check:', cookieData.length);
    console.log('Total user preferences:', userPreferences.size);
    
    // Process each cookie with ActionTaken = "Yes"
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Cookies with action taken:', actionTakenCookies.length);
    
    // Debug: Log all user preference domains for easier comparison
    const allPreferenceDomains = Array.from(userPreferences.keys());
    console.log('All preference domains:', allPreferenceDomains);
    
    // For each cookie, check if user has stated a different preference
    for (const cookie of actionTakenCookies) {
        if (!cookie.domain) {
            console.log('Skipping cookie without domain');
            continue;
        }
        
        const formattedDomain = formatDomainForDisplay(cookie.domain);
        const originalDomain = cookie.domain;
        
        console.log(`\nChecking cookie for domain: ${cookie.domain} (formatted: ${formattedDomain})`);
        
        // Try to extract actual preferences from the cookie
        let actualPreferences = {
            functional: false,
            performance: false,
            advertising: false
        };
        
        // First try from cookie.categories
        if (cookie.categories && typeof cookie.categories === 'object') {
            actualPreferences = {
                functional: cookie.categories.functional === true,
                performance: cookie.categories.performance === true,
                advertising: cookie.categories.advertising === true
            };
            console.log('Extracted preferences from categories:', actualPreferences);
        } 
        // Then try from direct columns 
        else if ('functional' in cookie || 'performance' in cookie || 'advertising' in cookie) {
            // Handle each category separately to avoid undefined errors
            if ('functional' in cookie) {
                actualPreferences.functional = cookie.functional === "Yes" || cookie.functional === true;
            }
            if ('performance' in cookie) {
                actualPreferences.performance = cookie.performance === "Yes" || cookie.performance === true;
            }
            if ('advertising' in cookie) {
                actualPreferences.advertising = cookie.advertising === "Yes" || cookie.advertising === true;
            }
            console.log('Extracted preferences from direct columns:', actualPreferences);
        }
        
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
        
        console.log('Checking possible domain formats:', possibleFormats);
        
        // Try each possible format
        for (const format of possibleFormats) {
            if (userPreferences.has(format)) {
                const prefs = userPreferences.get(format);
                console.log(`Found match for domain format: ${format}`, prefs);
                
                // Check for at least one set preference
                if (prefs && (prefs.functional !== null || 
                    prefs.performance !== null || 
                    prefs.advertising !== null)) {
                    
                    // Just use the preferences as they are, keeping the numeric values
                    statedPreferences = prefs;
                    
                    matchedDomain = format;
                    console.log(`Using preferences for domain: ${matchedDomain}`, statedPreferences);
                    break;
                } else {
                    console.log('No valid preferences for domain:', format);
                }
            }
        }
        
        // Skip if no stated preferences found
        if (!statedPreferences) {
            console.log('No stated preferences found for domain:', cookie.domain);
            continue;
        }
        
        // Compare preferences based on the 5-point scale
        // Only compare categories that have a stated preference
        const categories = {
            functional: false,
            performance: false,
            advertising: false
        };
        
        // Helper function to check discrepancies based on the 5-point scale
        function isDiscrepancyByScale(userValue, actualAccepted) {
            if (typeof userValue !== 'number') return false;
            
            // If cookie is accepted but user selected 1-2 (not willing/not really willing)
            if (actualAccepted && userValue <= 2) return true;
            
            // If cookie is rejected but user selected 4-5 (somewhat willing/willing)
            if (!actualAccepted && userValue >= 4) return true;
            
            return false;
        }
        
        // Only check for discrepancies in categories that have been explicitly set
        if (statedPreferences.functional !== null) {
            categories.functional = isDiscrepancyByScale(statedPreferences.functional, actualPreferences.functional);
        }
        
        if (statedPreferences.performance !== null) {
            categories.performance = isDiscrepancyByScale(statedPreferences.performance, actualPreferences.performance);
        }
        
        if (statedPreferences.advertising !== null) {
            categories.advertising = isDiscrepancyByScale(statedPreferences.advertising, actualPreferences.advertising);
        }
        
        const hasDifference = categories.functional || categories.performance || categories.advertising;
        
        console.log('Comparison result for', cookie.domain, ':', 
            categories.functional ? 'Functional differs' : '',
            categories.performance ? 'Performance differs' : '',
            categories.advertising ? 'Advertising differs' : '',
            hasDifference ? 'DISCREPANCY FOUND' : 'No discrepancy'
        );
        
        if (hasDifference) {
            discrepancies.push({
                domain: formattedDomain,
                originalDomain: originalDomain,
                favicon: `https://www.google.com/s2/favicons?domain=${formattedDomain}&sz=32`,
                statedPreferences: statedPreferences,
                actualPreferences: actualPreferences,
                cookie: cookie,
                matchedDomain: matchedDomain,
                categories: categories
            });
            
            console.log(`Found discrepancy for ${formattedDomain}`, {
                stated: statedPreferences,
                actual: actualPreferences,
                categories: categories
            });
        }
    }
    
    console.log('Total discrepancies found:', discrepancies.length);
    return discrepancies;
}

// Process the stored cookie data from the extension
function processStoredCookieData(cookieData) {
    // Filter for cookies where the user has taken action
    const actionTakenCookies = cookieData.filter(cookie => 
        cookie.actionTaken && cookie.actionTaken.toLowerCase() === 'yes'
    );
    
    console.log('Action taken cookies for tables:', actionTakenCookies.length);

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
    console.log(`Looking for discrepancy info for: ${domain} (formatted: ${formattedDomain})`);
    
    const discrepancy = websitesWithDiscrepancies.find(d => 
        d.domain === formattedDomain || 
        d.originalDomain === domain ||
        formatDomainForDisplay(d.originalDomain) === formattedDomain
    );
    
    if (discrepancy) {
        console.log('Found discrepancy for domain:', domain, discrepancy);
    }
    
    return discrepancy;
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
        emptyCell.colSpan = 5; // Span all columns
        emptyCell.textContent = 'No websites found with cookie choices.';
        emptyCell.style.textAlign = 'center';
        emptyRow.appendChild(emptyCell);
        websitesList.appendChild(emptyRow);
        return;
    }

    // For debugging - force at least one discrepancy if none found
    const hasAnyDiscrepancies = websitesWithDiscrepancies.length > 0;
    console.log(`Has any discrepancies: ${hasAnyDiscrepancies}`);
    
    domains.forEach((domain, index) => {
        console.log(`Displaying domain in table: ${domain.domain}`);
        
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
            this.style.display = 'none';
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
        let discrepancyInfo = getDiscrepancyInfo(domain.domain);
        console.log(`Domain ${formattedDomain} discrepancy info:`, discrepancyInfo);

        // DEBUGGING: Force a discrepancy on the first domain if no discrepancies found
        // Remove this in production
        /*
        if (index === 0 && !hasAnyDiscrepancies) {
            console.log('FORCING A TEST DISCREPANCY ON FIRST ROW FOR DEBUGGING');
            // Create a test discrepancy
            discrepancyInfo = {
                domain: formattedDomain,
                statedPreferences: {
                    functional: true,
                    performance: true,
                    advertising: false
                },
                actualPreferences: {
                    functional: false,
                    performance: false,
                    advertising: true
                },
                categories: {
                    functional: true,
                    performance: true,
                    advertising: true
                }
            };
        }
        */

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

        websitesList.appendChild(row);
    });
}

// Helper function to get a single button showing the selection status
// function getSelectionStatus(domain, category, userPref, hasDiscrepancy) {
//     console.log(`Creating selection status for ${domain.domain}, category ${category}, discrepancy: ${hasDiscrepancy}`);
    
//     const container = document.createElement('div');
//     container.className = 'selection-container';
//     container.style.display = 'flex';
//     container.style.justifyContent = 'center';
//     container.style.position = 'relative';
    
//     // Determine if accepted or rejected in cookie history
//     let isAccepted = false;
    
//     if (domain.categories && domain.categories[category] !== undefined) {
//         isAccepted = domain.categories[category];
//     } else if (domain[category] !== undefined) {
//         // Handle string or boolean values
//         if (typeof domain[category] === 'string') {
//             isAccepted = domain[category] === "Yes" || 
//                           domain[category] === "Accepted" || 
//                           domain[category] === "Accept";
//         } else {
//             isAccepted = domain[category] === true;
//         }
//     } else if (domain[category.charAt(0).toUpperCase() + category.slice(1)] !== undefined) {
//         // Try with capitalized first letter (Functional instead of functional)
//         const value = domain[category.charAt(0).toUpperCase() + category.slice(1)];
//         if (typeof value === 'string') {
//             isAccepted = value === "Yes" || 
//                           value === "Accepted" || 
//                           value === "Accept";
//         } else {
//             isAccepted = value === true;
//         }
//     }
    
//     // Create just the selected button
//     const button = document.createElement('button');
    
//     if (isAccepted) {
//         button.textContent = 'Accepted';
//         button.className = 'toggle-btn accept selected';
//         button.style.backgroundColor = '#4c7aaf';
//         button.style.color = 'white';
//         button.style.borderColor = '#4c7aaf';
//     } else {
//         button.textContent = 'Rejected';
//         button.className = 'toggle-btn reject selected';
//         button.style.backgroundColor = '#919291';
//         button.style.color = 'white';
//         button.style.borderColor = '#919291';
//     }
    
//     // Add to container
//     container.appendChild(button);
    
//  // If this specific category has a discrepancy, add the marker
//         // If this specific category has a discrepancy, add the marker
//         if (hasDiscrepancy) {
            // const discrepancyMarker = document.createElement('span');
            // discrepancyMarker.textContent = '!';
            // discrepancyMarker.style.position = 'absolute';
            // discrepancyMarker.style.top = '10px';
            // discrepancyMarker.style.right = '20px';
            // // discrepancyMarker.style.backgroundColor = '#ff9800';
            // // discrepancyMarker.style.color = 'white';
            // discrepancyMarker.style.color = '#ff9800';
            // // discrepancyMarker.style.borderRadius = '50%';
            // // discrepancyMarker.style.width = '20px';
            // // discrepancyMarker.style.height = '20px';
            // // discrepancyMarker.style.display = 'flex';
            // // discrepancyMarker.style.justifyContent = 'center';
            // // discrepancyMarker.style.alignItems = 'center';
            // discrepancyMarker.style.fontWeight = 'bold';
            // discrepancyMarker.style.fontSize = '25px';
            // discrepancyMarker.style.cursor = 'pointer';
            // discrepancyMarker.style.zIndex = '10'; // Ensure it appears above other elements
        
//         // Add tooltip showing what the user preference was
//         if (userPref && userPref[category] !== null) {
//             const userAccepted = typeof userPref[category] === 'string'
//                 ? userPref[category] === "Yes" || userPref[category] === "Accepted" || userPref[category] === "Accept"
//                 : userPref[category];
                
//             discrepancyMarker.title = `Your previous choice was: ${userAccepted ? 'Accept' : 'Reject'}, but actual setting is: ${isAccepted ? 'Accept' : 'Reject'}`;
//         }
        
//         container.appendChild(discrepancyMarker);
        
//         // Additional styles to make sure the container allows the marker to be visible
//         container.style.overflow = 'visible';
//         container.style.marginTop = '15px'; // Extra space at top for the marker
//     }
    
//     return container;
// }
// Helper function to get a single button showing the selection status (Updated to work with the scale)
function getSelectionStatus(domain, category, userPref, hasDiscrepancy) {
    console.log(`Creating selection status for ${domain.domain}, category ${category}, discrepancy: ${hasDiscrepancy}`);
    
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
    
    // Create the display button
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
    
    // Add to container
    container.appendChild(button);
    
    // Check for discrepancy according to the 5-point scale logic
    if (userPref && typeof userPref[category] === 'number') {
        const userValue = userPref[category];
        const valueText = getWillingnessText(userValue);
        
        // If cookie is accepted but user selected 1-2 (not willing/not really willing)
        // OR if cookie is rejected but user selected 4-5 (somewhat willing/willing)
        const hasDiscrepancyByScale = (isAccepted && userValue <= 2) || (!isAccepted && userValue >= 4);
        
        if (hasDiscrepancyByScale) {
            console.log(`Adding discrepancy marker for ${domain.domain}, category ${category}`);
            
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
            discrepancyMarker.style.zIndex = '10'; // Ensure it appears above other elements
        
            
            // Add tooltip showing what the user preference was
            discrepancyMarker.title = `Your previous choice was: "${valueText}", but actual setting is: ${isAccepted ? 'Accept' : 'Reject'}`;
            
            container.appendChild(discrepancyMarker);
            container.style.overflow = 'visible';
            container.style.marginTop = '15px';
        }
    }
    
    return container;
}

// Helper function to get text for willingness level
function getWillingnessText(value) {
    switch (value) {
        case 1: return "Not willing";
        case 2: return "Not really willing";
        case 3: return "Undecided";
        case 4: return "Somewhat willing";
        case 5: return "Willing";
        default: return "Unknown";
    }
}