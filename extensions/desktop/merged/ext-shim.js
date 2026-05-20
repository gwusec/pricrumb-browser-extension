// DEPRECATED
// Cross-browser alias for extension APIs
//const ext = (typeof browser !== "undefined") ? browser : chrome;

// ext-shim.js
// Cross-browser shim: makes Chrome APIs behave like Firefox's Promise-based APIs
// Usage: just import this file before any of your other scripts and use `ext.*` everywhere

const ext = (() => {
    if (typeof browser !== "undefined") {
        // Firefox already supports Promise-based APIs
        return browser;
    }
    
    if (typeof chrome !== "undefined") {
        // Helper to wrap callback APIs into Promises
        const promisify = (fn, context, needsDefaultObject = false) => (...args) => {
            if (needsDefaultObject && args.length === 0) {
                args = [{}]; // default to empty object
            }
            return new Promise((resolve, reject) => {
                fn.apply(context, [
                ...args,
                (result) => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    } else {
                    resolve(result);
                    }
                },
                ]);
            });
        };

        // Must define API based on what functions are present
        const api = { ...chrome };
        
        // Runtime should always be present
        if (chrome.runtime) {
            api.runtime = {
                ...chrome.runtime,
                sendMessage: promisify(chrome.runtime.sendMessage, chrome.runtime),
                getPlatformInfo: promisify(chrome.runtime.getPlatformInfo, chrome.runtime),
            };
        }

        if (chrome.tabs) {
            api.tabs = {
                ...chrome.tabs,
                query: promisify(chrome.tabs.query, chrome.tabs),
                create: promisify(chrome.tabs.create, chrome.tabs),
                update: promisify(chrome.tabs.update, chrome.tabs),
                remove: promisify(chrome.tabs.remove, chrome.tabs),
                sendMessage: promisify(chrome.tabs.sendMessage, chrome.tabs),
            };
        }

        if (chrome.storage) {
            api.storage = {
                ...chrome.storage,
                local: {
                get: promisify(chrome.storage.local.get, chrome.storage.local, true),
                set: promisify(chrome.storage.local.set, chrome.storage.local),
                remove: promisify(chrome.storage.local.remove, chrome.storage.local),
                clear: promisify(chrome.storage.local.clear, chrome.storage.local),
                },
            };
        }

        if (chrome.downloads) {
            api.downloads = {
                ...chrome.downloads,
                download: promisify(chrome.downloads.download, chrome.downloads),
                erase: promisify(chrome.downloads.erase, chrome.downloads),
                search: promisify(chrome.downloads.search, chrome.downloads),
            };
        }

        if (chrome.cookies) {
            api.cookies = {
                ...chrome.cookies,
                get: promisify(chrome.cookies.get, chrome.cookies),
                getAll: promisify(chrome.cookies.getAll, chrome.cookies),
                set: promisify(chrome.cookies.set, chrome.cookies),
                remove: promisify(chrome.cookies.remove, chrome.cookies),
            };
        }

        if (chrome.scripting) {
            api.scripting = {
                ...chrome.scripting,
                executeScript: promisify(chrome.scripting.executeScript, chrome.scripting),
                insertCSS: promisify(chrome.scripting.insertCSS, chrome.scripting),
            };
        }

        return api;
    }

    throw new Error("Neither browser nor chrome APIs found. This script must run in an extension context.");
})();

globalThis.ext = ext;