import { SITE_CONFIG } from "./config.js";

/* ==========================================================================
   1. DOM REFERENCES AND APPLICATION STATE
   --------------------------------------------------------------------------
   Keeping selectors and mutable state near the top makes the data flow easy
   to inspect: user actions update state, then one render path updates the UI.
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE_KEYS = {
    appearance: "isheep:appearance",
    enabledFeeds: "isheep:enabled-feeds",
    savedArticles: "isheep:saved-articles",
    viewMode: "isheep:view-mode",
};

// Keep the compact presentation aligned with the live site's phone breakpoint.
const MOBILE_TILE_QUERY = window.matchMedia("(max-width: 600px)");
const SYSTEM_DARK_QUERY = window.matchMedia("(prefers-color-scheme: dark)");
const FEATURED_STORY_COUNT = 5;

const elements = {
    grid: $("#newsGrid"),
    status: $("#status"),
    feedList: $("#feedList"),
    settingsOverlay: $("#settingsOverlay"),
    contactOverlay: $("#contactOverlay"),
    mobileMenu: $("#mobileMenu"),
    hamburgerButton: $("#hamburgerBtn"),
    searchInput: $("#searchInput"),
    searchClear: $("#searchClear"),
    mobileSearchInput: $("#mobileSearchInput"),
    mobileSearchClear: $("#mobileSearchClear"),
};

const state = {
    activeCategory: "All",
    availableFeeds: [],
    enabledFeeds: [],
    articles: [],
    searchQuery: "",
    // The live site opens in its compact, Apple News-style phone layout. A
    // visitor can still opt into the full-card view from the mobile menu.
    viewMode: readStorage(STORAGE_KEYS.viewMode, "compact") === "compact" ? "compact" : "grid",
    requestId: 0,
};

/* ==========================================================================
   2. STORAGE AND THEME HELPERS
   --------------------------------------------------------------------------
   Local storage is optional in some privacy modes, so every read and write is
   guarded. The site remains usable if it cannot persist a preference.
   ========================================================================== */

function readStorage(key, fallback) {
    try {
        const rawValue = window.localStorage.getItem(key);
        return rawValue === null ? fallback : JSON.parse(rawValue);
    } catch {
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Storage failures should not block a visitor from using the news feed.
    }
}

function getAppearance() {
    const stored = readStorage(STORAGE_KEYS.appearance, {});
    const theme = ["light", "dark", "system"].includes(stored?.theme)
        ? stored.theme
        : "system";

    return { theme };
}

function getResolvedTheme(preference = getAppearance().theme) {
    if (preference === "system") {
        return SYSTEM_DARK_QUERY.matches ? "dark" : "light";
    }

    return preference;
}

function setButtonIcon(button, iconClass) {
    const icon = button?.querySelector("i");

    if (icon) {
        icon.className = iconClass;
        icon.setAttribute("aria-hidden", "true");
    }
}

/**
 * Apply the saved theme to the root element, then update every visible theme
 * toggle. The document attribute lets CSS switch all tokens at once.
 */
function applyTheme() {
    const resolvedTheme = getResolvedTheme();
    if (resolvedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
    } else {
        document.documentElement.removeAttribute("data-theme");
    }

    const useDarkTheme = resolvedTheme !== "dark";
    const iconClass = useDarkTheme ? "fa-solid fa-moon" : "fa-solid fa-sun";
    const label = useDarkTheme ? "Dark theme" : "Light theme";

    setButtonIcon($("#themeToggle"), iconClass);
    setButtonIcon($("#mobileThemeToggle"), iconClass);
    setButtonIcon($("#mobileDarkToggle"), iconClass);

    const mobileThemeLabel = $("#mobileThemeLabel");
    if (mobileThemeLabel) {
        mobileThemeLabel.textContent = label;
    }

    [$("#themeToggle"), $("#mobileThemeToggle")].forEach((button) => {
        button?.setAttribute("aria-label", "Use " + label.toLowerCase());
    });
}

