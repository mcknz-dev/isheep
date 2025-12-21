import { SITE_CONFIG } from "./config.js";
import { DEFAULT_ENABLED_FEEDS } from "./feeds.js";

/* ---------- HELPERS ---------- */
const $ = (sel) => document.querySelector(sel);

function isToday(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    if (isNaN(d)) return false;

    const t = new Date();
    return (
        d.getFullYear() === t.getFullYear() &&
        d.getMonth() === t.getMonth() &&
        d.getDate() === t.getDate()
    );
}

function loadAppearance(){
    try {
        return JSON.parse(localStorage.getItem("appearance")) || {
            theme: "system",
            borderColor: "#2b2b2b",
            columns: 4
        };
    } catch {
        return {
            theme: "system",
            borderColor: "#2b2b2b",
            columns: 4
        };
    }
}

function saveAppearance(settings){
    localStorage.setItem("appearance", JSON.stringify(settings));
}

/* ---------- READ LATER ---------- */
function loadReadLater() {
    try {
        return JSON.parse(localStorage.getItem("readLater")) || [];
    } catch {
        return [];
    }
}

function saveToReadLater(article) {
    const saved = loadReadLater();
    if (saved.some(a => a.link === article.link)) return;
    saved.push(article);
    localStorage.setItem("readLater", JSON.stringify(saved));
}

function removeFromReadLater(link) {
    const updated = loadReadLater().filter(a => a.link !== link);
    localStorage.setItem("readLater", JSON.stringify(updated));
}

function isSaved(link) {
    return loadReadLater().some(a => a.link === link);
}

/* ---------- ELEMENTS ---------- */
const tabsEl = $("#tabs");
const gridEl = $("#newsGrid");
const statusEl = $("#status");

const modalBackdrop = $("#modalBackdrop");
const feedListEl = $("#feedList");

const openSettingsBtn = $("#openSettings");
const closeSettingsBtn = $("#closeSettings");
const saveFeedsBtn = $("#saveFeeds");
const selectAllBtn = $("#selectAll");
const selectNoneBtn = $("#selectNone");

/* ---------- STATE ---------- */
let activeCategory = "All";
let allFeeds = [];
let enabledFeeds = loadEnabledFeeds();
let feedChecks = new Map();

/* ---------- INIT ---------- */
document.title = SITE_CONFIG.name;
document.querySelector(".site-name").textContent = SITE_CONFIG.name;

renderTabs();
wireModal();
await loadFeedsFromServer();
await loadAndRenderNews();

const settingsTabs = document.querySelectorAll(".settings-tab");
const panels = {
    feeds: document.getElementById("feedsPanel"),
    appearance: document.getElementById("appearancePanel")
};

settingsTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        settingsTabs.forEach(t => t.classList.remove("active"));
        Object.values(panels).forEach(p => p.classList.remove("active"));

        tab.classList.add("active");
        panels[tab.dataset.tab].classList.add("active");
    });
});

/* ---------- TABS ---------- */
function renderTabs() {
    tabsEl.innerHTML = "";

    SITE_CONFIG.categories.forEach(cat => {
        const btn = document.createElement("button");
        btn.className = "tab" + (cat === activeCategory ? " active" : "");
        btn.textContent = cat;

        btn.addEventListener("click", async () => {
            activeCategory = cat;
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            await loadAndRenderNews();
        });

        tabsEl.appendChild(btn);
    });
}

/* ---------- MODAL ---------- */
function wireModal() {
    openSettingsBtn?.addEventListener("click", openModal);
    closeSettingsBtn?.addEventListener("click", closeModal);

    modalBackdrop?.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) closeModal();
    });

    selectAllBtn?.addEventListener("click", () => {
        feedChecks.forEach(cb => cb.checked = true);
    });

    selectNoneBtn?.addEventListener("click", () => {
        feedChecks.forEach(cb => cb.checked = false);
    });

    saveFeedsBtn?.addEventListener("click", async () => {
        const selected = [];
        feedChecks.forEach((cb, id) => {
            if (cb.checked) selected.push(id);
        });

        enabledFeeds = selected.length ? selected : [];
        saveEnabledFeeds(enabledFeeds);
        closeModal();
        await loadAndRenderNews();
    });
}
const appearance = loadAppearance();

const themeSelect = document.getElementById("themeSelect");
const borderPicker = document.getElementById("borderColorPicker");
const columnSelect = document.getElementById("columnSelect");

if (themeSelect) {
    themeSelect.value = appearance.theme;
    themeSelect.addEventListener("change", () => {
        appearance.theme = themeSelect.value;
        saveAppearance(appearance);
        applyAppearance();
    });
}

if (borderPicker) {
    borderPicker.value = appearance.borderColor;
    borderPicker.addEventListener("input", () => {
        appearance.borderColor = borderPicker.value;
        saveAppearance(appearance);
        applyAppearance();
    });
}

if (columnSelect) {
    columnSelect.value = appearance.columns;
    columnSelect.addEventListener("change", () => {
        appearance.columns = Number(columnSelect.value);
        saveAppearance(appearance);
        applyAppearance();
    });
}

function openModal() {
    buildFeedList();
    modalBackdrop.classList.remove("hidden");
}

function closeModal() {
    modalBackdrop.classList.add("hidden");
}

