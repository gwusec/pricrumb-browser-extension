import {
    getFavicon,
    sendExtensionMessage
} from './helper_functions.js';

const SCENARIO_GROUP_NAMES = [
    "all_cookies_accepted",
    "all_cookies_rejected",
    "ad_cookies_rejected",
    "default_cookies"
];

const FAMILIARITY_OPTIONS = [
    { value: 1, label: "1 - Not at all familiar" },
    { value: 2, label: "2 - Slightly familiar" },
    { value: 3, label: "3 - Somewhat familiar" },
    { value: 4, label: "4 - Moderately familiar" },
    { value: 5, label: "5 - Extremely familiar" }
];

const PLACEHOLDER_ICON = 'data:image/svg+xml;base64,' + btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <rect width="24" height="24" rx="4" fill="#d1d5db"/>
  <text x="12" y="16" text-anchor="middle" font-size="14" fill="#111827" font-family="Arial, sans-serif">?</text>
</svg>
`);

function normalizeDomainHash(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidDomainHash(value) {
    return /^[0-9a-f]{64}$/i.test(normalizeDomainHash(value));
}

function normalizeScenarioFamiliarityAnswer(value) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function createEmptyScenarioCandidateMap() {
    return Object.fromEntries(SCENARIO_GROUP_NAMES.map((groupName) => [groupName, []]));
}

function normalizeScenarioFamiliarityState(source) {
    const candidatesByCondition = createEmptyScenarioCandidateMap();
    const answersByHash = {};
    const candidateSource =
        source?.candidatesByCondition && typeof source.candidatesByCondition === "object"
            ? source.candidatesByCondition
            : {};

    SCENARIO_GROUP_NAMES.forEach((groupName) => {
        const seen = new Set();
        const entries = Array.isArray(candidateSource[groupName]) ? candidateSource[groupName] : [];

        candidatesByCondition[groupName] = entries.reduce((accumulator, entry) => {
            const domainHash = normalizeDomainHash(entry?.domainHash);
            const rawDomain = typeof entry?.rawDomain === "string" ? entry.rawDomain.trim() : "";
            const displayDomain = typeof entry?.displayDomain === "string" ? entry.displayDomain.trim() : "";
            const faviconDataUrl = typeof entry?.faviconDataUrl === "string"
                ? entry.faviconDataUrl.trim()
                : "";

            if (!isValidDomainHash(domainHash) || !rawDomain || seen.has(domainHash)) {
                return accumulator;
            }

            seen.add(domainHash);
            accumulator.push({
                domainHash,
                rawDomain,
                displayDomain: displayDomain || rawDomain,
                faviconDataUrl
            });
            return accumulator;
        }, []);
    });

    const rawAnswers =
        source?.answersByHash && typeof source.answersByHash === "object" && !Array.isArray(source.answersByHash)
            ? source.answersByHash
            : {};
    Object.entries(rawAnswers).forEach(([domainHashCandidate, answerCandidate]) => {
        const domainHash = normalizeDomainHash(domainHashCandidate);
        const answer = normalizeScenarioFamiliarityAnswer(answerCandidate);
        if (!isValidDomainHash(domainHash) || answer === null) return;
        answersByHash[domainHash] = answer;
    });

    const candidateCount = SCENARIO_GROUP_NAMES.reduce(
        (count, groupName) => count + candidatesByCondition[groupName].length,
        0
    );

    return {
        candidatesByCondition,
        answersByHash,
        candidateCount
    };
}

function flattenCandidates(candidatesByCondition) {
    return SCENARIO_GROUP_NAMES.flatMap((groupName) => candidatesByCondition[groupName] || []);
}

function isScenarioFamiliarityComplete(candidatesByCondition, answersByHash) {
    const candidates = flattenCandidates(candidatesByCondition);
    if (candidates.length === 0) return true;

    return candidates.every((candidate) => (
        normalizeScenarioFamiliarityAnswer(answersByHash?.[candidate.domainHash]) !== null
    ));
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

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function buildStyles() {
    return `
        :host {
            display: block;
            width: 100%;
        }

        .wrapper {
            width: 100%;
            overflow-x: auto;
            padding: 8px 0 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-family: Arial, sans-serif;
            color: #111827;
        }

        thead th {
            font-size: 15px;
            font-weight: 600;
            text-align: center;
            border-bottom: 1px solid #d1d5db;
            padding: 12px 8px;
            vertical-align: bottom;
        }

        thead th.website-col {
            width: 34%;
            text-align: left;
        }

        tbody tr:nth-child(odd) {
            background: #f8fafc;
        }

        td {
            border-bottom: 1px solid #e5e7eb;
            padding: 14px 8px;
            text-align: center;
            vertical-align: middle;
        }

        td.website-cell {
            text-align: left;
            padding-left: 12px;
        }

        .website-label {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }

        .website-label img {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            object-fit: contain;
            flex: 0 0 24px;
            background: #f3f4f6;
        }

        .website-label span {
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .radio-option {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
        }

        input[type="radio"] {
            width: 18px;
            height: 18px;
            margin: 0;
            cursor: pointer;
        }

        .loading-table td {
            color: #6b7280;
            text-align: left;
        }

        .loading-pill {
            display: inline-block;
            width: 100%;
            height: 16px;
            border-radius: 999px;
            background: linear-gradient(90deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%);
            background-size: 200% 100%;
            animation: shimmer 1.2s linear infinite;
        }

        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
}