function toggleTheme() {
    const nextTheme = getResolvedTheme() === "dark" ? "light" : "dark";
    writeStorage(STORAGE_KEYS.appearance, { theme: nextTheme });
    applyTheme();
}

/* ==========================================================================
   3. GENERAL UI HELPERS
   ========================================================================== */

function setStatus(message) {
    if (elements.status) {
        elements.status.textContent = message;
    }
}

function pluralize(count, singular, plural = singular + "s") {
    return count === 1 ? singular : plural;
}

function isMobileTileView() {
    return state.viewMode === "compact" && MOBILE_TILE_QUERY.matches;
}

function shouldShowFeaturedCarousel() {
    return (
        isMobileTileView() &&
        state.activeCategory === "All" &&
        !state.searchQuery
    );
}

function closeMobileMenu() {
    if (!elements.mobileMenu || !elements.hamburgerButton) {
        return;
    }

    elements.mobileMenu.hidden = true;
    elements.hamburgerButton.setAttribute("aria-expanded", "false");
    elements.hamburgerButton.setAttribute("aria-label", "Open menu");
}

function toggleMobileMenu() {
    if (!elements.mobileMenu || !elements.hamburgerButton) {
        return;
    }

    const willOpen = elements.mobileMenu.hidden;
    elements.mobileMenu.hidden = !willOpen;
    elements.hamburgerButton.setAttribute("aria-expanded", String(willOpen));
    elements.hamburgerButton.setAttribute("aria-label", willOpen ? "Close menu" : "Open menu");
}

function updateOverlayScrollLock() {
    const hasOpenOverlay = !elements.settingsOverlay?.hidden || !elements.contactOverlay?.hidden;
    document.body.classList.toggle("has-overlay", hasOpenOverlay);
}

function openOverlay(overlay) {
    if (!overlay) {
        return;
    }

    // Only one modal dialog should be active at a time.
    [elements.settingsOverlay, elements.contactOverlay].forEach((item) => {
        if (item && item !== overlay) {
            item.hidden = true;
        }
    });

    closeMobileMenu();
    overlay.hidden = false;
    updateOverlayScrollLock();
}

function closeOverlay(overlay) {
    if (!overlay) {
        return;
    }

    overlay.hidden = true;
    updateOverlayScrollLock();
}

function createElement(tagName, className, textContent) {
    const element = document.createElement(tagName);

    if (className) {
        element.className = className;
    }

    if (textContent !== undefined) {
        element.textContent = textContent;
    }

    return element;
}

function createIcon(iconClass) {
    const icon = createElement("i", iconClass);
    icon.setAttribute("aria-hidden", "true");
    return icon;
}

/* ==========================================================================
   4. CATEGORY, SEARCH, AND VIEW CONTROLS
   --------------------------------------------------------------------------
   These controls only affect rendering. A new network request is made for
   category changes, while searching filters already-loaded articles instantly.
   ========================================================================== */

function syncCategoryControls() {
    $$("[data-category]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.category === state.activeCategory);
    });
}

async function setCategory(category) {
    if (!SITE_CONFIG.categories.includes(category)) {
        return;
    }

    state.activeCategory = category;
    syncCategoryControls();
    closeMobileMenu();
    await loadAndRenderNews();
}

function syncSearchControls() {
    const hasQuery = Boolean(state.searchQuery);

    if (elements.searchInput) {
        elements.searchInput.value = state.searchQuery;
    }

    if (elements.mobileSearchInput) {
        elements.mobileSearchInput.value = state.searchQuery;
    }

    if (elements.searchClear) {
        elements.searchClear.hidden = !hasQuery;
    }

    if (elements.mobileSearchClear) {
        elements.mobileSearchClear.hidden = !hasQuery;
    }
}

function setSearchQuery(value) {
    state.searchQuery = value.trim().toLowerCase();
    syncSearchControls();
    renderArticles();
}

