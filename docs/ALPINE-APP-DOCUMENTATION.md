# Alpine.js App Documentation

Describes template release **1.0.0** (unreleased). See [CHANGELOG.md](../CHANGELOG.md) for what changed in each release.

How the interactive parts of the Small-Business Site Frame work, and how to change them safely.

For the "reuse this for a new client" steps, deployment and the pre-launch checklist, see [README.md](../README.md). This document covers the Alpine.js layer underneath it: what each component does, where its data comes from, and what to watch out for when editing.

**All site paths in this document are inside `site/`** unless they start with another top-level folder (`tests/`, `docs/`).

---

## Contents

1. [Overview](#1-overview)
2. [How the scripts load](#2-how-the-scripts-load)
3. [Configuration: `window.SITE`](#3-configuration-windowsite)
4. [Components](#4-components)
   - [mobileNav](#41-mobilenav--header-navigation)
   - [$store.hours](#42-storehours--open-now-status-and-hours-table)
   - [showcase](#43-showcase--menu--gallery-and-lightbox)
   - [faq](#44-faq--accordion)
   - [contactForm](#45-contactform--validated-contact-form)
   - [Footer year](#46-footer-year)
5. [How the hours calculation works](#5-how-the-hours-calculation-works)
6. [Styling hooks used by Alpine](#6-styling-hooks-used-by-alpine)
7. [Accessibility built into the components](#7-accessibility-built-into-the-components)
8. [Common tasks](#8-common-tasks)
9. [Troubleshooting](#9-troubleshooting)
10. [Testing](#10-testing)
11. [Roadmap](#11-roadmap)

---

## 1. Overview

The website is a single static page in the `site/` folder. There is no build step, no bundler and no `package.json`: open `site/index.html` in a browser and it runs.

| Piece | Where | Role |
| --- | --- | --- |
| Alpine.js 3.14.1 | `site/js/vendor/` (self-hosted) | Reactivity and `x-` directives in the HTML |
| Alpine Focus plugin 3.14.1 | `site/js/vendor/` (self-hosted) | Provides `x-trap` for the lightbox |
| `js/site-config.js` | `site/` | All per-business data, exposed as `window.SITE` |
| `js/components.js` | `site/` | Hours helper functions + every Alpine component and store |
| `index.html` | `site/` | Markup; each feature attaches to a component with `x-data` |
| `css/styles.css` | `site/` | Styles, including the classes Alpine toggles |

The design rule throughout: **data lives in `site-config.js`, behaviour lives in `components.js`, markup lives in `index.html`.** Reusing the template for a new business should normally mean editing only the config file and the copy in the HTML.

### Project files

```
site/                         THE WEBSITE: the only folder that is deployed or copied for a client
  index.html                  Page markup + CSP <meta> tag; each feature is an x-data component
  404.html                    "Page not found" page (no Alpine, no scripts; its own stricter CSP)
  _headers                    Security headers for Netlify / Cloudflare Pages (a CSP copy lives here too)
  _redirects                  Returns 404 for project paths if they're uploaded by mistake (Netlify only)
  css/styles.css              All styles, mobile-first; theme variables in :root
  js/site-config.js           Per-business data (window.SITE)
  js/components.js            Hours helpers + all Alpine components and the hours store
  js/vendor/                  Self-hosted Alpine core and Focus plugin (always the same version)
  images/                     Placeholder photos
tests/browser-test.mjs        Automated headless-Chrome tests; template and --client modes (not deployed)
CHANGELOG.md                  Template releases; security-relevant changes marked 🔒 (not deployed)
screenshots/                  Images used in the README (not deployed)
docs/                         This documentation (not deployed)
README.md                     Project README (not deployed)
.gitattributes                Keeps site/js/vendor/ byte-exact in git (see §2)
```

> **Deploying: publish `site/` only**, never the project root. Set the publish directory to `site` on Netlify / Cloudflare Pages, or upload the *contents* of `site/` elsewhere. The root holds `.git/`, `docs/`, `tests/` and the README, none of which belong on a client site. Start a new client's site from a copy of `site/` only. Full steps are in the README.

### Running it locally

Opening `site/index.html` directly (`file://`) works, including under the CSP. A local server is closer to how the live site behaves. Run one of these **from the project root** (no `cd` needed):

```sh
python -m http.server 8000 --bind 127.0.0.1 --directory site
npx --yes serve@14.2.6 -l tcp://127.0.0.1:8000 site
```

Then open http://127.0.0.1:8000. On both `file://` and `127.0.0.1`/`localhost`, an empty `formEndpoint` logs submissions to the console instead of failing (see [4.5](#45-contactform--validated-contact-form)).

- **Keep the `127.0.0.1` binding.** Without it, `python -m http.server` listens on every network interface, and anyone on the same Wi-Fi can browse what you're serving.
- **Don't serve the project root.** It contains `.git/` (the full source and history) and other project files that don't belong on a website. Both commands above serve `site/` only, wherever you run them from.
- **Keep `serve` pinned** to a version, so `npx` doesn't download and run whatever is newest on npm.

### Template releases and client sites

Each client site is a **copy of `site/`** taken on one day. Fixes made to the template later don't reach it on their own. Three things track which release each client site is on:

| What | Where | Purpose |
| --- | --- | --- |
| **Release tag** | git tag `vMAJOR.MINOR.PATCH` | Marks a launch-ready template state. `v1.0.0` isn't tagged yet; it waits on choosing the host and form provider, a manual autofill test, and a staging header scan. |
| **Changelog** | `CHANGELOG.md` (project root) | What changed in each release. **🔒 Security** marks changes that must go out to live client sites. 1.0.0 is listed as "Unreleased". |
| **Client register** | Kept by whoever owns the pre-launch checklist, **outside `site/` and outside anything public** | Client, live URL, the template release it was copied from, launch date, form provider. When a 🔒 release ships, the register says which sites need it. |

**Update policy:** a security-relevant release should go out to every live client site within an agreed window (suggested: 14 days for anything of Medium severity or above).

**When you change the template:** add an entry to `CHANGELOG.md` and mark it 🔒 if it affects security. At release time, tag the commit.

---

## 2. How the scripts load

From the `<head>` of `site/index.html`:

```html
<script defer src="js/site-config.js"></script>
<script defer src="js/components.js"></script>
<script defer src="js/vendor/alpine-focus-3.14.1.min.js"></script>
<script defer src="js/vendor/alpine-3.14.1.min.js"></script>
```

These paths are relative to `index.html`, so they didn't change when the site moved into `site/`.

Alpine is **self-hosted**: no script loads from a third-party domain. This removes the risk of a compromised CDN, keeps `script-src` limited to `'self'` plus `'unsafe-eval'` (which the standard Alpine build needs until the planned move to Alpine's CSP build), and lets the site work offline.

**The order matters.** `defer` scripts run in document order once the HTML is parsed, so:

1. `site-config.js` sets `window.SITE`.
2. `components.js` registers a listener for Alpine's `alpine:init` event.
3. The Focus plugin registers itself.
4. Alpine core starts, fires `alpine:init` (our components and store get registered), then walks the page and initialises every `x-data` element.

If Alpine core is moved above `components.js`, the `alpine:init` event fires before anyone is listening and every component on the page fails with "`mobileNav` is not defined"-style errors. Keep Alpine core **last**.

### Upgrading Alpine

Alpine core and the Focus plugin must **always be the same version**, and both files must be replaced in the same change. Replacing only one, or changing a filename without updating `index.html`, breaks every component on the page at once.

Self-hosting means **no update ever arrives automatically**. There's no `package.json`, so no Dependabot either. Someone must watch for Alpine security fixes: on GitHub, `alpinejs/alpine` → Watch → Custom → Security alerts. The pre-launch checklist also asks for the Alpine version to be checked against the latest release and advisories.

Run these from the project root:

1. **Read the release notes** for every version between the current one and the new one. Look for security fixes and breaking changes.
2. Download both files for the new version (replace `X.Y.Z`):
   ```sh
   curl -sSfL -o site/js/vendor/alpine-X.Y.Z.min.js       https://cdn.jsdelivr.net/npm/alpinejs@X.Y.Z/dist/cdn.min.js
   curl -sSfL -o site/js/vendor/alpine-focus-X.Y.Z.min.js https://cdn.jsdelivr.net/npm/@alpinejs/focus@X.Y.Z/dist/cdn.min.js
   ```
3. Verify the downloads. Fetch the same files from a second source (e.g. `https://unpkg.com/alpinejs@X.Y.Z/dist/cdn.min.js`) and confirm the SHA-384 hashes match:
   ```sh
   openssl dgst -sha384 -binary <file> | openssl base64 -A
   ```
4. Update both `<script src>` paths in `site/index.html`, and the version in the table in [section 1](#1-overview).
5. Delete the old files from `site/js/vendor/`. The tests fail if any other file is left in that folder.
6. **Update the tests** in `tests/browser-test.mjs`:
   - the `VENDOR_SHA384` table near the top: new filenames and their verified hashes
   - both `Alpine.version === '3.14.1'` checks (template page and client page): the new version
7. Update the hash table below.
8. Run the [browser tests](#10-testing), and test every component (nav, hours, filters, lightbox, FAQ, form) by hand with the browser console open. Look for errors and CSP violations.
9. Add a `CHANGELOG.md` entry (🔒 if the upgrade includes a security fix). Then roll the release out to live client sites using the client register.

The 3.14.1 files currently in `site/js/vendor/` were checked on 2026-09-30, and checked again after the move into `site/`. The copies from jsDelivr and unpkg were byte-identical. These same values are in `VENDOR_SHA384` in the tests, and **the test run fails if a single byte changes**:

| File | SHA-384 |
| --- | --- |
| `alpine-3.14.1.min.js` | `l8f0VcPi/M1iHPv8egOnY/15TDwqgbOR1anMIJWvU6nLRgZVLTLSaNqi/TOoT5Fh` |
| `alpine-focus-3.14.1.min.js` | `bKXNU7o2Y3Uk/F2PB6U0bMyGZf6pLDnePM70U7sTE3cXUQ+JLgzrr/kwipEh0p23` |

**Line endings.** `.gitattributes` marks `site/js/vendor/**` as `-text`, so git never converts line endings in these files. Without it, a Windows checkout could rewrite them and the hashes above would stop matching. Keep that rule if you rename or move the vendor folder.

If you ever go back to loading Alpine from a CDN, every `<script>` tag needs `integrity="sha384-…"` and `crossorigin="anonymous"`, the hashes must be regenerated on every version change, and the CDN origin must be added to `script-src` in the CSP.

### Content-Security-Policy

The policy now lives in **three** places:

| File | Policy | Notes |
| --- | --- | --- |
| `site/index.html` | `<meta>` tag | The main page. |
| `site/_headers` | HTTP header | Same as the `<meta>` tag, plus `frame-ancestors 'none'` and `upgrade-insecure-requests`, which only work as a header. |
| `site/404.html` | `<meta>` tag | **Deliberately stricter**: `script-src 'none'`, `connect-src 'none'`, `form-action 'none'`. The 404 page has no scripts or form. |

**`index.html` and `_headers` must stay in sync.** The tests now check this. They parse both policies and fail unless every directive matches, except `frame-ancestors` and `upgrade-insecure-requests`, which must appear in `_headers` only. They also fail if either copy contains `'unsafe-inline'`, or lacks `object-src 'none'` or `base-uri 'none'`. `404.html` isn't part of the comparison. The header policy is:

```
default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self'; img-src 'self';
connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none';
frame-ancestors 'none'; upgrade-insecure-requests
```

- The policy allows scripts, styles and images only from the site itself.
- It needs `'unsafe-eval'` because the standard Alpine build evaluates `x-` attribute expressions with `new Function()`.
- `connect-src` controls where the contact form may send data. See [Receive real form submissions](#8-common-tasks).
- `img-src` is `'self'` only. **`data:` images are not allowed**. If a design later needs an inline SVG icon in CSS, add `data:` back to `img-src` in both files.

What this means when editing:

- **No inline `<script>` or `<style>` blocks, and no `style="…"` attributes.** Put code in `js/` and styles in `css/styles.css`. Alpine's own `x-` expressions are allowed because of `'unsafe-eval'`.
- **No scripts, fonts, styles or images from other domains** (e.g. Google Fonts, analytics) unless you add their origin to the policy in **both** `index.html` and `_headers`. If `404.html` also needs it (a web font, for example), add it there as well. Don't loosen its `script-src 'none'`.

### Other headers in `_headers`

| Header | Value | Why |
| --- | --- | --- |
| `X-Frame-Options` | `DENY` | Older-browser backup for `frame-ancestors 'none'`: the site can't be framed. |
| `X-Content-Type-Options` | `nosniff` | Browsers must trust the declared file type. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites see only the origin, not full URLs. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | The page can't request these. |
| `Cross-Origin-Opener-Policy` | `same-origin` | A page that opens this site in a popup gets no handle to its window. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites can't embed this site's files. |
| `Strict-Transport-Security` | `max-age=31536000` | Forces HTTPS for this domain for a year. **No `includeSubDomains` by default.** Add it only after confirming every subdomain of the client's domain serves HTTPS. Browsers remember it for a year and it can't be undone. |

`_headers` is read by Netlify and Cloudflare Pages from the root of the published folder. On another host, the same headers must be set in that host's config.

---

## 3. Configuration: `window.SITE`

Defined in [site/js/site-config.js](../site/js/site-config.js). Components read it once, when Alpine initialises.

| Key | Type | Used by | Notes |
| --- | --- | --- | --- |
| `timeZone` | string (IANA, e.g. `"America/Los_Angeles"`) | `$store.hours` | "Open now" is worked out in this zone, not the visitor's. |
| `hours` | object keyed `mon`…`sun` | `$store.hours` | Each day is an array of `{ open, close }` in 24-hour `"HH:MM"`. |
| `faqs` | array of `{ q, a }` | `faq` | Plain text only; rendered with `x-text`. |
| `showcase.layout` | `"menu"` or `"gallery"` | `showcase` | Switches between a priced list and a photo grid. |
| `showcase.categories` | array of `{ name, items }` | `showcase` | Each category becomes a filter button. |
| `formEndpoint` | string (full `https://` URL) | `contactForm` | Must be a full `https://` URL with a host and **no username or password**. Upper-case `HTTPS://` and surrounding spaces are accepted. Empty is **for local development only**: on `file://`/`localhost` submissions are logged to the console; on any other host the form shows its error message. Its origin must also be in the CSP `connect-src`. |

> **Everything in `site/` is public**, including this file. Never put API keys, tokens or passwords in `site-config.js` or anywhere else in `site/`. Use only the provider's public form URL. If a provider requires a secret key, it needs a server-side function, not this template. The same rule is in a comment at the top of `site-config.js`, in the README reuse steps and in the pre-launch checklist.
>
> The code enforces one part of this: an endpoint like `https://user:secret@…` is rejected at page load (see [4.5](#45-contactform--validated-contact-form)). By then, though, the secret is already in a public file. **The rejection tells you about the mistake after the fact; it doesn't protect the secret. Rotate any credential that was ever put there.**

There is **no validation of the config yet** (planned). A typo that makes `site-config.js` invalid JavaScript, or a missing key, currently breaks every component on the page. Check the browser console after every config edit.

### Hours format

```js
hours: {
  mon: [{ open: "07:00", close: "15:00" }],          // one range
  fri: [
    { open: "07:00", close: "15:00" },               // several ranges (e.g. lunch break)
    { open: "18:00", close: "00:30" },               // close < open = runs past midnight
  ],
  sun: [],                                           // closed all day
}
```

- A missing day key is treated the same as `[]` (closed).
- A close time earlier than (or equal to) the open time means the range ends the next day.

### Showcase items

```js
{ name: "Cortado", description: "…", price: "$4.25", image: { src: "images/photo-1.svg", alt: "…" } }
```

- Only `name` is required.
- `name` must be **unique within its category**, because it's used as the `:key` in the item loop. Category `name`s must also be unique.
- `price` is free text (`"From $40"`, `"Market price"` are fine).
- Any item with an `image` becomes clickable and appears in the lightbox. Always provide `alt` text.
- `image.src` is relative to `index.html` (so `images/…`, not `site/images/…`).
- For client photos use **JPG, PNG or WebP**. Don't use SVGs supplied by clients without sanitizing them, because an SVG can contain scripts. The placeholder SVGs are safe.
- For `layout: "gallery"`, give every item an image.

---

## 4. Components

All components are registered in [site/js/components.js](../site/js/components.js) inside the `alpine:init` listener. Reusable components use `Alpine.data(...)` and are attached with `x-data="name"`; the shared hours state uses `Alpine.store(...)`.

### 4.1 `mobileNav` — header navigation

**Attached to:** `<header class="site-header" x-data="mobileNav">`

| State / method | Description |
| --- | --- |
| `open` | `true` while the small-screen menu is expanded. |
| `toggle()` | Flips `open`. Bound to the hamburger button. |
| `close()` | Sets `open` to `false`. |

**Closes when:** a nav link is clicked, Escape is pressed anywhere (`@keydown.escape.window`), or the user clicks outside the header (`@click.outside`).

The component only tracks a flag and adds `.is-open` to the `<nav>`. CSS decides what that means: below 760px the nav is a dropdown; at 760px and up it is always visible and the toggle button is hidden.

### 4.2 `$store.hours` — "Open now" status and hours table

**Used by:** the status badge in the hero, and the hours table in `#hours`. Both use a bare `x-data` so Alpine processes them, then read from `$store.hours`.

It's a **store** rather than a component because two separate parts of the page need the same live value. A store is a single shared object, so both update together.

| Property | Description |
| --- | --- |
| `status.isOpen` | `true` if the business is open right now. |
| `status.label` | `"Open now"` or `"Closed"`. |
| `status.detail` | e.g. `"Closes at 3 PM"`, `"Opens tomorrow at 7 AM"`, or `""` if there are no hours at all. |
| `todayIndex` | Today's day number (0 = Sunday) in the business's time zone. Used to highlight today's row. |
| `days` | Seven table rows, Monday first: `{ index, name, text }` where `text` is like `"7 AM – 3 PM, 6 PM – 12:30 AM"` or `"Closed"`. Built once at startup. |
| `init()` | Called automatically by Alpine. Runs `refresh()` immediately, then every 60 seconds. |
| `refresh()` | Recalculates `status` and `todayIndex` from the current time. |

The badge carries `x-cloak`, so it stays hidden until Alpine has filled it in. Visitors never see an empty badge flash.

See [section 5](#5-how-the-hours-calculation-works) for the maths.

### 4.3 `showcase` — menu / gallery and lightbox

**Attached to:** `<section id="menu" x-data="showcase">`

| State / getter / method | Description |
| --- | --- |
| `layout` | From config. Applied as a `layout-menu` or `layout-gallery` class on the list. |
| `categories` | From config. |
| `activeCategory` | Index of the selected filter button (starts at `0`). |
| `items` *(getter)* | Items in the active category. |
| `images` *(getter)* | Only those items that have an `image`. The lightbox steps through these. |
| `isOpen` | Whether the lightbox is showing. |
| `index` | Position within `images` of the photo currently shown. |
| `current` *(getter)* | `images[index]`, or `undefined` if the category has no photos. |
| `caption` *(getter)* | `"Name · Price"`, or just the name when there's no price. |
| `selectCategory(i)` | Switches category and closes the lightbox. |
| `open(item)` | Opens the lightbox on that item. |
| `close()`, `next()`, `prev()` | Lightbox controls. `next`/`prev` wrap around. |

**Behaviour details**

- Filter buttons are hidden when there's only one category.
- The thumbnail button is rendered with `x-if` (not `x-show`), so items without an image get no button at all. There's nothing empty for keyboard users to tab to.
- The lightbox uses `x-trap.noscroll="isOpen"` from the Focus plugin: Tab stays inside the dialog, page scrolling is locked, and focus returns to the thumbnail on close.
- Lightbox keyboard controls: **Esc** closes, **←/→** move between photos. Clicking the dark backdrop (`@click.self`) also closes it.
- `close()` deliberately leaves `index` alone, so the image doesn't go blank during the fade-out transition.
- The image binding uses optional chaining (`current?.image.src`) because `current` can be `undefined`.

### 4.4 `faq` — accordion

**Attached to:** `<div class="container narrow" x-data="faq">`

| State / method | Description |
| --- | --- |
| `items` | `SITE.faqs`. |
| `openIndex` | Index of the open answer, or `null` if none. |
| `toggle(i)` | Opens question `i`, or closes it if it's already open. |
| `isOpen(i)` | `true` if question `i` is open. |

Only one answer is open at a time. Each question/answer pair gets matching `id`, `aria-controls`, `aria-labelledby` and `aria-expanded` attributes generated from its index.

### 4.5 `contactForm` — validated contact form

**Attached to:** `<form x-data="contactForm" @submit.prevent="submit()" novalidate>`

| State / method | Description |
| --- | --- |
| `fields` | `{ name, email, phone, message, hp }`, bound with `x-model`. `hp` is the honeypot. |
| `errors` | One message per validated field; `""` means valid. |
| `status` | `"idle"` → `"sending"` → `"success"` or `"error"`. |
| `validateField(name)` | Runs that field's rule, stores the message, returns `true` if valid. |
| `validateAll()` | Validates **every** field (not stopping at the first failure) so all errors show at once. |
| `submit()` | Validates, handles the honeypot, sends, and updates `status`. |

**Validation rules** (the `rules` object in `components.js`):

| Field | Rule | Message |
| --- | --- | --- |
| `name` | Not blank; at most 100 characters | "Please enter your name." / "Name is too long." |
| `email` | Not blank; at most 254 characters; matches `something@something.something` | "Please enter your email." / "That email address is too long." / "That email address doesn't look right." |
| `phone` | Optional; if filled, at most 30 characters and 10–15 digits (formatting characters ignored) | "Please enter a valid phone number." |
| `message` | 10–5,000 characters after trimming | "Please write at least 10 characters." / "Please keep your message under 5,000 characters." |

The same limits are set as `maxlength` attributes in `index.html`; keep the two in step. Length is checked **before** the email regex, because the regex gets very slow on extremely long input.

**When validation runs**

- On **blur** (leaving a field).
- On **input**, but only if that field is already showing an error. The error clears as soon as it's fixed, without nagging someone who's still typing for the first time.
- On **submit**, for every field. If anything fails, focus jumps to the first invalid field.

`novalidate` on the `<form>` switches off the browser's own popups so these messages are used instead.

**Endpoint check at startup**

When `components.js` runs its `alpine:init` listener, `parseEndpoint()` parses `SITE.formEndpoint` once with `new URL(value.trim())`:

- It accepts the value only if the protocol is `https:`, there is a host, and there is **no username or password** in the URL. The result is the normalised URL (`url.href`), and that is what `fetch()` uses.
- Upper-case (`HTTPS://…`) and leading or trailing spaces are fine.
- `http://…`, `https://` with no host, `https://user:pass@…`, or anything that isn't a URL gives `null`. The console then shows: *"formEndpoint in site-config.js must be a full https:// URL. The contact form will not send."*

**Submission flow**

1. If validation fails → stop and focus the first invalid field.
2. If the hidden `hp` honeypot has a value → treat as a bot: set `status = "success"` and send nothing.
3. Set `status = "sending"` (the button disables and reads "Sending…").
4. Send, depending on `SITE.formEndpoint`:
   - **Set and valid** → `POST` the **trimmed** fields (minus `hp`) as JSON to the parsed URL, with `Content-Type` and `Accept: application/json`, `credentials: "omit"` (no cookies go to the form service) and `referrerPolicy: "strict-origin"` (the service sees only the site's origin). If there's no response within **15 seconds**, the request is aborted. A non-2xx response, a network or CORS failure, a CSP block or a timeout all count as errors.
   - **Set, but invalid** (see above) → error.
   - **Empty, on a local copy** → `console.info` the payload instead. "Local" means `location.hostname` is empty (`file://`), `localhost`, `127.0.0.1` or `[::1]`. A LAN address such as `192.168.x.x` counts as live.
   - **Empty, on any other host** → error. A live site never pretends a message was sent.
5. On success → `status = "success"`, and the form is cleared.
   On any error → `status = "error"` and the error is logged with `console.error`.

**Honeypot.** The hidden field is `id="hp_field"` with `autocomplete="new-password"` and the label "Leave this field empty". This naming is intended to stop browsers and password managers from autofilling it. It hasn't been verified yet; see the note below. Autofill would silently discard a real customer's message. Don't rename it to anything autofill recognizes (`company`, `address`, `organization` and so on).

> **Not yet verified:** real browser autofill and password managers haven't been tested against the honeypot yet. A planned change will send the honeypot value to the form provider as spam instead of discarding it in the browser, so a false positive ends up in a spam folder rather than being lost.

The success/error message sits inside a `role="status"` element so screen readers announce it.

**Payload sent to the endpoint** (every value trimmed of leading and trailing whitespace):

```json
{ "name": "…", "email": "…", "phone": "…", "message": "…" }
```

### 4.6 Footer year

```html
<span x-data x-text="new Date().getFullYear()"></span>
```

A one-off inline expression; no registered component. Uses the visitor's clock.

---

## 5. How the hours calculation works

The helper functions at the top of `components.js` are plain JavaScript with no Alpine dependency, so they can be reasoned about (or tested) on their own.

**The core idea:** every time is converted to *minutes since Sunday 00:00*. A whole week becomes one number line from `0` to `WEEK` (10,080). Checking "are we open?" is then just checking whether a number falls inside a range.

| Function | What it does |
| --- | --- |
| `toMinutes("07:30")` | → `450` |
| `minuteOfWeekInZone(timeZone)` | Uses `Intl.DateTimeFormat` to get the current weekday/hour/minute **in the business's time zone**, and returns a minute-of-week. |
| `weeklyRanges(hours)` | Flattens the config into `[{ start, end }]`. If `end <= start`, adds a day to `end` (past-midnight closing). |
| `getOpenStatus(hours, now)` | Returns `{ isOpen: true, closesAt }` or `{ isOpen: false, opensAt }` (`opensAt` is `null` if there are no hours at all). |
| `formatTime(minutes)` | `450` → `"7:30 AM"`, `420` → `"7 AM"`. |
| `dayLabel(target, now)` | `"today"`, `"tomorrow"`, or a weekday name. |

**Edge cases handled**

- **Past midnight on Saturday into Sunday.** A Saturday 22:00–02:00 range ends *after* the end of the week. `getOpenStatus` also tests `now + WEEK`, so at Sunday 01:00 the business correctly shows as open.
- **Finding the next opening.** For each range it computes `(start - now + WEEK) % WEEK`, the minutes until it next begins (wrapping around the week), and picks the smallest.
- **Visitors in other time zones** see the business's local status, not their own.

Note that `todayIndex` (the highlighted table row) follows the business's time zone, while the footer year follows the visitor's clock.

These edge cases are **not covered by dedicated tests yet**. Those tests are the next planned change. Don't change these functions until they exist.

---

## 6. Styling hooks used by Alpine

Classes and attributes Alpine adds or relies on, all defined in [site/css/styles.css](../site/css/styles.css):

| Hook | Set by | Effect |
| --- | --- | --- |
| `[x-cloak]` | Markup (Alpine removes it once ready) | `display: none !important` until initialised. |
| `.site-nav.is-open` | `mobileNav` | Shows the dropdown on small screens. |
| `.status-badge.is-open` / `.is-closed` | `$store.hours` | Green or red status dot and label. |
| `.hours-table tr.is-today` | `$store.hours` | Highlights today's row. |
| `.layout-menu` / `.layout-gallery` | `showcase` | List vs. photo-grid layout. |
| `.filter-button[aria-pressed="true"]` | `showcase` | Active category button. |
| `[aria-invalid="true"]` | `contactForm` | Invalid field styling. |
| `.honeypot` | Static | Hides the bot trap off-screen. |

Brand colours and fonts are CSS variables in `:root` at the top of the stylesheet. Transitions are reduced under `prefers-reduced-motion: reduce`. `404.html` uses the same stylesheet.

---

## 7. Accessibility built into the components

These are easy to break by accident when editing, so keep them intact.

- **Skip link** to `#main` at the top of the page.
- **Nav toggle** exposes `aria-expanded` and `aria-controls="site-nav"`, and has screen-reader text "Menu".
- **Filter buttons** use `aria-pressed` to show which category is active, inside a labelled `role="group"`.
- **Lightbox** is a `role="dialog"` with `aria-modal="true"`, traps focus, restores focus on close, and supports Esc and arrow keys. Thumbnails include hidden "Enlarge photo: …" text.
- **FAQ** buttons live inside `<h3>`s and expose `aria-expanded`/`aria-controls`; answers are `role="region"` labelled by their question.
- **Contact form** fields have real `<label>`s, `aria-invalid`, and `aria-describedby` pointing at their error message. Status updates are announced via `role="status"`.
- **Honeypot** is `aria-hidden` and `tabindex="-1"`, so neither screen-reader nor keyboard users land on it.

---

## 8. Common tasks

**Change opening hours or time zone**: edit `timeZone` and `hours` in `site/js/site-config.js`. No code changes needed.

**Add/remove FAQ questions**: edit the `faqs` array.

**Switch from a menu to a photo gallery**: set `showcase.layout: "gallery"` and give every item an `image`. Rename the "Menu" heading and nav link in `site/index.html` to suit (e.g. "Our Work").

**Use a single, unfiltered list**: put all items in one category; the filter buttons hide themselves.

**Receive real form submissions** (required before any site goes live):

1. Set `formEndpoint` to a service that accepts JSON POSTs (Formspree, Basin, Getform, or your own endpoint). It must be a full `https://` URL, and the service must allow cross-origin requests from your domain. **Everything in `site/` is public:** use only the provider's public form URL, and never put an API key, token or password in `site-config.js` or anywhere in `site/`. If a provider requires a secret key, it needs a server-side function, not this template.
2. Add the service's origin (e.g. `https://formspree.io`) to `connect-src` in the CSP, in **both** `site/index.html` and `site/_headers`. If you miss this, the browser blocks the request. `404.html` doesn't need it.
3. In the provider's settings, **restrict submissions to the client's domain**, turn on **spam protection** (reCAPTCHA or Cloudflare Turnstile) and server-side validation, and make sure notification emails are **plain text**.
4. Send a real test message and confirm it arrives in the client's inbox.

When **switching providers**, repeat steps 1–4 and remove the old provider's origin from the CSP.

**Add a validated form field**

1. Add the key to `emptyFields()` (which sets up and resets `fields`) and to `errors` in `components.js`.
2. Add a rule to the `rules` object that returns an error string or `""`. Include a maximum length, checked before any regex.
3. Copy an existing `.field` block in `index.html` and change the `id`, `for`, `x-model`, `validateField('…')`, `errors.…` and `aria-describedby` references. Set `maxlength` to the same limit as the rule.
4. Update the form provider's server-side limits to match, and the list in the README under "Form provider settings".

**Add a new component**

```js
// site/js/components.js, inside the alpine:init listener
Alpine.data("myThing", () => ({
  items: site.myThings,   // read data from window.SITE
  // state and methods…
}));
```

```html
<section x-data="myThing">…</section>
```

Put its data in `site-config.js`, and add `x-cloak` to anything that would look broken before Alpine loads. Keep the logic in `components.js` rather than in long inline expressions: the planned move to Alpine's CSP build will only allow simple property and method references in the markup.

> **Security rule: never use `x-html`.** Render config values and user input with `x-text` (or attribute bindings) only. `x-text` inserts plain text, which is why the page has no cross-site scripting (XSS) path today; a single `x-html` would open one. Also keep `:src`/`:href` bindings pointed at your own paths. If a URL ever comes from somewhere other than the config you control, allow only `https:` and relative paths.

**Add a new file to the site**: put it inside `site/`. Anything outside `site/` is never deployed. Remember that everything inside `site/` is public.

**Check a client's site before launch**: from the template repository, run `node tests/browser-test.mjs --client path/to/client-site` (see [§10](#10-testing)). It must pass before the site goes live; this is a line in the README pre-launch checklist. Then add the site to the client register with the template release it was copied from.

---

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Nothing interactive works; console says a component is not defined | Script order changed. Alpine core must load **after** `components.js`. Or there's a syntax error in `site-config.js`/`components.js`; check the console. |
| Lightbox opens but Tab escapes it / `x-trap` warning | Focus plugin missing, or it's loading after Alpine core. |
| Hours status is wrong by a few hours | Wrong `timeZone`, or a typo in a time (must be `"HH:MM"`, 24-hour). |
| "Open now" never updates | It refreshes every 60 seconds; check for a console error in `refresh()`. |
| Showcase items duplicate or vanish when switching categories | Two items in the same category share a `name` (used as the loop key). |
| A photo shows as broken | `image.src` must be relative to `index.html` (`images/…`), not include `site/`. Also check the file really is inside `site/images/`. |
| Form always shows "Something went wrong" | The endpoint returned a non-2xx status or blocked the request (CORS). The real error is in the console. |
| Form shows "Something went wrong" on the live site; console says "formEndpoint is not configured" | `formEndpoint` is empty. On a live host this is deliberately an error, not a fake success. Set the endpoint. |
| Console says "formEndpoint in site-config.js must be a full https:// URL" | The endpoint uses `http://`, has no host (`"https://"`), contains a username or password (`https://user:pass@…`), or isn't a URL. Use the provider's public `https://` form URL. If it contained a credential, **rotate that credential**: it was in a public file. |
| Form fails and the console shows a CSP violation (`connect-src`) | The CSP `connect-src` doesn't match `formEndpoint`. Add the provider's origin in both `site/index.html` and `site/_headers`. |
| Form stays on "Sending…" for about 15 seconds, then shows an error | The endpoint didn't respond in time and the request was aborted. Check the provider's status and the URL. |
| Form "succeeds" locally but nothing arrives | On `file://`/`localhost` with an empty `formEndpoint`, submissions are only logged to the console. |
| Testing the form from a phone on your network logs nothing and shows an error | A LAN address (e.g. `192.168.1.20`) isn't treated as local, so an empty `formEndpoint` is an error there. Set a test endpoint, or test on `127.0.0.1`. Only bind a server to your LAN address on a network you trust, and only serve `site/`. |
| All components broke after an Alpine upgrade | Core and Focus plugin versions differ, or a `<script src>` in `index.html` still points at the old filename. See [Upgrading Alpine](#upgrading-alpine). |
| Test `[vendor] SHA-384 of <file>` fails | A vendor file changed by even one byte. After a clone, line endings may have been converted: check that `.gitattributes` still has `site/js/vendor/** -text`, then re-checkout the files. Otherwise, **treat it as a possible tampered file**: restore it from git or re-download and re-verify it (§2). Only change `VENDOR_SHA384` as part of a deliberate upgrade. |
| Test `[vendor] js/vendor/ holds only the expected files` fails | An old Alpine file was left behind after an upgrade, or an unexpected file was added. Remove it, or add it to `VENDOR_SHA384` if it's a verified part of an upgrade. |
| Test `Alpine started` fails right after an upgrade | The `Alpine.version` checks in the tests still expect the old version. See step 6 of [Upgrading Alpine](#upgrading-alpine). |
| A `[csp]` test fails and names a directive | `index.html` and `_headers` disagree on that directive, or one of them has `'unsafe-inline'` or is missing `object-src 'none'`/`base-uri 'none'`. The output shows both values. Make the two copies match. |
| `--client` run fails its config checks | The client's `formEndpoint` is empty, isn't a public `https://` URL, contains credentials, or its origin is missing from `connect-src` in one of the two CSP copies. |
| Tests print "Usage: node tests/browser-test.mjs --client …" and exit | `--client` was given without a folder, or not as the **first** argument. |
| Console shows a CSP violation for a script, style or image | Something is loading from another domain, is inline, or is a `data:` image. Self-host it, or update the CSP in both `index.html` and `_headers`. |
| Live home page shows "not found", but the site works at `/site/` | The project root was published instead of `site/`. Set the publish directory to `site` (or upload the contents of `site/`). Check that `/.git/config`, `/README.md` and `/docs/` return 404 afterwards. |
| The README, `docs/` or `.git/` are visible on the live site | The project root was published. Same fix as above. On Netlify, `_redirects` hides these paths as a backup; on Cloudflare Pages it doesn't. |
| `404.html` has no styling when opened locally | It links to `/css/styles.css` from the site root, so it's unstyled from `file://`. Use the local-server commands in §1; on a real host it's styled. |
| Elements flash unstyled/empty on load | Add `x-cloak` to them. |

---

## 10. Testing

The automated browser test is [tests/browser-test.mjs](../tests/browser-test.mjs). It drives headless Chrome through the Chrome DevTools Protocol, with no npm packages. It has two modes:

```sh
node tests/browser-test.mjs                                   # template mode: the full suite, for this repository
node tests/browser-test.mjs --client path/to/client-site      # client mode: a client's copy of site/
```

- **Requirements:** Node 22+ and Google Chrome. The script uses the default Windows install path unless you set **`CHROME_PATH`** to your Chrome or Chromium executable, for example:
  ```sh
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/browser-test.mjs
  ```
- **Arguments:** in template mode, the optional first argument is the project root; it defaults to the folder above `tests/`. In client mode, `--client` must come **first**, followed by the client's site folder (the folder that holds its `index.html`). The test server serves **only that site folder**, like the real host.
- **The tests never contact a real form provider.** Every form test swaps in a fake endpoint, and every outgoing `https://` request from a test page is either handed to a test stub or blocked. If the tests can't find a client's `formEndpoint` to swap out, they block the page load rather than risk a real submission.
- The tests stay in the template repository and are never copied into `site/`, because `site/` is public. To test a client's site, run the template's script and point it at the client's folder.

**What each mode runs**

| Group | Template | Client | Checks |
| --- | --- | --- | --- |
| Components | ✓ | — | Hours badge and table, footer year, nav, filters, lightbox (focus trap, arrow keys, Esc), FAQ, validation messages, 50k-character paste, `maxlength`, honeypot, local console fallback. Runs from `file://`, a `localhost` server and a server sending the real `_headers`. Depends on the sample content, so it's skipped for clients. |
| Test server | ✓ | — | Path traversal returns 404, a malformed URL returns 400, and the server survives. This tests the harness itself. |
| **Vendor files** | ✓ | ✓ | SHA-384 of each file matches `VENDOR_SHA384`, and `js/vendor/` holds only those files. |
| **CSP and headers** | ✓ | ✓ | Both CSP copies match (apart from the header-only directives); no `'unsafe-inline'`; `object-src 'none'` and `base-uri 'none'`; no `data:`; COOP and CORP present. **HSTS:** template mode requires exactly `max-age=31536000`. Client mode only requires a `max-age` of at least one year, so a client may add `includeSubDomains` after the checklist confirmation. The test doesn't check that confirmation was done. |
| **Contact-form security** | ✓ | ✓ | Empty endpoint on a live host → error; `http://` → error; credentials → rejected, nothing sent; endpoint missing from `connect-src` → blocked; working endpoint → trimmed payload, origin-only referrer; stalled endpoint → error after about 15 s; `HTTPS://` and leading space accepted; `https://` with no host rejected. |
| **Deployment files** | ✓ | ✓ | `_redirects` rules and `404.html` present. Template mode also checks that `/.git/config`, `/docs/`, `/README.md`, `/CHANGELOG.md` and `/tests/…` return 404. |
| Client config | — | ✓ | `formEndpoint` is set, is a public `https://` URL with no credentials, and its origin is in `connect-src` in **both** CSP copies. |
| Client page smoke check | — | ✓ | Alpine 3.14.1 starts, with no CSP violations or console errors on load with the client's `_headers` applied. |

Every run fails on any console error or CSP violation.

**Last recorded results:** **template mode 103 / 103**. **Client mode 38 / 38** on a sample client copy (one category, no photos, Formspree-style endpoint). A deliberately broken copy failed 7 checks, each for the right reason.

Client mode checks the **files**. It doesn't replace the pre-launch checklist's live-URL checks: header scan, 404s, and a real test submission.

> **Known limitation of client mode:** it checks that the client's two CSP copies match each other and contain the key protections, but it doesn't yet compare them against the template's policy. A weakening made in *both* copies (a wider `script-src`, a relaxed `frame-ancestors`, a removed header) can still pass. Until that check is added, compare the client's `_headers` and CSP with the template's by hand before launch. Client mode also doesn't yet check the client folder for files that shouldn't be published (`.git/`, `.env`, notes), so check that by hand too.

**Not covered by automated tests:**

- **Browser autofill and password managers** leaving the honeypot empty (**required before launch**). Check by hand in Chrome, Edge, Safari, Firefox and 1Password or Bitwarden. After autofilling, run `document.getElementById('hp_field').value` in the console; it must be `""`.
- **Headers and 404s on the real host** (**required before launch**). Deploy to staging and check the live URL with a header scanner (e.g. securityheaders.com).
- **The hours helpers in isolation.** They're only tested through the page at the current time. Past-midnight and end-of-week cases aren't pinned by tests yet.
- **`404.html`'s own CSP.** It isn't compared with the other two copies. It's meant to be stricter.

After any change to `site/js/components.js`, `site/index.html`, the CSP or `site/js/vendor/`, run the script and do a quick manual pass of every component with the console open.

---

## 11. Roadmap

Before release **1.0.0** is tagged:

- choose the default hosting platform (Netlify or Cloudflare Pages) and add its config file (`netlify.toml` or `wrangler.toml`) pinning the publish directory to `site`
- choose the default form provider (JSON POST, spam kept in a spam folder, domain restriction, plain-text notifications, no secret key in the browser)
- a manual autofill test of the honeypot, and a staging deploy that passes a header scan
- client mode compares a client's policy and headers against the template's, and checks the client folder for files that shouldn't be published

After 1.0.0, each item ships as its own release with a changelog entry:

| Order | Change | What will change in this document |
| --- | --- | --- |
| 1 | Automated tests for the hours helpers | [Section 5](#5-how-the-hours-calculation-works) (remove the "not tested yet" warning) and [section 10](#10-testing). |
| 2 | Validate `site-config.js` at startup | [Section 3](#3-configuration-windowsite) and [section 9](#9-troubleshooting). One broken component must no longer take down the others; in particular, the contact form must keep working when the hours config is broken. |
| 3 | Switch to Alpine's CSP build and remove `'unsafe-eval'` | [Section 2](#2-how-the-scripts-load), and every place where the markup uses an inline expression, such as [4.6 Footer year](#46-footer-year), the FAQ `id` strings in [4.4](#44-faq--accordion) and the lightbox counter in [4.3](#43-showcase--menu--gallery-and-lightbox). These will move into `components.js`. |
| 4 | Send the honeypot value to the form provider as spam | [Section 4.5](#45-contactform--validated-contact-form): the honeypot step and the payload. |
