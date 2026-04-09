import express from "express";
import cors from "cors";
import Parser from "rss-parser";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { FEED_ALLOWLIST } from "./feeds.allowlist.js";

const app = express();
const parser = new Parser({ timeout: 12000 });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8787;

// Supabase + Resend clients
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

// Simple in-memory cache
const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

function getCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) { cache.delete(key); return null; }
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

    const image =
        safeText(item.enclosure?.url) ||
        safeText(item["media:content"]?.url) ||
        extractImageFromHtml(item.content) ||
        extractImageFromHtml(item["content:encoded"]) ||
        "";

    return {
        id: `${feedMeta.id}:${link || title}`.slice(0, 250),
        title, link,
        source: feedMeta.name,
        feedId: feedMeta.id,
        categories: feedMeta.categories,
        date, summary, image
    };
}

// =============================================================
// EXISTING ROUTES
// =============================================================

app.get("/api/feeds", (_req, res) => {
    res.json(FEED_ALLOWLIST.map(f => ({
        id: f.id, name: f.name, categories: f.categories
    })));
});

app.get("/api/news", async (req, res) => {
    try {
        const idsParam = safeText(req.query.feeds);
        const category = safeText(req.query.category);
        const limit = Math.min(parseInt(req.query.limit || "60", 10) || 60, 150);

        const selectedIds = idsParam
            ? idsParam.split(",").map(s => s.trim()).filter(Boolean)
            : FEED_ALLOWLIST.map(f => f.id);

        const allowed = new Map(FEED_ALLOWLIST.map(f => [f.id, f]));
        const feedsToFetch = selectedIds.map(id => allowed.get(id)).filter(Boolean);

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

// =============================================================
// NEWSLETTER: SUBSCRIBE
// =============================================================

app.post("/api/subscribe", async (req, res) => {
    try {
        const email = safeText(req.body.email).toLowerCase();
        const firstName = safeText(req.body.firstName) || null;

        // Basic email validation
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "Invalid email address." });
        }

        // Check if already subscribed
        const { data: existing } = await supabase
            .from("subscribers")
            .select("id, unsubscribed")
            .eq("email", email)
            .single();

        if (existing && !existing.unsubscribed) {
            return res.status(409).json({ error: "Already subscribed." });
        }

        // Re-subscribe if they previously unsubscribed
        if (existing && existing.unsubscribed) {
            await supabase
                .from("subscribers")
                .update({ unsubscribed: false, first_name: firstName })
                .eq("email", email);
        } else {
            // New subscriber
            await supabase
                .from("subscribers")
                .insert({ email, first_name: firstName });
        }

        // Add to Resend audience
        await resend.contacts.create({
            email,
            firstName: firstName || "",
            unsubscribed: false,
            audienceId: RESEND_AUDIENCE_ID
        });

        // Send confirmation email
        const greeting = firstName ? `Hi ${firstName}` : "Hi there";
        await resend.emails.send({
            from: "iSheep <hello@isheep.news>",
            to: email,
            subject: "🐑 You're subscribed to iSheep!",
            html: `
                <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #ffffff;">
                    <div style="text-align: center; margin-bottom: 32px;">
                        <h1 style="font-size: 32px; font-weight: 800; letter-spacing: 2px; margin: 0; color: #111;">iSheep</h1>
                        <p style="color: #888; margin: 8px 0 0; font-size: 14px;">Your Apple news, all in one place.</p>
                    </div>
                    <h2 style="font-size: 22px; font-weight: 700; color: #111; margin-bottom: 12px;">${greeting}, welcome aboard! 🎉</h2>
                    <p style="color: #444; line-height: 1.6; margin-bottom: 24px;">
                        You're now subscribed to the iSheep weekly digest. Every week you'll get the best Apple news delivered straight to your inbox.
                    </p>
                    <a href="https://isheep.news" style="display: inline-block; background: #f58220; color: #fff; font-weight: 700; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-size: 15px;">
                        Read today's news →
                    </a>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 40px 0 24px;" />
                    <p style="color: #aaa; font-size: 12px; text-align: center;">
                        © 2026 iSheep.news — <a href="https://isheep.onrender.com/api/unsubscribe?token=TOKEN_PLACEHOLDER" style="color: #aaa;">Unsubscribe</a>
                    </p>
                </div>
            `
        });

        res.json({ success: true });

    } catch (err) {
        console.error("Subscribe error:", err);
        res.status(500).json({ error: "Something went wrong. Please try again." });
    }
});

// =============================================================
// NEWSLETTER: UNSUBSCRIBE
// =============================================================

app.get("/api/unsubscribe", async (req, res) => {
    try {
        const token = safeText(req.query.token);
        if (!token) return res.status(400).send("Invalid unsubscribe link.");

        const { data: subscriber } = await supabase
            .from("subscribers")
            .select("id, email")
            .eq("unsubscribe_token", token)
            .single();

        if (!subscriber) {
            return res.status(404).send("Unsubscribe link not found.");
        }

        // Mark as unsubscribed in Supabase
        await supabase
            .from("subscribers")
            .update({ unsubscribed: true })
            .eq("id", subscriber.id);

        // Mark as unsubscribed in Resend
        await resend.contacts.update({
            email: subscriber.email,
            unsubscribed: true,
            audienceId: RESEND_AUDIENCE_ID
        });

        res.send(`
            <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; padding: 0 24px;">
                <h1 style="font-size: 28px; font-weight: 800; color: #111;">Unsubscribed</h1>
                <p style="color: #666; line-height: 1.6;">You've been removed from the iSheep weekly digest. Sorry to see you go!</p>
                <a href="https://isheep.news" style="display: inline-block; margin-top: 24px; background: #f58220; color: #fff; font-weight: 700; text-decoration: none; padding: 12px 24px; border-radius: 12px;">
                    Back to iSheep
                </a>
            </div>
        `);

    } catch (err) {
        console.error("Unsubscribe error:", err);
        res.status(500).send("Something went wrong.");
    }
});

app.listen(PORT, () => {
    console.log(`RSS server running on http://localhost:${PORT}`);
});