function syncViewControls() {
    const compactView = state.viewMode === "compact";
    const label = $("#mobileViewLabel");

    if (label) {
        label.textContent = compactView ? "Standard view" : "Compact view";
    }

    setButtonIcon(
        $("#mobileViewToggle"),
        compactView ? "fa-solid fa-table-cells-large" : "fa-solid fa-table-list"
    );
}

function toggleViewMode() {
    state.viewMode = state.viewMode === "compact" ? "grid" : "compact";
    writeStorage(STORAGE_KEYS.viewMode, state.viewMode);
    syncViewControls();
    renderArticles();
    closeMobileMenu();
}

/* ==========================================================================
   5. FEED PREFERENCES
   --------------------------------------------------------------------------
   The server remains the source of truth for valid feeds. Locally persisted
   IDs are filtered against that list before being used in an API request.
   ========================================================================== */

async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Request failed with status " + response.status);
    }

    return response.json();
}

async function loadAvailableFeeds() {
    try {
        const feeds = await fetchJson(SITE_CONFIG.apiBase + "/api/feeds");

        if (!Array.isArray(feeds)) {
            throw new Error("Feed list was not an array");
        }

        state.availableFeeds = feeds.filter((feed) => feed?.id && feed?.name);
        return true;
    } catch (error) {
        console.error("Unable to load feed list:", error);
        state.availableFeeds = [];
        setStatus("News sources are temporarily unavailable. Please try again shortly.");
        return false;
    }
}

function loadEnabledFeeds() {
    const storedIds = readStorage(STORAGE_KEYS.enabledFeeds, null);
    const availableIds = new Set(state.availableFeeds.map((feed) => feed.id));

    // A saved empty array is meaningful: the visitor intentionally selected none.
    if (Array.isArray(storedIds)) {
        return storedIds.filter((id) => availableIds.has(id));
    }

    // First-time visitors see every available source, matching the original site behavior.
    return state.availableFeeds.map((feed) => feed.id);
}

function buildFeedList() {
    if (!elements.feedList) {
        return;
    }

    const enabledIds = new Set(state.enabledFeeds);
    const fragment = document.createDocumentFragment();

    state.availableFeeds.forEach((feed) => {
        const label = createElement("label", "feed-option");
        const checkbox = createElement("input");
        const name = createElement("span", "feed-option-name", feed.name);

        checkbox.type = "checkbox";
        checkbox.checked = enabledIds.has(feed.id);
        checkbox.dataset.feedId = feed.id;
        checkbox.setAttribute("aria-label", "Include " + feed.name);

        label.append(checkbox, name);
        fragment.appendChild(label);
    });

    elements.feedList.replaceChildren(fragment);
}

function saveSelectedFeeds() {
    const selectedIds = $$("input[data-feed-id]", elements.feedList)
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.dataset.feedId);

    state.enabledFeeds = selectedIds;
    writeStorage(STORAGE_KEYS.enabledFeeds, selectedIds);
    closeOverlay(elements.settingsOverlay);
    void loadAndRenderNews();
}

/* ==========================================================================
   6. SAVED ARTICLES
   --------------------------------------------------------------------------
   Saved stories are stored as whole article objects so they remain readable
   even after their original RSS entry no longer appears in a live response.
   ========================================================================== */

function loadSavedArticles() {
    const articles = readStorage(STORAGE_KEYS.savedArticles, []);

    return Array.isArray(articles)
        ? articles.filter((article) => article?.link && article?.title)
        : [];
}

function writeSavedArticles(articles) {
    writeStorage(STORAGE_KEYS.savedArticles, articles);
}

function isSavedArticle(article) {
    return loadSavedArticles().some((savedArticle) => savedArticle.link === article.link);
}

function toggleSavedArticle(article) {
    const savedArticles = loadSavedArticles();
    const matchingIndex = savedArticles.findIndex((savedArticle) => savedArticle.link === article.link);

    if (matchingIndex >= 0) {
        savedArticles.splice(matchingIndex, 1);
    } else {
        savedArticles.push(article);
    }

    writeSavedArticles(savedArticles);
    renderArticles();
}

