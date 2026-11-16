import time
import json
import os
import undetected_chromedriver as uc
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities

# IMPORTANT:
#
# From https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md
#
# How does the CMP provide the API?
# Every consent manager MUST provide the following API function:
# 
# __tcfapi(command, version, callback, parameter)
# 
# The function __tcfapi must always be a function and cannot be any other type, even if only temporarily on initialization – the API must be able to handle calls at all times.
# 
# Secondarily, CMPs must provide a proxy for postMessage events targeted to the __tcfapi interface sent from within nested iframes. See the section on iframes for information.

# https://ieeexplore.ieee.org/abstract/document/9152617

# If set to true, the scraper does not wait for user input upon website launch. 
# Rather, it waits a set amount of time, and then automatically extracts.
AUTOMATE = False
SET_TIME_SECONDS = 10

# List of websites to scan
WEBSITES = [
    "https://kleinanzeigen.de",
    "https://www.discogs.com",
    # ...
]

# Output log file for each website
LOG_FILE = "log.json"

def setup_browser():

    caps = DesiredCapabilities.CHROME
    caps["goog:loggingPrefs"] = {"performance": "ALL"}

    options = uc.ChromeOptions()
    # options.add_argument("--headless=new")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-gpu")

    driver = uc.Chrome(options=options, desired_capabilities=caps)
    return driver

def extract_tcfapi(driver):
    script = """
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
    """
    try:
        result = driver.execute_script(script)
        if result:
            return json.loads(result)
    except Exception as e:
        print("TCF v2 API extraction failed:", e)
    return None

def find_tcf_in_cookies(driver, tc_string):
    if not tc_string:
        return "N/A"

    cookies = driver.get_cookies()
    for cookie in cookies:
        value = cookie.get("value", "")
        if tc_string in value:
            return cookie.get("name")
    return "None"

def update_log(entry):
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = []

    data.append(entry)

    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def process_website(driver, url):
    print(f"\nVisiting {url}")
    driver.get(url)

    if AUTOMATE:
        time.sleep(SET_TIME_SECONDS)
    else:
        time.sleep(3)
        input(f"Interact with cookie banner on {url}, then press Enter to continue...")

    print("Extracting TCF string via __tcfapi()...")
    tcf_data = extract_tcfapi(driver)

    result = {
        "website": url,
        "tcf_string_found": bool(tcf_data and tcf_data.get("__rawString")),
        "cookie_with_tcf_string": "N/A"
    }

    if result["tcf_string_found"]:
        tc_string = tcf_data["__rawString"]
        result["cookie_with_tcf_string"] = find_tcf_in_cookies(driver, tc_string)

    update_log(result)
    print(f"Logged result for {url}.")

def main():
    for website in WEBSITES:
        driver = setup_browser()
        try:
            process_website(driver, website)
        finally:
            driver.quit()

if __name__ == "__main__":
    main()
