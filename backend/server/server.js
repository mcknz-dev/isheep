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
        const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
        const { data: subData } = await supabase
            .from("subscribers")
            .select("unsubscribe_token")
            .eq("email", email)
            .single();
        const unsubToken = subData?.unsubscribe_token ?? "";

        await resend.emails.send({
            from: "iSheep <hello@isheep.news>",
            to: email,
            subject: "🐑 You're in! Welcome to iSheep",
            html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&family=DM+Mono:wght@400&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

        <!-- HEADER — white, clean -->
        <tr><td style="background:#ffffff;border-radius:20px 20px 0 0;padding:40px 40px 28px;text-align:center;border-bottom:1px solid #eeeeee;">
          <img src="https://isheep.news/assets/homepage/Sheep.png" alt="iSheep" width="72" height="72" style="display:block;margin:0 auto 16px;image-rendering:pixelated;" />
          <div style="font-family:'Orbitron',Georgia,sans-serif;font-size:30px;font-weight:700;letter-spacing:4px;color:#111111;line-height:1;">iSheep</div>
          <div style="font-family:'DM Mono',monospace;font-size:12px;font-weight:500;letter-spacing:3px;color:#f58220;text-transform:uppercase;margin-top:6px;">Weekly</div>
          <div style="font-family:'DM Mono',monospace;font-size:11px;color:#aaaaaa;margin-top:12px;letter-spacing:1.5px;text-transform:uppercase;">Your Apple news, all in one place</div>
        </td></tr>

        <!-- ORANGE ACCENT BAR -->
        <tr><td style="background:#f58220;height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- BODY -->
        <tr><td style="background:#ffffff;padding:36px 40px 32px;">

          <h1 style="font-size:22px;font-weight:800;color:#111111;margin:0 0 14px;">Welcome aboard${firstName ? `, ${firstName}` : ""}! 🎉</h1>

          <p style="font-size:15px;line-height:1.7;color:#444444;margin:0 0 12px;">
            You're now subscribed to <strong>iSheep Weekly</strong> — your Sunday catch-up for everything Apple. Every week I'll send you the biggest stories from the past week, what was released, and a note from me.
          </p>

        

          <!-- CTA BUTTON -->
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td align="center">
              <table cellpadding="0" cellspacing="0">
                <tr><td style="background:#f58220;border-radius:12px;box-shadow:0 4px 16px rgba(245,130,32,0.35);">
                  <a href="https://isheep.news" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">
                    Read today's news →
                  </a>
                </td></tr>
              </table>
            </td></tr>
          </table>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#f7f7f7;padding:24px 40px;text-align:center;border-radius:0 0 20px 20px;border-top:1px solid #eeeeee;">
          <p style="font-size:12px;color:#999999;margin:0 0 6px;">
            Sent by <a href="https://isheep.news" style="color:#f58220;text-decoration:none;font-weight:600;">iSheep.news</a> · Built by <a href="https://mcknz.dev" style="color:#f58220;text-decoration:none;font-weight:600;">mcknz.dev</a>
          </p>
          <p style="font-size:12px;color:#bbbbbb;margin:0;">
            <a href="https://isheep.onrender.com/api/unsubscribe?token=${unsubToken}" style="color:#bbbbbb;">Unsubscribe</a> · © 2026 iSheep.news
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>
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
