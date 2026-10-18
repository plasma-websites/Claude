# What's My IP

A tiny static site that shows your public **IPv4** (big) and **IPv6** (below it), plus a history of IPs seen in this browser with a button to reset it.

- IPs are looked up client-side via [ipify](https://www.ipify.org/) (`api.ipify.org` for IPv4, `api6.ipify.org` for IPv6). If your network has no IPv6, it shows "Not available".
- History is stored in your browser's `localStorage`; a new entry is added only when your IP changes.

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project → GitHub** and pick this repo.
2. Leave the build command empty and the publish directory as `.` (already set in `netlify.toml`).
3. Deploy.

## Run locally

Open `index.html` in a browser, or run `npx serve .`.

### Deploying from this folder

This site currently lives in the `whats-my-ip/` folder of the `plasma-websites/Claude` repo. When importing into Netlify, set **Branch** to the branch it lives on and **Base directory** to `whats-my-ip`.
