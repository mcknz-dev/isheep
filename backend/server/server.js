import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import { FEED_ALLOWLIST } from "./feeds.allowlist.js";

const app = express();
const parser = new Parser({
    timeout: 12000
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

// Simple in-memory cache: { key: { expiresAt, data } }
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

function getCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        cache.delete(key);
        return null;
    }
    return hit.data;
}
function setCache(key, data) {
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, data });
}

function safeText(value) {
    return (value ?? "").toString().trim();
}

function extractImageFromHtml(html) {
    if (!html) return "";

    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : "";
}

function normalizeItem(item, feedMeta) {
    const title = safeText(item.title);
    const link = safeText(item.link || item.guid);
    const date = item.isoDate || item.pubDate || null;

    const summary =
        safeText(item.contentSnippet) ||
        safeText(item.summary) ||
        safeText(item.content).slice(0, 220);

    // ✅ BETTER IMAGE EXTRACTION
    const image =
        safeText(item.enclosure?.url) ||
        safeText(item["media:content"]?.url) ||
        extractImageFromHtml(item.content) ||
        extractImageFromHtml(item["content:encoded"]) ||
        "";

    return {
        id: `${feedMeta.id}:${link || title}`.slice(0, 250),
        title,
        link,
        source: feedMeta.name,
        feedId: feedMeta.id,
        categories: feedMeta.categories,
        date,
        summary,
        image
    };
}

app.get("/api/feeds", (_req, res) => {
    res.json(
        FEED_ALLOWLIST.map(f => ({
            id: f.id,
            name: f.name,
            categories: f.categories
        }))
    );
});

app.get("/api/news", async (req, res) => {
    try {
        const idsParam = safeText(req.query.feeds);
        const category = safeText(req.query.category); // optional filter server-side
        const limit = Math.min(parseInt(req.query.limit || "60", 10) || 60, 150);

        const selectedIds = idsParam
            ? idsParam.split(",").map(s => s.trim()).filter(Boolean)
            : FEED_ALLOWLIST.map(f => f.id);

        const allowed = new Map(FEED_ALLOWLIST.map(f => [f.id, f]));
        const feedsToFetch = selectedIds
            .map(id => allowed.get(id))
            .filter(Boolean);

        const cacheKey = `news:${feedsToFetch.map(f => f.id).join(",")}`;
        const cached = getCache(cacheKey);
        if (cached) {
            const filtered = category && category !== "All"
                ? cached.filter(a => a.categories.includes(category))
                : cached;
            return res.json(filtered.slice(0, limit));
        }

        const results = await Promise.allSettled(
            feedsToFetch.map(async (f) => {
                const feed = await parser.parseURL(f.url);
                return (feed.items || []).map(item => normalizeItem(item, f));
            })
        );

        let articles = [];
        for (const r of results) {
            if (r.status === "fulfilled") articles.push(...r.value);
        }

        // Sort newest first when possible
        articles.sort((a, b) => {
            const da = a.date ? Date.parse(a.date) : 0;
            const db = b.date ? Date.parse(b.date) : 0;
            return db - da;
        });

        setCache(cacheKey, articles);

        const filtered = category && category !== "All"
            ? articles.filter(a => a.categories.includes(category))
            : articles;

        res.json(filtered.slice(0, limit));
    } catch (err) {
        res.status(500).json({ error: "Failed to load news." });
    }
});

app.listen(PORT, () => {
    console.log(`RSS server running on http://localhost:${PORT}`);
});