/* ==========================================================================
   7. ARTICLE DATA AND RENDERING
   ========================================================================== */

function isToday(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return false;
    }

    const today = new Date();
    return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
    );
}

function isNewArticle(dateString) {
    const date = new Date(dateString);
    const elapsed = Date.now() - date.getTime();

    return !Number.isNaN(elapsed) && elapsed >= 0 && elapsed < 60 * 60 * 1_000;
}

function formatRelativeTime(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return "Recently";
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1_000));
    const units = [
        [365 * 24 * 60 * 60, "y"],
        [30 * 24 * 60 * 60, "mo"],
        [24 * 60 * 60, "d"],
        [60 * 60, "h"],
        [60, "m"],
    ];

    for (const [seconds, suffix] of units) {
        const value = Math.floor(elapsedSeconds / seconds);

        if (value > 0) {
            return value + suffix + " ago";
        }
    }

    return "Just now";
}

function getYouTubeThumbnail(url) {
    const match = String(url || "").match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );

    return match ? "https://img.youtube.com/vi/" + match[1] + "/mqdefault.jpg" : "";
}

function createImagePlaceholder(sourceName) {
    const placeholder = createElement(
        "div",
        "card-placeholder",
        String(sourceName || "?").charAt(0).toUpperCase()
    );
    placeholder.setAttribute("aria-hidden", "true");
    return placeholder;
}

function createArticleMedia(article) {
    const media = createElement("div", "card-media");
    const imageUrl = article.image || getYouTubeThumbnail(article.link);

    if (imageUrl) {
        const image = createElement("img", "card-image");
        image.src = imageUrl;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => {
            image.replaceWith(createImagePlaceholder(article.source));
        }, { once: true });
        media.appendChild(image);
    } else {
        media.appendChild(createImagePlaceholder(article.source));
    }

    if (isNewArticle(article.date)) {
        media.appendChild(createElement("span", "new-badge", "NEW"));
    }

    return media;
}

function openArticle(article) {
    window.open(article.link, "_blank", "noopener,noreferrer");
}

function createActionButton({ label, iconClass, active = false, onClick }) {
    const button = createElement("button", "action-button");

    button.type = "button";
    button.setAttribute("aria-label", label);
    button.classList.toggle("is-saved", active);
    button.appendChild(createIcon(iconClass));
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick(button);
    });

    return button;
}

async function shareArticle(article, button) {
    try {
        if (navigator.share) {
            await navigator.share({
                title: article.title,
                url: article.link,
            });
            return;
        }

        if (!navigator.clipboard?.writeText) {
            throw new Error("Clipboard access is unavailable");
        }

        await navigator.clipboard.writeText(article.link);
        setButtonIcon(button, "fa-solid fa-check");
        button.setAttribute("aria-label", "Link copied");

        window.setTimeout(() => {
            setButtonIcon(button, "fa-solid fa-arrow-up-from-bracket");
            button.setAttribute("aria-label", "Share article");
        }, 1_500);
    } catch (error) {
        // Dismissing the native share sheet is normal and does not need a UI error.
        if (error?.name !== "AbortError") {
            console.warn("Unable to share article:", error);
        }
    }
}

/**
 * Render one article structure for both normal and compact modes. User-provided
 * RSS text is assigned with textContent, never parsed as HTML.
 */
