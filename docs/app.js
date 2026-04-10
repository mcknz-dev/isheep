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

    root.style.setProperty("--grid-columns", a.columns ?? 4);
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
let isListView = false;
// viewMode: "grid" | "tiles"
let viewMode = "grid";

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
wireThemeToggle();
wireSubscribe();
wireNewsletterModal();
wireSearch();
wirePullToRefresh();
wireWWDCCountdown();
wireViewToggle();
wireFirstVisitPopup();

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

    // Dark mode toggle in mobile menu
    const mobileDarkBtn = $("#mobileDarkToggle");
    const mobileDarkIcon = $("#mobileDarkIcon");
    const mobileDarkLabel = $("#mobileDarkLabel");

    // Dark mode toggle in mobile nav bar
    const mobileNavThemeBtn = $("#mobileThemeToggle");
    const mobileNavThemeIcon = $("#mobileThemeIcon");

    function updateAllDarkBtns() {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        if (mobileDarkIcon) mobileDarkIcon.className = isDark ? "fa-solid fa-sun mobile-row-icon" : "fa-solid fa-moon mobile-row-icon";
        if (mobileDarkLabel) mobileDarkLabel.textContent = isDark ? "Light Mode" : "Dark Mode";
        if (mobileNavThemeIcon) mobileNavThemeIcon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
        const navIcon = $("#themeToggleIcon");
        if (navIcon) navIcon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
    }

    updateAllDarkBtns();

    const toggleDark = (e) => {
        e.stopPropagation();
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const next = { ...loadAppearance(), theme: isDark ? "light" : "dark" };
        saveAppearance(next);
        applyAppearance();
        updateAllDarkBtns();
    };

    mobileDarkBtn?.addEventListener("click", toggleDark);
    mobileNavThemeBtn?.addEventListener("click", toggleDark);

    // Newsletter in mobile menu
    const mobileNewsletterBtn = $("#mobileNewsletter");
    mobileNewsletterBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileMenu?.classList.add("hidden");
        $("#newsletterBackdrop")?.classList.remove("hidden");
    });

    // Newsletter in mobile nav bar
    const mobileNavNewsletterBtn = $("#mobileNewsletterBtn");
    mobileNavNewsletterBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        $("#newsletterBackdrop")?.classList.remove("hidden");
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
   THEME TOGGLE (NAV BAR)
   ====================================================== */
function wireThemeToggle() {
    const btn = $("#themeToggle");
    const icon = $("#themeToggleIcon");
    if (!btn || !icon) return;

    function updateIcon() {
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
    }

    updateIcon();

    btn.addEventListener("click", () => {
        const current = loadAppearance();
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const next = { ...current, theme: isDark ? "light" : "dark" };
        saveAppearance(next);
        applyAppearance();
        updateIcon();

        // Keep the settings panel pills in sync
        document.querySelectorAll("#themePills button").forEach(b => {
            b.classList.toggle("active", b.dataset.theme === next.theme);
        });
    });
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
function isNew(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    if (isNaN(d)) return false;
    return (Date.now() - d.getTime()) < 60 * 60 * 1000; // within 1 hour
}

function renderDealCard(deal) {
    const card = document.createElement("div");
    card.className = "card deal-card";
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
        window.open(deal.link, "_blank", "noopener,noreferrer");
    });

    // Image
    const imgWrap = document.createElement("div");
    imgWrap.className = "card-image";
    const img = document.createElement("img");
    img.src = deal.image;
    img.loading = "lazy";
    img.onerror = () => { imgWrap.style.display = "none"; };
    imgWrap.appendChild(img);

    // Badge
    const badge = document.createElement("span");
    badge.className = "deal-badge";
    badge.textContent = deal.badge;
    imgWrap.appendChild(badge);

    card.appendChild(imgWrap);

    // Body
    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "title";
    title.textContent = deal.title;
    body.appendChild(title);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = deal.summary;
    body.appendChild(summary);

    card.appendChild(body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "card-header";

    const price = document.createElement("div");
    price.className = "deal-price";
    price.textContent = deal.price;

    const shopBtn = document.createElement("a");
    shopBtn.className = "deal-shop-btn";
    shopBtn.href = deal.link;
    shopBtn.target = "_blank";
    shopBtn.rel = "noopener noreferrer";
    shopBtn.textContent = "Shop on Amazon →";
    shopBtn.addEventListener("click", (e) => e.stopPropagation());

    footer.appendChild(price);
    footer.appendChild(shopBtn);
    card.appendChild(footer);

    return card;
}

