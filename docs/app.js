import { SITE_CONFIG } from "./config.js";

/* ======================================================
   HELPERS
   ====================================================== */
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

function timeAgo(dateString) {
    if (!dateString) return "—";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "—";

    const seconds = Math.floor((Date.now() - date) / 1000);
    const units = [
        { label: "y", secs: 31536000 },
        { label: "mo", secs: 2592000 },
        { label: "d", secs: 86400 },
        { label: "h", secs: 3600 },
        { label: "m", secs: 60 }
    ];

    for (const u of units) {
        const v = Math.floor(seconds / u.secs);
        if (v > 0) return `${v}${u.label} ago`;
    }
    return "just now";
}

/* ======================================================
   APPEARANCE
   ====================================================== */
function loadAppearance() {
    try {
        return JSON.parse(localStorage.getItem("appearance")) || {
            theme: "system",
            borderColor: "#2b2b2b",
            columns: 4
        };
    } catch {
        return { theme: "system", borderColor: "#2b2b2b", columns: 4 };
    }
}

function saveAppearance(settings) {
    localStorage.setItem("appearance", JSON.stringify(settings));
}

function applyAppearance() {
    const a = loadAppearance();
    const r = document.documentElement;

    // Reset (so switching from dark -> light/system works)
    r.style.removeProperty("--bg");
    r.style.removeProperty("--card");
    r.style.removeProperty("--text");
    r.style.removeProperty("--muted");

    function applyAppearance() {
        const a = loadAppearance();
        const root = document.documentElement;

        // Clear previous theme
        root.removeAttribute("data-theme");

        if (a.theme === "dark") {
            root.setAttribute("data-theme", "dark");
        }

        if (a.theme === "system") {
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            if (prefersDark) {
                root.setAttribute("data-theme", "dark");
            }
        }

        root.style.setProperty("--border", a.borderColor);
        root.style.setProperty("--grid-columns", a.columns);
    }
    r.style.setProperty("--border", a.borderColor);
    r.style.setProperty("--grid-columns", a.columns);
}

/* ======================================================
   READ LATER
   ====================================================== */
function loadReadLater() {
    try {
        return JSON.parse(localStorage.getItem("readLater")) || [];
    } catch {
        return [];
    }
}

const savedTheme = loadAppearance().theme || "system";
setTheme(savedTheme);

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

/* ======================================================
   ELEMENTS
   ====================================================== */
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

const hamburgerBtn = $("#hamburgerBtn");
const mobileMenu = $("#mobileMenu");
const mobileSettingsBtn = $("#mobileSettings");

const columnSelect = $("#columnSelect");
const themePills = $("#themePills");
const feedsActions = $("#feedsActions");

/* ======================================================
   STATE
   ====================================================== */
let activeCategory = "All";
let allFeeds = [];
let enabledFeeds = [];
let feedChecks = new Map();

/* ======================================================
   INIT
   ====================================================== */
document.title = SITE_CONFIG.name;
const siteNameEl = $(".site-name");
if (siteNameEl) siteNameEl.textContent = SITE_CONFIG.name;

applyAppearance();
renderTabs();
wireModal();
wireSettingsTabs();
wireHamburger();
wireAppearanceControls();

await loadFeedsFromServer();
enabledFeeds = loadEnabledFeeds();
await loadAndRenderNews();

/* ======================================================
   TOP TABS (DESKTOP)
   ====================================================== */
function renderTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = "";

    SITE_CONFIG.categories.forEach(cat => {
        const btn = document.createElement("button");
        btn.className = "tab" + (cat === activeCategory ? " active" : "");
        btn.textContent = cat;

        btn.addEventListener("click", async () => {
            activeCategory = cat;
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");

            // Also sync mobile menu highlight if it exists
            document.querySelectorAll(".mobile-item[data-category]").forEach(b => {
                b.classList.toggle("active", b.dataset.category === cat);
            });

            await loadAndRenderNews();
        });

        tabsEl.appendChild(btn);
    });
}

/* ======================================================
   SETTINGS MODAL
   ====================================================== */
function openModal() {
    buildFeedList();

    // Default to Feeds tab when opening (nice + avoids weird states)
    setSettingsTab("feeds");

    modalBackdrop?.classList.remove("hidden");
}

function closeModal() {
    modalBackdrop?.classList.add("hidden");
}

function wireModal() {
    openSettingsBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal();
    });

    closeSettingsBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
    });

    modalBackdrop?.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) closeModal();
    });

    selectAllBtn?.addEventListener("click", () => {
        feedChecks.forEach(cb => (cb.checked = true));
    });

    selectNoneBtn?.addEventListener("click", () => {
        feedChecks.forEach(cb => (cb.checked = false));
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

/* ======================================================
   SETTINGS: 3 TABS (Feeds / Appearance / Contact)
   ====================================================== */
function setSettingsTab(tabName) {
    document.querySelectorAll(".settings-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tabName);
    });

    document.querySelectorAll(".settings-panel").forEach(p => {
        p.classList.toggle("active", p.id === `${tabName}Panel`);
    });

    // Only show the bottom buttons on Feeds tab
    if (feedsActions) {
        feedsActions.style.display = tabName === "feeds" ? "flex" : "none";
    }
}

function wireSettingsTabs() {
    document.querySelectorAll(".settings-tab").forEach(tab => {
        tab.addEventListener("click", (e) => {
            e.preventDefault();
            setSettingsTab(tab.dataset.tab);
        });
    });
}

/* ======================================================
   HAMBURGER MENU (MOBILE)
   ====================================================== */
function wireHamburger() {
    // Toggle menu
    hamburgerBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileMenu?.classList.toggle("hidden");
    });

    // Clicking inside menu should NOT close it
    mobileMenu?.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    // Click outside closes menu
    document.addEventListener("click", () => {
        mobileMenu?.classList.add("hidden");
    });

    // Settings item in mobile menu
    mobileSettingsBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileMenu?.classList.add("hidden");
        openModal();
    });

    // Category switching in mobile menu
    document.querySelectorAll(".mobile-item[data-category]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.preventDefault();

            const category = btn.dataset.category; // ✅ this is what your HTML uses
            activeCategory = category;

            // Mobile highlight
            document.querySelectorAll(".mobile-item[data-category]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Desktop tabs highlight (if they exist on the page)
            document.querySelectorAll(".tab").forEach(t => {
                t.classList.toggle("active", t.textContent.trim() === category);
            });

            mobileMenu?.classList.add("hidden");
            await loadAndRenderNews();
        });
    });
}