function createArticleCard(article, index) {
    const card = createElement("article", "card card-enter");
    const content = createElement("div", "card-content");
    const source = createElement("p", "card-source", article.source || "Source");
    const title = createElement("h2", "card-title");
    const link = createElement("a", "", article.title || "Untitled");
    const summary = createElement("p", "card-summary", article.summary || "");
    const footer = createElement("footer", "card-footer");
    const time = createElement("time", "card-time", formatRelativeTime(article.date));
    const actions = createElement("div", "card-actions");

    card.tabIndex = 0;
    card.style.animationDelay = Math.min(index * 35, 420) + "ms";
    card.addEventListener("click", (event) => {
        if (!event.target.closest("a, button")) {
            openArticle(article);
        }
    });
    card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.target.closest("a, button")) {
            event.preventDefault();
            openArticle(article);
        }
    });

    link.href = article.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const articleDate = new Date(article.date);
    if (!Number.isNaN(articleDate.getTime())) {
        time.dateTime = articleDate.toISOString();
    }

    const saved = isSavedArticle(article);
    const saveButton = createActionButton({
        label: saved ? "Remove from saved stories" : "Save story",
        iconClass: saved ? "fa-solid fa-star" : "fa-regular fa-star",
        active: saved,
        onClick: () => toggleSavedArticle(article),
    });
    const shareButton = createActionButton({
        label: "Share article",
        iconClass: "fa-solid fa-arrow-up-from-bracket",
        onClick: (button) => {
            void shareArticle(article, button);
        },
    });

    title.appendChild(link);
    content.append(source, title);

    if (article.summary) {
        content.appendChild(summary);
    }

    actions.append(saveButton, shareButton);
    footer.append(time, actions);
    card.append(createArticleMedia(article), content, footer);

    return card;
}

function getNewestArticles(articles) {
    return [...articles]
        .sort((firstArticle, secondArticle) => {
            const firstDate = Date.parse(firstArticle.date);
            const secondDate = Date.parse(secondArticle.date);
            const firstTimestamp = Number.isNaN(firstDate) ? 0 : firstDate;
            const secondTimestamp = Number.isNaN(secondDate) ? 0 : secondDate;

            return secondTimestamp - firstTimestamp;
        })
        .slice(0, FEATURED_STORY_COUNT);
}

function createFeaturedCarousel(articles) {
    const carousel = createElement("section", "featured-carousel card-enter");
    const heading = createElement("h2", "sr-only", "Latest stories");
    const track = createElement("div", "featured-carousel-track");

    carousel.setAttribute("aria-roledescription", "carousel");
    track.tabIndex = 0;
    track.setAttribute(
        "aria-label",
        "Latest stories. Swipe left or right to browse, or use the arrow keys."
    );

    articles.forEach((article, index) => {
        const card = createArticleCard(article, index);
        card.classList.add("featured-card");
        card.classList.remove("card-enter");
        card.classList.toggle("is-current", index === 0);
        card.setAttribute("aria-label", "Latest story " + (index + 1) + " of " + articles.length);
        track.appendChild(card);
    });

    const cards = $$(".featured-card", track);
    const syncCurrentCard = () => {
        const trackBounds = track.getBoundingClientRect();
        const trackCenter = trackBounds.left + (trackBounds.width / 2);
        let closestCard = cards[0];
        let closestDistance = Number.POSITIVE_INFINITY;

        cards.forEach((card) => {
            const cardBounds = card.getBoundingClientRect();
            const cardCenter = cardBounds.left + (cardBounds.width / 2);
            const distance = Math.abs(trackCenter - cardCenter);

            if (distance < closestDistance) {
                closestCard = card;
                closestDistance = distance;
            }
        });

        cards.forEach((card) => {
            card.classList.toggle("is-current", card === closestCard);
        });
    };

    let scrollFrame;
    track.addEventListener("scroll", () => {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(syncCurrentCard);
    }, { passive: true });
    window.requestAnimationFrame(syncCurrentCard);

    track.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }

        event.preventDefault();
        track.scrollBy({
            left: (event.key === "ArrowRight" ? 1 : -1) * track.clientWidth,
            behavior: "smooth",
        });
    });

    carousel.append(heading, track);

    if (articles.length > 1) {
        const hint = createElement("p", "featured-carousel-hint", "Swipe for more");
        hint.setAttribute("aria-hidden", "true");
        carousel.appendChild(hint);
    }

    return carousel;
}

