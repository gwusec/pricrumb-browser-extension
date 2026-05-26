// background.js

// Load polyfill and shim in MV3 background service worker
import "./ext-shim.js";
import { buildDomain, extractMainDomainName, getCookieData } from "./helper_functions.js";

async function listAllStorageKeys() {
  try {
    // Get everything in storage
    const allItems = await browser.storage.local.get();

    // Extract keys
    const keys = Object.keys(allItems);

    console.log("All keys in storage:", keys);
    console.log("Full storage contents:", allItems);
  } catch (err) {
    console.error("Failed to list storage keys:", err);
  }
}

// Run it
listAllStorageKeys();



const historyCache = {}; // Cache to store history data per domain
const visitedDomainsCache = new Set(); // Cache to store domains the user has visited
let visitedDomainsCacheLastUpdated = 0; // Timestamp of last update to visitedDomainsCache
let top1mDomainRankMapPromise = null;
const domainHashCache = new Map();
let browsingHistoryDataCache = null;
let browsingHistoryDataCacheLastUpdated = 0;
const DOMAIN_HASH_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_SURVEY_API_BASE_URL = "https://nets.gwusec.seas.gwu.edu";
const DEFAULT_DOMAIN_HASH_SERVICE_PATH = "/postsurvey/hash-domains";
const SCENARIO_FAMILIARITY_CANDIDATES_KEY = "scenarioFamiliarityCandidates";
const SCENARIO_FAMILIARITY_ANSWERS_KEY = "scenarioFamiliarityAnswers";
const SELECTED_SCENARIO_DOMAIN_HASHES_KEY = "selectedScenarioDomainHashes";
const SCENARIO_FAMILIARITY_CANDIDATES_DEDUPE_VERSION = 2;
const SCENARIO_GROUP_NAMES = [
  "all_cookies_accepted",
  "all_cookies_rejected",
  "ad_cookies_rejected",
  "default_cookies"
];
const MAX_SCENARIO_FAMILIARITY_CANDIDATES_PER_GROUP = 3;
const SCENARIO_DISPLAY_DOMAIN_TRIM_ANCHORS = new Set([
  "com",
  "org",
  "edu",
  "gov",
  "net",
  "mil",
  "int",
  "biz",
  "info"
]);
const faviconDataUrlCache = new Map();

/*
 * Extension lifecycle: installation / update phase
 *
 * This handler runs when the browser installs or updates the extension.
 * Use it for one-time setup, migrations, or default configuration.
 *
 * Runs in the background context (service worker), not in content scripts.
 */
browser.runtime.onInstalled.addListener(async () => {

  const tabs = await browser.tabs.query({
    url: [
      "http://localhost:*/*",
      "*://gwuaddressatsomepoint/*"
    ]
  });

  //browser.tabs.query({ url: "*://*.mozilla.org/*" })

  const surveyTab = tabs.find(tab =>
    tab.url && tab.url.includes("/survey")
  );

  if (surveyTab) {
    await browser.tabs.update(surveyTab.id, { active: true });
    await browser.windows.update(surveyTab.windowId, { focused: true });
  } else {
    // await browser.tabs.create({
    //     url: "http://localhost:5173/survey",
    //     active: true
    // });
  }
});



// Parse top-1m-websites.csv once and cache the Map<domain, rank_range>
async function getTop1mDomainRankMap() {
  if (top1mDomainRankMapPromise) {
    return top1mDomainRankMapPromise;
  }

  top1mDomainRankMapPromise = (async () => {
    const response = await fetch(ext.runtime.getURL("top-1m-websites.csv"));
    const text = await response.text();
    const map = new Map();

    text.split(/\r?\n/).forEach(line => {
      if (!line) return;
      const commaIndex = line.indexOf(",");
      if (commaIndex === -1) return;
      const rankRange = line.slice(0, commaIndex).trim();
      const domain = line.slice(commaIndex + 1).trim().toLowerCase();
      if (domain && !map.has(domain)) {
        map.set(domain, rankRange);
      }
    });

    console.log(`Loaded top-1m domain map with ${map.size} entries`);
    return map;
  })();

  return top1mDomainRankMapPromise;
}

function canonicalizeDomain(domain) {
  let d = String(domain || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.split("/")[0];
  if (d.startsWith(".")) d = d.slice(1);
  if (d.endsWith(".")) d = d.slice(0, -1);
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

function canonicalizeScenarioDisplayDomain(domain) {
  const canonical = canonicalizeDomain(domain);
  if (!canonical) return "";

  const labels = canonical.split(".").filter(Boolean);
  if (!labels.length) return "";

  const anchorIndex = labels.findIndex((label) => SCENARIO_DISPLAY_DOMAIN_TRIM_ANCHORS.has(label));
  if (anchorIndex === -1) return canonical;

  return labels.slice(0, anchorIndex + 1).join(".");
}

function normalizeHttpUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch (_error) {
    return "";
  }
}

function normalizeServicePath(value) {
  if (typeof value !== "string") return DEFAULT_DOMAIN_HASH_SERVICE_PATH;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_DOMAIN_HASH_SERVICE_PATH;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function buildDomainHashServiceEndpoint(baseUrl) {
  const normalizedBase = normalizeHttpUrl(baseUrl) || DEFAULT_SURVEY_API_BASE_URL;
  const path = normalizeServicePath(DEFAULT_DOMAIN_HASH_SERVICE_PATH);
  return `${normalizedBase}${path}`;
}

async function resolveDomainHashServiceEndpoint() {
  try {
    const stored = await ext.storage.local.get([
      "domainHashServiceEndpoint",
      "surveyApiBaseUrl"
    ]);

    const configuredEndpoint = normalizeHttpUrl(stored.domainHashServiceEndpoint);
    if (configuredEndpoint) return configuredEndpoint;

    const configuredBase = normalizeHttpUrl(stored.surveyApiBaseUrl);
    if (configuredBase) {
      return buildDomainHashServiceEndpoint(configuredBase);
    }
  } catch (error) {
    console.warn("Failed to load service config from storage:", error);
  }

  return buildDomainHashServiceEndpoint(DEFAULT_SURVEY_API_BASE_URL);
}

function isHexDomainHash(value, lengths = [64]) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) return false;
  return lengths.includes(normalized.length);
}

