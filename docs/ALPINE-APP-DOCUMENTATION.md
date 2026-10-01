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
   - [footer](#46-footer--copyright-year)
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
| Alpine.js 3.14.1, **CSP build** | `site/js/vendor/` (self-hosted) | Reactivity and `x-` directives in the HTML, without `eval` (see [§2](#the-csp-build-rule)) |
| Alpine Focus plugin 3.14.1 | `site/js/vendor/` (self-hosted) | Provides `x-trap` for the lightbox |
| `js/site-config.js` | `site/` | All per-business data, exposed as `window.SITE` |
| `js/components.js` | `site/` | Hours helper functions, config checks, and every Alpine component and store |
| `index.html` | `site/` | Markup; each feature attaches to a component with `x-data` |
| `css/styles.css` | `site/` | Styles, including the classes Alpine toggles |

The design rule throughout: **data lives in `site-config.js`, behaviour lives in `components.js`, markup lives in `index.html`.** Reusing the template for a new business should normally mean editing only the config file and the copy in the HTML.

Because the site uses Alpine's CSP build, this rule is also enforced: **the HTML can't contain JavaScript.** Every `x-`, `:` and `@` attribute names a property, getter or method in `components.js`. See [The CSP build rule](#the-csp-build-rule).

### Project files

```
site/                         THE WEBSITE: the only folder that is deployed or copied for a client
  index.html                  Page markup + CSP <meta> tag; each feature is an x-data component
  404.html                    "Page not found" page (no Alpine, no scripts; its own stricter CSP)
  _headers                    Security headers for Netlify / Cloudflare Pages (a CSP copy lives here too)
  _redirects                  Returns 404 for project paths if they're uploaded by mistake (Netlify only)
  css/styles.css              All styles, mobile-first; theme variables in :root
  js/site-config.js           Per-business data (window.SITE)
  js/components.js            Hours helpers, config checks, all Alpine components and the hours store
  js/vendor/                  Self-hosted Alpine (CSP build) and Focus plugin (always the same version)
  images/                     Placeholder photos
tests/browser-test.mjs        Automated headless-Chrome tests; template and --client modes (not deployed)
tests/site-policy.mjs         File checks used by the browser tests: headers, CSP, folder contents, vendor hashes (not deployed)
tests/hours.test.mjs          Node tests for the opening-hours helpers and config checks (not deployed)
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
| **Release tag** | git tag `vMAJOR.MINOR.PATCH` | Marks a launch-ready template state. `v1.0.0` isn't tagged yet; see the [Roadmap](#11-roadmap). |
| **Changelog** | `CHANGELOG.md` (project root) | What changed in each release. **🔒 Security** marks changes that must go out to live client sites. 1.0.0 is listed as "Unreleased". |
| **Client register** | Kept by whoever owns the pre-launch checklist, **outside `site/` and outside anything public** | Client, live URL, the template release it was copied from, launch date, form provider, and every `--allow` exception the client's test run needs, with the reason (see [§10](#10-testing)). When a 🔒 release ships, the register says which sites need it. |

**Update policy:** a security-relevant release should go out to every live client site within an agreed window (suggested: 14 days for anything of Medium severity or above).

**When you change the template:** add an entry to `CHANGELOG.md` and mark it 🔒 if it affects security. At release time, tag the commit.

---

## 2. How the scripts load

From the `<head>` of `site/index.html`:

```html
<script defer src="js/site-config.js"></script>
<script defer src="js/components.js"></script>
<script defer src="js/vendor/alpine-focus-3.14.1.min.js"></script>
<script defer src="js/vendor/alpine-csp-3.14.1.min.js"></script>
```

These paths are relative to `index.html`.

Alpine is **self-hosted**: no script loads from a third-party domain. This removes the risk of a compromised CDN, keeps `script-src` to `'self'` alone, and lets the site work offline.

The core file is Alpine's **CSP build** (the `@alpinejs/csp` package), not the standard `alpinejs` build. The standard build turns each attribute value into code with `new Function()`, which needs `'unsafe-eval'` in the Content-Security-Policy. The CSP build reads attribute values without ever running them as code, so the policy can block `eval` completely.

**The order matters.** `defer` scripts run in document order once the HTML is parsed, so:

1. `site-config.js` sets `window.SITE`.
2. `components.js` registers a listener for Alpine's `alpine:init` event.
3. The Focus plugin registers itself.
4. Alpine core starts, fires `alpine:init` (our components and store get registered), then walks the page and initialises every `x-data` element.

If Alpine core is moved above `components.js`, the `alpine:init` event fires before anyone is listening and every component on the page fails with "`mobileNav` is not defined"-style errors. Keep Alpine core **last**.

### The CSP build rule

The CSP build only understands **names**, not JavaScript. Every `x-`, `:` and `@` attribute value in `index.html` must be one of these:

- a property, getter or method name: `x-show="isOpen"`, `@click="close"`, `:class="navClass"`
- a dotted path: `x-text="item.name"`, `x-for="day in $store.hours.days"`, `x-show="$store.hours.available"`

Anything else is an **expression**, and the CSP build can't run it: operators (`===`, `+`, `&&`), `!`, `? :`, `?.`, template strings, and calls with arguments such as `toggle(i)` or `validateField('email')`. `x-model` is also out, because it compiles to an assignment. Put the logic in a getter or method in `components.js` and name it from the HTML instead:

| Don't write (needs `eval`) | Write | In `components.js` |
| --- | --- | --- |
| `:class="{ 'is-open': open }"` | `:class="navClass"` | `get navClass() { return { "is-open": this.open }; }` |
| `x-show="categories.length > 1"` | `x-show="hasFilters"` | `get hasFilters() { return this.categories.length > 1; }` |
| `@click="toggle(i)"` inside an `x-for` | `@click="toggleThis"` | `toggleThis() { this.toggle(this.i); }` |
| `x-model="fields.email"` | `data-field="email" :value="fields.email" @input="onInput"` | `onInput(event)` reads `event.target.dataset.field` |

How methods behave:

- **A method named from the HTML is called with the element's whole Alpine scope as `this`.** Inside an `x-for`, that includes the loop variables, so a method can read `this.item`, `this.i` or `this.day`. That's how a single method works for every row of a list without taking an argument.
- **An event handler receives the event** as its argument: `onInput(event)`, `onBlur(event)`.
- **Values read from the HTML must never be `undefined`.** The CSP build logs a console warning for each one. That's why `components.js` turns optional config fields into `""` or `null` before the page sees them.

When the rule is broken, the console shows a warning such as *"Alpine Expression Error: … Alpine is unable to interpret the following expression using the CSP-friendly build"*, and that binding does nothing. The browser tests fail on **any** console warning, so a broken binding can't pass the tests unnoticed.

The same rule is written in a comment in the `<head>` of `index.html` and at the top of `components.js`.

### Upgrading Alpine

Alpine core and the Focus plugin must **always be the same version**, and both files must be replaced in the same change. Replacing only one, or changing a filename without updating `index.html`, breaks every component on the page at once.

Self-hosting means **no update ever arrives automatically**. There's no `package.json`, so no Dependabot either. Someone must watch for Alpine security fixes: on GitHub, `alpinejs/alpine` → Watch → Custom → Security alerts. The pre-launch checklist also asks for the Alpine version to be checked against the latest release and advisories.

Run these from the project root:

1. **Read the release notes** for every version between the current one and the new one. Look for security fixes and breaking changes.
2. Download both files for the new version (replace `X.Y.Z`). The core file comes from the **`@alpinejs/csp`** package, not `alpinejs`:
   ```sh
   curl -sSfL -o site/js/vendor/alpine-csp-X.Y.Z.min.js   https://cdn.jsdelivr.net/npm/@alpinejs/csp@X.Y.Z/dist/cdn.min.js
   curl -sSfL -o site/js/vendor/alpine-focus-X.Y.Z.min.js https://cdn.jsdelivr.net/npm/@alpinejs/focus@X.Y.Z/dist/cdn.min.js
   ```
3. Verify the downloads. Fetch the same files from a second source (e.g. `https://unpkg.com/@alpinejs/csp@X.Y.Z/dist/cdn.min.js`) and confirm the SHA-384 hashes match:
   ```sh
   openssl dgst -sha384 -binary <file> | openssl base64 -A
   ```
4. Update both `<script src>` paths in `site/index.html`, and the version in the table in [section 1](#1-overview).
5. Delete the old files from `site/js/vendor/`. The tests fail if any other file is left in that folder.
6. **Update the tests:**
   - the `VENDOR_SHA384` table at the top of **`tests/site-policy.mjs`**: new filenames and their verified hashes
   - both `Alpine.version === '3.14.1'` checks in `tests/browser-test.mjs` (template page and client page): the new version
7. Update the hash table below.
8. Run the [tests](#10-testing), and test every component (nav, hours, filters, lightbox, FAQ, form) by hand with the browser console open. Look for errors, warnings and CSP violations. A new CSP build may read some attribute values differently; the tests' "no console warnings" checks are there to catch that.
9. Add a `CHANGELOG.md` entry (🔒 if the upgrade includes a security fix). Then roll the release out to live client sites using the client register.

The 3.14.1 files currently in `site/js/vendor/` were checked on 2026-09-30. The copies from jsDelivr and unpkg were byte-identical. These same values are in `VENDOR_SHA384` in `tests/site-policy.mjs`, and **the test run fails if a single byte changes**:

| File | Package | SHA-384 |
| --- | --- | --- |
| `alpine-csp-3.14.1.min.js` | `@alpinejs/csp@3.14.1` | `rCnzN/DdCU4dORuP99iqMm3OJPQKDUtMAjgeZ9nfqF9Fz4P/n4BGlOrtfsaiDNAL` |
| `alpine-focus-3.14.1.min.js` | `@alpinejs/focus@3.14.1` | `bKXNU7o2Y3Uk/F2PB6U0bMyGZf6pLDnePM70U7sTE3cXUQ+JLgzrr/kwipEh0p23` |

**Line endings.** `.gitattributes` marks `site/js/vendor/**` as `-text`, so git never converts line endings in these files. Without it, a Windows checkout could rewrite them and the hashes above would stop matching. Keep that rule if you rename or move the vendor folder.

If you ever go back to loading Alpine from a CDN, every `<script>` tag needs `integrity="sha384-…"` and `crossorigin="anonymous"`, the hashes must be regenerated on every version change, and the CDN origin must be added to `script-src` in the CSP.

### Content-Security-Policy

The policy now lives in **three** places:

| File | Policy | Notes |
| --- | --- | --- |
| `site/index.html` | `<meta>` tag | The main page. |
| `site/_headers` | HTTP header | Same as the `<meta>` tag, plus `frame-ancestors 'none'` and `upgrade-insecure-requests`, which only work as a header. |
| `site/404.html` | `<meta>` tag | **Deliberately stricter**: `script-src 'none'`, `connect-src 'none'`, `form-action 'none'`. The 404 page has no scripts or form. |

**`index.html` and `_headers` must stay in sync.** The tests check this: they parse both policies and fail unless every directive matches, except `frame-ancestors` and `upgrade-insecure-requests`, which must appear in `_headers` only. `404.html` isn't part of the comparison. The header policy is:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none';
frame-ancestors 'none'; upgrade-insecure-requests
```

- The policy allows scripts, styles and images only from the site itself.
- **There's no `'unsafe-eval'`.** The page can't turn text into code with `eval()` or `new Function()`. The tests prove this with a probe script that tries `new Function()` under each policy copy and must be blocked (see [§10](#10-testing)).
- `connect-src` controls where the contact form may send data. See [Receive real form submissions](#8-common-tasks).
- `img-src` is `'self'` only. **`data:` images are not allowed.**

**How the tests read the policy.** They read it the way a browser does, so text the browser ignores can't stand in for the real policy:

- HTML comments are removed before the `<meta>` tag is looked for, and **`index.html` must have exactly one** CSP `<meta>` tag outside comments. Don't keep an old copy commented out "for reference"; it fails the run.
- **A directive may appear only once in each copy.** Browsers use the first copy of a repeated directive and ignore the rest, so the tests check the first copy and fail on the repeat.
- Keywords such as `'self'` and `'unsafe-inline'` are compared **in any letter case**, as browsers treat them.

**Hard limits.** The tests fail on any of these in the `index.html` `<meta>` tag or the `/*` block of `_headers`, in the template and in every client site. `--allow` can't add them:

- `'unsafe-inline'` or `'unsafe-eval'`, in any letter case
- the wildcard `*`, or a scheme-wide source such as `https:`, `http:`, `data:` or `blob:` (each allows any host or any inline content)
- `object-src` or `base-uri` set to anything other than `'none'`, or (in `_headers`) `frame-ancestors` set to anything other than `'none'`

These limits apply to the **site-wide** policy only. A CSP set in another path's block of `_headers` is not checked against them; see [Other headers](#other-headers-in-_headers).

So a design that needs an inline `data:` SVG icon in CSS can't simply add `data:` to `img-src`. Save the icon as a file in `images/` instead.

What this means when editing:

- **No inline `<script>` or `<style>` blocks, and no `style="…"` attributes.** Put code in `js/` and styles in `css/styles.css`.
- **No JavaScript in Alpine attributes.** See [The CSP build rule](#the-csp-build-rule).
- **No scripts, fonts, styles or images from other domains** (e.g. Google Fonts, analytics) unless you add their origin to the policy in **both** `index.html` and `_headers`. If `404.html` also needs it (a web font, for example), add it there as well. Don't loosen its `script-src 'none'`. On a client site, every added origin must also be passed to the client tests with `--allow` and recorded in the client register (see [§10](#10-testing)). **An origin added to `script-src` is the riskiest kind**: get a security review for that client before it goes into the register.

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

**Keep all the security headers in the single `/*` block.** The tests require exactly one `/*` block, with each header set once, and every header above with exactly the value shown. The only allowed difference is HSTS on a client site, which may be `max-age=31536000; includeSubDomains` (or a longer `max-age`). A block for another path, such as `/images/*`, may set other headers, like `Cache-Control`. If it sets a security header, the client tests fail unless that header is passed with `--allow "header <path> <Header-Name>"`. **The tests don't check the value of a header allowed this way**, not even against the CSP hard limits, and hosts differ in how overlapping blocks combine. Review the value by hand before recording such an exception.

### `_redirects`

`site/_redirects` ships with rules that return 404 for project paths (`/.git/*`, `/README.md`, `/docs/*` and so on) if they're ever uploaded by mistake. The tests require those rules, and they **fail on any rule that leaves the site**:

- **No target on another host.** A target that starts with a scheme (`https://…`) or with `//` fails.
- **No status `200` or `200!`.** On Netlify, a `200` rule is a rewrite, and to another host it's a **proxy**: that host's content is served under the site's own address, where the CSP trusts it as `'self'`. A `200` rewrite between the site's own paths fails too.

Redirects within the site, such as `/old-menu  /#menu  301`, are fine. There's no `--allow` for `_redirects` rules. A client that needs one is a template change.

---

## 3. Configuration: `window.SITE`

Defined in [site/js/site-config.js](../site/js/site-config.js). Components read it once, when Alpine initialises.

| Key | Type | Used by | Notes |
| --- | --- | --- | --- |
| `timeZone` | string (IANA, e.g. `"America/Los_Angeles"`) | `$store.hours` | "Open now" is worked out in this zone, not the visitor's. |
| `hours` | object keyed `mon`…`sun` | `$store.hours` | Each day is an array of `{ open, close }` in 24-hour `"HH:MM"`. |
| `faqs` | array of `{ q, a }` | `faq` | Plain text only; rendered with `x-text`. |
| `showcase.layout` | `"menu"` or `"gallery"` | `showcase` | Switches between a priced list and a photo grid. Any other value is treated as `"menu"`. |
| `showcase.categories` | array of `{ name, items }` | `showcase` | Each category becomes a filter button. |
| `formEndpoint` | string (full `https://` URL) | `contactForm` | Must be a full `https://` URL with a host and **no username or password**. Upper-case `HTTPS://` and surrounding spaces are accepted. Empty is **for local development only**: on `file://`/`localhost` submissions are logged to the console; on any other host the form shows its error message. Its origin must also be in the CSP `connect-src`. **The word `formEndpoint` must appear in the file exactly once** (see below). |

**`formEndpoint` appears once.** The tests read the endpoint the way the browser does: they run `site-config.js` in a sandbox and take `window.SITE.formEndpoint`. They also fail unless the word `formEndpoint` appears in the file **exactly once, comments included**. So a commented-out old endpoint, a second assignment later in the file, or even a comment that mentions the name all fail the run. Keep one `formEndpoint: "…"` line and nothing else that names it. The tests also fail if the file can't be run, or if `formEndpoint` is missing or isn't a string.

> **Everything in `site/` is public**, including this file. Never put API keys, tokens or passwords in `site-config.js` or anywhere else in `site/`. Use only the provider's public form URL. If a provider requires a secret key, it needs a server-side function, not this template. The same rule is in a comment at the top of `site-config.js`, in the README reuse steps and in the pre-launch checklist.
>
> The code enforces one part of this: an endpoint like `https://user:secret@…` is rejected at page load (see [4.5](#45-contactform--validated-contact-form)). By then, though, the secret is already in a public file. **The rejection tells you about the mistake after the fact; it doesn't protect the secret. Rotate any credential that was ever put there.**

### What happens when the config is wrong

`components.js` checks the config when Alpine starts. **A mistake only affects its own part of the page**, and it's reported in the browser console once. The navigation, and above all the contact form, keep working whatever is wrong with the config.

| Mistake | What the visitor sees | Console message |
| --- | --- | --- |
| A bad time, such as `"7am"`, `"7:30"` or `"24:00"` | The "Open now" badge and hours table are hidden, and "Please call us for our current opening hours." is shown instead. Everything else works. | *Opening hours are hidden because of a problem in site-config.js: hours.mon[0].open: invalid time "7am": use 24-hour "HH:MM", such as "07:30"* |
| A misspelled `timeZone` (e.g. `"America/Portland"`) | Same as above | *… timeZone "America/Portland" isn't a valid IANA time zone, such as "America/Los_Angeles"* |
| `timeZone` missing | Same as above | *… timeZone is missing* |
| `hours` missing, or not an object | Same as above | *… hours is missing or isn't an object* |
| A day key that isn't `mon`…`sun` (e.g. `monday`) | Same as above | *… hours.monday: unknown day; use sun, mon, tue, wed, thu, fri, sat* |
| A day that isn't a list (e.g. `mon: { open, close }`) | Same as above | *… hours.mon must be a list of { open, close } ranges, or [] when closed* |
| `faqs` set but not a list | The FAQ list is empty. | *faqs in site-config.js must be a list.* |
| `showcase.categories` set but not a list | The menu / gallery is empty. | *showcase.categories in site-config.js must be a list.* |
| `site-config.js` missing (404), or a syntax error in it | Hours hidden with the "please call us" line; FAQ and menu empty. The nav and contact form still work. For a syntax error, the browser also reports the error itself first. | *site-config.js didn't load, so the page is using empty settings.* |
| `formEndpoint` invalid | The form shows its error message on submit. | See [4.5](#45-contactform--validated-contact-form). |

Some gaps are filled in quietly, without a console message:

- A missing `faqs` or `showcase` key gives an empty FAQ or menu.
- A category without an `items` list is left out.
- A missing `q`, `a`, item `name`, `description` or `price` shows as empty text. An `image` without a `src` is treated as no image.

**Still check the page and the console after every config edit.** The checks catch mistakes in format, not wrong content: a valid but wrong time zone, or hours typed for the wrong day, look fine to the code.

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

- Times are **strict 24-hour `"HH:MM"`**, from `"00:00"` to `"23:59"`, with two digits each side: `"07:00"`, not `"7:00"` or `"7am"`. For a range that ends at midnight, close at `"00:00"`.
- A missing day key is treated the same as `[]` (closed). `hours: {}` means closed every day: the badge shows "Closed" with no opening time.
- A close time earlier than the open time means the range ends the next day. A close time **equal** to the open time (e.g. `"00:00"`–`"00:00"`) means open for 24 hours.

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

All components are registered in [site/js/components.js](../site/js/components.js) inside the `alpine:init` listener. Reusable components use `Alpine.data(...)` and are attached with `x-data="name"`; the shared hours state uses `Alpine.store(...)`. Under the CSP build every `x-data` must name a registered component; a bare `x-data` doesn't work.

The tables below list everything the HTML names. Because of [the CSP build rule](#the-csp-build-rule), each component has small getters and methods that exist only so the HTML has something to name: `navClass`, `hasFilters`, `toggleThis` and so on. Methods marked *(row)* are used inside an `x-for` and read the loop variable through `this` instead of taking an argument.

### 4.1 `mobileNav` — header navigation

**Attached to:** `<header class="site-header" x-data="mobileNav">`

| State / getter / method | Description |
| --- | --- |
| `open` | `true` while the small-screen menu is expanded. Bound to the button's `aria-expanded`. |
| `navClass` *(getter)* | `{ "is-open": open }`, bound to the `<nav>`'s `:class`. |
| `toggle()` | Flips `open`. Bound to the hamburger button. |
| `close()` | Sets `open` to `false`. |

**Closes when:** a nav link is clicked, Escape is pressed anywhere (`@keydown.escape.window="close"`), or the user clicks outside the header (`@click.outside="close"`).

The component only tracks a flag and adds `.is-open` to the `<nav>`. CSS decides what that means: below 760px the nav is a dropdown; at 760px and up it is always visible and the toggle button is hidden.

### 4.2 `$store.hours` — "Open now" status and hours table

**Used by:** the status badge in the hero (`x-data="hoursBadge"`) and the hours table in `#hours` (`x-data="hoursTable"`). Both read their values from `$store.hours`.

It's a **store** rather than a component because two separate parts of the page need the same live value. A store is a single shared object, so both update together.

| Property / getter / method | Description |
| --- | --- |
| `available` | `true` once the hours config has passed its checks and the status has been worked out. The badge and table are shown only while it's `true`. |
| `unavailable` *(getter)* | `!available`. Shows the "Please call us for our current opening hours." line. |
| `status.isOpen` | `true` if the business is open right now. |
| `status.label` | `"Open now"` or `"Closed"`. |
| `status.detail` | e.g. `"Closes at 3 PM"`, `"Opens tomorrow at 7 AM"`, or `""` if there are no hours at all. |
| `badgeClass` *(getter)* | `"is-open"` or `"is-closed"`, bound to the badge's `:class`. |
| `detailText` *(getter)* | `"· Closes at 3 PM"`, or `""` when there's no detail. |
| `todayIndex` | Today's day number (0 = Sunday) in the business's time zone, or `null` until the status is known. Used to highlight today's row. |
| `days` | Seven table rows, Monday first: `{ index, name, text }` where `text` is like `"7 AM – 3 PM, 6 PM – 12:30 AM"` or `"Closed"`. Built once at startup. |
| `init()` | Called automatically by Alpine. Checks the config with `validateHours()` and builds `days`. If the check fails, it logs the problem (see [§3](#what-happens-when-the-config-is-wrong)), leaves `available` `false` and stops. Otherwise it runs `refresh()` immediately, then every 60 seconds. |
| `refresh()` | Recalculates `status` and `todayIndex` from the current time and sets `available`. If that throws, it logs the error and sets `available` to `false`. |

The two components that read the store:

| Component | Attached to | Getter / method |
| --- | --- | --- |
| `hoursBadge` | `<p class="status-badge">` in the hero | None. It exists only because the CSP build can't use a bare `x-data`. |
| `hoursTable` | The `<div>` around the hours table | `rowClass()` *(row)*: `{ "is-today": true }` for today's row (`this.day.index === $store.hours.todayIndex`). |

The badge and the "please call us" line carry `x-cloak`, so they stay hidden until Alpine has decided which to show. Visitors never see an empty badge flash.

See [section 5](#5-how-the-hours-calculation-works) for the maths.

### 4.3 `showcase` — menu / gallery and lightbox

**Attached to:** `<section id="menu" x-data="showcase">`

| State / getter / method | Description |
| --- | --- |
| `layout` | From config: `"menu"` or `"gallery"`. |
| `categories` | From config, normalised: every item has `name`, `description` and `price` as strings (`""` when missing) and `image` as `{ src, alt }` or `null`. |
| `activeCategory` | Index of the selected filter button (starts at `0`). |
| `items` *(getter)* | Items in the active category. |
| `images` *(getter)* | Only those items that have an `image`. The lightbox steps through these. |
| `isOpen` | Whether the lightbox is showing. |
| `index` | Position within `images` of the photo currently shown. |
| `current` *(getter)* | `images[index]`, or `null` if the category has no photos. |
| `caption` *(getter)* | `"Name · Price"`, or just the name when there's no price. |
| `layoutClass` *(getter)* | `"layout-menu"` or `"layout-gallery"`, bound to the list's `:class`. |
| `hasFilters` *(getter)* | `true` when there's more than one category. Shows the filter buttons. |
| `hasSeveralImages` *(getter)* | `true` when there's more than one photo. Shows the lightbox's previous / next buttons. |
| `currentSrc`, `currentAlt` *(getters)* | The lightbox image's `src` (`null` when there's no photo, which leaves `src` unset) and `alt`. |
| `counter` *(getter)* | `"2 / 5"` in the lightbox caption. |
| `isActiveCategory()` *(row)* | `true` for the active filter button (`this.i`). Bound to `aria-pressed`. |
| `selectThisCategory()` *(row)* | Calls `selectCategory(this.i)`. |
| `openThisItem()` *(row)* | Calls `open(this.item)`. |
| `enlargeLabel()` *(row)* | `"Enlarge photo: <name>"`, the thumbnail's hidden button text. |
| `selectCategory(i)` | Switches category and closes the lightbox. |
| `open(item)` | Opens the lightbox on that item. |
| `close()`, `next()`, `prev()` | Lightbox controls. `next`/`prev` wrap around. |

**Behaviour details**

- Filter buttons are hidden when there's only one category.
- The thumbnail button is rendered with `x-if="item.image"` (not `x-show`), so items without an image get no button at all. There's nothing empty for keyboard users to tab to.
- The lightbox uses `x-trap.noscroll="isOpen"` from the Focus plugin: Tab stays inside the dialog, page scrolling is locked, and focus returns to the thumbnail on close.
- Lightbox keyboard controls: **Esc** closes, **←/→** move between photos. Clicking the dark backdrop (`@click.self`) also closes it.
- `close()` deliberately leaves `index` alone, so the image doesn't go blank during the fade-out transition.

### 4.4 `faq` — accordion

**Attached to:** `<div class="container narrow" x-data="faq">`

| State / method | Description |
| --- | --- |
| `items` | `SITE.faqs`, normalised to `{ q, a }` strings. |
| `openIndex` | Index of the open answer, or `null` if none. |
| `toggle(i)` | Opens question `i`, or closes it if it's already open. |
| `isOpen(i)` | `true` if question `i` is open. |
| `toggleThis()` *(row)* | Calls `toggle(this.i)`. Bound to the question button. |
| `isThisOpen()` *(row)* | `isOpen(this.i)`. Bound to `aria-expanded` and the answer's `x-show`. |
| `questionId()`, `answerId()` *(row)* | `"faq-q-<i>"` and `"faq-a-<i>"`. |

Only one answer is open at a time. Each question/answer pair gets matching `id`, `aria-controls`, `aria-labelledby` and `aria-expanded` attributes from `questionId()`, `answerId()` and `isThisOpen()`.

### 4.5 `contactForm` — validated contact form

**Attached to:** `<form x-data="contactForm" @submit.prevent="submit" novalidate>`

| State / getter / method | Description |
| --- | --- |
| `fields` | `{ name, email, phone, message, hp }`. `hp` is the honeypot. |
| `errors` | One message per validated field; `""` means valid. |
| `status` | `"idle"` → `"sending"` → `"success"` or `"error"`. |
| `invalid` *(getter)* | `{ name: true/false, … }`, one flag per validated field. Bound to each input's `aria-invalid` (`:aria-invalid="invalid.email"`). |
| `isSending`, `isSuccess`, `isError` *(getters)* | `status` as flags. `isSending` disables the button; the other two show the success or error message. |
| `buttonLabel` *(getter)* | `"Send message"`, or `"Sending…"` while sending. |
| `onInput(event)` | Copies the input's value into `fields[<data-field>]`, and re-checks the field if it's already showing an error. |
| `onBlur(event)` | Checks the field named by the input's `data-field`. |
| `validateField(name)` | Runs that field's rule, stores the message, returns `true` if valid. |
| `validateAll()` | Validates **every** field (not stopping at the first failure) so all errors show at once. |
| `submit()` | Validates, handles the honeypot, sends, and updates `status`. |

**How the inputs are bound.** The CSP build can't use `x-model`, so each input binds its value one way and reports changes through one shared handler:

```html
<input id="email" … data-field="email" :value="fields.email"
       @input="onInput" @blur="onBlur"
       :aria-invalid="invalid.email" aria-describedby="email-error">
```

`data-field` names the key in `fields`. `:value` writes the field back to the input, which is how the form clears after a successful send. The honeypot input uses the same pattern (`data-field="hp"`, without `@blur`).

**Validation rules** (the `rules` object in `components.js`):

| Field | Rule | Message |
| --- | --- | --- |
| `name` | Not blank; at most 100 characters | "Please enter your name." / "Name is too long." |
| `email` | Not blank; at most 254 characters; matches `something@something.something` | "Please enter your email." / "That email address is too long." / "That email address doesn't look right." |
| `phone` | Optional; if filled, at most 30 characters and 10–15 digits (formatting characters ignored) | "Please enter a valid phone number." |
| `message` | 10–5,000 characters after trimming | "Please write at least 10 characters." / "Please keep your message under 5,000 characters." |

The same limits are set as `maxlength` attributes in `index.html`; keep the two in step. Length is checked **before** the email regex, because the regex gets very slow on extremely long input.

**When validation runs**

- On **blur** (leaving a field), through `onBlur`.
- On **input**, through `onInput`, but only if that field is already showing an error. The error clears as soon as it's fixed, without nagging someone who's still typing for the first time.
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

### 4.6 `footer` — copyright year

```html
<span x-data="footer" x-text="year"></span>
```

| State | Description |
| --- | --- |
| `year` | `new Date().getFullYear()`, set once when the component starts. Uses the visitor's clock. |

Before the move to the CSP build this was an inline expression in the HTML. That no longer works; see [The CSP build rule](#the-csp-build-rule).

---

## 5. How the hours calculation works

The helper functions at the top of `components.js` are plain JavaScript with no Alpine dependency, so they can be reasoned about and tested on their own. `tests/hours.test.mjs` does exactly that (see [§10](#10-testing)).

**The core idea:** every time is converted to *minutes since Sunday 00:00*. A whole week becomes one number line from `0` to `WEEK` (10,080). Checking "are we open?" is then just checking whether a number falls inside a range.

| Function | What it does |
| --- | --- |
| `toMinutes("07:30")` | → `450`. Accepts only strict 24-hour `"HH:MM"` (`"00:00"`–`"23:59"`); anything else throws *invalid time "…"*. |
| `validateHours(hours, timeZone)` | Checks the config before it's used: a real IANA time zone, `hours` an object, only `mon`…`sun` keys, each day a list, and every `open`/`close` a valid time. Throws an error naming the location, such as `hours.fri[1].close: invalid time …`. |
| `minuteOfWeekInZone(timeZone, date?)` | Uses `Intl.DateTimeFormat` to get the weekday/hour/minute **in the business's time zone**, and returns a minute-of-week. `date` defaults to now. |
| `weeklyRanges(hours)` | Flattens the config into `[{ start, end }]`. If `end <= start`, adds a day to `end` (past-midnight closing). |
| `getOpenStatus(hours, now)` | Returns `{ isOpen: true, closesAt }` or `{ isOpen: false, opensAt }` (`opensAt` is `null` if there are no hours at all). |
| `formatTime(minutes)` | `450` → `"7:30 AM"`, `420` → `"7 AM"`. |
| `dayLabel(target, now)` | `"today"`, `"tomorrow"`, or a weekday name. |

**Edge cases handled**

- **Past midnight on Saturday into Sunday.** A Saturday 22:00–02:00 range ends *after* the end of the week. `getOpenStatus` also tests `now + WEEK`, so at Sunday 01:00 the business correctly shows as open.
- **Finding the next opening.** For each range it computes `(start - now + WEEK) % WEEK`, the minutes until it next begins (wrapping around the week), and picks the smallest.
- **Visitors in other time zones** see the business's local status, not their own.

Note that `todayIndex` (the highlighted table row) follows the business's time zone, while the footer year follows the visitor's clock.

**These cases are pinned by tests** in `tests/hours.test.mjs`: past midnight (Friday 18:00–00:30), Saturday into Sunday (22:00–02:00, across the end of the week), several ranges in one day, no hours at all, the opening minute counting as open and the closing minute as closed, the next opening wrapping round to Monday, a 24-hour range, three time zones, and midnight reported as `00:00`. If you change these functions, run `node --test tests/hours.test.mjs` first and after.

---

## 6. Styling hooks used by Alpine

Classes and attributes Alpine adds or relies on, all defined in [site/css/styles.css](../site/css/styles.css):

| Hook | Set by | Effect |
| --- | --- | --- |
| `[x-cloak]` | Markup (Alpine removes it once ready) | `display: none !important` until initialised. |
| `.site-nav.is-open` | `mobileNav.navClass` | Shows the dropdown on small screens. |
| `.status-badge.is-open` / `.is-closed` | `$store.hours.badgeClass` | Green or red status dot and label. |
| `.hours-table tr.is-today` | `hoursTable.rowClass()` | Highlights today's row. |
| `.layout-menu` / `.layout-gallery` | `showcase.layoutClass` | List vs. photo-grid layout. |
| `.filter-button[aria-pressed="true"]` | `showcase.isActiveCategory()` | Active category button. |
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

**What's tested.** The browser tests walk the page with real key presses (Tab, Enter, Space, arrows, Esc) and check every item above: the tab order, the skip link, the menu button on a narrow screen, the filters, the lightbox focus trap and focus return, the FAQ, and filling in and sending the form. They check behaviour and ARIA attributes. **They don't check what a screen reader actually announces.** After changing any of these, also try the page with a real screen reader (NVDA, VoiceOver or TalkBack).

---

## 8. Common tasks

**Change opening hours or time zone**: edit `timeZone` and `hours` in `site/js/site-config.js`. No code changes needed. Then reload the page: if the hours have disappeared and "Please call us" shows, the console names the mistake (see [§3](#what-happens-when-the-config-is-wrong)).

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

1. Add the key to `emptyFields()` (which sets up and resets `fields`) and to `errors` in `components.js`. The `invalid` getter picks it up from `errors` automatically.
2. Add a rule to the `rules` object that returns an error string or `""`. Include a maximum length, checked before any regex.
3. Copy an existing `.field` block in `index.html` and change the `id`, `for`, `data-field`, `:value="fields.…"`, `:aria-invalid="invalid.…"`, `x-show`/`x-text="errors.…"` and `aria-describedby` references. Keep `@input="onInput"` and `@blur="onBlur"` as they are: they find the field through `data-field`. Set `maxlength` to the same limit as the rule. **Don't use `x-model` or `validateField('…')` in the HTML**: the CSP build can't run them.
4. Update the form provider's server-side limits to match, and the list in the README under "Form provider settings".
5. Run the tests. The form tests count the error messages shown on an empty submit, so they need updating if the new field is required.

**Add a new component**

```js
// site/js/components.js, inside the alpine:init listener
Alpine.data("myThing", () => ({
  items: listOrEmpty(site.myThings, "myThings"),   // a list from window.SITE, or [] with a console message
  showAll: false,
  get visibleItems() {                             // logic goes in getters...
    return this.showAll ? this.items : this.items.slice(0, 3);
  },
  get toggleLabel() {
    return this.showAll ? "Show fewer" : "Show all";
  },
  toggle() {                                       // ...and methods with no arguments
    this.showAll = !this.showAll;
  },
}));
```

```html
<section x-data="myThing">
  <template x-for="thing in visibleItems" :key="thing.name">
    <p x-text="thing.name"></p>
  </template>
  <button type="button" @click="toggle" x-text="toggleLabel"></button>
</section>
```

- Follow [the CSP build rule](#the-csp-build-rule): the HTML only names properties, getters and methods. An attribute like `x-show="items.length > 3"` or `@click="showAll = !showAll"` won't work; it logs a console warning and the tests fail.
- A method used inside an `x-for` reads the row through `this` (here, `this.thing`) instead of taking an argument.
- Turn optional config values into `""` or `null` (the `text()` helper in `components.js` does this), so the HTML never reads `undefined`.
- Make the component cope with its own config being missing or wrong, like the others do, so a mistake can't stop the rest of the page.
- Put its data in `site-config.js`, and add `x-cloak` to anything that would look broken before Alpine loads.

> **Security rule: never use `x-html`.** Render config values and user input with `x-text` (or attribute bindings) only. `x-text` inserts plain text, which is why the page has no cross-site scripting (XSS) path today; a single `x-html` would open one. Also keep `:src`/`:href` bindings pointed at your own paths. If a URL ever comes from somewhere other than the config you control, allow only `https:` and relative paths.

**Add a new file to the site**: put it inside `site/`. Anything outside `site/` is never deployed. Remember that everything inside `site/` is public. The tests only accept what the site needs, in the template and in every client copy:

| Where | Allowed |
| --- | --- |
| Top level | `index.html`, `404.html`, `_headers`, `_redirects`, and the folders `css/`, `js/`, `images/` |
| `css/` | `.css` files |
| `js/` | `site-config.js`, `components.js` and `vendor/` (which holds exactly the verified Alpine files) |
| `images/` | `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.svg`. An SVG must not contain `<script` or an `on…=` event attribute. |
| Anywhere | No dotfiles or dot-folders (`.git/`, `.env`, `.DS_Store`), and no `.md`, `.env`, `.bak`, `.orig`, `.map`, `.zip`, `.log`, `.mjs` or `.ts` files |

So new code goes into `components.js` rather than a new script file. A new page or a new kind of file is a template change: update `folderProblems()` in `tests/site-policy.mjs` in the same change, and say why in the `CHANGELOG.md` entry. There's no `--allow` for files.

**Add a redirect** (for example, an old page address): add a line to `site/_redirects`, such as `/old-menu  /#menu  301`. Keep the six 404 rules. The target must stay on the site, and the status mustn't be `200` (see [`_redirects`](#_redirects)). To send visitors to another site, link to it from the page instead.

**Check a client's site before launch**: from the template repository, run `node tests/browser-test.mjs --client path/to/client-site` (see [§10](#10-testing)). It must pass before the site goes live; this is a line in the README pre-launch checklist. If the client needs something the template doesn't allow, such as a web-font host, pass each exception with `--allow`. Then add the site to the client register with the template release it was copied from and every `--allow` exception, with the reason.

---

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Nothing interactive works; console says a component is not defined | Script order changed. Alpine core must load **after** `components.js`. Or there's a syntax error in `components.js`; check the console. |
| Console warning: *"Alpine Expression Error: … Alpine is unable to interpret the following expression using the CSP-friendly build"*, and one binding does nothing | An attribute in `index.html` contains JavaScript (an operator, `!`, a call with arguments, `x-model`…). Move the logic into a getter or method in `components.js` and name it. See [The CSP build rule](#the-csp-build-rule). |
| A bare `x-data` element does nothing | The CSP build needs a component name. Register an empty one (like `hoursBadge`) and use `x-data="name"`. |
| A console warning appears for a binding that looks correct | The HTML may be reading a value that is `undefined`, often an optional config field. Default it to `""` or `null` in `components.js`. |
| Lightbox opens but Tab escapes it / `x-trap` warning | Focus plugin missing, or it's loading after Alpine core. |
| Hours are hidden, "Please call us for our current opening hours." shows, and the console says *"Opening hours are hidden because of a problem in site-config.js: …"* | The message names the mistake and where it is, e.g. `hours.mon[0].open: invalid time "7am"` or a misspelled `timeZone`. Fix it in `site-config.js`. See [§3](#what-happens-when-the-config-is-wrong). |
| Console says *"site-config.js didn't load, so the page is using empty settings."* | The file is missing, its path in `index.html` is wrong, or it has a syntax error (the browser reports that just before). The nav and form still work, but the hours, FAQ and menu are empty. |
| Console says *"faqs in site-config.js must be a list."* (or `showcase.categories`) | That value isn't a `[ … ]` list. That section stays empty until it's fixed. |
| Hours status is wrong by a few hours | `timeZone` is a valid zone, but the wrong one. |
| "Open now" never updates | It refreshes every 60 seconds; check for a console error from `refresh()`. |
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
| Test `[vendor] js/vendor/ holds exactly the verified Alpine files` fails with *"SHA-384 is …, expected …"* | A vendor file changed by even one byte. After a clone, line endings may have been converted: check that `.gitattributes` still has `site/js/vendor/** -text`, then re-checkout the files. Otherwise, **treat it as a possible tampered file**: restore it from git or re-download and re-verify it (§2). Only change `VENDOR_SHA384` in `tests/site-policy.mjs` as part of a deliberate upgrade. |
| The same test fails with *"js/vendor/ holds …; expected …"* | An old Alpine file was left behind after an upgrade, or an unexpected file was added. Remove it, or add it to `VENDOR_SHA384` if it's a verified part of an upgrade. A client copy made before the move to the CSP build fails here (it still has `alpine-3.14.1.min.js`); update it from the current template. |
| Test `Alpine started` fails right after an upgrade | The `Alpine.version` checks in the tests still expect the old version. See step 6 of [Upgrading Alpine](#upgrading-alpine). |
| A `[policy] the two CSP copies match` test fails and names a directive | `index.html` and `_headers` disagree on that directive. The output shows both values. Make the two copies match. |
| A `[policy] CSP hard limits` test fails | A copy contains `'unsafe-inline'`, `'unsafe-eval'` (in any letter case), `*` or a scheme-wide source such as `https:` or `data:`, or `object-src`/`base-uri`/`frame-ancestors` isn't `'none'`. These can't be allowed; remove them. See [Hard limits](#content-security-policy). If the message says *(is "*")* but the directive looks right, check for a second copy of it earlier in the policy. |
| `[policy] each CSP copy is written once…` fails: *"index.html must have exactly one Content-Security-Policy meta tag outside comments (found N)"* | `index.html` has no CSP `<meta>` tag, or more than one. Comments don't count. Keep exactly one, and delete any commented-out copies. |
| The same test fails: *"<copy>: <directive> appears more than once (browsers use only the first)"* | A directive is written twice in that copy. Browsers enforce only the first. Merge them into one. |
| `[policy] site-config.js sets formEndpoint exactly once` fails: *"site-config.js mentions formEndpoint N times…"* | A commented-out old endpoint, a second assignment, or a comment that mentions the name. Leave exactly one `formEndpoint: "…"` line. |
| The same test fails: *"site-config.js couldn't be run: …"* or *"window.SITE.formEndpoint is missing"* / *"is not a string"* | The file has a syntax error, doesn't set `window.SITE`, or `formEndpoint` is missing or isn't a quoted string. |
| `[policy] _redirects only redirects within the site…` fails: *"_redirects line N points to another host: …"* | A rule's target starts with `https://`, another scheme or `//`. Remove it. To send visitors elsewhere, link to the other site from the page. |
| The same test fails: *"_redirects line N is a 200 rewrite or proxy: …"* | A rule uses status `200` or `200!`. Use a `301` redirect within the site, or remove it. See [`_redirects`](#_redirects). |
| `[policy] every --allow exception is used` fails: *"--allow "…": "…" isn't a host source…"* | `--allow` was given a keyword (`'strict-dynamic'`, `'unsafe-hashes'`…), a bare scheme, `*`, a host with a `*`, or a host without a scheme. Only sources like `https://host.example` (optionally with a path) can be passed. Anything else needs a template change. |
| `[policy] CSP matches the template…` fails: *"script-src adds "https://…", which the template doesn't have"* | The client's policy has a source the template doesn't. If it's intended, pass it with `--allow "<directive> <source>"` and record it in the client register. If not, remove it. |
| The same test fails: *"default-src was removed"* (or another directive) | A whole directive is missing. Removing a source is fine; removing a directive isn't, because the browser then falls back to `default-src`. Put it back. |
| `[policy] security headers present with the template's values` fails | A header in the `/*` block is missing or has a different value. Use the template's exact value (§2). |
| `[policy] HSTS…` fails | `Strict-Transport-Security` is missing or shorter than a year, or isn't written exactly as `max-age=<seconds>` or `max-age=<seconds>; includeSubDomains`. In the template itself, it must be exactly `max-age=31536000`. |
| `[policy] _headers blocks are well-formed…` fails | `_headers` has no `/*` block or more than one, repeats a header in a block, has a line that isn't `Name: value`, or sets a security header in another path's block. If a per-path security header is really intended, pass `--allow "header <path> <Header-Name>"`. |
| `[policy] every --allow exception is used` fails: *"--allow "…" isn't needed"* | The run was given an exception the site doesn't need (perhaps it was removed from the CSP). Drop it from the command, and from the client register, so the register stays accurate. |
| `[folder] only site files…` fails | The client folder contains something that shouldn't be published, such as `.git/`, `.env`, a notes or backup file, a script other than `site-config.js`/`components.js`, or an SVG with a script. Remove it. See [Add a new file to the site](#8-common-tasks). |
| `[eval] blocked by the … policy` fails | `'unsafe-eval'` (or something that allows `eval`) is back in that CSP copy. Remove it. |
| `[client page] no requests to other hosts on load, except --allow origins` fails | The page loads something from another host (a font, an analytics script, an image). Self-host it, or, if it's intended, add it to both CSP copies and pass its origin with `--allow`. |
| `--client` run fails its config checks | The client's `formEndpoint` is empty, isn't a public `https://` URL, contains credentials, or its origin is missing from `connect-src` in one of the two CSP copies. |
| Tests print "Usage: node tests/browser-test.mjs --client …" and exit | `--client` was given without a folder, or not as the **first** argument. |
| Tests print *"Unexpected argument: …"* or *"--allow only applies with --client"* | Every argument after the client folder must be `--allow "<exception>"`, with the exception in quotes. `--allow` can't be used in template mode. |
| Console shows a CSP violation for a script, style or image | Something is loading from another domain, is inline, or is a `data:` image. Self-host it, or update the CSP in both `index.html` and `_headers`. |
| Live home page shows "not found", but the site works at `/site/` | The project root was published instead of `site/`. Set the publish directory to `site` (or upload the contents of `site/`). Check that `/.git/config`, `/README.md` and `/docs/` return 404 afterwards. |
| The README, `docs/` or `.git/` are visible on the live site | The project root was published. Same fix as above. On Netlify, `_redirects` hides these paths as a backup; on Cloudflare Pages it doesn't. |
| `404.html` has no styling when opened locally | It links to `/css/styles.css` from the site root, so it's unstyled from `file://`. Use the local-server commands in §1; on a real host it's styled. |
| Elements flash unstyled/empty on load | Add `x-cloak` to them. |

---

## 10. Testing

There are two test scripts, both with no npm packages:

```sh
node tests/browser-test.mjs                                   # template mode: the full browser suite, for this repository
node tests/browser-test.mjs --client path/to/client-site      # client mode: a client's copy of site/
node --test tests/hours.test.mjs                              # the opening-hours helpers (Node only, no browser)
```

[tests/browser-test.mjs](../tests/browser-test.mjs) drives headless Chrome through the Chrome DevTools Protocol. Its file-based checks (headers, CSP, folder contents, vendor hashes) live in [tests/site-policy.mjs](../tests/site-policy.mjs), which it imports. [tests/hours.test.mjs](../tests/hours.test.mjs) loads `components.js` into a sandbox and tests the hours helpers directly.

- **Requirements:** Node 22+, and Google Chrome for the browser tests. The script uses the default Windows install path unless you set **`CHROME_PATH`** to your Chrome or Chromium executable, for example:
  ```sh
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tests/browser-test.mjs
  ```
- **Arguments:** in template mode, the optional first argument is the project root; it defaults to the folder above `tests/`. In client mode, `--client` must come **first**, followed by the client's site folder (the folder that holds its `index.html`), then any number of `--allow "<exception>"` (see below). The test server serves **only that site folder**, like the real host.
- **The tests never contact anything outside your machine.** Every request from a test page is intercepted. Only the local test servers are reached. An `https://` request goes to a test stub if the test has one (that's how the form tests fake a provider), and everything else is blocked and recorded. The form tests swap in their fake endpoint by adding one line **after** `site-config.js` has run (`window.SITE.formEndpoint = …`, in strict mode), so comments or the file's layout can't leave the real endpoint in place. If `window.SITE` is missing or can't be changed, that line throws and the test fails visibly.
- The tests stay in the template repository and are never copied into `site/`, because `site/` is public. To test a client's site, run the template's script and point it at the client's folder.
- Details are printed only for a check that **fails**, one problem per line, so a `PASS` line never shows text that reads like a problem.

### What each mode runs

| Group | Template | Client | Checks |
| --- | --- | --- | --- |
| Components | ✓ | — | Hours badge and table, footer year, nav, filters, lightbox (focus trap, arrow keys, Esc), FAQ, validation messages, 50k-character paste, `maxlength`, honeypot, local console fallback, **no console warnings** (which is how a binding the CSP build can't read is caught). Runs from `file://`, a `localhost` server and a server sending the real `_headers`. |
| Broken config | ✓ | — | `site-config.js` is broken six ways: a bad time, a misspelled time zone, an unknown day, `faqs` not a list, the file missing, and a syntax error. Each must give exactly one console message naming the problem and no uncaught exceptions. The affected part hides, and the nav, FAQ, menu and **contact form (validates and submits)** keep working. |
| Keyboard walk | ✓ | — | The accessibility list in [§7](#7-accessibility-built-into-the-components), with real key presses: the full tab order, the honeypot never focused, the skip link, filters, lightbox, FAQ, form errors and focus, sending by keyboard, and the narrow-screen menu. |
| Weakened copies | ✓ | — | Proves the client checks work. A correctly configured client copy must pass. Then 36 copies, each weakened one way, must **each fail with the specific problem it targets**: for example a wider `script-src`, a removed header, a short HSTS, `'unsafe-eval'` added back, a second `_headers` block, `.git/`, `.env`, a notes file, an SVG with a script, a changed vendor byte, a commented-out CSP tag above a widened real one, a repeated directive, a commented-out old `formEndpoint`, `'UNSAFE-INLINE'` in upper case, a keyword passed with `--allow`, and `_redirects` rules that proxy or redirect to another host. Five more checks cover `--allow`, and one checks that `formEndpoint` is read past a commented-out copy. |
| Test server | ✓ | — | Path traversal returns 404, a malformed URL returns 400, and the server survives. This tests the harness itself. |
| **Vendor files** | ✓ | ✓ | SHA-384 of each file matches `VENDOR_SHA384`, and `js/vendor/` holds only those files. |
| **Policy** | ✓ | ✓ | The `_headers` structure; the security headers; HSTS; each CSP copy written once, with no directive repeated; `formEndpoint` set exactly once in `site-config.js`; the CSP [hard limits](#content-security-policy); the comparison with the template's policy; the two CSP copies matching; every `--allow` being a usable host source and actually used; and `_redirects` staying on the site. See below. |
| **Folder** | ✓ | ✓ | Only site files: see [Add a new file to the site](#8-common-tasks). |
| **`eval` blocked** | ✓ | ✓ | A probe script, served by the test server and loaded by the page like its own scripts, tries `new Function()`. It must be **blocked** under the `index.html` policy and under the `_headers` policy. A control run with the policy switched off must report **allowed**, which shows the probe can tell the difference. |
| **Contact-form security** | ✓ | ✓ | Empty endpoint on a live host → error; `http://` → error; credentials → rejected, nothing sent; endpoint missing from `connect-src` → blocked; working endpoint → trimmed payload, origin-only referrer; stalled endpoint → error after about 15 s; `HTTPS://` and leading space accepted; `https://` with no host rejected. |
| **Deployment files** | ✓ | ✓ | `_redirects` rules and `404.html` present. Template mode also checks that `/.git/config`, `/docs/`, `/README.md`, `/CHANGELOG.md` and `/tests/…` return 404. |
| Client config | — | ✓ | `formEndpoint` is set, is a public `https://` URL with no credentials, and its origin is in `connect-src` in **both** CSP copies. |
| Client page | — | ✓ | Alpine 3.14.1 starts with the client's `_headers` applied, with no CSP violations, console errors or console warnings on load, and no requests to other hosts except origins passed with `--allow`. |

The components, broken-config, keyboard and weakened-copy groups depend on the sample content, so they're skipped for clients.

`tests/hours.test.mjs` covers the cases listed in [§5](#5-how-the-hours-calculation-works), plus `toMinutes` rejecting `"7am"`, `"7:30"`, `"24:00"`, `"07:60"` and other bad times, and `validateHours` reporting each kind of mistake with its location.

### What client mode guarantees

A passing client run means the client's copy of `site/` has **the template's security policy, apart from the exceptions you passed and can see on the command line**:

- **The policy is read as the browser reads it:** exactly one CSP `<meta>` tag outside HTML comments, no directive repeated, keywords in any letter case.
- **The policy matches the template's.** Both CSP copies are compared, directive by directive, with the `site/` folder of the template checkout you run the tests from. The only difference accepted without `--allow` is the form endpoint's origin in `connect-src`. Removing a source is fine (it's stricter); removing a whole directive isn't.
- **The hard limits hold in the site-wide policy** (the `<meta>` tag and the `/*` block), whatever `--allow` says: no `'unsafe-inline'`, no `'unsafe-eval'`, no `*` or scheme-wide sources, and `object-src`, `base-uri` and `frame-ancestors` stay `'none'`.
- **The security headers** are in a single `/*` block, each set once, with the template's exact values. HSTS is at least a year and may add `includeSubDomains`. The test can't tell whether the subdomain check in the pre-launch checklist was actually done.
- **`formEndpoint`** is set exactly once in `site-config.js`, read by running the file.
- **`_redirects`** has no rule to another host and no `200` rewrite.
- **The folder holds only the site**, with no dotfiles, notes, backups, source maps or extra scripts. SVGs are checked for `<script` and `on…=` event attributes only.
- **The Alpine files are the verified ones**, byte for byte, and **`eval` is blocked** by both policy copies.
- **The form setup is right**, and **the page loads cleanly** with no outside requests except `--allow` origins.

What it **doesn't** guarantee yet:

- **The template itself isn't pinned.** The baseline is whatever the template's `site/` folder holds on disk, including uncommitted edits or an older checkout. A change that widens the template's own policy (without breaking a hard limit) passes template mode, and every client run then accepts it as the baseline. Run client checks from a clean, up-to-date checkout of a release, and review any template change to the CSP or `_headers` by hand.
- **A security header allowed for another path** with `--allow "header …"` isn't checked: not its value, and not the CSP hard limits.
- **An `--allow` source may still use `http://`.**
- **SVG content** beyond `<script` and `on…=` (for example a `javascript:` link) isn't checked. The site's CSP still blocks scripts in SVGs served from the site.

It checks the **files**. It doesn't replace the pre-launch checklist's live-URL checks: a header scan, the 404s, and a real test submission. A client copy made from an older template release can fail when the template's checks get stricter. That's deliberate: an outdated site can't pass the checklist unnoticed.

### Exceptions with `--allow`

If a client genuinely needs something the template doesn't allow, pass each exception explicitly:

```sh
node tests/browser-test.mjs --client path/to/client-site --allow "font-src https://fonts.gstatic.com"
node tests/browser-test.mjs --client path/to/client-site --allow "style-src https://fonts.googleapis.com" --allow "font-src https://fonts.gstatic.com"
node tests/browser-test.mjs --client path/to/client-site --allow "header /images/* Cross-Origin-Resource-Policy"
```

| Form | Allows |
| --- | --- |
| `"<directive> <host-source> [<host-source> …]"` | Those sources in that CSP directive, in both copies. The directive may be one the template doesn't have. **Only host sources** are accepted: a scheme, `://` and a host, optionally with a path, such as `https://fonts.gstatic.com` or `https://cdn.example/lib/file.js`. Keywords (`'strict-dynamic'`, `'unsafe-hashes'`, `'wasm-unsafe-eval'`…), bare schemes, `*`, hosts containing `*`, and hosts without a scheme are rejected; they need a change to the template itself. |
| `"header <path> <Header-Name>"` | That security header set in the `_headers` block for that path. **Its value isn't checked**, so review it by hand. |

- **An exception that isn't needed fails the run**, so the list on the command line always matches what the site really does.
- **`--allow` can't add a hard-limit source to the site-wide policy**, change a header's value in the `/*` block, allow a `_redirects` rule, or allow files in the folder.
- A run that used exceptions prints them at the end. **Record each one, with the reason, in the client register.** In client mode, every `--allow` is the place to look first in a review: it's the one way to widen a client's policy.
- **A `script-src` exception needs a security review for that client** before it goes into the register. It's the riskiest kind: a whole public CDN in `script-src`, for example, lets anyone who can publish a package there run script on the site. Prefer a full file URL to a bare host.
- Prefer `https://` sources. `http://` is still accepted, but it lets the file be changed in transit.
- The tests still block requests to `--allow` origins (they never contact them), and list them as expected.

### Last recorded results

Recorded on 2026-09-30 for the current template:

| Run | Result |
| --- | --- |
| `node tests/browser-test.mjs` (template mode) | **216 / 216** |
| `node --test tests/hours.test.mjs` | **16 / 16** |
| `node tests/browser-test.mjs --client …` on a fresh, correctly configured client copy of `site/` | **41 / 41** |

### Not covered by automated tests

- **Browser autofill and password managers** leaving the honeypot empty (**required before launch**). Check by hand in Chrome, Edge, Safari, Firefox and 1Password or Bitwarden. After autofilling, run `document.getElementById('hp_field').value` in the console; it must be `""`.
- **Headers and 404s on the real host** (**required before launch**). Deploy and check the live URL with a header scanner (e.g. securityheaders.com).
- **What a screen reader announces.** The keyboard walk checks behaviour and ARIA attributes only (see [§7](#7-accessibility-built-into-the-components)).
- **`404.html`'s own CSP.** It isn't compared with the other two copies. It's meant to be stricter.

After any change to `site/js/components.js`, `site/index.html`, `site/js/site-config.js`, the CSP or `site/js/vendor/`, run the tests and do a quick manual pass of every component with the console open.

---

## 11. Roadmap

Before release **1.0.0** is tagged:

- choose the default hosting platform (Netlify or Cloudflare Pages) and add its config file (`netlify.toml` or `wrangler.toml`) pinning the publish directory to `site`
- choose the default form provider (JSON POST, spam kept in a spam folder, domain restriction, plain-text notifications, no secret key in the browser)
- send the honeypot value to the form provider as spam, instead of discarding the message in the browser. This changes [§4.5](#45-contactform--validated-contact-form): the honeypot step and the payload.
- deploy the sample site as a live demo and staging site, and check it: a header scan, the 404s, and a real test submission
- a manual autofill test of the honeypot (see [§10](#not-covered-by-automated-tests))
- a manual screen-reader pass of the accessibility list in [§7](#7-accessibility-built-into-the-components)
- close the gaps listed under [What client mode guarantees](#what-client-mode-guarantees): pin the template's own policy in the tests, check the value of per-path header exceptions, reject `http://` in `--allow`, and widen the SVG check. The folder list will also accept `favicon.ico`, `robots.txt`, `sitemap.xml`, `site.webmanifest` and `.well-known/security.txt`. These sections change when that lands.

Each later change ships as its own release with a `CHANGELOG.md` entry, and this document is updated in the same release.