function renderSkeletons() {
    const cols = loadAppearance().columns ?? 4;
    const count = window.innerWidth < 600 ? 4 : cols * 2;
    gridEl.innerHTML = "";
    for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        card.className = "card skeleton-card";
        card.innerHTML = `
            <div class="skeleton skeleton-image"></div>
            <div class="card-body" style="padding: 16px; gap: 10px;">
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-title" style="width: 75%;"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line" style="width: 60%;"></div>
            </div>
            <div class="card-header">
                <div class="skeleton skeleton-badge"></div>
                <div class="skeleton skeleton-time"></div>
            </div>
        `;
        gridEl.appendChild(card);
    }
}

async function loadAndRenderNews() {
    if (!gridEl || !statusEl) return;

    gridEl.innerHTML = "";
    statusEl.textContent = "";

    renderSkeletons();

    // ✅ Saved (your UI says "Saved" but your data-category uses "Read Later")
    if (activeCategory === "Read Later" || activeCategory === "Saved") {
        const saved = loadReadLater();
        if (!saved.length) {
            statusEl.textContent = "No saved stories yet.";
            return;
        }
        gridEl.innerHTML = "";
        statusEl.textContent = `${saved.length} saved stories`;
        saved.forEach((a, i) => {
            const card = renderCard(a);
            card.style.animationDelay = `${i * 40}ms`;
            card.classList.add("card-fadein");
            gridEl.appendChild(card);
        });
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
        gridEl.innerHTML = "";
        statusEl.textContent = "No articles found.";
        return;
    }

    gridEl.innerHTML = "";
    applyViewMode();
    statusEl.textContent = `${articles.length} stories`;
    articles.forEach((a, i) => {
        let card;
        if (window.innerWidth <= 600 && viewMode === "tiles") {
            card = renderSmallTileCard(a);
        } else {
            card = renderCard(a);
        }
        card.style.animationDelay = `${i * 40}ms`;
        card.classList.add("card-fadein");
        gridEl.appendChild(card);
    });
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

    // Card click — open article
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
        window.open(a.link, "_blank", "noopener,noreferrer");
    });

    // Image — always render the block, fallback to source-letter placeholder
    const imgWrap = document.createElement("div");
    imgWrap.className = "card-image";

    const articleDate = a.published || a.isoDate || a.pubDate || a.date;

    // Try YouTube thumbnail from link if no image
    function getYtThumb(url) {
        if (!url) return null;
        const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
    }

    const imgSrc = a.image || getYtThumb(a.link);

    if (imgSrc) {
        const img = document.createElement("img");
        img.src = imgSrc;
        img.loading = "lazy";
        img.onerror = () => {
            img.remove();
            const ph = document.createElement("div");
            ph.className = "card-image-placeholder";
            ph.textContent = (a.source || "?")[0].toUpperCase();
            imgWrap.appendChild(ph);
        };
        imgWrap.appendChild(img);
    } else {
        const ph = document.createElement("div");
        ph.className = "card-image-placeholder";
        ph.textContent = (a.source || "?")[0].toUpperCase();
        imgWrap.appendChild(ph);
    }

    // NEW badge
    if (isNew(articleDate)) {
        const badge = document.createElement("span");
        badge.className = "new-badge";
        badge.textContent = "NEW";
        imgWrap.appendChild(badge);
    }

    card.appendChild(imgWrap);

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
        e.preventDefault();
        e.stopPropagation();
        isSaved(a.link) ? removeFromReadLater(a.link) : saveToReadLater(a);
        saveBtn.textContent = isSaved(a.link) ? "★" : "☆";
    };

    // Share button
    const shareBtn = document.createElement("button");
    shareBtn.className = "share-btn";
    shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
    shareBtn.setAttribute("aria-label", "Share");
    shareBtn.onclick = async (e) => {
        e.stopPropagation();
        if (navigator.share) {
            try {
                await navigator.share({
                    title: a.title,
                    url: a.link
                });
            } catch {}
        } else {
            await navigator.clipboard.writeText(a.link);
            shareBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            setTimeout(() => {
                shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
            }, 1500);
        }
    };

    header.appendChild(source);
    header.appendChild(time);
    header.appendChild(saveBtn);
    header.appendChild(shareBtn);

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