function renderSkeletons() {
    if (!elements.grid) {
        return;
    }

    const skeletonCount = MOBILE_TILE_QUERY.matches ? 4 : 8;
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < skeletonCount; index += 1) {
        const card = createElement("article", "card skeleton-card");
        const media = createElement("div", "skeleton skeleton-media");
        const content = createElement("div", "skeleton-content");

        content.append(
            createElement("div", "skeleton skeleton-line short"),
            createElement("div", "skeleton skeleton-line"),
            createElement("div", "skeleton skeleton-line medium")
        );
        card.append(media, content);
        fragment.appendChild(card);
    }

    elements.grid.classList.remove("tile-view");
    elements.grid.replaceChildren(fragment);
}

function getVisibleArticles() {
    let articles = state.articles;

    if (state.activeCategory === "Today") {
        articles = articles.filter((article) => isToday(article.date));
    }

    if (!state.searchQuery) {
        return articles;
    }

    return articles.filter((article) => {
        const searchableText = [
            article.title,
            article.summary,
            article.source,
        ].join(" ").toLowerCase();

        return searchableText.includes(state.searchQuery);
    });
}

function getEmptyMessage() {
    if (state.activeCategory === "Saved") {
        return state.searchQuery
            ? "No saved stories match your search."
            : "No saved stories yet.";
    }

    if (state.activeCategory === "Today") {
        return state.searchQuery
            ? "No stories from today match your search."
            : "No stories from today.";
    }

    return state.searchQuery
        ? "No stories match your search."
        : "No articles found.";
}

function renderArticles() {
    if (!elements.grid) {
        return;
    }

    const articles = getVisibleArticles();
    elements.grid.classList.toggle("tile-view", isMobileTileView());
    elements.grid.replaceChildren();

    if (articles.length === 0) {
        setStatus(getEmptyMessage());
        return;
    }

    const fragment = document.createDocumentFragment();
    let remainingArticles = articles;
    let renderedFeaturedCount = 0;

    if (shouldShowFeaturedCarousel()) {
        const featuredArticles = getNewestArticles(articles);

        if (featuredArticles.length > 0) {
            fragment.appendChild(createFeaturedCarousel(featuredArticles));
            const featuredSet = new Set(featuredArticles);
            remainingArticles = articles.filter((article) => !featuredSet.has(article));
            renderedFeaturedCount = featuredArticles.length;
        }
    }

    remainingArticles.forEach((article, index) => {
        fragment.appendChild(createArticleCard(article, index + renderedFeaturedCount));
    });
    elements.grid.appendChild(fragment);

    if (state.searchQuery) {
        setStatus(
            articles.length + " " +
            pluralize(articles.length, "result") +
            " for \"" + state.searchQuery + "\""
        );
    } else {
        setStatus(articles.length + " " + pluralize(articles.length, "story"));
    }
}

/**
 * A request ID prevents a slow prior request from overwriting newer category
 * results when a visitor quickly switches between All, Today, and Saved.
 */
async function loadAndRenderNews() {
    const requestId = ++state.requestId;

    if (state.activeCategory === "Saved") {
        state.articles = loadSavedArticles();
        renderArticles();
        return;
    }

    if (state.enabledFeeds.length === 0) {
        state.articles = [];
        elements.grid?.replaceChildren();
        setStatus("No feeds selected. Open Feeds to choose sources.");
        return;
    }

    renderSkeletons();
    setStatus("Loading news...");

    const url = new URL(SITE_CONFIG.apiBase + "/api/news");
    url.searchParams.set("feeds", state.enabledFeeds.join(","));
    url.searchParams.set("limit", "60");

    try {
        const articles = await fetchJson(url);

        if (requestId !== state.requestId) {
            return;
        }

        state.articles = Array.isArray(articles) ? articles : [];
        renderArticles();
    } catch (error) {
        if (requestId !== state.requestId) {
            return;
        }

        console.error("Unable to load news:", error);
        elements.grid?.replaceChildren();
        setStatus("Unable to load news right now. Please try again shortly.");
    }
}

/* ==========================================================================
   8. EVENT WIRING
   --------------------------------------------------------------------------
   Event listeners are grouped by feature and only call named helpers. This
   avoids the duplicated touch/click handlers that previously caused races.
   ========================================================================== */