/* ---------- FEEDS ---------- */
function loadEnabledFeeds() {
    try {
        const raw = localStorage.getItem("enabledFeeds");
        if (!raw) return [...DEFAULT_ENABLED_FEEDS];
        const ids = JSON.parse(raw);
        return Array.isArray(ids) && ids.length ? ids : [...DEFAULT_ENABLED_FEEDS];
    } catch {
        return [...DEFAULT_ENABLED_FEEDS];
    }
}

function saveEnabledFeeds(ids) {
    localStorage.setItem("enabledFeeds", JSON.stringify(ids));
}

async function loadFeedsFromServer() {
    const res = await fetch(`${SITE_CONFIG.apiBase}/api/feeds`);
    allFeeds = await res.json();
}

function buildFeedList() {
    feedListEl.innerHTML = "";
    feedChecks.clear();

    const enabledSet = new Set(enabledFeeds);

    allFeeds.forEach(feed => {
        const row = document.createElement("div");
        row.className = "feed-row";

        const left = document.createElement("div");
        const name = document.createElement("div");
        name.style.fontWeight = "800";
        name.textContent = feed.name;

        const cats = document.createElement("small");
        cats.textContent = (feed.categories || []).join(" • ");

        left.appendChild(name);
        left.appendChild(cats);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = enabledSet.has(feed.id);

        feedChecks.set(feed.id, cb);

        row.appendChild(left);
        row.appendChild(cb);
        feedListEl.appendChild(row);
    });
}

/* ---------- NEWS ---------- */
async function loadAndRenderNews() {
    gridEl.innerHTML = "";
    statusEl.textContent = "Loading…";

    /* ---------- READ LATER ---------- */
    if (activeCategory === "Read Later") {
        const saved = loadReadLater();

        if (saved.length === 0) {
            statusEl.textContent = "No saved stories yet.";
            return;
        }

        statusEl.textContent = `${saved.length} saved stories`;
        saved.forEach(a => gridEl.appendChild(renderCard(a)));
        return;
    }

    const feedsParam = enabledFeeds.length ? enabledFeeds.join(",") : "";

    const url = new URL(`${SITE_CONFIG.apiBase}/api/news`);
    if (feedsParam) url.searchParams.set("feeds", feedsParam);
    url.searchParams.set("limit", "60");

    const res = await fetch(url.toString());
    let articles = await res.json();

    if (!Array.isArray(articles)) {
        statusEl.textContent = "Failed to load news.";
        return;
    }

    /* ---------- TODAY ---------- */
    if (activeCategory === "Today") {
        articles = articles.filter(a =>
            isToday(a.published || a.isoDate || a.date || a.pubDate)
        );
    }

    /* ---------- EXPLORE (placeholder) ---------- */
    if (activeCategory === "Explore") {
        articles = articles.filter(a => !a.isApple);
    }

    if (articles.length === 0) {
        statusEl.textContent =
            activeCategory === "Today"
                ? "No stories published today yet."
                : "No articles found.";
        return;
    }

    statusEl.textContent = `${articles.length} stories`;
    articles.forEach(a => gridEl.appendChild(renderCard(a)));
}

/* ---------- CARD ---------- */
function renderCard(a) {
    const card = document.createElement("div");
    card.className = "card";

    /* Save button */
    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = isSaved(a.link) ? "★" : "☆";

    saveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isSaved(a.link)) {
            removeFromReadLater(a.link);
            saveBtn.textContent = "☆";
        } else {
            saveToReadLater(a);
            saveBtn.textContent = "★";
        }
    });

    card.appendChild(saveBtn);

    /* Source */
    const source = document.createElement("div");
    source.className = "badge";
    source.textContent = a.source || "Source";
    card.appendChild(source);

    /* Image */
    if (a.image) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "card-image";

        const img = document.createElement("img");
        img.src = a.image;
        img.alt = a.title || "Article image";
        img.loading = "lazy";

        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
    }

    /* Title */
    const title = document.createElement("h3");
    title.className = "title";

    const link = document.createElement("a");
    link.href = a.link || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = a.title || "Untitled";

    title.appendChild(link);
    card.appendChild(title);

    /* Summary */
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = (a.summary || "").slice(0, 220);
    card.appendChild(summary);

    /* Meta */
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (a.categories || []).join(", ");
    card.appendChild(meta);

    return card;
}

function applyAppearance(){
    const appearance = loadAppearance();
    const root = document.documentElement;

    /* Theme */
    if (appearance.theme === "dark") {
        root.style.setProperty("--bg", "#111");
        root.style.setProperty("--card", "#1a1a1a");
        root.style.setProperty("--text", "#f5f5f5");
        root.style.setProperty("--muted", "#aaa");
    } else if (appearance.theme === "light") {
        root.style.setProperty("--bg", "#f6f6f6");
        root.style.setProperty("--card", "#ffffff");
        root.style.setProperty("--text", "#111");
        root.style.setProperty("--muted", "#6b6b6b");
    } else {
        // system
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
            root.style.setProperty("--bg", "#111");
            root.style.setProperty("--card", "#1a1a1a");
            root.style.setProperty("--text", "#f5f5f5");
            root.style.setProperty("--muted", "#aaa");
        }
    }

    /* Border color */
    root.style.setProperty("--border", appearance.borderColor);

    /* Grid columns */
    document.documentElement.style.setProperty(
        "--grid-columns",
        appearance.columns
    );
}