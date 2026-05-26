import {
    getFavicon,
    sendExtensionMessage
} from './helper_functions.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCENARIO_GROUP_NAMES = [
    "all_cookies_accepted",
    "all_cookies_rejected",
    "ad_cookies_rejected",
    "default_cookies"
];

const FAMILIARITY_OPTIONS = [
    { value: 1, label: "(1) Not at all familiar" },
    { value: 2, label: "(2) Slightly familiar" },
    { value: 3, label: "(3) Somewhat familiar" },
    { value: 4, label: "(4) Moderately familiar" },
    { value: 5, label: "(5) Very familiar" },
    { value: 6, label: "(6) Extremely familiar" }
];

const SCENARIO_FOLLOWUP_OPTIONS_BY_FIELD = Object.freeze({
    pricrumbs_website_followup_trustworthiness: [
        { value: "1-not-at-all-trustworthy",  label: "(1) Not at all trustworthy" },
        { value: "2-slightly-trustworthy",     label: "(2) Slightly trustworthy" },
        { value: "3-somewhat-trustworthy",     label: "(3) Somewhat trustworthy" },
        { value: "4-moderately-trustworthy",   label: "(4) Moderately trustworthy" },
        { value: "5-very-trustworthy",         label: "(5) Very trustworthy" },
        { value: "6-extremely-trustworthy",    label: "(6) Extremely trustworthy" }
    ],
    pricrumbs_website_followup_utility: [
        { value: "1-not-at-all-useful",  label: "(1) Not at all useful" },
        { value: "2-slightly-useful",    label: "(2) Slightly useful" },
        { value: "3-somewhat-useful",    label: "(3) Somewhat useful" },
        { value: "4-moderately-useful",  label: "(4) Moderately useful" },
        { value: "5-very-useful",        label: "(5) Very useful" },
        { value: "6-extremely-useful",   label: "(6) Extremely useful" }
    ],
    pricrumbs_website_followup_privacy_concerns: [
        { value: "1-not-at-all-concerned",  label: "(1) Not at all concerned" },
        { value: "2-slightly-concerned",    label: "(2) Slightly concerned" },
        { value: "3-somewhat-concerned",    label: "(3) Somewhat concerned" },
        { value: "4-moderately-concerned",  label: "(4) Moderately concerned" },
        { value: "5-very-concerned",        label: "(5) Very concerned" },
        { value: "6-extremely-concerned",   label: "(6) Extremely concerned" }
    ]
});

const PLACEHOLDER_ICON = 'data:image/svg+xml;base64,' + btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <rect width="24" height="24" rx="4" fill="#d1d5db"/>
  <text x="12" y="16" text-anchor="middle" font-size="14" fill="#111827" font-family="Arial, sans-serif">?</text>
