// ============================
// CONFIG / CONSTANTS
// ============================
import { getFavicon, STORAGE_KEYS, getParticipantCookiesPreferences } from './helper_functions.js';

// Mapping for display names
const CATEGORY_LABELS = {
    performance: "Performance Cookies",
    functional: "Extra Functionality Cookies",
    advertising: "Personalized Advertising"
};

// ============================
// STATE
// ============================
const state = {
    domains: [],
    domainLookup: new Map(),
    index: 0,
    selections: {} // session selections for UI
};

// ============================
// DOM CACHE
// ============================
const DOM = {};

function cacheDOM() {
    DOM.loading = document.getElementById("loading");
    DOM.questionView = document.getElementById("questionView");
    DOM.completionView = document.getElementById("completionView");

    DOM.totalDomains = document.getElementById("totalDomains");
    DOM.currentDomain = document.getElementById("currentDomain");
    DOM.currentDomainName = document.getElementById("currentDomainName");
    DOM.cookieType = document.getElementById("currentCookieType");

    DOM.previousButton = document.getElementById("previousButton");
    DOM.progressFill = document.querySelector(".progress-fill");
    DOM.toggleContainer = document.querySelector(".toggle-container");
}

// ============================
// INIT
// ============================
document.addEventListener("DOMContentLoaded", init);

async function init() {
    cacheDOM();

    if (!DOM.toggleContainer) {
        console.error("No toggle-container found!");
        return;
    }

    // Detect category dynamically
    const category = DOM.toggleContainer.getAttribute("cookie-category") || "performance";

    if (DOM.previousButton) {
        DOM.previousButton.addEventListener("click", () => showPreviousDomain(category));
    }

    await loadCookies(category);
    setupEmbedAutoHeight();
}

// ============================
// STORAGE HELPERS
// ============================

export async function savePreference(domain, category, value) {
    try {
        const prefs = await getParticipantCookiesPreferences();
        const key = (domain.originalDomain || domain.domain || "")
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .split("/")[0]
            .replace(/^\.+/, "")
            .replace(/^www\./, "")
            .replace(/\.+$/, "");

        // Find existing entry
        let entry = prefs.find(p => p.domain === key);

        if (!entry) {
            entry = { domain: key, functional: null, performance: null, advertising: null };
            prefs.push(entry);
        }

        entry[category] = value;

        // Save updated array
        await ext.storage.local.set({ [STORAGE_KEYS.PREFS]: prefs });

        // Update session state for UI highlighting
        if (!state.selections[key]) state.selections[key] = {};
        state.selections[key][category] = value;

        console.log(`Saved preference for ${key}/${category}: ${value}`);
    } catch (e) {
        console.error("Failed to save preference", e);
    }
}

// ============================
// UTILITIES
// ============================
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatDomain(domain) {
    if (!domain) return "Unknown";
    domain = domain.replace(/^\./, "");
    if (!domain.startsWith("www.") && domain.split(".").length === 2) domain = "www." + domain;
    return domain;
}

function extractMainDomain(domain) {
    const cleaned = domain.replace(/^www\./, "");
    const parts = cleaned.split(".");
    return parts.length >= 2 ? parts[parts.length - 2].toLowerCase() : cleaned;
}

function buildDomainObject(cookie) {
    const domain = formatDomain(cookie.domain);
    return {
        domain,
        originalDomain: cookie.domain,
        mainDomain: extractMainDomain(domain),
        favicon: `https://icons.duckduckgo.com/ip3/${domain}.ico`,
        lastVisited: cookie.lastVisited,
        categories: cookie.categories,
        totalVisitCount: parseInt(cookie.totalVisitCount) || 0,
        expiration: cookie.expiration,
        actionTaken: cookie.actionTaken || "Yes"
    };
}

// ============================
// COOKIE LOADING
// ============================
async function loadCookies(category) {
    try {
        const result = await ext.storage.local.get(STORAGE_KEYS.COOKIE_DATA);
        const cookies = result[STORAGE_KEYS.COOKIE_DATA] || [];

        if (!cookies.length) {
            if (DOM.loading) DOM.loading.textContent = "No cookie data found.";
            return;
        }

        const domains = selectDomains(cookies);
        const historyResult = await ext.storage.local.get(STORAGE_KEYS.DOMAIN_HISTORY);

        if (!historyResult[STORAGE_KEYS.DOMAIN_HISTORY]) {
            await ext.storage.local.set({ [STORAGE_KEYS.DOMAIN_HISTORY]: domains });
            state.domains = shuffle(domains);
        } else {
            state.domains = shuffle(historyResult[STORAGE_KEYS.DOMAIN_HISTORY]);
        }

        state.domains.forEach(d => state.domainLookup.set(d.domain, d));

        if (DOM.loading) DOM.loading.style.display = "none";
        if (DOM.questionView) DOM.questionView.style.display = "block";
        if (DOM.totalDomains) DOM.totalDomains.textContent = state.domains.length;

        initializeSelections(category);
        renderDomain(category);

    } catch (e) {
        console.error("Failed to load cookies", e);
        if (DOM.loading) DOM.loading.textContent = "Error loading cookie data.";
    }
}