/* ======================================================
   NEWSLETTER SUBSCRIBE
   ====================================================== */
function wireSubscribe() {
    const btn = $("#subscribeBtn");
    const status = $("#subscribeStatus");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        const email = $("#subEmail")?.value.trim();
        const firstName = $("#subFirstName")?.value.trim();
        const consent = $("#subConsent")?.checked;

        if (!email) {
            status.textContent = "Please enter your email.";
            status.style.color = "#e53e3e";
            return;
        }
        if (!consent) {
            status.textContent = "Please agree to receive emails.";
            status.style.color = "#e53e3e";
            return;
        }

        btn.textContent = "Subscribing…";
        btn.disabled = true;
        status.textContent = "";

        try {
            const res = await fetch(`${SITE_CONFIG.apiBase}/api/subscribe`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, firstName })
            });

            const data = await res.json();

            if (res.ok) {
                status.textContent = "🎉 You're subscribed! Check your inbox.";
                status.style.color = "#f58220";
                btn.textContent = "Subscribed!";
                $("#subEmail").value = "";
                $("#subFirstName").value = "";
                $("#subConsent").checked = false;
            } else if (res.status === 409) {
                status.textContent = "You're already subscribed!";
                status.style.color = "#f58220";
                btn.textContent = "Subscribe";
                btn.disabled = false;
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            status.textContent = err.message || "Something went wrong. Try again.";
            status.style.color = "#e53e3e";
            btn.textContent = "Subscribe";
            btn.disabled = false;
        }
    });
}

/* ======================================================
   NEWSLETTER MODAL
   ====================================================== */
function wireNewsletterModal() {
    const openBtn = $("#openNewsletter");
    const backdrop = $("#newsletterBackdrop");
    const closeBtn = $("#closeNewsletter");
    const submitBtn = $("#nlSubmitBtn");
    const status = $("#nlStatus");

    openBtn?.addEventListener("click", () => {
        backdrop?.classList.remove("hidden");
    });

    closeBtn?.addEventListener("click", () => {
        backdrop?.classList.add("hidden");
    });

    backdrop?.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.add("hidden");
    });

    submitBtn?.addEventListener("click", async () => {
        const email = $("#nlEmail")?.value.trim();
        const firstName = $("#nlFirstName")?.value.trim();
        const consent = $("#nlConsent")?.checked;

        if (!email) {
            status.textContent = "Please enter your email.";
            status.style.color = "#e53e3e";
            return;
        }
        if (!consent) {
            status.textContent = "Please agree to receive emails.";
            status.style.color = "#e53e3e";
            return;
        }

        submitBtn.textContent = "Subscribing…";
        submitBtn.disabled = true;
        status.textContent = "";

        try {
            const res = await fetch(`${SITE_CONFIG.apiBase}/api/subscribe`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, firstName })
            });

            const data = await res.json();

            if (res.ok) {
                status.textContent = "🎉 You're subscribed! Check your inbox.";
                status.style.color = "#f58220";
                submitBtn.textContent = "Subscribed!";
                $("#nlEmail").value = "";
                $("#nlFirstName").value = "";
                $("#nlConsent").checked = false;
            } else if (res.status === 409) {
                status.textContent = "You're already subscribed!";
                status.style.color = "#f58220";
                submitBtn.textContent = "Subscribe";
                submitBtn.disabled = false;
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            status.textContent = err.message || "Something went wrong. Try again.";
            status.style.color = "#e53e3e";
            submitBtn.textContent = "Subscribe";
            submitBtn.disabled = false;
        }
    });
}

/* ======================================================
   SEARCH
   ====================================================== */
let searchQuery = "";