function renderLoadingState(shadowRoot) {
    shadowRoot.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="wrapper">
            <table class="loading-table">
                <thead>
                    <tr>
                        <th class="website-col">Website domain</th>
                        ${FAMILIARITY_OPTIONS.map((option) => `<th>${escapeHtml(option.label)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${Array.from({ length: 4 }, () => `
                        <tr>
                            <td><span class="loading-pill"></span></td>
                            ${Array.from({ length: 5 }, () => `<td><span class="loading-pill"></span></td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderEmptyState(shadowRoot) {
    shadowRoot.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="wrapper" style="display:none;"></div>
    `;
}

function buildTableRow(candidate, answersByHash) {
    const checkedValue = answersByHash[candidate.domainHash] ?? null;
    const faviconSource = candidate.faviconDataUrl || PLACEHOLDER_ICON;
    const displayDomain = candidate.displayDomain || candidate.rawDomain;

    return `
        <tr data-domain-hash="${escapeHtml(candidate.domainHash)}">
            <td class="website-cell">
                <label class="website-label" for="familiarity-${escapeHtml(candidate.domainHash)}-1">
                    <img
                        src="${escapeHtml(faviconSource)}"
                        alt=""
                        aria-hidden="true"
                        data-favicon-hash="${escapeHtml(candidate.domainHash)}"
                    />
                    <span>${escapeHtml(displayDomain)}</span>
                </label>
            </td>
            ${FAMILIARITY_OPTIONS.map((option) => `
                <td>
                    <label class="radio-option" for="familiarity-${escapeHtml(candidate.domainHash)}-${option.value}">
                        <input
                            type="radio"
                            id="familiarity-${escapeHtml(candidate.domainHash)}-${option.value}"
                            name="familiarity-${escapeHtml(candidate.domainHash)}"
                            value="${option.value}"
                            data-domain-hash="${escapeHtml(candidate.domainHash)}"
                            ${checkedValue === option.value ? "checked" : ""}
                        />
                    </label>
                </td>
            `).join("")}
        </tr>
    `;
}

function renderScenarioFamiliarityTable(shadowRoot, state) {
    const flattenedCandidates = flattenCandidates(state.candidatesByCondition);

    if (flattenedCandidates.length === 0) {
        renderEmptyState(shadowRoot);
        return;
    }

    shadowRoot.innerHTML = `
        <style>${buildStyles()}</style>
        <div class="wrapper">
            <table>
                <thead>
                    <tr>
                        <th class="website-col">Website domain</th>
                        ${FAMILIARITY_OPTIONS.map((option) => `<th>${escapeHtml(option.label)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${flattenedCandidates.map((candidate) => buildTableRow(candidate, state.answersByHash)).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function persistScenarioFamiliarityAnswers(state) {
    try {
        const response = await sendExtensionMessage({
            action: "setScenarioFamiliarityAnswers",
            answersByHash: state.answersByHash
        });

        if (response?.answersByHash && typeof response.answersByHash === "object") {
            state.answersByHash = response.answersByHash;
        }
        emitScenarioFamiliarityState(state);
    } catch (error) {
        console.warn("Failed to store scenario familiarity answers:", error);
    }
}

async function hydrateFavicons(shadowRoot, candidates) {
    await Promise.all(candidates.map(async (candidate) => {
        const image = shadowRoot.querySelector(
            `img[data-favicon-hash="${candidate.domainHash}"]`
        );
        if (!image) return;

        const currentSource = typeof image.getAttribute("src") === "string"
            ? image.getAttribute("src")
            : "";
        if (candidate.faviconDataUrl && currentSource !== candidate.faviconDataUrl) {
            image.setAttribute("src", candidate.faviconDataUrl);
            return;
        }

        try {
            const favicon = await getFavicon(candidate.rawDomain);
            if (favicon) {
                image.setAttribute("src", favicon);
            }
        } catch (_error) {
            // Keep the placeholder icon.
        }
    }));
}

async function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadScenarioFamiliarityState(maxAttempts = 10) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const response = await sendExtensionMessage({ action: "getScenarioFamiliarityState" });
        if (response && typeof response === "object") {
            return normalizeScenarioFamiliarityState(response);
        }
        if (attempt < maxAttempts - 1) {
            await waitFor(500);
        }
    }

    throw new Error("Unable to load scenario familiarity state.");
}

export async function injectScenarioFamiliarityWidget(target = null) {
    if (!target) return;

    let container = target.querySelector('.ext-injected-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'ext-injected-container';
        target.innerHTML = "";
        target.appendChild(container);
    }

    let shadowRoot = container.shadowRoot;
    if (!shadowRoot) {
        shadowRoot = container.attachShadow({ mode: 'open' });
    }

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

            widgetState.answersByHash = {
                ...widgetState.answersByHash,
                [domainHash]: answer
            };

            emitScenarioFamiliarityState(widgetState);
            void persistScenarioFamiliarityAnswers(widgetState);
        });
        container.dataset.familiarityListenerAttached = "true";
    }

    renderLoadingState(shadowRoot);

    const renderWithLiveState = async () => {
        try {
            const loadedState = await loadScenarioFamiliarityState();
            widgetState.candidatesByCondition = loadedState.candidatesByCondition;
            widgetState.answersByHash = loadedState.answersByHash;
            widgetState.candidateCount = loadedState.candidateCount;
            renderScenarioFamiliarityTable(shadowRoot, widgetState);
            emitScenarioFamiliarityState(widgetState);

            if (widgetState.candidateCount > 0) {
                queueMicrotask(() => {
                    hydrateFavicons(shadowRoot, flattenCandidates(widgetState.candidatesByCondition));
                });
            }
        } catch (_error) {
            setTimeout(renderWithLiveState, 1000);
        }
    };

    await renderWithLiveState();
}
