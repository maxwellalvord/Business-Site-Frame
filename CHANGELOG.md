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

### Scripts and headers
- 🔒 **Security:** Alpine 3.14.1 and the Focus plugin are self-hosted in `site/js/vendor/`. No script loads from a third-party domain.
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
- `--client <site folder>` mode runs the security and deployment checks against a client's copy of `site/`, and never contacts the client's real form endpoint.