/* ======================================================
   APPEARANCE CONTROLS (Theme pills + desktop columns)
   ====================================================== */
function wireAppearanceControls() {
    // Theme pills
    if (themePills) {
        const a = loadAppearance();
        const buttons = themePills.querySelectorAll("button[data-theme]");

        // Set active pill on load
        buttons.forEach(b => b.classList.toggle("active", b.dataset.theme === a.theme));

        buttons.forEach(btn => {
            btn.addEventListener("click", () => {
                const next = loadAppearance();
                next.theme = btn.dataset.theme;
                saveAppearance(next);

                buttons.forEach(b => b.classList.toggle("active", b === btn));
                applyAppearance();
            });
        });
    }

    // Columns select (desktop-only UI)
    if (columnSelect) {
        const a = loadAppearance();
        columnSelect.value = String(a.columns ?? 4);

        columnSelect.addEventListener("change", async () => {
            const next = loadAppearance();
            next.columns = Number(columnSelect.value);
            saveAppearance(next);
            applyAppearance();
            await loadAndRenderNews();
        });
    }
}

/* ======================================================
   FEEDS
   ====================================================== */
function loadEnabledFeeds() {
    try {
        const raw = localStorage.getItem("enabledFeeds");
        if (raw) {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids) && ids.length) return ids;
        }
    } catch {}

    // First visit -> enable all
    const all = allFeeds.map(f => f.id);
    localStorage.setItem("enabledFeeds", JSON.stringify(all));
    return all;
}

async function loadFeedsFromServer() {
    const res = await fetch(`${SITE_CONFIG.apiBase}/api/feeds`);
    allFeeds = await res.json();
}

function buildFeedList() {
    if (!feedListEl) return;

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

/* ======================================================
   NEWS
   ====================================================== */
async function loadAndRenderNews() {
    if (!gridEl || !statusEl) return;

    gridEl.innerHTML = "";
    statusEl.textContent = "Loading…";

    // ✅ Saved (your UI says "Saved" but your data-category uses "Read Later")
    if (activeCategory === "Read Later" || activeCategory === "Saved") {
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

    // ✅ Today filter
    if (activeCategory === "Today") {
        articles = articles.filter(a =>
            isToday(a.published || a.isoDate || a.pubDate || a.date)
        );
    }

    if (!articles.length) {
        statusEl.textContent = "No articles found.";
        return;
    }

    statusEl.textContent = `${articles.length} stories`;
    articles.forEach(a => gridEl.appendChild(renderCard(a)));
}

document.querySelectorAll("#themePills button").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll("#themePills button")
            .forEach(b => b.classList.remove("active"));

        btn.classList.add("active");
        setTheme(btn.dataset.theme);
    });
});

/* ======================================================
   CARD (KEEP HEADER AT BOTTOM)
   ====================================================== */
function renderCard(a) {
    const card = document.createElement("div");
    card.className = "card";

    // Image
    if (a.image) {
        const imgWrap = document.createElement("div");
        imgWrap.className = "card-image";
        const img = document.createElement("img");
        img.src = a.image;
        img.loading = "lazy";
        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
    }

    // Title
    const title = document.createElement("h3");
    title.className = "title";
    const link = document.createElement("a");
    link.href = a.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = a.title || "Untitled";
    title.appendChild(link);
    card.appendChild(title);

    // Summary
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = (a.summary || "").slice(0, 220);
    card.appendChild(summary);

    // Header (ALWAYS LAST)
    const header = document.createElement("div");
    header.className = "card-header";

    const source = document.createElement("div");
    source.className = "badge";
    source.textContent = a.source || "Source";

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = timeAgo(a.published || a.isoDate || a.pubDate || a.date);

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = isSaved(a.link) ? "★" : "☆";
    saveBtn.onclick = (e) => {
        e.stopPropagation();
        isSaved(a.link) ? removeFromReadLater(a.link) : saveToReadLater(a);
        saveBtn.textContent = isSaved(a.link) ? "★" : "☆";
    };

    header.appendChild(source);
    header.appendChild(time);
    header.appendChild(saveBtn);

    card.appendChild(header); // 🔒 DO NOT MOVE

    return card;
}

function setTheme(theme) {
    const root = document.documentElement;

    // Remove existing theme
    root.removeAttribute("data-theme");

    if (theme === "dark") {
        root.setAttribute("data-theme", "dark");
    }

    if (theme === "system") {
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
            root.setAttribute("data-theme", "dark");
        }
    }

    const appearance = loadAppearance();
    appearance.theme = theme;
    localStorage.setItem("appearance", JSON.stringify(appearance));
}

