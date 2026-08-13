import cors from "cors";
import express from "express";
import Parser from "rss-parser";
import { FEED_ALLOWLIST } from "./feeds.allowlist.js";

/**
 * iSheep's API does one job: fetch approved RSS sources and return a
 * consistent article shape for the static frontend.
 */
const app = express();
const parser = new Parser({ timeout: 12_000 });

const PORT = Number(process.env.PORT) || 8787;
const CACHE_DURATION_MS = 10 * 60 * 1_000;
const DEFAULT_ARTICLE_LIMIT = 60;
const MAX_ARTICLE_LIMIT = 150;

// The API is read-only, so CORS is the only middleware needed here.
app.use(cors());

/**
 * Cache merged feed results rather than individual feeds. Most visitors use
 * the same combinations, and the short TTL keeps the response current.
 */
const cache = new Map();

function readCache(key) {
    const cached = cache.get(key);

    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }

    return cached.value;
}

function writeCache(key, value) {
    cache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_DURATION_MS,
    });
}

/**
 * Convert unknown RSS values into predictable, trimmed strings.
 * RSS feeds regularly omit optional fields or use non-string values.
 */
function safeText(value) {
    return String(value ?? "").trim();
}

/**
 * RSS images can appear in several fields. This fallback handles the common
 * HTML-content case after structured image fields have been checked.
 */
function extractImageFromHtml(html) {
    const match = safeText(html).match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : "";
}

/**
 * Normalize each publisher's RSS item so frontend rendering is feed-agnostic.
 */
function normalizeArticle(item, feed) {
    const title = safeText(item.title);
    const link = safeText(item.link || item.guid);
    const summary = (
        safeText(item.contentSnippet) ||
        safeText(item.summary) ||
        safeText(item.content)
    ).slice(0, 220);
    const image = (
        safeText(item.enclosure?.url) ||
        safeText(item["media:content"]?.url) ||
        extractImageFromHtml(item.content) ||
        extractImageFromHtml(item["content:encoded"])
    );

    return {
        // A feed ID prefix prevents collisions between publishers with similar links.
        id: (feed.id + ":" + (link || title)).slice(0, 250),
        title,
        link,
        source: feed.name,
        feedId: feed.id,
        date: item.isoDate || item.pubDate || null,
        summary,
        image,
    };
}

function parseLimit(value) {
    const parsed = Number.parseInt(safeText(value), 10);

    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_ARTICLE_LIMIT;
    }

    return Math.min(parsed, MAX_ARTICLE_LIMIT);
}

/**
 * Resolve requested IDs against the server allowlist. A client can choose
 * sources, but it cannot make this server fetch an arbitrary URL.
 */
function getRequestedFeeds(request) {
    const queryHasFeeds = Object.prototype.hasOwnProperty.call(request.query, "feeds");
    const requestedIds = queryHasFeeds
        ? safeText(request.query.feeds).split(",").map((id) => id.trim()).filter(Boolean)
        : FEED_ALLOWLIST.map((feed) => feed.id);
    const feedsById = new Map(FEED_ALLOWLIST.map((feed) => [feed.id, feed]));

    return requestedIds
        .map((id) => feedsById.get(id))
        .filter(Boolean);
}

function articleTimestamp(article) {
    const timestamp = Date.parse(article.date);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * A small, stable endpoint used by the source picker.
 * URLs are intentionally not exposed because the UI does not need them.
 */
app.get("/api/feeds", (_request, response) => {
    response.json(FEED_ALLOWLIST.map(({ id, name }) => ({ id, name })));
});

/**
 * Fetch, normalize, and sort articles from the selected approved feeds.
 * A failed publisher does not prevent the remaining sources from rendering.
 */
app.get("/api/news", async (request, response) => {
    try {
        const feeds = getRequestedFeeds(request);
        const limit = parseLimit(request.query.limit);

        if (feeds.length === 0) {
            return response.json([]);
        }

        const cacheKey = "news:" + feeds.map((feed) => feed.id).join(",");
        const cachedArticles = readCache(cacheKey);

        if (cachedArticles) {
            return response.json(cachedArticles.slice(0, limit));
        }

        const results = await Promise.allSettled(
            feeds.map(async (feed) => {
                const parsedFeed = await parser.parseURL(feed.url);
                return (parsedFeed.items || []).map((item) => normalizeArticle(item, feed));
            })
        );

        const articles = results
            .flatMap((result) => {
                if (result.status === "fulfilled") {
                    return result.value;
                }

                // Keep errors observable without exposing publisher details to clients.
                console.warn("RSS source failed to load:", result.reason);
                return [];
            })
            .filter((article) => article.title && article.link)
            .sort((first, second) => articleTimestamp(second) - articleTimestamp(first));

        writeCache(cacheKey, articles);
        return response.json(articles.slice(0, limit));
    } catch (error) {
        console.error("News request failed:", error);
        return response.status(500).json({ error: "Unable to load news right now." });
    }
});

app.listen(PORT, () => {
    console.log("iSheep API listening on port " + PORT);
});
