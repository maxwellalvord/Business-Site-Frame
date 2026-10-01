# Changelog

Releases of the Small-Business Site Frame template. Record the release each client site was copied from in your (private) client register, and use it to find out which live sites need an update.

**🔒 Security** marks a security-relevant change. A security-relevant release goes out to every live client site within the agreed update window.

Versions follow `MAJOR.MINOR.PATCH`. Each release is a git tag (`v1.0.0`, and so on).

---

## [1.0.0] — Unreleased

The first launch-ready template. It will be tagged `v1.0.0` once the host and form provider are chosen, a manual autofill test of the contact form is done, and a staging deploy passes a header scan.

### Contact form
- 🔒 **Security:** On a live host, an empty `formEndpoint` now shows an error instead of a fake "Thanks!" and doesn't log the visitor's details to the console. The console fallback only works on `file://` and `localhost`.
- 🔒 **Security:** `formEndpoint` must be a full `https://` URL. It's parsed with `new URL()`, so an upper-case scheme and surrounding whitespace are accepted. A URL with no host, or with a username or password, is rejected with a console error at page load.
- 🔒 **Security:** Length limits on every field (name 100, email 254, phone 30, message 5,000), checked before the email regex. Values are trimmed before sending.
- 🔒 **Security:** Sending times out after 15 seconds, and requests go without cookies (`credentials: "omit"`) and with an origin-only referrer.
- 🔒 **Security:** The spam-trap field was renamed to `hp_field` with `autocomplete="new-password"`, so autofill doesn't fill it and silently drop real messages. *(A manual autofill test is still required before launch.)*

### Configuration
- A mistake in `site-config.js` now only affects its own part of the page. A bad time (such as `"7am"`), a misspelled time zone or an unknown day name hides the "Open now" badge and hours table, shows "Please call us for our current opening hours" instead, and reports exactly where the mistake is in the console. The FAQ, menu and contact form keep working. Before, a bad time zone stopped every component, including the contact form, and a bad time silently showed the wrong status.
- If `site-config.js` is missing or has a syntax error, the page reports it once and the navigation and contact form still work.
- Times must be strict 24-hour `"HH:MM"`.

### Scripts and headers
- 🔒 **Security:** Alpine 3.14.1 and the Focus plugin are self-hosted in `site/js/vendor/`. No script loads from a third-party domain.
- 🔒 **Security:** The site uses Alpine's CSP build (`alpine-csp-3.14.1.min.js`, verified from two sources), so the Content-Security-Policy no longer needs `'unsafe-eval'`. Nothing on the page can turn text into code. The HTML's Alpine attributes now name properties and methods in `components.js` instead of containing JavaScript expressions.
- 🔒 **Security:** Content-Security-Policy in `index.html` and `_headers`: scripts, styles and images only from the site itself, and no `data:` images.
- 🔒 **Security:** `_headers` for Netlify / Cloudflare Pages: `frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and HSTS for one year. HSTS leaves out `includeSubDomains` by default; it should be added only after checking every subdomain.

### Structure and deployment
- 🔒 **Security:** The website moved into `site/`, the only folder that is deployed or copied for a client. `site/_redirects` hides internal paths on Netlify if they're uploaded by mistake, and `site/404.html` was added.
- 🔒 **Security:** The README's local-server commands bind to `127.0.0.1`, serve only `site/`, and pin `serve@14.2.6`.
- The README has a "Deploying" section, a pre-launch checklist, a "`site/` is public, no secrets" rule and screenshots.
- Developer documentation for the Alpine components is in `docs/`.

### Tests
- Automated headless-Chrome tests in `tests/browser-test.mjs`: every component, the form's failure paths, the security headers and the deployment layout.
- 🔒 **Security:** The tests fail if a byte of the vendor files changes, if an unexpected file appears in `js/vendor/`, or if the two CSP copies drift apart.
- `--client <site folder>` mode runs the security and deployment checks against a client's copy of `site/`.
- 🔒 **Security:** Client mode compares the client's headers and CSP with the template's own policy. Any other difference fails unless it's passed with `--allow`, and some protections (no `'unsafe-inline'`, no wildcard sources, `object-src`/`base-uri`/`frame-ancestors 'none'`) can't be relaxed at all. Security headers may only be set in the `/*` block of `_headers`.
- 🔒 **Security:** Client mode checks the folder holds only site files: no dotfiles, notes, backups or source maps, and no SVGs with scripts.
- 🔒 **Security:** Test pages can't contact any outside host. Every request to another host is answered by the test or blocked, so the tests never reach a client's real form endpoint.
- The template tests build weakened copies of the site and require the client checks to catch each one.
- Tests for the opening-hours calculations (`tests/hours.test.mjs`): past midnight, Saturday into Sunday, several ranges per day, no hours at all, time zones, and config validation.
- The browser tests break `site-config.js` in six ways and check the rest of the page, and the contact form, keep working.
- 🔒 **Security:** The tests check that the page's policy really blocks `eval`, and that `'unsafe-eval'` can't be added back, even with `--allow`.
- A keyboard walk test: the tab order, the skip link, the menu button, the filters, the lightbox (focus trap, arrows, Esc, focus return), the FAQ and the contact form, all by keyboard.