function wireSearch() {
    // Desktop search
    const input = $("#searchInput");
    const clear = $("#searchClear");

    if (input) {
        input.addEventListener("input", () => {
            searchQuery = input.value.trim().toLowerCase();
            clear?.classList.toggle("hidden", !searchQuery);
            // Sync mobile input
            const mobileInput = $("#mobileSearchInput");
            if (mobileInput) mobileInput.value = input.value;
            filterCards();
        });

        clear?.addEventListener("click", () => {
            input.value = "";
            searchQuery = "";
            clear.classList.add("hidden");
            filterCards();
            input.focus();
        });
    }

    // Mobile search
    const mobileInput = $("#mobileSearchInput");
    const mobileClear = $("#mobileSearchClear");

    if (mobileInput) {
        mobileInput.addEventListener("input", () => {
            searchQuery = mobileInput.value.trim().toLowerCase();
            mobileClear?.classList.toggle("hidden", !searchQuery);
            // Sync desktop input
            if (input) input.value = mobileInput.value;
            filterCards();
            // Close menu and show results
            if (searchQuery) {
                $("#mobileMenu")?.classList.add("hidden");
            }
        });

        mobileClear?.addEventListener("click", () => {
            mobileInput.value = "";
            searchQuery = "";
            mobileClear.classList.add("hidden");
            if (input) input.value = "";
            filterCards();
        });
    }
}

function filterCards() {
    const cards = gridEl?.querySelectorAll(".card:not(.skeleton-card)");
    if (!cards) return;
    let visible = 0;
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        const match = !searchQuery || text.includes(searchQuery);
        card.style.display = match ? "" : "none";
        if (match) visible++;
    });
    if (statusEl) {
        statusEl.textContent = searchQuery
            ? `${visible} result${visible !== 1 ? "s" : ""} for "${searchQuery}"`
            : `${cards.length} stories`;
    }
}

/* ======================================================
   PULL TO REFRESH
   ====================================================== */
function wirePullToRefresh() {
    // Desktop only — mobile uses touch
    if (window.innerWidth > 600) return;

    let startY = 0;
    let pulling = false;
    let indicator = null;

    function createIndicator() {
        indicator = document.createElement("div");
        indicator.className = "pull-indicator";
        indicator.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        document.body.appendChild(indicator);
    }

    function removeIndicator() {
        indicator?.remove();
        indicator = null;
    }

    document.addEventListener("touchstart", (e) => {
        if (window.scrollY === 0) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 60) {
            if (!indicator) createIndicator();
            indicator.classList.add("visible");
        }
    }, { passive: true });

    document.addEventListener("touchend", async (e) => {
        if (!pulling) return;
        pulling = false;
        const dy = e.changedTouches[0].clientY - startY;
        if (dy > 60 && indicator) {
            indicator.classList.add("spinning");
            await loadAndRenderNews();
            removeIndicator();
        } else {
            removeIndicator();
        }
    });
}

/* ======================================================
   WWDC COUNTDOWN
   ====================================================== */
function wireWWDCCountdown() {
    const el = $("#wwdcCountdown");
    if (!el) return;

    // WWDC26 — June 8, 2026 at 1:00 PM EDT (UTC-4, summer time)
    const WWDC = new Date("2026-06-08T13:00:00-04:00");

    // Make countdown clickable
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
        window.open("https://developer.apple.com/wwdc26/", "_blank", "noopener,noreferrer");
    });

    const mobileBanner = $("#mobileWwdcBanner");

    function update() {
        const now = new Date();
        const diff = WWDC - now;

        if (diff <= 0) {
            el.innerHTML = `<span class="wwdc-live">🎉 WWDC is live!</span>`;
            if (mobileBanner) mobileBanner.innerHTML = `<span class="wwdc-live">🎉 WWDC is live!</span>`;
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        const timeStr = days > 0
            ? `${days} DAY${days !== 1 ? "S" : ""} AWAY`
            : `${hours}h ${mins}m AWAY`;

        const inner = `
            <span class="wwdc-label-text">WWDC</span><span class="wwdc-year">26</span>
            <span class="wwdc-days-text">${timeStr}</span>
        `;

        el.innerHTML = inner;
        if (mobileBanner) mobileBanner.innerHTML = `<span class="wwdc-label-text">WWDC</span><span class="wwdc-year">26</span><span class="wwdc-days-text">${timeStr}</span>`;
    }

    update();
    setInterval(update, 60000); // update every minute
}

/* ======================================================
   MOBILE LIST VIEW TOGGLE
   ====================================================== */
