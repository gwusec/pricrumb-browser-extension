class ConsentDataManager {
    saveConsentChoices(choices) {

        return choices;
    }
}
document.addEventListener('DOMContentLoaded', () => {
    // Define the consent cookie names to look for
    const cookieNames = [
        "OptanonConsent", "OptanonAlertBoxClosed", "cookieyes-consent", 
        "wscrCookieConsent", "cmplz_rt_functional", "cmplz_rt_marketing", 
        "cmplz_rt_preferences", "cmplz_rt_statistics", "cmplz_rt_banner-status", 
        "uc_userconsent", "quantcast_consent", "CookieConsent", "osano_consent", 
        "cookie_notice", "cookie_law_info", "TrustArcConsent"
    ];

    function fetchAndDisplayWebsites() {
        ext.runtime.sendMessage({ action: "checkCookies", cookieNames }, (response) => {
            if (ext.runtime.lastError) {
                console.error("Error fetching cookies:", ext.runtime.lastError);
                document.getElementById('loading').textContent = 'Error loading cookie data. Please try again.';
                return;
            }

            if (!response || !response.cookies) {
                console.error("No cookies in response");
                document.getElementById('loading').textContent = 'No cookie data found.';
                return;
            }

            // Filter websites with action taken "Yes"
            const websitesWithAction = response.cookies
                .filter(cookie => {
                    const consentObject = createConsentObject(response.cookies, cookie);
                    return consentObject && consentObject.actionTaken === "Yes";
                })
                .map(cookie => createConsentObject(response.cookies, cookie))
                .filter(Boolean)
                // Sort by last visited date, most recent first
                .sort((a, b) => {
                    // Convert last visited to Date objects
                    const dateA = new Date(a.lastVisited);
                    const dateB = new Date(b.lastVisited);
                    
                    // Compare dates
                    return dateB - dateA;
                })
                .slice(0, 10); // Limit to 10 websites

            console.log("Websites with Action:", websitesWithAction);

            // Populate the table
            populateWebsites(websitesWithAction);
        });
    }

    // Populate the website list in the table
    function populateWebsites(websites) {
        const tbody = document.getElementById('websitesList');
        tbody.innerHTML = '';

        if (websites.length === 0) {
            document.getElementById('loading').textContent = 'No websites found where action was taken.';
            return;
        }
        //can add next button to move to the next?
        //or if website.length ===0 , then provide a specific list of websites (we can choose later)

        websites.forEach(website => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-weight: bold;">${website.domain}</td>
                <td class="checkbox-cell"><input type="checkbox" checked disabled title="Necessary cookies cannot be disabled"></td>
                <td class="checkbox-cell"><input type="checkbox" class="cookie-option" ${website.categories.functional ? 'checked' : ''}></td>
                <td class="checkbox-cell"><input type="checkbox" class="cookie-option" ${website.categories.performance ? 'checked' : ''}></td>
                <td class="checkbox-cell"><input type="checkbox" class="cookie-option" ${website.categories.advertising ? 'checked' : ''}></td>
                <td class="row-actions">
                    <button class="accept-btn">Accept All</button>
                    <button class="reject-btn">Reject All</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add event listeners to the buttons
        document.querySelectorAll('.accept-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                acceptRow(event.target);
            });
        });

        document.querySelectorAll('.reject-btn').forEach(button => {
            button.addEventListener('click', (event) => {
                declineRow(event.target);
            });
        });

        // Add event listener for the save preferences button
        document.getElementById('savePreferencesButton').addEventListener('click', savePreferences);

        document.getElementById('loading').style.display = 'none';
        document.getElementById('cookieTable').style.display = 'table';
    }

    // Make these functions globally available
    window.acceptRow = function(button) {
        const row = button.closest('tr');
        const checkboxes = row.querySelectorAll('.cookie-option');
        checkboxes.forEach(checkbox => {
            checkbox.checked = true;
        });
    }

    window.declineRow = function(button) {
        const row = button.closest('tr');
        const checkboxes = row.querySelectorAll('.cookie-option');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    window.savePreferences = function() {
        const websiteChoices = [];
        const rows = document.querySelectorAll('tbody tr');
        
        rows.forEach(row => {
            const domain = row.querySelector('td').textContent;
            const checkboxes = row.querySelectorAll('input[type="checkbox"]');
            websiteChoices.push({
                domain,
                preferences: {
                    functional: checkboxes[1].checked,
                    performance: checkboxes[2].checked,
                    advertising: checkboxes[3].checked
                }
            });
        });

        try {
            // Use the ConsentDataManager to save choices
            const dataManager = new ConsentDataManager();
            const savedData = dataManager.saveConsentChoices(websiteChoices);

            // Save as a separate JSON file
            const jsonData = JSON.stringify(savedData, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            ext.downloads.download({
                url: url,
                filename: `cookie_preferences_${new Date().toISOString().slice(0,10)}.json`,
                saveAs: true
            }, () => {
                URL.revokeObjectURL(url);
                alert('Your preferences have been saved!');
            });
        } catch (error) {
            console.error("Error saving preferences:", error);
            alert('There was an error saving your preferences. Please try again.');
        }
    }

    // Include the createConsentObject and other helper functions from the existing code
    function createConsentObject(allCookies, currentCookie) {
        const decoded = decodeCMPValue(allCookies, currentCookie);
        if (!decoded) return null;

        return {
            cmpName: decoded.cmpName,
            domain: currentCookie.domain,
            categories: {
                necessary: decoded.necessary,
                functional: decoded.functional,
                performance: decoded.performance,
                advertising: decoded.advertising,
            },
            timestamp: decoded.timestamp,
            expiration: decoded.expiration,
            firstVisited: decoded.firstVisited,
            lastVisited: decoded.lastVisited,
            actionTaken: decoded.actionTaken,
            misc: decoded.misc || {},
        };
    }

    function decodeCMPValue(cookies, currentCookie) {
        // Advanced decoding logic to determine Action Taken
        let actionTaken = "No"; // Default to "No"    
        // Different logic for different Cookie Management Platforms (CMPs)
        switch (currentCookie.name) {
            case "OptanonConsent":
                // For OneTrust, check for Alert Box Closed and interaction count
                const alertBoxCookie = cookies.find(cookie => 
                    cookie.name === "OptanonAlertBoxClosed" && 
                    cookie.domain === currentCookie.domain
                );
                
                // Parse the cookie value to check interaction details
                const parsedValue = currentCookie.value.split('&').reduce((acc, pair) => {
                    const [key, value] = pair.split('=');
                    acc[key] = value;
                    return acc;
                }, {});
    
                // Check if there's an interaction count and alert box was closed
                if (alertBoxCookie && parsedValue.interactionCount && parseInt(parsedValue.interactionCount) > 0) {
                    actionTaken = "Yes";
                }
                break;
    
            case "cookieyes-consent":
                // For CookieYes, check if consent was explicitly given
                if (currentCookie.value.includes('action:yes')) {
                    actionTaken = "Yes";
                }
                break;
    
            case "CookieConsent":
                // For Cookiebot, check if consent method is not 'implied'
                if (currentCookie.value.includes('method') && !currentCookie.value.includes('method=implied')) {
                    actionTaken = "Yes";
                }
                break;
    
            // Add more CMP-specific logic as needed
            default:
                // For other CMPs, you might need to add specific parsing logic
                actionTaken = "No";
        }
    
        return {
            cmpName: getCMPName(currentCookie.name),
            necessary: true,
            functional: false,
            performance: false,
            advertising: false,
            // Not all cookies have an expiration date (e.g. session cookies)
            timestamp: currentCookie.expirationDate ? new Date(currentCookie.expirationDate * 1000).toLocaleString() : null,
            expiration: currentCookie.expirationDate ? new Date(currentCookie.expirationDate * 1000).toLocaleString() : null,
            actionTaken: actionTaken,
            misc: {}
        };
    }

    function getCMPName(cookieName) {
        const cmpMap = {
            "OptanonConsent": "OneTrust",
            "cookieyes-consent": "CookieYes",
            "CookieConsent": "Cookiebot",
            // Add other mappings as needed
        };
        return cmpMap[cookieName] || "Unknown CMP";
    }

    // Initialize by fetching and displaying websites
    console.log("Websites fetched and displayed!");
    fetchAndDisplayWebsites();
});