async function hashDomains(domains, { strict = false } = {}) {
  const canonicalDomains = Array.from(
    new Set(
      (Array.isArray(domains) ? domains : [])
        .map(canonicalizeDomain)
        .filter(Boolean)
    )
  );

  if (!canonicalDomains.length) {
    return new Map();
  }

  const uncachedDomains = canonicalDomains.filter((domain) => !domainHashCache.has(domain));
  if (uncachedDomains.length) {
    const domainHashServiceEndpoint = await resolveDomainHashServiceEndpoint();
    if (!domainHashServiceEndpoint) {
      throw new Error("Domain hash service endpoint is not configured.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOMAIN_HASH_REQUEST_TIMEOUT_MS);
    let response = null;

    try {
      response = await fetch(domainHashServiceEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: uncachedDomains }),
        signal: controller.signal
      });
    } catch (error) {
      if (strict) {
        throw new Error(`Failed to reach domain hash service: ${error.message}`);
      }
      console.warn("Domain hash service request failed:", error);
      return new Map(
        canonicalDomains
          .filter((domain) => domainHashCache.has(domain))
          .map((domain) => [domain, domainHashCache.get(domain)])
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Domain hash service responded ${response.status}: ${text}`);
    }

    const payload = await response.json();
    const hashes = Array.isArray(payload?.hashes) ? payload.hashes : [];

    hashes.forEach((entry) => {
      const domain = canonicalizeDomain(entry?.domain);
      const domainHash = String(entry?.domainHash || "").trim().toLowerCase();
      if (!domain || !isHexDomainHash(domainHash, [64])) { console.warn("Invalid domain hash", entry); return; }
      domainHashCache.set(domain, domainHash);
      //domainHashCache.set(domain, domain); // for debugging only
    });
  }

  const result = new Map();
  canonicalDomains.forEach((domain) => {
    const hash = domainHashCache.get(domain);
    if (hash) {
      result.set(domain, hash);
    }
  });

  if (strict) {
    const missing = canonicalDomains.filter((domain) => !result.has(domain));
    if (missing.length) {
      throw new Error(`Domain hash service did not return hashes for ${missing.length} domain(s).`);
    }
  }

  return result;
}

function normalizeConsentBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") return true;
    if (normalized === "no" || normalized === "false" || normalized === "0") return false;
  }
  return null;
}

function normalizeActionTakenValue(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  if (typeof value === "number") {
    if (value === 1) return "yes";
    if (value === 0) return "no";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes" || normalized === "true" || normalized === "1") return "yes";
    if (normalized === "no" || normalized === "false" || normalized === "0") return "no";
    if (normalized.startsWith("yes")) return "yes";
    if (normalized.startsWith("no")) return "no";
  }
  return "unknown";
}

function resolveActionTakenValue(record) {
  if (!record || typeof record !== "object") return "unknown";
  return normalizeActionTakenValue(
    record.actionTaken ??
    record["action taken"] ??
    record.action_taken
  );
}

function normalizeScenarioDomainHash(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getScenarioRootDomainKey(domain) {
  return extractMainDomainName(domain);
}

function createEmptyScenarioCandidateMap() {
  return Object.fromEntries(SCENARIO_GROUP_NAMES.map((groupName) => [groupName, []]));
}

function isValidScenarioFamiliarityCandidateEntry(entry) {
  const domainHash = normalizeScenarioDomainHash(entry?.domainHash);
  const rawDomain = typeof entry?.rawDomain === "string" ? entry.rawDomain.trim() : "";
  const displayDomain = typeof entry?.displayDomain === "string" ? entry.displayDomain.trim() : "";
  if (!isHexDomainHash(domainHash, [64]) || !rawDomain || !displayDomain) return false;
  return canonicalizeScenarioDisplayDomain(rawDomain) === displayDomain;
}

function getScenarioFamiliarityCandidateVersion(candidatesByCondition) {
  const version = Number(candidatesByCondition?.__dedupeVersion);
  return Number.isInteger(version) ? version : 0;
}

function setScenarioFamiliarityCandidateVersion(candidatesByCondition) {
  candidatesByCondition.__dedupeVersion = SCENARIO_FAMILIARITY_CANDIDATES_DEDUPE_VERSION;
}

function hasScenarioFamiliarityCandidates(candidatesByCondition) {
  if (!candidatesByCondition || typeof candidatesByCondition !== "object") return false;

  if (!SCENARIO_GROUP_NAMES.every((groupName) => Array.isArray(candidatesByCondition[groupName]))) {
    return false;
  }

  let hasAnyCandidates = false;
  const hasValidShape = SCENARIO_GROUP_NAMES.every((groupName) => {
    const entries = candidatesByCondition[groupName];
    if (!entries.length) return true;

    hasAnyCandidates = true;
    const seenHashes = new Set();

    return entries.every((entry) => {
      if (!isValidScenarioFamiliarityCandidateEntry(entry)) return false;

      const domainHash = normalizeScenarioDomainHash(entry.domainHash);
      if (seenHashes.has(domainHash)) return false;
      seenHashes.add(domainHash);
      return true;
    });
  });

  return hasValidShape &&
    hasAnyCandidates &&
    getScenarioFamiliarityCandidateVersion(candidatesByCondition) === SCENARIO_FAMILIARITY_CANDIDATES_DEDUPE_VERSION;
}

function parseStoredCookieArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createEmptySelectedScenarioDomainHashes() {
  return Object.fromEntries(SCENARIO_GROUP_NAMES.map((groupName) => [groupName, null]));
}

function normalizeSelectedScenarioDomainHashes(value) {
  const normalized = createEmptySelectedScenarioDomainHashes();
  if (!value || typeof value !== "object") return normalized;

  SCENARIO_GROUP_NAMES.forEach((groupName) => {
    const domainHash = normalizeScenarioDomainHash(value[groupName]);
    normalized[groupName] = isHexDomainHash(domainHash, [64]) ? domainHash : null;
  });

  return normalized;
}

function normalizeScenarioFamiliarityAnswerValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1 && value <= 6 ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 6 ? parsed : null;
  }
  return null;
}

function normalizeScenarioFamiliarityAnswers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const normalized = {};
  Object.entries(value).forEach(([domainHashCandidate, answerCandidate]) => {
    const domainHash = normalizeScenarioDomainHash(domainHashCandidate);
    const answer = normalizeScenarioFamiliarityAnswerValue(answerCandidate);
    if (!isHexDomainHash(domainHash, [64]) || answer === null) return;
    normalized[domainHash] = answer;
  });

  return normalized;
}

function getScenarioFamiliarityCandidateCount(candidatesByCondition) {
  return SCENARIO_GROUP_NAMES.reduce(
    (count, groupName) => count + (Array.isArray(candidatesByCondition?.[groupName]) ? candidatesByCondition[groupName].length : 0),
    0
  );
}

function pruneScenarioFamiliarityAnswers(candidatesByCondition, answersByHash) {
  const normalizedAnswers = normalizeScenarioFamiliarityAnswers(answersByHash);
  const validHashes = new Set();

  SCENARIO_GROUP_NAMES.forEach((groupName) => {
    const candidates = Array.isArray(candidatesByCondition?.[groupName])
      ? candidatesByCondition[groupName]
      : [];
    candidates.forEach((candidate) => {
      const domainHash = normalizeScenarioDomainHash(candidate?.domainHash);
      if (isHexDomainHash(domainHash, [64])) {
        validHashes.add(domainHash);
      }
    });
  });

  const pruned = {};
  Object.entries(normalizedAnswers).forEach(([domainHash, answer]) => {
    if (validHashes.has(domainHash)) {
      pruned[domainHash] = answer;
    }
  });

  return pruned;
}

function isScenarioFamiliarityComplete(candidatesByCondition, answersByHash) {
  const candidateCount = getScenarioFamiliarityCandidateCount(candidatesByCondition);
  if (candidateCount === 0) return true;

  const prunedAnswers = pruneScenarioFamiliarityAnswers(candidatesByCondition, answersByHash);
  return SCENARIO_GROUP_NAMES.every((groupName) => {
    const candidates = Array.isArray(candidatesByCondition?.[groupName])
      ? candidatesByCondition[groupName]
      : [];
    return candidates.every((candidate) => {
      const domainHash = normalizeScenarioDomainHash(candidate?.domainHash);
      return isHexDomainHash(domainHash, [64]) && prunedAnswers[domainHash] !== undefined;
    });
  });
}

function getScenarioConditionForCookie(cookie) {
  const actionTaken = resolveActionTakenValue(cookie);
  if (actionTaken === "no") return "default_cookies";
  if (actionTaken !== "yes") return null;

  const functional = normalizeConsentBoolean(cookie?.categories?.functional ?? cookie?.functional);
  const performance = normalizeConsentBoolean(cookie?.categories?.performance ?? cookie?.performance);
  const advertising = normalizeConsentBoolean(cookie?.categories?.advertising ?? cookie?.advertising);

  if (functional === true && performance === true && advertising === true) {
    return "all_cookies_accepted";
  }
  if (functional === false && performance === false && advertising === false) {
    return "all_cookies_rejected";
  }
  if (functional === true && performance === true && advertising === false) {
    return "ad_cookies_rejected";
  }

  return null;
}

function getScenarioCandidateSortKey(entry) {
  return [
    -(entry.visitCount || 0),
    entry.rawDomain || "",
    entry.domainHash || ""
  ];
}

function compareScenarioCandidates(a, b) {
  const [aVisits, aDomain, aHash] = getScenarioCandidateSortKey(a);
  const [bVisits, bDomain, bHash] = getScenarioCandidateSortKey(b);
  if (aVisits !== bVisits) return aVisits - bVisits;
  const domainCompare = aDomain.localeCompare(bDomain);
  if (domainCompare !== 0) return domainCompare;
  return aHash.localeCompare(bHash);
}

async function fetchFaviconAsDataURL(url) {
  if (typeof url !== "string" || !url.trim()) return null;

  if (faviconDataUrlCache.has(url)) {
    return faviconDataUrlCache.get(url);
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") || "";

      // HARD FILTER: reject non-images
      if (!contentType.startsWith("image/")) {
        return null;
      }

      const blob = await response.blob();

      if (!blob || blob.size === 0) return null;

      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();

  faviconDataUrlCache.set(url, fetchPromise);

  const result = await fetchPromise;

  // IMPORTANT: don’t cache failures permanently
  if (!result) {
    faviconDataUrlCache.delete(url);
  }

  return result;
}

async function withTimeout(promise, timeoutMs) {
  return await new Promise((resolve) => {
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

const faviconCache = new Map();

async function resolveFaviconDataUrlForDomain(domain) {
  const canonicalDomain = canonicalizeDomain(domain);
  if (!canonicalDomain) return null;

  // Cache
  if (faviconCache.has(canonicalDomain)) {
    return faviconCache.get(canonicalDomain);
  }

  const resultPromise = resolveFaviconInternal(canonicalDomain);
  faviconCache.set(canonicalDomain, resultPromise);

  try {
    return await resultPromise;
  } catch {
    faviconCache.delete(canonicalDomain);
    return null;
  }
}

async function resolveFaviconInternal(domain) {
  // 1. Existing browser tab favicon (fastest + best)
  const tabFavicon = await getTabFavicon(domain);
  if (tabFavicon) return tabFavicon;

  // 2. Try common favicon locations first
  const commonCandidates = [
    `https://${domain}/favicon.ico`,
    `https://${domain}/favicon.png`,
    `https://${domain}/apple-touch-icon.png`,
    `https://www.${domain}/favicon.ico`,
    `https://www.${domain}/favicon.png`,
    `https://www.${domain}/apple-touch-icon.png`,
  ];

  for (const url of commonCandidates) {
    const icon = await fetchFaviconAsDataURL(url);
    if (icon) return icon;
  }

  // 3. Parse homepage only if needed
  const discoveredIcon = await discoverFaviconFromHtml(domain);
  if (discoveredIcon) return discoveredIcon;

  return null;
}

async function getTabFavicon(domain) {
  try {
    const tabs = await ext.tabs.query({});

    for (const tab of tabs) {
      if (!tab?.url || !tab?.favIconUrl) continue;

      try {
        const tabDomain = canonicalizeDomain(
          new URL(tab.url).hostname
        );

        if (tabDomain !== domain) continue;

        const icon = await fetchFaviconAsDataURL(tab.favIconUrl);
        if (icon) return icon;
      } catch {
        // ignore invalid tab URL
      }
    }
  } catch {
    // ignore extension API failures
  }

  return null;
}

async function discoverFaviconFromHtml(domain) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const response = await fetch(`https://${domain}`, {
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Better favicon rel matching
    const linkMatches = [
      ...html.matchAll(
        /<link[^>]+rel=["'][^"']*(icon|apple-touch-icon)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi
      ),
    ];

    for (const match of linkMatches) {
      const href = match[2];

      try {
        const iconUrl = new URL(
          href,
          `https://${domain}/`
        ).toString();

        const icon = await fetchFaviconAsDataURL(iconUrl);

        if (icon) return icon;
      } catch {
        // ignore malformed URL
      }
    }
  } catch {
    // ignore network/abort errors
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

async function getScenarioCandidateSourceData() {
  const stored = await ext.storage.local.get([
    "cookieData",
    "cookiesAndDomains",
    "browsingHistoryData"
  ]);

  const cookieData = Array.isArray(stored.cookieData) && stored.cookieData.length > 0
    ? stored.cookieData
    : parseStoredCookieArray(stored.cookiesAndDomains);
  let browsingHistoryData = Array.isArray(stored.browsingHistoryData)
    ? stored.browsingHistoryData
    : [];

  if (browsingHistoryData.length === 0 && cookieData.length > 0) {
    browsingHistoryData = await getBrowsingHistoryData(false).catch(() => []);
  }

  return {
    cookieData: Array.isArray(cookieData) ? cookieData : [],
    browsingHistoryData: Array.isArray(browsingHistoryData) ? browsingHistoryData : []
  };
}

async function buildScenarioFamiliarityCandidates() {

  const { cookieData, browsingHistoryData } = await getScenarioCandidateSourceData();
  const visitCountByHash = new Map(
    (Array.isArray(browsingHistoryData) ? browsingHistoryData : [])
      .map((record) => [normalizeScenarioDomainHash(record?.domainHash), Number(record?.numberOfVisits) || 0])
      .filter(([domainHash]) => isHexDomainHash(domainHash, [64]))
  );
  const pendingEntries = [];
  const missingHashDomains = new Set();

  cookieData.forEach((cookie) => {
    const groupName = getScenarioConditionForCookie(cookie);
    if (!groupName) return;

    const rawDomain = canonicalizeDomain(cookie?.domain || cookie?.originalDomain || cookie?.url || "");
    if (!rawDomain) return;

    const domainHash = normalizeScenarioDomainHash(cookie?.domainHash);
    const entry = {
      groupName,
      rawDomain,
      domainHash: isHexDomainHash(domainHash, [64]) ? domainHash : "",
      visitCount: Number(cookie?.totalVisitCount) || Number(cookie?.numberOfVisits) || 0
    };

    if (!entry.domainHash) {
      missingHashDomains.add(rawDomain);
    }

    pendingEntries.push(entry);
  });

  const missingHashMap = missingHashDomains.size > 0
    ? await hashDomains(Array.from(missingHashDomains), { strict: false }).catch(() => new Map())
    : new Map();
  const dedupedGlobalByRootDomain = new Map();

  pendingEntries.forEach((entry) => {
    const domainHash = entry.domainHash || missingHashMap.get(entry.rawDomain) || "";
    if (!isHexDomainHash(domainHash, [64])) return;

    const visitCount = Math.max(entry.visitCount, visitCountByHash.get(domainHash) || 0);
    const displayDomain = buildDomain(entry.rawDomain);
    if (!displayDomain) return;
    const rootDomainKey = getScenarioRootDomainKey(entry.rawDomain);
    if (!rootDomainKey) return;

    const normalizedEntry = {
      groupName: entry.groupName,
      domainHash,
      rawDomain: entry.rawDomain,
      displayDomain,
      faviconDataUrl: null,
      visitCount
    };

    const existingEntry = dedupedGlobalByRootDomain.get(rootDomainKey);
    if (!existingEntry || compareScenarioCandidates(normalizedEntry, existingEntry) < 0) {
      dedupedGlobalByRootDomain.set(rootDomainKey, normalizedEntry);
    }
  });

  const dedupedByGroup = Object.fromEntries(
    SCENARIO_GROUP_NAMES.map((groupName) => [groupName, []])
  );
  dedupedGlobalByRootDomain.forEach((entry) => {
    if (dedupedByGroup[entry.groupName]) {
      dedupedByGroup[entry.groupName].push(entry);
    }
  });

  const candidatesByCondition = createEmptyScenarioCandidateMap();

  SCENARIO_GROUP_NAMES.forEach((groupName) => {
    candidatesByCondition[groupName] = dedupedByGroup[groupName]
      .sort(compareScenarioCandidates)
      .slice(0, MAX_SCENARIO_FAMILIARITY_CANDIDATES_PER_GROUP)
      .map((entry) => ({
        domainHash: entry.domainHash,
        rawDomain: entry.rawDomain,
        displayDomain: entry.displayDomain,
        faviconDataUrl: null
      }));
  });
  setScenarioFamiliarityCandidateVersion(candidatesByCondition);

  await ext.storage.local.set({
    [SCENARIO_FAMILIARITY_CANDIDATES_KEY]: candidatesByCondition
  });

  return candidatesByCondition;
}

async function getScenarioFamiliarityStateResponse(forceRefresh = false) {
  let candidatesByCondition = createEmptyScenarioCandidateMap();

  if (!forceRefresh) {
    const storedCandidates = await ext.storage.local.get(SCENARIO_FAMILIARITY_CANDIDATES_KEY);
    const cachedCandidates = storedCandidates?.[SCENARIO_FAMILIARITY_CANDIDATES_KEY];
    if (hasScenarioFamiliarityCandidates(cachedCandidates)) {
      candidatesByCondition = cachedCandidates;
    }
  }
  
  if (!hasScenarioFamiliarityCandidates(candidatesByCondition)) {
    candidatesByCondition = await buildScenarioFamiliarityCandidates();
  }

  const storedAnswers = await ext.storage.local.get(SCENARIO_FAMILIARITY_ANSWERS_KEY);
  const answersByHash = pruneScenarioFamiliarityAnswers(
    candidatesByCondition,
    storedAnswers?.[SCENARIO_FAMILIARITY_ANSWERS_KEY]
  );

  await ext.storage.local.set({
    [SCENARIO_FAMILIARITY_ANSWERS_KEY]: answersByHash
  });

  return {
    candidatesByCondition,
    answersByHash,
    candidateCount: getScenarioFamiliarityCandidateCount(candidatesByCondition),
    complete: isScenarioFamiliarityComplete(candidatesByCondition, answersByHash)
  };
}

// Opens the popup.html when the extension icon is clicked
(ext.action || ext.browserAction).onClicked.addListener(() => {
  ext.tabs.create({
    url: ext.runtime.getURL("popup_welcome.html")
  });
});

// Cross-browser executeScript wrapper for MV3
// DEPRECATED - ONLY FOR USE IN DEBUGGING
async function executeScriptWrapper(tabId, details) {
  if (chrome.scripting && chrome.scripting.executeScript) {
    return chrome.scripting.executeScript({
      target: { tabId },
      // Expects details.code as a string
      func: new Function(details.code)  // wrap string into a function
    });
  } else if (ext.tabs && ext.tabs.executeScript) {
    // Firefox
    return ext.tabs.executeScript(tabId, { code: details.code });
  } else {
    console.error("No compatible executeScript API available");
  }
}

// Fetch all domains the user has directly visited (handles >10k entries)
async function getVisitedMainDomains() {
  const CACHE_TTL_MS = 60 * 60 * 1000;        // 1 hour
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day search windows
  const HISTORY_LIMIT = 10_000;
  const LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

  const cacheAge = Date.now() - visitedDomainsCacheLastUpdated;
  const cacheValid =
    visitedDomainsCacheLastUpdated > 0 &&
    cacheAge < CACHE_TTL_MS &&
    visitedDomainsCache.size > 0;

  if (cacheValid) {
    console.log(
      `Using cached visited domains (${visitedDomainsCache.size} domains, ` +
      `cache age: ${Math.round(cacheAge / 60_000)} min)`
    );
    return Array.from(visitedDomainsCache);
  }

  visitedDomainsCache.clear();
  const cutoff = Date.now() - LOOKBACK_MS;
  let endTime = Date.now();

  while (endTime > cutoff) {
    const startTime = Math.max(cutoff, endTime - WINDOW_MS);
    const historyItems = await new Promise(resolve =>
      ext.history.search(
        { text: '', startTime, endTime, maxResults: HISTORY_LIMIT },
        resolve
      )
    );

    // Deduplicate by URL, then extract + canonicalize domains
    const seen = new Map(
      historyItems
        .filter(item => item.url)
        .map(item => [item.url, item])
    );

    for (const { url } of seen.values()) {
      try {
        const canonicalDomain = canonicalizeDomain(new URL(url).hostname);
        if (!canonicalDomain) continue;

        // Strip subdomains but keep TLD (e.g. mail.google.com → google.com)
        const mainDomain = buildDomain(canonicalDomain);
        if (!mainDomain) continue;

        visitedDomainsCache.add(mainDomain);
      } catch {
        // skip malformed URLs
      }
    }

    endTime = startTime - 1;
  }

  visitedDomainsCacheLastUpdated = Date.now();
  const domains = Array.from(visitedDomainsCache);
  console.log(`Built visited domains cache with ${domains.length} entries`);
  ext.runtime.sendMessage({ type: 'visitedDomainsCount', count: domains.length });
  return domains;
}

// Check if a cookie domain matches any visited domain (direct or subdomain relationship)
function isVisitedDomain(cookieDomain, visitedDomains) {
  const cookie = canonicalizeDomain(cookieDomain);
  if (!cookie) { return false; }

  // visitedDomains should already be canonicalized
  const visited = visitedDomains instanceof Set
    ? visitedDomains
    : new Set(visitedDomains);

  if (visited.has(cookie)) { return true; }

  const matched = [...visited].some(v => {
    const cookieSubMatch = cookie.endsWith(`.${v}`);
    const visitedSubMatch = v.endsWith(`.${cookie}`);
    return cookieSubMatch || visitedSubMatch;
  });

  return matched;
}

// Fetch all browsing history for a specific cookie domain
function getAllHistoryForDomain(cookieDomain, callback) {
  fetchPaginatedHistory(cookieDomain, callback);
}

function getVisitsForUrl(url, oneYearAgo) {
  return new Promise(resolve => {
    ext.history.getVisits({ url }, visits => {
      if (ext.runtime.lastError) {
        console.error(`history.getVisits error: ${ext.runtime.lastError}`);
        resolve([]); return;
      }
      resolve(
        (visits || []).filter(v =>
          v.visitId != null &&
          typeof v.visitTime === "number" &&
          v.visitTime >= oneYearAgo &&
          !['auto_redirect', 'auto_subframe', 'reload'].includes(v.transition)
        )
      );
    });
  });
}

// Fetches browser history statistics for a domain over the past year.
// 1. First collects ALL matching URLs across paginated history.
// 2. Then fetches visits ONCE per unique URL.
// 3. Finally aggregates statistics.
async function fetchPaginatedHistory(cookieDomain, callback) {

  // Return cached result immediately if available.
  if (historyCache[cookieDomain]) {
    callback(historyCache[cookieDomain]);
    return;
  }

  // Timestamp for one year ago.
  const oneYearAgo =
    Date.now() - (365 * 24 * 60 * 60 * 1000);

  // Stores unique URLs matching the domain.
  const uniqueUrls = new Set();

  // Prevents duplicate visit counting.
  const processedVisitIds = new Set();

  // Aggregated visit timestamps.
  const allVisits = [];

  // Daily visit counts:
  // YYYY-MM-DD => count
  const dailyVisitMap = new Map();

  // Unique visited dates.
  const uniqueDates = new Set();

  // Pagination state.
  let lastEndTime = Date.now();
  let previousEndTime = null;

  // Safety limit.
  let fetchAttempts = 0;
  const MAX_FETCH_ATTEMPTS = 5;
  const MAX_FETCH_RESULTS_PER_ATTEMPT = 5000; // We dont expect more than 25k visits for a single host name.

  // Helper: promisified history search.
  function searchHistory(params) {
    return new Promise((resolve, reject) => {

      ext.history.search(params, (results) => {

        if (ext.runtime.lastError) {
          reject(ext.runtime.lastError);
          return;
        }

        resolve(results);
      });
    });
  }

  try {

    // ---------------------------------------------------
    // PHASE 1:
    // Collect all unique matching URLs (e.g., google.com/1, google.com/2 etc)
    // ---------------------------------------------------

    while (fetchAttempts < MAX_FETCH_ATTEMPTS) {

      fetchAttempts++;

      // Fetch one batch of history records.
      const results = await searchHistory({
        text: cookieDomain,
        startTime: oneYearAgo,
        endTime: lastEndTime,
        maxResults: MAX_FETCH_RESULTS_PER_ATTEMPT
      });

      // Stop if:
      // - no more results
      // - pagination stalled
      if (
        results.length === 0 ||
        lastEndTime === previousEndTime
      ) {
        console.debug(`No more history items for ${cookieDomain}`);
        break;
      }

      previousEndTime = lastEndTime;

      // Find oldest history item in this batch.
      const oldest = results.reduce((min, r) => {
        const t = r?.lastVisitTime;

        return Number.isFinite(t) && t < min
          ? t
          : min;
      }, Infinity);

      if (!Number.isFinite(oldest)) {
        break;
      }

      const nextEndTime = oldest - 1;

      // Filter URLs matching target domain.
      for (const item of results) {

        try {

          const url = new URL(item.url);

          // Only keep URLs matching the domain.
          // needed because nogoogle.com and google.com could be in data
          if (domainMatch(url.hostname, cookieDomain)) {
            uniqueUrls.add(item.url);
          }

        } catch { console.warn(`Invalid URL: ${item.url}`); }
      }

      // Move pagination backward in time.
      lastEndTime = nextEndTime;

      // Stop once we crossed the one-year boundary.
      if (lastEndTime <= oneYearAgo) { break; }
    }

    // ---------------------------------------------------
    // PHASE 2:
    // Fetch visits once per unique URL
    // ---------------------------------------------------

    // Fetch visit arrays concurrently.
    const settled = await Promise.allSettled(
      Array.from(uniqueUrls).map(url => getVisitsForUrl(url, oneYearAgo))
    );

    const visitArrays = [];
    for (const r of settled) {
      if (r.status === "fulfilled") {
        visitArrays.push(r.value);
      } else {
        console.warn("getVisitsForUrl failed:", r.reason);
      }
    }

    // ---------------------------------------------------
    // PHASE 3:
    // Aggregate visit statistics
    // ---------------------------------------------------

    let totalVisitCount = 0;

    for (const visits of visitArrays) {

      for (const v of visits) {

        // Prevent duplicate visit counting.
        if (processedVisitIds.has(v.visitId)) {
          continue;
        }

        processedVisitIds.add(v.visitId);

        // Store timestamp.
        allVisits.push(v.visitTime);

        totalVisitCount++;

        // Convert timestamp into YYYY-MM-DD.
        const dateKey =
          new Date(v.visitTime)
            .toISOString()
            .slice(0, 10);

        // Increment daily count.
        dailyVisitMap.set(
          dateKey,
          (dailyVisitMap.get(dateKey) || 0) + 1
        );

        // Track unique day.
        uniqueDates.add(dateKey);
      }
    }

    // ---------------------------------------------------
    // FINALIZE
    // ---------------------------------------------------

    const avgDailyVisits = dailyVisitMap.size
      ? Math.round(
        (totalVisitCount / dailyVisitMap.size) * 10
      ) / 10
      : 0;

    const historyData = {

      // Earliest visit timestamp.
      firstVisited:
        allVisits.length > 0
          ? Math.min(...allVisits)
          : null,

      // Most recent visit timestamp.
      lastVisited:
        allVisits.length > 0
          ? Math.max(...allVisits)
          : null,

      // Total deduplicated visits.
      totalVisitCount,

      // Average visits per active day.
      avgDailyVisits,

      // Number of unique visited days.
      daysVisited: dailyVisitMap.size,

      // Sorted list of visited dates.
      visitedDates:
        Array.from(uniqueDates).sort(),
    };

    // Cache final result.
    historyCache[cookieDomain] = historyData;

    // Return result.
    callback(historyData);

  } catch (err) {
    console.error("Error in getDomainHistory:", err);

    // Fallback result on failure.
    callback({
      firstVisited: null,
      lastVisited: null,
      totalVisitCount: 0,
      avgDailyVisits: 0,
      daysVisited: 0,
      visitedDates: [],
    });
  }
}

// Improved domain matching for better history correlation
function domainMatch(historyDomain, cookieDomain) {
  // First standardize both domains
  historyDomain = canonicalizeDomain(historyDomain);
  cookieDomain = canonicalizeDomain(cookieDomain);

  // Remove 'www.' from both for better matching
  const historyDomainNoWWW = historyDomain.replace(/^www\./, '');
  const cookieDomainNoWWW = cookieDomain.replace(/^www\./, '');

  // Check for exact match
  if (historyDomain === cookieDomain || historyDomainNoWWW === cookieDomainNoWWW) {
    return true;
  }

  // Check for subdomain relationships
  return historyDomain.endsWith(`.${cookieDomain}`) ||
    historyDomainNoWWW.endsWith(`.${cookieDomainNoWWW}`) ||
    cookieDomain.endsWith(`.${historyDomain}`) ||
    cookieDomainNoWWW.endsWith(`.${historyDomainNoWWW}`);
}

function historySearchAsync(query) {
  return new Promise((resolve) => {
    ext.history.search(query, (results) => {
      if (ext.runtime.lastError) {
        console.error("History search error:", ext.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(Array.isArray(results) ? results : []);
    });
  });
}

function historyGetVisitsAsync(url) {
  return new Promise((resolve) => {
    ext.history.getVisits({ url }, (visits) => {
      if (ext.runtime.lastError) {
        console.error(`History getVisits error for ${url}:`, ext.runtime.lastError);
        resolve([]);
        return;
      }
      resolve(Array.isArray(visits) ? visits : []);
    });
  });
}

function getPreferenceVariants(domain) {
  const standardized = canonicalizeDomain(domain);
  if (!standardized) return [];

  const variants = new Set([standardized]);
  variants.add(`.${standardized}`);

  if (standardized.startsWith("www.")) {
    const withoutWww = standardized.slice(4);
    variants.add(withoutWww);
    variants.add(`.${withoutWww}`);
  } else {
    variants.add(`www.${standardized}`);
    variants.add(`.www.${standardized}`);
  }

  return Array.from(variants);
}

function findDomainPreferences(domain, prefsMap) {
  const variants = getPreferenceVariants(domain);
  for (const key of variants) {
    if (prefsMap.has(key)) return prefsMap.get(key);
  }
  return null;
}

function normalizeParticipantPreferenceValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeParticipantPreferenceEntry(entry) {
  let domain = "";
  let preferences = null;

  if (Array.isArray(entry)) {
    domain = entry[0];
    preferences = entry[1];
  } else if (entry && typeof entry === "object") {
    domain = entry.domain;
    preferences = entry;
  } else {
    return null;
  }

  const normalizedDomain = canonicalizeDomain(domain);
  if (!normalizedDomain) return null;

  return {
    domain: normalizedDomain,
    functional: normalizeParticipantPreferenceValue(preferences?.functional),
    performance: normalizeParticipantPreferenceValue(preferences?.performance),
    advertising: normalizeParticipantPreferenceValue(preferences?.advertising)
  };
}

function buildParticipantPreferencesMap(preferences) {
  const prefsMap = new Map();

  (Array.isArray(preferences) ? preferences : []).forEach((entry) => {
    const normalized = normalizeParticipantPreferenceEntry(entry);
    if (!normalized) return;

    const existing = prefsMap.get(normalized.domain) || {
      functional: null,
      performance: null,
      advertising: null
    };

    if (normalized.functional !== null) existing.functional = normalized.functional;
    if (normalized.performance !== null) existing.performance = normalized.performance;
    if (normalized.advertising !== null) existing.advertising = normalized.advertising;

    prefsMap.set(normalized.domain, existing);
  });

  return prefsMap;
}

function findCookieMetadataForDomain(domain, cookies) {
  const variants = new Set(getPreferenceVariants(domain));
  for (const cookie of cookies) {
    const cookieDomain = canonicalizeDomain(cookie?.domain);
    if (!cookieDomain) continue;

    if (variants.has(cookieDomain) || variants.has(`.${cookieDomain}`)) {
      return cookie;
    }
  }
  return null;
}

async function getBrowsingHistoryData(forceRefresh = false) {
  const cacheAge = Date.now() - browsingHistoryDataCacheLastUpdated;
  if (!forceRefresh && browsingHistoryDataCache && browsingHistoryDataCacheLastUpdated > 0 && cacheAge < 3600000) {
    console.log(`Using cached browsingHistoryData (${browsingHistoryDataCache.length} domains, age ${Math.round(cacheAge / 60000)}m)`);
    return browsingHistoryDataCache;
  }

  const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
  const maxResultsPerBatch = 5000;
  const maxFetchAttempts = 30;
  const historyItemsByUrl = new Map();
  let endTime = Date.now();
  let previousEndTime = null;
  let fetchAttempts = 0;

  // Phase 1: collect all URLs via pagination
  while (fetchAttempts < maxFetchAttempts) {
    fetchAttempts += 1;
    const results = await historySearchAsync({
      text: "",
      startTime: oneYearAgo,
      endTime,
      maxResults: maxResultsPerBatch
    });

    if (!results.length || endTime === previousEndTime) break;

    results.forEach(item => {
      if (item?.url) historyItemsByUrl.set(item.url, item);
    });

    const timestamps = results
      .map(item => item?.lastVisitTime)
      .filter(value => typeof value === "number");

    if (!timestamps.length) break;

    previousEndTime = endTime;
    endTime = Math.min(...timestamps) - 1;

    if (endTime <= oneYearAgo) break;
  }

  // Phase 2: get visits per URL and aggregate into domainStats
  const domainStats = new Map();

  for (const url of historyItemsByUrl.keys()) {
    let canonicalDomain = "";
    try {
      canonicalDomain = canonicalizeDomain(new URL(url).hostname);
    } catch { continue; }
    if (!canonicalDomain) continue;

    // Strip subdomains but keep TLD (e.g. mail.google.com → google.com, mail.google.co.uk → google.co.uk)
    const mainDomain = buildDomain(canonicalDomain);

    if (!domainStats.has(mainDomain)) {
      domainStats.set(mainDomain, {
        numberOfVisits: 0,
        datesSet: new Set(),
        seenVisitIds: new Set()
      });
    }

    const stats = domainStats.get(mainDomain);
    const visits = await getVisitsForUrl(url, oneYearAgo);

    for (const visit of visits) {
      if (stats.seenVisitIds.has(visit.visitId)) continue;
      stats.seenVisitIds.add(visit.visitId);
      stats.numberOfVisits += 1;
      const date = new Date(visit.visitTime);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      stats.datesSet.add(`${date.getFullYear()}-${month}-${day}`);
    }
  }

  // Phase 3: build final output
  const rankMap = await getTop1mDomainRankMap();
  const domains = Array.from(domainStats.keys());
  const hashMap = await hashDomains(domains, { strict: true });

  const browsingHistoryData = Array.from(domainStats.entries()).map(([domain, stats]) => ({
    domainHash: hashMap.get(domain) || null,
    domainRankRange: rankMap.get(domain) || "1000000+",
    numberOfVisits: stats.numberOfVisits,
    dates: Array.from(stats.datesSet).sort()
  }));

  browsingHistoryData.sort((a, b) => (b.numberOfVisits || 0) - (a.numberOfVisits || 0));
  browsingHistoryDataCache = browsingHistoryData;
  browsingHistoryDataCacheLastUpdated = Date.now();
  console.log(`Built browsingHistoryData for ${browsingHistoryData.length} domains`);
  return browsingHistoryData;
}

// Send message to content script to run the DOM-checker when a tab finishes loading.
ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    ext.tabs.sendMessage(tabId, { action: "runSurveyElementCheck" })
      .catch(err => {
        console.log(`Could not message content script on tab ${tabId}: ${err && err.message ? err.message : err}`);
      });
  }
});

// Listen for messages from the popup.js or content.js
ext.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "getCookieData") {
    getCookieData().then(sendResponse);
    return true;
  } else if (request.action === 'checkCookies') {
    console.log(`[pricrumbs] checkCookies`);

    const cookieNames = request.cookieNames || [];
    const cookieNameSet = new Set(cookieNames);
    const cookiePatterns = request.cookiePatterns || [];
    const compiledPatterns = cookiePatterns.map(p => new RegExp(p));

    // Step 1: get visited domains
    getVisitedMainDomains()
      .then(visitedDomains => {
        console.info(`[background.js] Found ${visitedDomains.length} visited main domains in history`);
        return ext.cookies.getAll({}).then(cookies => ({ cookies, visitedDomains }));
      })
      .then(({ cookies, visitedDomains }) => {
        console.info(`[background.js] Total cookies retrieved: ${cookies.length}`);

        // Step 2: filter cookies by name and visited domains
        const filteredCookies = cookies.filter(cookie => {
          const nameMatch =
            cookieNameSet.has(cookie.name) ||
            compiledPatterns.some(regex => regex.test(cookie.name));
          return nameMatch && isVisitedDomain(cookie.domain, visitedDomains);
        });
        console.info(`Filtered to ${filteredCookies.length} cookies from visited domains`);

        ext.runtime.sendMessage({
          type: 'supportedVisitedDomainsCount',
          count: filteredCookies.length
        });

        // Step 3: extract unique domains
        const uniqueDomains = [...new Set(filteredCookies.map(c => c.domain))];

        // Step 4: fetch domain histories
        const domainHistoryPromises = uniqueDomains.map(domain =>
          new Promise(resolve => {
            if (historyCache[domain]) {
              resolve(historyCache[domain]);
              return;
            }

            let resolved = false;
            getAllHistoryForDomain(domain, historyData => {
              if (!resolved) {
                resolved = true;
                const safeData = {
                  firstVisited: historyData.firstVisited ?? null,
                  lastVisited: historyData.lastVisited ?? null,
                  totalVisitCount: historyData.totalVisitCount ?? 0,
                  avgDailyVisits: historyData.avgDailyVisits ?? 0,
                  visitedDates: Array.isArray(historyData.visitedDates) ? historyData.visitedDates : []
                };
                historyCache[domain] = safeData;
                resolve(safeData);
              }
            });

            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                console.warn(`Timeout fetching history for ${domain}, using defaults.`);
                const defaultData = {
                  firstVisited: null,
                  lastVisited: null,
                  totalVisitCount: 0,
                  avgDailyVisits: 0,
                  visitedDates: []
                };
                historyCache[domain] = defaultData;
                resolve(defaultData);
              }
            }, 30000);
          })
        );

        return Promise.all(domainHistoryPromises).then(histories => ({ filteredCookies, uniqueDomains, histories }));
      })
      .then(({ filteredCookies, uniqueDomains, histories }) => {
        // Step 5: build history map
        const historyMap = {};
        uniqueDomains.forEach((domain, i) => {
          historyMap[domain] = histories[i];
        });

        // Step 6: merge history into cookies
        const cookiesWithHistory = filteredCookies.map(cookie => ({
          ...cookie,
          ...historyMap[cookie.domain]
        }));

        return cookiesWithHistory;
      })
      .then(cookiesWithHistory => {
        // Step 7: get rank and hash maps
        return Promise.all([getTop1mDomainRankMap(), hashDomains(
          Array.from(new Set(
            cookiesWithHistory.map(c => canonicalizeDomain(c.domain)).filter(Boolean)
          )),
          { strict: true }
        )]).then(([rankMap, hashMap]) => ({ cookiesWithHistory, rankMap, hashMap }));
      })
      .then(({ cookiesWithHistory, rankMap, hashMap }) => {
        // Step 8: merge metadata
        const cookiesWithMetadata = cookiesWithHistory.map(cookie => {
          const canonicalDomain = canonicalizeDomain(cookie.domain);
          return {
            ...cookie,
            domainRankRange: canonicalDomain ? (rankMap.get(canonicalDomain) || "1000000+") : null,
            domainHash: canonicalDomain ? (hashMap.get(canonicalDomain) || null) : null
          };
        });

        console.log("Cookies with history and metadata ready, sending response...");
        sendResponse({ cookies: cookiesWithMetadata });
      })
      .catch(err => {
        console.error("Error in checkCookies flow:", err);
        sendResponse({ cookies: [] });
      });

    return true; // keep the message channel open
  }

  if (request.payload?.action === "fetchAllCookies" || request.action === 'fetchAllCookies') {
    // Fetch all cookies
    ext.cookies.getAll({})
      .then((cookies) => {
        console.log("Sending cookies response:", cookies);
        sendResponse({ cookies });
      })
      .catch((err) => {
        console.error("Error fetching cookies:", err);
        sendResponse({ cookies: [] });
      });
    return true; // Keep the message channel open
  }

  if (request.payload?.action === "injectHTML") {
    const tabId = sender.tab ? sender.tab.id : request.tabId;

    if (!request.payload.html) {
      console.error("No html file provided");
      sendResponse({ success: false, error: "No html file provided" });
      return true;
    }
    if (!tabId) {
      console.error("Invalid tabID");
      sendResponse({ success: false, error: "Invalid tabID" });
      return true;
    }

    // Prefer explicit elementId from content script; fallback to html filename.
    let elementId = request.payload.elementId || request.payload.html.slice(0, -5);
    let height = request.payload.height ? request.payload.height : "600px";

    if (height === "0px") {
      elementId = "pricrumbs_popup_hidden";
    }

    // Send message to content script to inject the iframe
    ext.tabs.sendMessage(tabId, {
      action: "injectHTML",
      elementId,
      htmlFile: request.payload.html,
      height
    })
      .then(() => {
        console.log(`Sent injectHTML command for ${request.payload.html} to tab ${tabId}`);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Error sending injectHTML to content script:", error);
        sendResponse({ success: false, error });
      });

    return true; // Keep channel open for async response
  }

  if (request.action === "getBrowsingHistoryData") {
    getBrowsingHistoryData(Boolean(request.forceRefresh))
      .then((browsingHistoryData) => {
        sendResponse({ browsingHistoryData });
      })
      .catch((error) => {
        console.error("Failed to build browsingHistoryData:", error);
        sendResponse({ browsingHistoryData: [] });
      });
    return true;
  }

  if (request.action === "getConsentChoices") {
    (async () => {
      try {
        const category = request.category || request.payload?.category || null;
        const result = await ext.storage.local.get([
          "selectedDomainsForHistory",
          "cookieData",
          "participantCookiesPreferences"
        ]);

        const selectedDomains = Array.isArray(result.selectedDomainsForHistory)
          ? result.selectedDomainsForHistory
          : [];
        const cookieData = Array.isArray(result.cookieData) ? result.cookieData : [];
        const rankMap = await getTop1mDomainRankMap();
        const prefsMap = buildParticipantPreferencesMap(result.participantCookiesPreferences);

        const canonicalDomains = Array.from(
          new Set(
            selectedDomains
              .map((domainObj) => canonicalizeDomain(domainObj?.originalDomain || domainObj?.domain || ""))
              .filter(Boolean)
          )
        );
        const hashMap = await hashDomains(canonicalDomains, { strict: true });

        const records = selectedDomains.map((domainObj) => {
          const rawDomain = domainObj?.originalDomain || domainObj?.domain || "";
          const canonicalDomain = canonicalizeDomain(rawDomain);
          if (!canonicalDomain) return null;

          const prefs = findDomainPreferences(rawDomain, prefsMap) || {};
          const matchedCookie = findCookieMetadataForDomain(rawDomain, cookieData);
          const domainHash = hashMap.get(canonicalDomain) || null;

          return {
            domainHash: domainHash || matchedCookie?.domainHash || null,
            trancoRank: rankMap.get(canonicalDomain) || matchedCookie?.domainRankRange || "1000000+",
            functional: prefs.functional ?? null,
            performance: prefs.performance ?? null,
            advertising: prefs.advertising ?? null
          };
        });

        sendResponse({
          category,
          choices: records.filter(Boolean)
        });
      } catch (error) {
        console.error("Failed to build consent choices payload:", error);
        sendResponse({
          category: request.category || request.payload?.category || null,
          choices: [],
          error: error.message
        });
      }
    })();

    return true;
  }

  if (request.action === "getScenarioFamiliarityCandidates") {
    console.debug("[background.js][getScenarioFamiliarityCandidates]");
    (async () => {
      try {
        const familiarityState = await getScenarioFamiliarityStateResponse(Boolean(request.forceRefresh));
        sendResponse({ candidatesByCondition: familiarityState.candidatesByCondition });
      } catch (error) {
        console.error("background.js][getScenarioFamiliarityCandidates] Failed to build scenario familiarity candidates:", error);
        const stored = await ext.storage.local.get(SCENARIO_FAMILIARITY_CANDIDATES_KEY);
        sendResponse({
          candidatesByCondition:
            stored?.[SCENARIO_FAMILIARITY_CANDIDATES_KEY] || createEmptyScenarioCandidateMap(),
          error: error.message
        });
      }
    })();
    return true;
  }

  if (request.action === "getScenarioFamiliarityState") {
    (async () => {
      try {
        const familiarityState = await getScenarioFamiliarityStateResponse(Boolean(request.forceRefresh));
        sendResponse(familiarityState);
      } catch (error) {
        console.error("Failed to build scenario familiarity state:", error);
        const stored = await ext.storage.local.get([
          SCENARIO_FAMILIARITY_CANDIDATES_KEY,
          SCENARIO_FAMILIARITY_ANSWERS_KEY
        ]);
        const candidatesByCondition =
          stored?.[SCENARIO_FAMILIARITY_CANDIDATES_KEY] || createEmptyScenarioCandidateMap();
        const answersByHash = pruneScenarioFamiliarityAnswers(
          candidatesByCondition,
          stored?.[SCENARIO_FAMILIARITY_ANSWERS_KEY]
        );

        sendResponse({
          candidatesByCondition,
          answersByHash,
          candidateCount: getScenarioFamiliarityCandidateCount(candidatesByCondition),
          complete: isScenarioFamiliarityComplete(candidatesByCondition, answersByHash),
          error: error.message
        });
      }
    })();
    return true;
  }

  if (request.action === "setScenarioFamiliarityAnswers") {
    (async () => {
      try {
        const stored = await ext.storage.local.get(SCENARIO_FAMILIARITY_CANDIDATES_KEY);
        const candidatesByCondition =
          stored?.[SCENARIO_FAMILIARITY_CANDIDATES_KEY] || createEmptyScenarioCandidateMap();
        const answersByHash = pruneScenarioFamiliarityAnswers(
          candidatesByCondition,
          request.answersByHash
        );
        await ext.storage.local.set({
          [SCENARIO_FAMILIARITY_ANSWERS_KEY]: answersByHash
        });
        sendResponse({
          ok: true,
          answersByHash,
          complete: isScenarioFamiliarityComplete(candidatesByCondition, answersByHash)
        });
      } catch (error) {
        console.error("Failed to store scenario familiarity answers:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === "setSelectedScenarioDomainHashes") {
    (async () => {
      try {
        const selectedScenarioDomainHashes = normalizeSelectedScenarioDomainHashes(
          request.selectedScenarioDomainHashes
        );
        await ext.storage.local.set({
          [SELECTED_SCENARIO_DOMAIN_HASHES_KEY]: selectedScenarioDomainHashes
        });
        sendResponse({ ok: true, selectedScenarioDomainHashes });
      } catch (error) {
        console.error("Failed to store selected scenario domain hashes:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === "resetStudyData" || request.payload?.action === "resetStudyData") {
    (async () => {
      try {
        await ext.storage.local.remove([
          "participantCookiesPreferences",
          "selectedDomainsForHistory",
          "consentDomainData",
          "browsingHistoryData",
          "cookieData",
          "hasDiscrepancies",
          "hasDiscrepanciesCheckedAt",
          "participantId",
          SCENARIO_FAMILIARITY_CANDIDATES_KEY,
          SCENARIO_FAMILIARITY_ANSWERS_KEY,
          SELECTED_SCENARIO_DOMAIN_HASHES_KEY
        ]);

        visitedDomainsCache.clear();
        visitedDomainsCacheLastUpdated = 0;
        domainHashCache.clear();
        browsingHistoryDataCache = null;
        browsingHistoryDataCacheLastUpdated = 0;

        Object.keys(historyCache).forEach((key) => {
          delete historyCache[key];
        });

        sendResponse({ ok: true });
      } catch (error) {
        console.error("Failed to reset study data:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.payload?.action === "autoUninstallExtension" || request.action === "autoUninstallExtension") {
    console.log("Background script automatic uninstallation triggered by event payload.");

    if (!ext.management || !ext.management.uninstallSelf) {
      console.warn("Uninstall not supported");
      sendResponse({ success: false, fallback: true, error: "management.uninstallSelf unavailable" });
      return false;
    }

    // Support both Chrome callback-style and Firefox Promise-style uninstallSelf.
    try {
      ext.management.uninstallSelf({ showConfirmDialog: true }, () => {
        if (ext.runtime.lastError) {
          console.error("Error uninstalling:", ext.runtime.lastError);
          sendResponse({ success: false, error: ext.runtime.lastError.message });
        } else {
          console.log("Extension uninstalled successfully.");
          sendResponse({ success: true });
        }
      });
      return true;
    } catch (_callbackStyleError) {
      try {
        const maybePromise = ext.management.uninstallSelf({ showConfirmDialog: true });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise
            .then(() => {
              console.log("Extension uninstall request completed.");
              sendResponse({ success: true });
            })
            .catch((error) => {
              const message = error?.message || String(error);
              console.error("Error uninstalling:", error);
              sendResponse({ success: false, error: message });
            });
          return true;
        }
      } catch (promiseStyleError) {
        const message = promiseStyleError?.message || String(promiseStyleError);
        console.error("Error uninstalling:", promiseStyleError);
        sendResponse({ success: false, error: message });
        return false;
      }
    }
  }

});

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "GET_FAVICON") {
    resolveFaviconDataUrlForDomain(msg.domain)
      .then((favicon) => {
        sendResponse({ favicon });
      })
      .catch((_error) => {
        sendResponse({ favicon: null });
      });

    return true; // Indicates async response
  }

  if (msg.type === "STORAGE_GET") {

    ext.storage.local.get(msg.key).then(data => {
      sendResponse(data);
    });

    return true;
  }

  if (msg.type === "STORAGE_SET") {

    ext.storage.local.set({ [msg.key]: msg.value })
      .then(async () => {

        const stored = await ext.storage.local.get(msg.key);

        // console.log("Stored key:", msg.key);
        // console.log("Stored value:", stored[msg.key]);

        sendResponse(true);
      })
      .catch((err) => {
        console.error("STORAGE_SET failed:", err);
        sendResponse(false);
      });

    return true;
  }

  if (msg.type === "OPEN_TAB") {

    ext.tabs.create(msg.options).then(tab => {
      sendResponse(tab);
    });

    return true;
  }

  if (msg.type === "CLOSE_TAB") {

    ext.tabs.remove(msg.tabId).then(() => {
      sendResponse(true);
    });

    return true;
  }

});
