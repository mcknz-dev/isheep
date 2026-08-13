# iSheep

iSheep is a lightweight Apple-news aggregator. The static frontend displays
articles from a small Express API, which fetches and normalizes RSS feeds from
an approved source list.

## Project structure

- docs/ - static site files for the public interface.
- docs/app.js - documented client state, rendering, preferences, and events.
- docs/styles.css - organized theme tokens, components, and responsive rules.
- backend/server/ - read-only RSS aggregation API.
- backend/server/feeds.allowlist.js - reviewed RSS sources accepted by the API.

## Run locally

Start the API from the server directory:

    cd backend/server
    npm install
    npm run dev

Serve docs/ with any static-file server. For local development, change
apiBase in docs/config.js to the API URL you are running locally.

## Configuration

The browser-safe configuration lives in docs/config.js. RSS source metadata
lives in backend/server/feeds.allowlist.js; the server only fetches URLs
declared in that allowlist.

## Features

- Feed selection persisted in browser storage.
- All, Today, and Saved article views.
- Search, sharing, and saved stories.
- Light, dark, and system theme support.
- A compact card layout for small screens.
