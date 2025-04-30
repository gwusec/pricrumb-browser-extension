# Website TCF v2 String Scraper

## Purpose

To determine whether or not a website has a valid TCF v2 implementation and, if so, which cookie (if any) stores this tcf string. This extraction can be done on an individual website or from a list of websites.

## Dependencies

Google Chrome  
Python 3.8+  
selenium  
undetected-chromedrive  

Install with:

```
pip install undetected-chromedriver selenium
```

## Usage

- Update the list of websites (found in the WEBSITES variable at the top) in the code  
- Run the script  

If AUTOMATE is set to false:  
- For each website, accept all cookies  
- Press enter in console once website is finished loading  

If AUTOMATE is set to true:  
- Have an extension installed that automatically accepts all cookies  
- Continue until all websites have been processed  

Find output in the log.json file  

## How it works

- Launches a stealth Chrome browser using undetected_chromedriver.

If AUTOMATE is set to false:  
- Navigates to a website and waits for 3 seconds.  
- Prompts the user to manually interact with the cookie banner.  
- Waits for user input to continue  

If AUTOMATE is set to true:  
- Navigates to a website  
- Waits a number of seconds as specified by SET_TIME_SECONDS  
- Continues  

- Runs a JavaScript snippet to invoke `__tcfapi('getTCData', 2, ...)` if available.  
- Searches browser cookies for the presence of the raw TCF string.  
- Logs results to log.json immediately after processing each site.  
  - If no tcf string found, cookie value = “N/A”  
  - If no cookie found with tcf string, cookie value = “None”  

## Example output (log.json)

```
[
  {
    "website": "https://kleinanzeigen.de",
    "tcf_string_found": true,
    "cookie_with_tcf_string": "ekConsentTcf2"
  },
  {
    "website": "https://www.discogs.com",
    "tcf_string_found": true,
    "cookie_with_tcf_string": "eupubconsent-v2"
  }
]
```

## Function Descriptions

### setup_browser():

**Returns:** selenium WebDriver instance  
**Purpose:** Opens a stealth chrome session with logging capabilities for website activity

---

### extract_tcfapi(driver):

**Input:** selenium WebDriver instance  
**Returns:** a dict containing valid tcf data, or None if not found  
**Purpose:** Executes a JS script to call the __tcfapi interface on the page  

**Script:**
```javascript
return new Promise((resolve) => {
        try {
            if (typeof __tcfapi !== "function") return resolve(null);
            __tcfapi('getTCData', 2, function(tcData, success) {
                if (success) {
                    tcData['__rawString'] = tcData.tcString || null;
                    tcData['__apiVersion'] = 'TCFv2';
                    resolve(JSON.stringify(tcData));
                } else {
                    resolve(null);
                }
            });
        } catch (e) {
            resolve(null);
        }
    });
```

---

### find_tcf_in_cookies(driver, tc_string):

**Input:** selenium WebDriver instance and TCF string value  
**Returns:** If tc_string is invalid, returns “N/A”. Otherwise, if cookie is found, returns the cookie name. If cookie is not found, returns “None”.  
**Purpose:** Finds the browser cookie name which contains the website TCF string is available

---

### update_log(entry):

**Input:** text to be logged  
**Purpose:** Appends entry into the logging json file

---

### process_website(driver, url):

**Input:** selenium WebDriver instance and url of a website  
**Purpose:** Executes the following algorithm for a website  
- Visits the URL  
- Either waits 10 seconds or pauses until user input (depending on AUTOMATE variable) to allow for cookie acceptance  
- Attempts to extract the TCF data and associated cookie name  
- Logs the result

---

### main():

Iterates over all websites in WEBSITES variable and applies the full processing algorithm to each

---

## Sources

- TCF v2 Documentation: https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md  
- Study which came up with the method: https://ieeexplore.ieee.org/abstract/document/9152617
