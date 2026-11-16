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
const HEADER_READY_TIMEOUT_MS = 1200;

// ============================
// STATE
// ============================
const state = {
    domains: [],
    domainLookup: new Map(),
    index: 0,
    selections: {}, // session selections for UI
    renderToken: 0,
    isInteractionLocked: false,
    isSelectionPending: false
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
    DOM.answerLockHint = document.getElementById("answerLockHint");

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
        const result = await browser.runtime.sendMessage({ 
            type: "STORAGE_GET", 
            key: STORAGE_KEYS.COOKIE_DATA 
        });
        const cookies = result?.[STORAGE_KEYS.COOKIE_DATA] || [];

        console.log(`[loadCookies] Retrieved ${cookies.length} cookies from storage`);

        if (!cookies.length) {
            console.warn("[loadCookies] No cookie data found in storage");
            if (DOM.loading) DOM.loading.textContent = "No cookie data found.";
            return;
        }

        const domains = selectDomains(cookies);
        console.log(`[loadCookies] selectDomains returned ${domains.length} domains`);

        const historyResult = await browser.runtime.sendMessage({ 
            type: "STORAGE_GET", 
            key: STORAGE_KEYS.DOMAIN_HISTORY 
        });

        if (!historyResult?.[STORAGE_KEYS.DOMAIN_HISTORY]) {
            console.log("[loadCookies] No domain history found, saving new selection");
            await browser.runtime.sendMessage({ 
                type: "STORAGE_SET", 
                key: STORAGE_KEYS.DOMAIN_HISTORY, 
                value: domains 
            });
            state.domains = shuffle(domains);
        } else {
            console.log("[loadCookies] Existing domain history found, reusing it");
            state.domains = shuffle(historyResult[STORAGE_KEYS.DOMAIN_HISTORY]);
        }

        console.log(`[loadCookies] Loaded ${state.domains.length} domains into state`);
        state.domains.forEach(d => state.domainLookup.set(d.domain, d));

        if (DOM.loading) DOM.loading.style.display = "none";
        if (DOM.questionView) DOM.questionView.style.display = "block";
        if (DOM.totalDomains) DOM.totalDomains.textContent = state.domains.length;

        initializeSelections(category);
        void renderDomain(category);

    } catch (e) {
        console.error("[loadCookies] Failed to load cookies:", e);
        if (DOM.loading) DOM.loading.textContent = "Error loading cookie data.";
    }
}

function selectDomains(cookies) {
    const byCookies = (action) =>
        cookies.filter(c => (c.actionTaken || "").toLowerCase() === action);

    const yesCookies     = byCookies("yes");
    const noCookies      = byCookies("no");
    const unknownCookies = byCookies("unknown");

    // Fallback pool
    const fallbackCookies = [...noCookies, ...unknownCookies].sort(() => Math.random() - 0.5);

    const sortDesc = (arr) => [...arr].sort((a, b) => (b.totalVisitCount || 0) - (a.totalVisitCount || 0));
    const sortAsc  = (arr) => [...arr].sort((a, b) => (a.totalVisitCount || 0) - (b.totalVisitCount || 0));

    const seen = new Set();
    const most  = [];
    const least = [];

    const pickMost = (source) => {
        for (const c of sortDesc(source)) {
            if (most.length === 5) break;
            const obj = buildDomainObject(c);
            if (!seen.has(obj.mainDomain)) {
                seen.add(obj.mainDomain);
                most.push(obj);
            }
        }
    };

    const pickLeast = (source) => {
        for (const c of sortAsc(source)) {
            if (least.length === 5) break;
            const obj = buildDomainObject(c);
            if (!seen.has(obj.mainDomain)) {
                seen.add(obj.mainDomain);
                least.push(obj);
            }
        }
    };

    // Fill most/least from yes first, then fallback
    pickMost(yesCookies);
    if (most.length < 5) pickMost(fallbackCookies);

    pickLeast(yesCookies);
    if (least.length < 5) pickLeast(fallbackCookies);

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
async function renderDomain(category) {
    const domain = state.domains[state.index];
    if (!domain) return;

    const token = ++state.renderToken;

    setInteractionLock(true, "Loading website details...");
    renderProgress();
    renderScale(domain, category);

    await renderDomainHeader(domain, getFavicon, category, token);
    if (token !== state.renderToken) return;

    if (!state.isSelectionPending) {
        setInteractionLock(false);
    }
}

async function renderDomainHeader(domain, getFaviconFunc, category, token) {
    if (!DOM.currentDomainName) return;

    const formattedDomain = formatDomain(domain.domain);
    const wrapper = document.createElement("div");
    wrapper.style.display = "inline-flex";
    wrapper.style.alignItems = "center";
    wrapper.style.gap = "12px";

    const placeholder = document.createElement("span");
    placeholder.textContent = "?";
    Object.assign(placeholder.style, {
        display: "inline-flex",
        width: "24px",
        height: "24px",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "6px",
        backgroundColor: "#e2e8f0",
        color: "#475569",
        fontSize: "11px",
        fontWeight: "700",
        flexShrink: "0"
    });

    const name = document.createElement("span");
    name.textContent = domain.domain;

    wrapper.append(placeholder, name);
    DOM.currentDomainName.innerHTML = "";
    DOM.currentDomainName.appendChild(wrapper);

    if (DOM.cookieType) DOM.cookieType.textContent = CATEGORY_LABELS[category] || category;
    postHeight();

    const faviconUrl = await resolveFaviconWithTimeout(formattedDomain, getFaviconFunc, HEADER_READY_TIMEOUT_MS);
    if (token !== state.renderToken || !faviconUrl) return;

    const favicon = document.createElement("img");
    favicon.src = faviconUrl;
    favicon.alt = "";
    Object.assign(favicon.style, {
        width: "24px",
        height: "24px",
        borderRadius: "6px",
        objectFit: "cover",
        flexShrink: "0"
    });
    favicon.onerror = () => favicon.remove();

    if (placeholder.isConnected) {
        wrapper.replaceChild(favicon, placeholder);
        postHeight();
    }
}

function setInteractionLock(isLocked, hintText = "") {
    state.isInteractionLocked = Boolean(isLocked);

    if (DOM.answerLockHint) {
        DOM.answerLockHint.textContent = isLocked ? hintText : "";
        DOM.answerLockHint.style.display = isLocked && hintText ? "block" : "none";
    }

    updateScaleButtonInteractivity();
    updatePreviousButtonState();
    postHeight();
}

function updateScaleButtonInteractivity() {
    if (!DOM.toggleContainer) return;
    const shouldDisable = state.isInteractionLocked || state.isSelectionPending;
    DOM.toggleContainer.querySelectorAll(".scale-btn").forEach((btn) => {
        btn.disabled = shouldDisable;
    });
}

function updatePreviousButtonState() {
    if (!DOM.previousButton) return;
    DOM.previousButton.disabled = state.index === 0 || state.isSelectionPending;
}

function waitForImageLoad(src) {
    return new Promise((resolve) => {
        if (!src) {
            resolve(false);
            return;
        }

        const probe = new Image();
        probe.onload = () => resolve(true);
        probe.onerror = () => resolve(false);
        probe.src = src;
    });
}

function withTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
        const timeoutId = setTimeout(() => resolve(null), timeoutMs);

        Promise.resolve(promise)
            .then((value) => {
                clearTimeout(timeoutId);
                resolve(value ?? null);
            })
            .catch(() => {
                clearTimeout(timeoutId);
                resolve(null);
            });
    });
}

