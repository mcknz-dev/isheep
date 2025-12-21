import { SITE_CONFIG } from "./config.js";

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

/* ---------- APPEARANCE ---------- */
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
let enabledFeeds = [];
let feedChecks = new Map();

/* ---------- INIT ---------- */
document.title = SITE_CONFIG.name;
$(".site-name").textContent = SITE_CONFIG.name;

renderTabs();
wireModal();
applyAppearance();

await loadFeedsFromServer();
enabledFeeds = loadEnabledFeeds();
await loadAndRenderNews();

/* ---------- SETTINGS TABS ---------- */
document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".settings-panel").forEach(p => p.classList.remove("active"));

        tab.classList.add("active");
        document.getElementById(tab.dataset.tab + "Panel").classList.add("active");
    });
});

/* ---------- TOP TABS ---------- */
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
        enabledFeeds = [];
        feedChecks.forEach((cb, id) => {
            if (cb.checked) enabledFeeds.push(id);
        });

        localStorage.setItem("enabledFeeds", JSON.stringify(enabledFeeds));
        closeModal();
        await loadAndRenderNews();
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
        if (raw) {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length) return ids;
        }

        // FIRST VISIT → enable ALL feeds
        const all = allFeeds.map(f => f.id);
        localStorage.setItem("enabledFeeds", JSON.stringify(all));
        return all;

    } catch {
        return allFeeds.map(f => f.id);
    }
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

    if (activeCategory === "Read Later") {
        const saved = loadReadLater();
        if (!saved.length) {
            statusEl.textContent = "No saved stories yet.";
            return;
        }
        statusEl.textContent = `${saved.length} saved stories`;
        saved.forEach(a => gridEl.appendChild(renderCard(a)));
        return;
    }

    const url = new URL(`${SITE_CONFIG.apiBase}/api/news`);
    url.searchParams.set("feeds", enabledFeeds.join(","));
    url.searchParams.set("limit", "60");

    let articles = await (await fetch(url)).json();

    if (activeCategory === "Today") {
        articles = articles.filter(a =>
            isToday(a.published || a.isoDate || a.pubDate)
        );
    }

    if (!articles.length) {
        statusEl.textContent = "No articles found.";
        return;
    }

    statusEl.textContent = `${articles.length} stories`;
    articles.forEach(a => gridEl.appendChild(renderCard(a)));
}

/* ---------- CARD ---------- */
function renderCard(a) {
    const card = document.createElement("div");
    card.className = "card";

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = isSaved(a.link) ? "★" : "☆";

    saveBtn.onclick = (e) => {
        e.stopPropagation();
        isSaved(a.link) ? removeFromReadLater(a.link) : saveToReadLater(a);
        saveBtn.textContent = isSaved(a.link) ? "★" : "☆";
    };

    card.appendChild(saveBtn);

    const source = document.createElement("div");
    source.className = "badge";
    source.textContent = a.source || "Source";
    card.appendChild(source);

    if (a.image) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "card-image";
        const img = document.createElement("img");
        img.src = a.image;
        img.loading = "lazy";
        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
    }

    const title = document.createElement("h3");
    title.className = "title";
    const link = document.createElement("a");
    link.href = a.link;
    link.target = "_blank";
    link.textContent = a.title || "Untitled";
    title.appendChild(link);
    card.appendChild(title);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = (a.summary || "").slice(0, 220);
    card.appendChild(summary);



    return card;
}

/* ---------- APPLY APPEARANCE ---------- */
function applyAppearance(){
    const a = loadAppearance();
    const r = document.documentElement;

    if (a.theme === "dark") {
        r.style.setProperty("--bg", "#111");
        r.style.setProperty("--card", "#1a1a1a");
        r.style.setProperty("--text", "#f5f5f5");
        r.style.setProperty("--muted", "#aaa");
    }

    r.style.setProperty("--border", a.borderColor);
    r.style.setProperty("--grid-columns", a.columns);
}