function wireViewToggle() {
    const btn = $("#mobileViewToggle");
    if (!btn) return;

    viewMode = localStorage.getItem("viewMode") || "grid";
    isListView = false;
    applyViewMode();

    btn.addEventListener("click", () => {
        viewMode = viewMode === "grid" ? "tiles" : "grid";
        localStorage.setItem("viewMode", viewMode);
        applyViewMode();
        const cards = gridEl?.querySelectorAll(".card:not(.skeleton-card)");
        if (cards?.length) loadAndRenderNews();
    });
}

function applyViewMode() {
    const icon = $("#mobileViewIcon");
    const grid = gridEl;
    if (!grid) return;

    grid.classList.remove("list-view", "small-tiles-view");

    if (viewMode === "tiles") {
        grid.classList.add("small-tiles-view");
        if (icon) icon.className = "fa-solid fa-grip";
    } else {
        if (icon) icon.className = "fa-solid fa-grip";
    }
}

function renderCompactCard(a) {
    const card = document.createElement("div");
    card.className = "card compact-card";
    card.style.cursor = "pointer";
    card.addEventListener("click", () => {
        window.open(a.link, "_blank", "noopener,noreferrer");
    });

    // NEW badge
    const articleDate = a.published || a.isoDate || a.pubDate || a.date;
    if (isNew(articleDate)) {
        const badge = document.createElement("span");
        badge.className = "new-badge compact-new";
        badge.textContent = "NEW";
        card.appendChild(badge);
    }

    // Main row: thumbnail + content
    const row = document.createElement("div");
    row.className = "compact-row";

    // Thumbnail
    if (a.image) {
        const img = document.createElement("img");
        img.src = a.image;
        img.className = "compact-thumb";
        img.loading = "lazy";
        row.appendChild(img);
    }

    // Text content
    const text = document.createElement("div");
    text.className = "compact-text";

    const source = document.createElement("div");
    source.className = "compact-source";
    source.textContent = a.source || "Source";
    text.appendChild(source);

    const title = document.createElement("div");
    title.className = "compact-title";
    title.textContent = a.title || "Untitled";
    text.appendChild(title);

    // Footer: time + actions
    const footer = document.createElement("div");
    footer.className = "compact-footer";

    const time = document.createElement("span");
    time.className = "compact-time";
    time.textContent = timeAgo(articleDate);
    footer.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "compact-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "compact-action-btn";
    saveBtn.innerHTML = isSaved(a.link) ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    saveBtn.onclick = (e) => {
        e.stopPropagation();
        isSaved(a.link) ? removeFromReadLater(a.link) : saveToReadLater(a);
        saveBtn.innerHTML = isSaved(a.link) ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    };

    const shareBtn = document.createElement("button");
    shareBtn.className = "compact-action-btn";
    shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
    shareBtn.onclick = async (e) => {
        e.stopPropagation();
        if (navigator.share) {
            try { await navigator.share({ title: a.title, url: a.link }); } catch {}
        } else {
            await navigator.clipboard.writeText(a.link);
            shareBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            setTimeout(() => { shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>'; }, 1500);
        }
    };

    actions.appendChild(saveBtn);
    actions.appendChild(shareBtn);
    footer.appendChild(actions);
    text.appendChild(footer);

    row.appendChild(text);
    card.appendChild(row);

    return card;
}

/* ======================================================
   SMALL TILE CARD — 2-col Apple News style (mobile)
   ====================================================== */
function renderSmallTileCard(a) {
    const card = document.createElement("div");
    card.className = "card small-tile-card";
    card.addEventListener("click", () => {
        window.open(a.link, "_blank", "noopener,noreferrer");
    });

    const articleDate = a.published || a.isoDate || a.pubDate || a.date;

    // NEW badge
    if (isNew(articleDate)) {
        const badge = document.createElement("span");
        badge.className = "small-tile-new";
        badge.textContent = "NEW";
        card.appendChild(badge);
    }

    // Image or placeholder — with YouTube thumbnail extraction
    function getYoutubeThumbnail(url) {
        if (!url) return null;
        const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return m ? `https://img.youtube.com/vi/${m[1]}/mqdefault.jpg` : null;
    }

    const ytThumb = getYoutubeThumbnail(a.link);
    const imgSrc = a.image || ytThumb;

    if (imgSrc) {
        const img = document.createElement("img");
        img.src = imgSrc;
        img.className = "small-tile-img";
        img.loading = "lazy";
        img.onerror = () => {
            // If YouTube thumb also fails, or image 404s — show letter placeholder
            const ph = document.createElement("div");
            ph.className = "small-tile-img-placeholder";
            ph.textContent = (a.source || "?")[0].toUpperCase();
            img.replaceWith(ph);
        };
        card.appendChild(img);
    } else {
        const ph = document.createElement("div");
        ph.className = "small-tile-img-placeholder";
        ph.textContent = (a.source || "?")[0].toUpperCase();
        card.appendChild(ph);
    }

    // Body
    const body = document.createElement("div");
    body.className = "small-tile-body";

    const source = document.createElement("div");
    source.className = "small-tile-source";
    source.textContent = a.source || "Source";
    body.appendChild(source);

    const title = document.createElement("div");
    title.className = "small-tile-title";
    title.textContent = a.title || "Untitled";
    body.appendChild(title);

    // Footer
    const footer = document.createElement("div");
    footer.className = "small-tile-footer";

    const time = document.createElement("span");
    time.className = "small-tile-time";
    time.textContent = timeAgo(articleDate);
    footer.appendChild(time);

    const actions = document.createElement("div");
    actions.className = "small-tile-actions";

    const saveBtn = document.createElement("button");
    saveBtn.className = "small-tile-btn";
    saveBtn.innerHTML = isSaved(a.link) ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    saveBtn.onclick = (e) => {
        e.stopPropagation();
        isSaved(a.link) ? removeFromReadLater(a.link) : saveToReadLater(a);
        saveBtn.innerHTML = isSaved(a.link) ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
    };

    const shareBtn = document.createElement("button");
    shareBtn.className = "small-tile-btn";
    shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>';
    shareBtn.onclick = async (e) => {
        e.stopPropagation();
        if (navigator.share) {
            try { await navigator.share({ title: a.title, url: a.link }); } catch {}
        } else {
            await navigator.clipboard.writeText(a.link);
            shareBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
            setTimeout(() => { shareBtn.innerHTML = '<i class="fa-solid fa-arrow-up-from-bracket"></i>'; }, 1500);
        }
    };

    actions.appendChild(saveBtn);
    actions.appendChild(shareBtn);
    footer.appendChild(actions);
    body.appendChild(footer);
    card.appendChild(body);

    return card;
}

/* ======================================================
   FIRST VISIT NEWSLETTER POPUP
   ====================================================== */
function wireFirstVisitPopup() {
    const backdrop = $("#firstVisitBackdrop");
    if (!backdrop) return;

    // Only show once — check flag
    const seen = localStorage.getItem("fv_newsletter_seen");
    if (seen) return;

    // Show after a short delay so page loads first
    setTimeout(() => {
        backdrop.classList.remove("hidden");
    }, 8000);

    const close = () => {
        backdrop.classList.add("hidden");
        localStorage.setItem("fv_newsletter_seen", "1");
    };

    $("#fvClose")?.addEventListener("click", close);
    $("#fvSkip")?.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
    });

    $("#fvSubmit")?.addEventListener("click", async () => {
        const email = $("#fvEmail")?.value.trim();
        const firstName = $("#fvFirstName")?.value.trim();
        const consent = $("#fvConsent")?.checked;
        const status = $("#fvStatus");
        const btn = $("#fvSubmit");

        if (!email) { status.textContent = "Please enter your email."; status.style.color = "#e53e3e"; return; }
        if (!consent) { status.textContent = "Please check the box to agree."; status.style.color = "#e53e3e"; return; }

        btn.textContent = "Subscribing…";
        btn.disabled = true;
        status.textContent = "";

        try {
            const res = await fetch(`${SITE_CONFIG.apiBase}/api/subscribe`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, firstName })
            });
            const data = await res.json();

            if (res.ok) {
                status.textContent = "🎉 You're in! Check your inbox.";
                status.style.color = "#f58220";
                btn.textContent = "Subscribed!";
                setTimeout(close, 2000);
            } else if (res.status === 409) {
                status.textContent = "Already subscribed!";
                status.style.color = "#f58220";
                btn.textContent = "Subscribe";
                btn.disabled = false;
                setTimeout(close, 1500);
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            status.textContent = err.message || "Something went wrong.";
            status.style.color = "#e53e3e";
            btn.textContent = "Subscribe";
            btn.disabled = false;
        }
    });
}