async function resolveFaviconWithTimeout(formattedDomain, getFaviconFunc, timeoutMs) {
    const fallbackUrl = `https://icons.duckduckgo.com/ip3/${formattedDomain}.ico`;

    const faviconResolution = (async () => {
        let candidateUrl = fallbackUrl;

        if (getFaviconFunc) {
            try {
                const resolved = await getFaviconFunc(formattedDomain);
                if (resolved) candidateUrl = resolved;
            } catch (e) {
                console.warn("Failed to load favicon for", formattedDomain, e);
            }
        }

        const loaded = await waitForImageLoad(candidateUrl);
        return loaded ? candidateUrl : null;
    })();

    return await withTimeout(faviconResolution, timeoutMs);
}

function renderProgress() {
    if (DOM.currentDomain) DOM.currentDomain.textContent = state.index + 1;

    const percent = ((state.index + 1) / state.domains.length) * 100;
    if (DOM.progressFill) DOM.progressFill.style.width = percent + "%";

    updatePreviousButtonState();
}

// ============================
// SCALE BUTTONS
// ============================
const SCALE = [
    { value: 1, text: "I strongly prefer this website NOT to use" },
    { value: 2, text: "I prefer this website NOT to use" },
    { value: 3, text: "I have no preference regarding" },
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
        btn.disabled = state.isInteractionLocked || state.isSelectionPending;

        if (current === item.value) btn.classList.add("is-selected");

        btn.addEventListener("click", () => handleSelection(domain, item.value, category));

        DOM.toggleContainer.appendChild(btn);
    });
}

// ============================
// SELECTION HANDLER
// ============================
async function handleSelection(domain, value, category) {
    if (state.isInteractionLocked || state.isSelectionPending) return;

    state.isSelectionPending = true;
    setInteractionLock(true);

    state.selections[domain.domain][category] = value;

    if (DOM.toggleContainer) {
        DOM.toggleContainer.querySelectorAll(".scale-btn").forEach((btn) => {
            btn.classList.toggle("is-selected", Number(btn.dataset.value) === value);
            btn.disabled = true;
        });
    }

    try {
        await savePreference(domain, category, value);
        nextDomain(category);
    } finally {
        state.isSelectionPending = false;
        updatePreviousButtonState();
    }
}

// ============================
// NAVIGATION
// ============================
function nextDomain(category) {
    if (state.index < state.domains.length - 1) {
        state.index++;
        void renderDomain(category);
    } else {
        finishCategory();
    }
}

function showPreviousDomain(category) {
    if (state.isSelectionPending) return;

    if (state.index > 0) {
        state.index--;
        void renderDomain(category);
    }
}

// ============================
// COMPLETION
// ============================
function finishCategory() {
    if (DOM.questionView) DOM.questionView.style.display = "none";
    if (DOM.completionView) DOM.completionView.style.display = "block";
    setInteractionLock(false);
    postHeight();
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

    const embedId = document.body?.dataset?.embedId || DOM.toggleContainer?.getAttribute("id") || "embed";
    window.parent.postMessage({
        type: "PRICRUMBS_EMBED_HEIGHT",
        payload: { elementId: embedId, height: h }
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
