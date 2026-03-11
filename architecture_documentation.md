# Architecture Documentation: Pricrumb Browser Extension

## Overview
This browser extension is a tool designed to analyze and document user consent data across the web. It identifies Consent Management Platforms (CMPs) and Transparency and Consent Framework (TCF) strings, correlates them with a user's browsing history, and detects discrepancies between user-stated preferences and actual cookie states.

The extension is designed for integration with survey technology, allowing the survey to query the extension for eligibility and data disclosure.

---

## Folder Structure (Modern "Merged" Extension)
The extension logic resides in the `/extensions/desktop/merged` directory. This is the unified codebase for both Chrome (MV3) and Firefox.

- `manifest.chrome/firefox.json`: Browser-specific manifests. Both use `background.js` as the service worker/background script.
- `background.js`: Handles browser-wide events, history fetching, and cookie management.
- `content.js`: Injected into all pages; serves as the bridge between the webpage (survey) and the extension.
- `popup.js`: Contains heavy logic for decoding various CMPs and TCF v2 strings.
- `consent_history_and_discrepancies.js`: Logic for identifying differences between user preferences and cookie reality.
- `models.js`: Centralized data models and category definitions.
- `ext-shim.js` / `browser-polyfill.min.js`: Ensure cross-browser compatibility.

---

## Core Systems

### 1. CMP & TCF Recognition
The extension identifies how a website handles consent by looking for specific cookies and localStorage keys.
- **CMP Detection**: It searches for fingerprints from major providers like OneTrust, CookieYes, Usercentrics, Quantcast, and Cookiebot.
- **TCF v2 Decoding**: It fetches and decodes TCF strings (e.g., `euconsent-v2`). It compares the decoded purposes against `tcf_default_decoded_js.json` to determine if a user has taken an explicit action or is using default settings.
- **Decoding Logic**: Found primarily in `popup.js`, which contains specialized decoders for each major CMP.

### 2. Browser History Correlation
A unique feature of this extension is its ability to correlate cookies with a user's actual browsing behavior.
- **Recursive Fetching**: `background.js` uses a paginated search algorithm to find all visits to a specific domain over the past year.
- **Transition Filtering**: It filters out redirects and reloads to focus on "meaningful" user-initiated visits.
- **Visit Metrics**: It calculates total visit counts, average daily visits, and first/last visit dates per domain.

### 3. Iframe Injection System
The extension does not always use a traditional popup. Instead, it can inject its UI components directly into pages (usually a survey page) via iframes.
- **Targeting**: `content.js` monitors the DOM for specific element IDs (e.g., `#pricrumbs_consent_history_top_websites`).
- **Dynamic Mounting**: When a target element is found, the extension injects a corresponding HTML file from its package into an iframe within that element.

### 4. Discrepancy Detection
The extension compares "stated" vs. "actual" consent:
- **Stated**: The user provides ratings on a 5-point scale (Willingness to share data) for Functional, Performance, and Advertising categories.
- **Actual**: The extension reads the current state of consent cookies on the user's machine.
- **Calculation**: A discrepancy is flagged if a cookie is "Accepted" but the user stated a low willingness (1-2), or if it is "Rejected" but the user stated a high willingness (4-5).

---

## Communication Flow

### Survey <-> Extension
The survey webpage communicates with the extension via `window.postMessage`.
1. **Eligibility Check**: The survey asks if the user has visited enough unique websites (the current threshold is **10 or more** unique domains) where they've taken action.
2. **Preference Sync**: The survey sends the user's 5-point scale preferences to the extension for storage.
3. **Disclosure**: The extension provides the list of websites, visit counts, and discrepancy flags back to the survey for display.

### Background <-> Content Script
Uses standard browser `runtime.sendMessage` and `tabs.sendMessage`.
- **Background** performs the "heavy lifting" like history searching and cookie API calls that content scripts cannot access.
- **Content Script** handles all DOM interactions and message relaying to the survey.

---

## Data Management
The extension uses `chrome.storage.local` to persist:
- `cookieData`: All processed cookies with their decoded categories and history metrics.
- `participantCookiesPreferences`: The user's 5-point scale ratings for specific domains.
- `selected_domains`: The specific subset of domains currently being analyzed in the survey flow.