function wireCategoryControls() {
    $$("[data-category]").forEach((button) => {
        button.addEventListener("click", () => {
            void setCategory(button.dataset.category);
        });
    });
}

function wireSearchControl(input, clearButton) {
    if (!input || !clearButton) {
        return;
    }

    input.addEventListener("input", () => setSearchQuery(input.value));
    clearButton.addEventListener("click", () => {
        setSearchQuery("");
        input.focus();
    });
}

function wireThemeControls() {
    [$("#themeToggle"), $("#mobileThemeToggle"), $("#mobileDarkToggle")].forEach((button) => {
        button?.addEventListener("click", toggleTheme);
    });

    const updateSystemTheme = () => {
        if (getAppearance().theme === "system") {
            applyTheme();
        }
    };

    if (SYSTEM_DARK_QUERY.addEventListener) {
        SYSTEM_DARK_QUERY.addEventListener("change", updateSystemTheme);
    } else {
        SYSTEM_DARK_QUERY.addListener(updateSystemTheme);
    }
}

function wireSettingsDialog() {
    const openSettings = () => {
        buildFeedList();
        openOverlay(elements.settingsOverlay);
    };

    $("#openSettings")?.addEventListener("click", openSettings);
    $("#mobileSettings")?.addEventListener("click", openSettings);
    $("#closeSettings")?.addEventListener("click", () => closeOverlay(elements.settingsOverlay));
    $("#selectAll")?.addEventListener("click", () => {
        $$("input[data-feed-id]", elements.feedList).forEach((checkbox) => {
            checkbox.checked = true;
        });
    });
    $("#selectNone")?.addEventListener("click", () => {
        $$("input[data-feed-id]", elements.feedList).forEach((checkbox) => {
            checkbox.checked = false;
        });
    });
    $("#saveFeeds")?.addEventListener("click", saveSelectedFeeds);

    elements.settingsOverlay?.addEventListener("click", (event) => {
        if (event.target === elements.settingsOverlay) {
            closeOverlay(elements.settingsOverlay);
        }
    });
}

function wireContactDialog() {
    $("#mobileContact")?.addEventListener("click", () => openOverlay(elements.contactOverlay));
    $("#closeContact")?.addEventListener("click", () => closeOverlay(elements.contactOverlay));

    elements.contactOverlay?.addEventListener("click", (event) => {
        if (event.target === elements.contactOverlay) {
            closeOverlay(elements.contactOverlay);
        }
    });
}

function wireMobileMenu() {
    elements.hamburgerButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleMobileMenu();
    });

    elements.mobileMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", () => closeMobileMenu());
}

function wireViewControl() {
    $("#mobileViewToggle")?.addEventListener("click", toggleViewMode);
}

function wireGlobalKeyboardAndResize() {
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }

        closeMobileMenu();
        closeOverlay(elements.settingsOverlay);
        closeOverlay(elements.contactOverlay);
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
            closeMobileMenu();
            renderArticles();
        }, 120);
    });
}

/* ==========================================================================
   9. INITIALIZATION
   ========================================================================== */

async function initialize() {
    document.title = SITE_CONFIG.name + " | Your Apple News Hub";
    $$(".brand").forEach((brand) => {
        brand.textContent = SITE_CONFIG.name;
    });

    applyTheme();
    syncCategoryControls();
    syncSearchControls();
    syncViewControls();

    wireCategoryControls();
    wireSearchControl(elements.searchInput, elements.searchClear);
    wireSearchControl(elements.mobileSearchInput, elements.mobileSearchClear);
    wireThemeControls();
    wireSettingsDialog();
    wireContactDialog();
    wireMobileMenu();
    wireViewControl();
    wireGlobalKeyboardAndResize();

    const feedsLoaded = await loadAvailableFeeds();
    if (!feedsLoaded) {
        return;
    }

    state.enabledFeeds = loadEnabledFeeds();
    await loadAndRenderNews();
}

void initialize();