function selectDomains(cookies) {
    const actionCookies = cookies.filter(c => (c.actionTaken || "").toLowerCase() === "yes");
    const source = actionCookies.length >= 6 ? actionCookies : cookies;

    const sortedDesc = [...source].sort((a, b) => (b.totalVisitCount || 0) - (a.totalVisitCount || 0));
    const sortedAsc = [...source].sort((a, b) => (a.totalVisitCount || 0) - (b.totalVisitCount || 0));

    const seen = new Set();
    const most = [];
    const least = [];

    for (const c of sortedDesc) {
        const obj = buildDomainObject(c);
        if (!seen.has(obj.mainDomain)) {
            seen.add(obj.mainDomain);
            most.push(obj);
        }
        if (most.length === 5) break;
    }

    for (const c of sortedAsc) {
        const obj = buildDomainObject(c);
        if (!seen.has(obj.mainDomain)) {
            seen.add(obj.mainDomain);
            least.push(obj);
        }
        if (least.length === 5) break;
    }

    return [...most, ...least];
}

// ============================
// SELECTION TRACKING
// ============================
function initializeSelections(category) {
    state.selections = {};
    state.domains.forEach(d => {
        state.selections[d.domain] = { [category]: null };
    });
}

// ============================
// UI RENDERING
// ============================
function renderDomain(category) {
    const domain = state.domains[state.index];
    if (!domain) return;

    renderDomainHeader(domain, getFavicon, category);
    renderProgress();
    renderScale(domain, category);
}

async function renderDomainHeader(domain, getFaviconFunc, category) {
    if (!DOM.currentDomainName) return;

    const wrapper = document.createElement("div");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "12px";

    const favicon = document.createElement("img");
    favicon.style.width = "24px";
    favicon.style.height = "24px";
    favicon.onerror = () => favicon.remove();

    const formattedDomain = formatDomain(domain.domain);
    favicon.src = `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`;

    if (getFaviconFunc) {
        try {
            const realFavicon = await getFaviconFunc(formattedDomain);
            if (realFavicon) favicon.src = realFavicon;
        } catch (e) {
            console.warn("Failed to load favicon for", formattedDomain, e);
        }
    }

    const name = document.createElement("span");
    name.textContent = domain.domain;

    wrapper.append(favicon, name);
    DOM.currentDomainName.innerHTML = "";
    DOM.currentDomainName.appendChild(wrapper);

    if (DOM.cookieType) DOM.cookieType.textContent = CATEGORY_LABELS[category] || category;
}

function renderProgress() {
    if (DOM.currentDomain) DOM.currentDomain.textContent = state.index + 1;

    const percent = ((state.index + 1) / state.domains.length) * 100;
    if (DOM.progressFill) DOM.progressFill.style.width = percent + "%";

    if (DOM.previousButton) DOM.previousButton.disabled = state.index === 0;
}

// ============================
// SCALE BUTTONS
// ============================
const SCALE = [
    { value: 1, text: "I strongly prefer this website NOT use" },
    { value: 2, text: "I prefer this website NOT use" },
    { value: 3, text: "I have no preference" },
    { value: 4, text: "I prefer this website to use" },
    { value: 5, text: "I strongly prefer this website to use" }
];

function renderScale(domain, category) {
    if (!DOM.toggleContainer) return;

    DOM.toggleContainer.innerHTML = "";

    const current = state.selections[domain.domain][category];
    const label = CATEGORY_LABELS[category] || category;

    SCALE.forEach(item => {
        const btn = document.createElement("button");
        btn.textContent = item.text + " " + label;
        btn.dataset.value = item.value;
        btn.className = "scale-btn";

        if (current === item.value) applySelectedStyle(btn);

        btn.addEventListener("click", () => handleSelection(domain, item.value, category));

        DOM.toggleContainer.appendChild(btn);
    });
}

function applySelectedStyle(btn) {
    btn.style.backgroundColor = "#4c7aaf";
    btn.style.color = "white";
    btn.style.borderColor = "#4c7aaf";
}

// ============================
// SELECTION HANDLER
// ============================
async function handleSelection(domain, value, category) {
    state.selections[domain.domain][category] = value;
    await savePreference(domain, category, value);
    nextDomain(category);
}

// ============================
// NAVIGATION
// ============================
function nextDomain(category) {
    if (state.index < state.domains.length - 1) {
        state.index++;
        renderDomain(category);
    } else {
        finishCategory();
    }
}

function showPreviousDomain(category) {
    if (state.index > 0) {
        state.index--;
        renderDomain(category);
    }
}

// ============================
// COMPLETION
// ============================
function finishCategory() {
    if (DOM.questionView) DOM.questionView.style.display = "none";
    if (DOM.completionView) DOM.completionView.style.display = "block";
}

// ============================
// EMBED HEIGHT
// ============================
let lastHeight = 0;

function getHeight() {
    const root = document.querySelector(".container") || document.body;
    return Math.ceil(Math.max(root.getBoundingClientRect().height, root.scrollHeight, root.offsetHeight));
}

function postHeight() {
    const h = getHeight();
    if (h === lastHeight) return;
    lastHeight = h;

    window.parent.postMessage({
        type: "PRICRUMBS_EMBED_HEIGHT",
        payload: { elementId: DOM.toggleContainer.getAttribute("id") || "embed", height: h }
    }, "*");
}

function setupEmbedAutoHeight() {
    const root = document.querySelector(".container") || document.body;
    if (!root) return;

    const resizeObserver = new ResizeObserver(postHeight);
    resizeObserver.observe(root);

    const mutationObserver = new MutationObserver(postHeight);
    mutationObserver.observe(root, { childList: true, subtree: true, attributes: true });
}