</svg>
`);

// ─── Shared helpers ───────────────────────────────────────────────────────────

function normalizeDomainHash(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidDomainHash(value) {
    return /^[0-9a-f]{64}$/i.test(normalizeDomainHash(value));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function toSafeDomId(value) {
    return String(value).replace(/[^a-z0-9_-]+/gi, "-");
}

function createEmptyScenarioCandidateMap() {
    return Object.fromEntries(SCENARIO_GROUP_NAMES.map((name) => [name, []]));
}

function flattenCandidates(candidatesByCondition) {
    return SCENARIO_GROUP_NAMES.flatMap((name) => candidatesByCondition[name] || []);
}

// ─── Familiarity normalization ────────────────────────────────────────────────

const FAMILIARITY_ALLOWED_VALUES = new Set(FAMILIARITY_OPTIONS.map((o) => o.value));

function normalizeScenarioFamiliarityAnswer(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && FAMILIARITY_ALLOWED_VALUES.has(parsed) ? parsed : null;
}

function normalizeScenarioFamiliarityState(source) {
    const candidatesByCondition = createEmptyScenarioCandidateMap();
    const answersByHash = {};
    const candidateSource = source?.candidatesByCondition ?? {};

    SCENARIO_GROUP_NAMES.forEach((groupName) => {
        const seen = new Set();
        candidatesByCondition[groupName] = (Array.isArray(candidateSource[groupName]) ? candidateSource[groupName] : [])
            .reduce((acc, entry) => {
                const domainHash = normalizeDomainHash(entry?.domainHash);
                const rawDomain = trimString(entry?.rawDomain);
                if (!isValidDomainHash(domainHash) || !rawDomain || seen.has(domainHash)) return acc;
                seen.add(domainHash);
                acc.push({
                    domainHash,
                    rawDomain,
                    displayDomain: trimString(entry?.displayDomain) || rawDomain,
                    faviconDataUrl: trimString(entry?.faviconDataUrl)
                });
                return acc;
            }, []);
    });

    const rawAnswers = isPlainObject(source?.answersByHash) ? source.answersByHash : {};
    Object.entries(rawAnswers).forEach(([hashCandidate, answerCandidate]) => {
        const domainHash = normalizeDomainHash(hashCandidate);
        const answer = normalizeScenarioFamiliarityAnswer(answerCandidate);
        if (!isValidDomainHash(domainHash) || answer === null) return;
        answersByHash[domainHash] = answer;
    });

    return {
        candidatesByCondition,
        answersByHash,
        candidateCount: SCENARIO_GROUP_NAMES.reduce((n, g) => n + candidatesByCondition[g].length, 0)
    };
}

function isScenarioFamiliarityComplete(candidatesByCondition, answersByHash) {
    const candidates = flattenCandidates(candidatesByCondition);
    return candidates.length === 0 ||
        candidates.every((c) => normalizeScenarioFamiliarityAnswer(answersByHash?.[c.domainHash]) !== null);
}

function emitScenarioFamiliarityState(state) {
    window.postMessage({
        type: "FROM_EXTENSION_SCENARIO_FAMILIARITY_STATE",
        payload: {
            candidatesByCondition: state.candidatesByCondition,
            answersByHash: state.answersByHash,
            candidateCount: state.candidateCount,
            complete: isScenarioFamiliarityComplete(state.candidatesByCondition, state.answersByHash)
        }
    }, "*");
}

// ─── Followup normalization ───────────────────────────────────────────────────

function getScenarioFollowupOptions(fieldName) {
    return SCENARIO_FOLLOWUP_OPTIONS_BY_FIELD[fieldName] || [];
}

function normalizeScenarioFollowupAnswer(value, fieldName) {
    const normalized = trimString(value);
    if (!normalized) return "";
    const allowed = new Set(getScenarioFollowupOptions(fieldName).map((o) => o.value));
    return allowed.has(normalized) ? normalized : "";
}

function normalizeScenarioFollowupState(source, fieldName) {
    const empty = createEmptyScenarioFollowupState(fieldName);
    if (getScenarioFollowupOptions(fieldName).length === 0) return empty;

    const familiarDomainHashes = deduplicateHashes(
        Array.isArray(source?.familiarDomainHashes) ? source.familiarDomainHashes : []
    );
    const familiarHashSet = new Set(familiarDomainHashes);
    const rawMetadataByHash = isPlainObject(source?.metadataByHash) ? source.metadataByHash : {};

    const metadataByHash = Object.fromEntries(
        familiarDomainHashes.map((domainHash) => {
            const raw = rawMetadataByHash[domainHash] || {};
            const rawDomain = trimString(raw?.rawDomain);
            const displayDomain = trimString(raw?.displayDomain);
            return [domainHash, {
                rawDomain: rawDomain || displayDomain || domainHash,
                displayDomain: displayDomain || rawDomain || domainHash,
                faviconDataUrl: trimString(raw?.faviconDataUrl)
            }];
        })
    );

    const answersByHash = {};
    const rawAnswersByHash = isPlainObject(source?.answersByHash) ? source.answersByHash : {};
    Object.entries(rawAnswersByHash).forEach(([hashCandidate, answerCandidate]) => {
        const domainHash = normalizeDomainHash(hashCandidate);
        if (!familiarHashSet.has(domainHash)) return;
        const answer = normalizeScenarioFollowupAnswer(answerCandidate, fieldName);
        if (answer) answersByHash[domainHash] = answer;
    });

    return { fieldName, familiarDomainHashes, familiarCount: familiarDomainHashes.length, answersByHash, metadataByHash };
}

function createEmptyScenarioFollowupState(fieldName) {
    return { fieldName, familiarDomainHashes: [], familiarCount: 0, answersByHash: {}, metadataByHash: {} };
}

function emitScenarioFollowupState(state) {
    window.postMessage({
        type: "FROM_EXTENSION_SCENARIO_FOLLOWUP_STATE",
        payload: { fieldName: state.fieldName, answersByHash: state.answersByHash }
    }, "*");
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deduplicateHashes(rawHashes) {
    const seen = new Set();
    return rawHashes.reduce((acc, entry) => {
        const hash = normalizeDomainHash(entry);
        if (!isValidDomainHash(hash) || seen.has(hash)) return acc;
        seen.add(hash);
        acc.push(hash);
        return acc;
    }, []);
}

function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Shared DOM helpers ───────────────────────────────────────────────────────

function getOrCreateShadowContainer(target) {
    let container = target.querySelector(".ext-injected-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "ext-injected-container";
        target.innerHTML = "";
        target.appendChild(container);
    }
    if (!container.shadowRoot) {
        container.attachShadow({ mode: "open" });
    }
    return container;
}

function buildStyles() {
    return `
        :host { display: block; width: 100%; }

        .wrapper { width: 100%; overflow-x: auto; padding: 8px 0 0; }

        table {
            width: 100%; border-collapse: collapse; table-layout: fixed;
            font-family: Arial, sans-serif; color: #111827;
        }

        thead th { text-align: center; border-bottom: 1px solid #d1d5db; padding: 12px 8px; }
        thead th.website-col { text-align: left; width: 190px; }

        tbody tr:nth-child(odd) { background: #f8fafc; }

        td { border-bottom: 1px solid #e5e7eb; padding: 14px 8px; text-align: center; vertical-align: middle; }
        td.website-cell { text-align: left; padding-left: 12px; width: 190px; }

        .website-label { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
        .website-label img {
            width: 24px; height: 24px; border-radius: 4px;
            object-fit: contain; flex: 0 0 24px; background: #f3f4f6;
        }
        .website-label span { white-space: nowrap; overflow-wrap: normal; word-break: normal; }

        .radio-option { display: inline-flex; align-items: center; justify-content: center; width: 100%; }
        input[type="radio"] { width: 18px; height: 18px; margin: 0; cursor: pointer; }

        .loading-pill {
            display: inline-block; width: 100%; height: 16px; border-radius: 999px;
            background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%);
            background-size: 200% 100%; animation: shimmer 1.2s linear infinite;
        }
        @keyframes shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
}

function renderLoadingTable(shadowRoot, options) {
    const cols = options.map((o) => `<th>${escapeHtml(o.label)}</th>`).join("");
    const cells = Array.from({ length: options.length }, () => `<td><span class="loading-pill"></span></td>`).join("");
    const rows = Array.from({ length: 4 }, () => `<tr><td><span class="loading-pill"></span></td>${cells}</tr>`).join("");
    shadowRoot.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="wrapper">
            <table class="loading-table">
                <thead><tr><th class="website-col">Website</th>${cols}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function renderEmptyState(shadowRoot) {
    shadowRoot.innerHTML = `<style>${buildStyles()}</style><div class="wrapper" style="display:none;"></div>`;
}

function renderTable(shadowRoot, options, headerHtml, rowsHtml) {
    const cols = options.map((o) => `<th>${escapeHtml(o.label)}</th>`).join("");
    shadowRoot.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="wrapper">
            <table>
                <thead><tr><th class="website-col">Website</th>${cols}</tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
}

function buildWebsiteCell(domainHash, faviconDataUrl, displayDomain, labelForId) {
    const src = escapeHtml(faviconDataUrl || PLACEHOLDER_ICON);
    return `
        <td class="website-cell">
            <label class="website-label" for="${escapeHtml(labelForId)}">
                <img src="${src}" alt="" aria-hidden="true" data-favicon-hash="${escapeHtml(domainHash)}"/>
                <span>${escapeHtml(displayDomain)}</span>
            </label>
        </td>`;
}

// ─── Familiarity widget rendering ─────────────────────────────────────────────

function buildFamiliarityRow(candidate, answersByHash) {
    const { domainHash, faviconDataUrl, displayDomain, rawDomain } = candidate;
    const checkedValue = answersByHash[domainHash] ?? null;
    const cells = FAMILIARITY_OPTIONS.map((opt) => `
        <td>
            <label class="radio-option" for="familiarity-${escapeHtml(domainHash)}-${opt.value}">
                <input
                    type="radio"
                    id="familiarity-${escapeHtml(domainHash)}-${opt.value}"
                    name="familiarity-${escapeHtml(domainHash)}"
                    value="${opt.value}"
                    data-domain-hash="${escapeHtml(domainHash)}"
                    ${checkedValue === opt.value ? "checked" : ""}
                />
            </label>
        </td>`).join("");

    return `<tr data-domain-hash="${escapeHtml(domainHash)}">
        ${buildWebsiteCell(domainHash, faviconDataUrl, displayDomain || rawDomain, `familiarity-${domainHash}-1`)}
        ${cells}
    </tr>`;
}

function renderFamiliarityTable(shadowRoot, state) {
    const candidates = flattenCandidates(state.candidatesByCondition);
    if (candidates.length === 0) { renderEmptyState(shadowRoot); return; }
    const rows = candidates.map((c) => buildFamiliarityRow(c, state.answersByHash)).join("");
    renderTable(shadowRoot, FAMILIARITY_OPTIONS, null, rows);
}

async function hydrateFavicons(shadowRoot, candidates) {
    await Promise.all(candidates.map(async (candidate) => {
        const img = shadowRoot.querySelector(`img[data-favicon-hash="${candidate.domainHash}"]`);
        if (!img) return;
        if (candidate.faviconDataUrl && img.getAttribute("src") !== candidate.faviconDataUrl) {
            img.setAttribute("src", candidate.faviconDataUrl);
            return;
        }
        try {
            const favicon = await getFavicon(candidate.rawDomain);
            if (favicon) img.setAttribute("src", favicon);
        } catch { /* keep placeholder */ }
    }));
}

async function persistScenarioFamiliarityAnswers(state) {
    try {
        const response = await sendExtensionMessage({
            action: "setScenarioFamiliarityAnswers",
            answersByHash: state.answersByHash
        });
        if (isPlainObject(response?.answersByHash)) {
            state.answersByHash = response.answersByHash;
        }
        emitScenarioFamiliarityState(state);
    } catch (error) {
        console.warn("Failed to store scenario familiarity answers:", error);
    }
}

async function loadScenarioFamiliarityState(maxAttempts = 10) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await sendExtensionMessage({ action: "getScenarioFamiliarityState" });
        if (response && typeof response === "object") return normalizeScenarioFamiliarityState(response);
        if (attempt < maxAttempts - 1) await waitFor(500);
    }
    throw new Error("Unable to load scenario familiarity state.");
}

export async function injectScenarioFamiliarityWidget(target = null) {
    if (!target) return;

    const container = getOrCreateShadowContainer(target);
    const shadowRoot = container.shadowRoot;

    const widgetState = {
        candidatesByCondition: createEmptyScenarioCandidateMap(),
        answersByHash: {},
        candidateCount: -1
    };

    if (!container.dataset.familiarityListenerAttached) {
        shadowRoot.addEventListener("change", (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;
            const domainHash = normalizeDomainHash(input.getAttribute("data-domain-hash"));
            const answer = normalizeScenarioFamiliarityAnswer(input.value);
            if (!isValidDomainHash(domainHash) || answer === null) return;
            widgetState.answersByHash = { ...widgetState.answersByHash, [domainHash]: answer };
            emitScenarioFamiliarityState(widgetState);
            void persistScenarioFamiliarityAnswers(widgetState);
        });
        container.dataset.familiarityListenerAttached = "true";
    }

    renderLoadingTable(shadowRoot, FAMILIARITY_OPTIONS);

    const renderWithLiveState = async () => {
        try {
            const loaded = await loadScenarioFamiliarityState();
            Object.assign(widgetState, loaded);
            renderFamiliarityTable(shadowRoot, widgetState);
            emitScenarioFamiliarityState(widgetState);
            if (widgetState.candidateCount > 0) {
                queueMicrotask(() => hydrateFavicons(shadowRoot, flattenCandidates(widgetState.candidatesByCondition)));
            }
        } catch {
            setTimeout(renderWithLiveState, 1000);
        }
    };

    await renderWithLiveState();
}

// ─── Followup widget rendering ────────────────────────────────────────────────

function buildFollowupRow(state, domainHash) {
    const options = getScenarioFollowupOptions(state.fieldName);
    const metadata = state.metadataByHash[domainHash] || {};
    const checkedValue = trimString(state.answersByHash?.[domainHash]);
    const displayDomain = metadata.displayDomain || metadata.rawDomain || domainHash;
    const idPrefix = toSafeDomId(`followup-${state.fieldName}-${domainHash}`);
    const radioName = escapeHtml(`followup-${toSafeDomId(`${state.fieldName}-${domainHash}`)}`);

    const cells = options.map((opt, i) => `
        <td>
            <label class="radio-option" for="${escapeHtml(`${idPrefix}-${i}`)}">
                <input
                    type="radio"
                    id="${escapeHtml(`${idPrefix}-${i}`)}"
                    name="${radioName}"
                    value="${escapeHtml(opt.value)}"
                    data-domain-hash="${escapeHtml(domainHash)}"
                    data-field-name="${escapeHtml(state.fieldName)}"
                    ${checkedValue === opt.value ? "checked" : ""}
                />
            </label>
        </td>`).join("");

    return `<tr data-domain-hash="${escapeHtml(domainHash)}">
        ${buildWebsiteCell(domainHash, metadata.faviconDataUrl, displayDomain, `${idPrefix}-0`)}
        ${cells}
    </tr>`;
}

function renderFollowupTable(shadowRoot, state) {
    const options = getScenarioFollowupOptions(state.fieldName);
    if (options.length === 0 || state.familiarDomainHashes.length === 0) { renderEmptyState(shadowRoot); return; }
    const rows = state.familiarDomainHashes.map((h) => buildFollowupRow(state, h)).join("");
    renderTable(shadowRoot, options, null, rows);
}

async function hydrateFollowupFavicons(shadowRoot, state) {
    await Promise.all(state.familiarDomainHashes.map(async (domainHash) => {
        const img = shadowRoot.querySelector(`img[data-favicon-hash="${domainHash}"]`);
        if (!img) return;
        const metadata = state.metadataByHash?.[domainHash] || {};
        if (metadata.faviconDataUrl && img.getAttribute("src") !== metadata.faviconDataUrl) {
            img.setAttribute("src", metadata.faviconDataUrl);
            return;
        }
        const rawDomain = trimString(metadata.rawDomain);
        if (!rawDomain) return;
        try {
            const favicon = await getFavicon(rawDomain);
            if (!favicon) return;
            img.setAttribute("src", favicon);
            state.metadataByHash[domainHash] = { ...metadata, faviconDataUrl: favicon };
        } catch { /* keep placeholder */ }
    }));
}

function requestScenarioFollowupWidgetState(fieldName) {
    if (!fieldName) return;
    window.postMessage({ type: "FROM_EXTENSION_SCENARIO_FOLLOWUP_WIDGET_REQUEST", payload: { fieldName } }, "*");
}

export async function injectScenarioFollowupWidget(target = null, fieldName = "") {
    if (!target || getScenarioFollowupOptions(fieldName).length === 0) return;

    const container = getOrCreateShadowContainer(target);
    const shadowRoot = container.shadowRoot;
    const widgetState = createEmptyScenarioFollowupState(fieldName);

    const renderWithCurrentState = () => {
        renderFollowupTable(shadowRoot, widgetState);
        if (widgetState.familiarCount > 0) {
            queueMicrotask(() => void hydrateFollowupFavicons(shadowRoot, widgetState));
        }
    };

    const applyIncomingState = (payload) => {
        const normalized = normalizeScenarioFollowupState(payload, fieldName);
        Object.assign(widgetState, normalized);
        renderWithCurrentState();
    };

    const changeListenerFlag = `scenarioFollowupChangeListenerAttached_${fieldName}`;
    if (!container.dataset[changeListenerFlag]) {
        shadowRoot.addEventListener("change", (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || input.type !== "radio") return;
            if (trimString(input.getAttribute("data-field-name")) !== fieldName) return;
            const domainHash = normalizeDomainHash(input.getAttribute("data-domain-hash"));
            const answer = normalizeScenarioFollowupAnswer(input.value, fieldName);
            if (!isValidDomainHash(domainHash) || !answer) return;
            if (!widgetState.familiarDomainHashes.includes(domainHash)) return;
            widgetState.answersByHash = { ...widgetState.answersByHash, [domainHash]: answer };
            emitScenarioFollowupState(widgetState);
        });
        container.dataset[changeListenerFlag] = "true";
    }

    if (!container.__scenarioFollowupMessageHandlers) container.__scenarioFollowupMessageHandlers = {};
    if (!container.__scenarioFollowupMessageHandlers[fieldName]) {
        const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== "FROM_SURVEY_SCENARIO_FOLLOWUP_STATE") return;
            const payload = event.data?.payload || {};
            if (payload.fieldName !== fieldName) return;
            applyIncomingState(payload);
        };
        window.addEventListener("message", handler);
        container.__scenarioFollowupMessageHandlers[fieldName] = handler;
    }

    renderLoadingTable(shadowRoot, getScenarioFollowupOptions(fieldName));

    requestScenarioFollowupWidgetState(fieldName);
    setTimeout(() => requestScenarioFollowupWidgetState(fieldName), 500);
    setTimeout(() => requestScenarioFollowupWidgetState(fieldName), 1200);
}
