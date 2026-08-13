/**
 * Client-facing site configuration.
 *
 * Keep only values that are safe to publish. Server credentials belong in the
 * backend environment, never in this static site.
 */
export const SITE_CONFIG = {
    name: "iSheep",
    apiBase: "https://isheep.onrender.com",
    categories: ["All", "Today", "Saved"],
};
