// Headless-Chrome browser tests for the site in site/.
//
// Template mode (the full suite, run in this repository):
//   node tests/browser-test.mjs [projectDir]
//   projectDir defaults to the folder above tests/.
//
// Client mode (security and deployment checks only, for a client's copy of
// site/ with its own config and content; see README "Tests"):
//   node tests/browser-test.mjs --client <path-to-client-site-folder>
//
// Set CHROME_PATH to use a Chrome/Chromium other than the default Windows
// install location. No request ever reaches a real form endpoint: every form
// test swaps in a fake endpoint and intercepts the request.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const CLIENT_MODE = process.argv[2] === "--client";
if (CLIENT_MODE && !process.argv[3]) {
  console.error("Usage: node tests/browser-test.mjs --client <path-to-client-site-folder>");
  process.exit(2);
}
const ROOT = CLIENT_MODE ? null : path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SITE = CLIENT_MODE ? path.resolve(process.argv[3]) : path.join(ROOT, "site"); // the only folder that is deployed

// Expected SHA-384 of every file in site/js/vendor/. When upgrading Alpine,
// update this table (see "Upgrading Alpine" in the docs).
const VENDOR_SHA384 = {
  "alpine-3.14.1.min.js": "l8f0VcPi/M1iHPv8egOnY/15TDwqgbOR1anMIJWvU6nLRgZVLTLSaNqi/TOoT5Fh",
  "alpine-focus-3.14.1.min.js": "bKXNU7o2Y3Uk/F2PB6U0bMyGZf6pLDnePM70U7sTE3cXUQ+JLgzrr/kwipEh0p23",
};
// CSP directives that only work as an HTTP header, so appear only in _headers.
const HEADER_ONLY_DIRECTIVES = ["frame-ancestors", "upgrade-insecure-requests"];
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const ENDPOINT_RE = /formEndpoint\s*:\s*(["'`])(.*?)\1/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- static server (optionally applying _headers) ----------
// Behaves like the intended production host: serves only files inside site/,
// never dotfiles, and answers bad requests with 400 instead of crashing.
function parseHeadersFile() {
  const lines = fs.readFileSync(path.join(SITE, "_headers"), "utf8").split(/\r?\n/);
  const out = {};
  for (const l of lines) {
    const m = l.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
function resolveSitePath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  } catch {
    return { status: 400 };
  }
  if (p === "/") p = "/index.html";
  const f = path.join(SITE, p);
  const rel = path.relative(SITE, f);
  const outside = rel.startsWith("..") || path.isAbsolute(rel);
  const dotfile = rel.split(path.sep).some((seg) => seg.startsWith("."));
  if (outside || dotfile || !fs.existsSync(f) || !fs.statSync(f).isFile()) return { status: 404 };
  return { status: 200, file: f };
}
function startServer(port, applyHeaders) {
  const hdrs = applyHeaders ? parseHeadersFile() : {};
  const srv = http.createServer((req, res) => {
    const { status, file } = resolveSitePath(req.url);
    if (status !== 200) { res.writeHead(status); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", ...hdrs });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
// Raw HTTP GET that sends the path exactly as written (fetch() would normalise "..").
function rawGet(port, rawPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", () => resolve("connection error"));
    req.end();
  });
}

// ---------- minimal CDP client ----------
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params }));
    }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-test-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-extensions",
  "--host-resolver-rules=MAP client-site.test 127.0.0.1",
  "about:blank",
], { stdio: "ignore" });

let results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

async function newPage({ bypassCSP = false, configOverride = null, onRequest = null } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
  const { webSocketDebuggerUrl } = await res.json();
  const c = await connect(webSocketDebuggerUrl);
  const logs = [];
  c.on((m) => {
    if (m.method === "Runtime.consoleAPICalled")
      logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview)).join(" "), args: m.params.args });
    if (m.method === "Runtime.exceptionThrown") logs.push({ type: "exception", text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
    if (m.method === "Log.entryAdded") logs.push({ type: "log-" + m.params.entry.level, text: m.params.entry.text });
  });
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Page.enable");
  if (bypassCSP) await c.send("Page.setBypassCSP", { enabled: true });
  // Record CSP violations from inside the page (CDP-injected scripts aren't subject to CSP).
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source:
    "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" });
  // Every https request is intercepted: handed to the test's onRequest stub,
  // or blocked. The site itself is served over http here, so this guarantees
  // no test ever reaches a real form endpoint.
  const patterns = [{ urlPattern: "https://*", requestStage: "Request" }];
  if (configOverride !== null) patterns.push({ urlPattern: "*site-config.js*", requestStage: "Response" });
  {
    await c.send("Fetch.enable", { patterns });
    c.on(async (m) => {
      if (m.method !== "Fetch.requestPaused") return;
      const { requestId, request, responseStatusCode } = m.params;
      if (responseStatusCode !== undefined && request.url.includes("site-config.js")) {
        const body = await c.send("Fetch.getResponseBody", { requestId });
        let src = body.base64Encoded ? Buffer.from(body.body, "base64").toString() : body.body;
        // If the endpoint can't be swapped out, fail the page load rather than
        // risk sending a test message to a client's real endpoint.
        if (!ENDPOINT_RE.test(src)) {
          console.log("      HARNESS: could not find formEndpoint in site-config.js; blocking page load");
          return c.send("Fetch.failRequest", { requestId, errorReason: "Aborted" });
        }
        src = src.replace(ENDPOINT_RE, `formEndpoint: ${JSON.stringify(configOverride)}`);
        await c.send("Fetch.fulfillRequest", { requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from(src).toString("base64") });
      } else if (request.url.startsWith("https://")) {
        if (onRequest) await onRequest(c, m.params);
        else await c.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      } else await c.send("Fetch.continueRequest", { requestId });
    });
  }
  const evalJS = async (expr) => {
    const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const key = async (k, code, vk) => {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  };
  const goto = async (url) => {
    await c.send("Page.navigate", { url });
    await sleep(1500);
  };
  return { c, logs, evalJS, key, goto };
}

// Fill the form through real input events so x-model picks them up.
const FILL = (vals) => `(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
  ${Object.entries(vals).map(([k, v]) => `set(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n")}
  return true; })()`;
const SUBMIT = `document.querySelector('.contact-form button[type=submit]').click()`;
const STATUS = `(() => { const s=[...document.querySelectorAll('.form-status span')].find(e=>getComputedStyle(e).display!=='none'); return s ? s.className : 'none'; })()`;
const GOOD = { name: "  Ada Lovelace  ", email: " ada@example.com ", phone: "(503) 555-0199", message: "  Hello, I'd like to book a table for ten.  " };

async function componentSuite(label, url) {
  const p = await newPage();
  await p.goto(url);
  const e = p.evalJS;
  check(`[${label}] Alpine started`, await e(`!!window.Alpine && Alpine.version === '3.14.1'`));
  check(`[${label}] hours badge filled`, (await e(`document.querySelector('.status-badge strong').textContent`)).length > 0);
  check(`[${label}] hours table has 7 rows`, (await e(`document.querySelectorAll('.hours-table tbody tr').length`)) === 7);
  check(`[${label}] footer year`, (await e(`document.querySelector('.site-footer span').textContent`)) === String(new Date().getFullYear()));
  // nav
  await e(`document.querySelector('.nav-toggle').click()`); await sleep(100);
  check(`[${label}] nav opens`, await e(`document.getElementById('site-nav').classList.contains('is-open')`));
  await p.key("Escape", "Escape", 27); await sleep(100);
  check(`[${label}] nav closes on Esc`, !(await e(`document.getElementById('site-nav').classList.contains('is-open')`)));
  // filters
  const first = await e(`document.querySelector('.showcase-name span').textContent`);
  await e(`document.querySelectorAll('.filter-button')[1].click()`); await sleep(100);
  check(`[${label}] category filter switches items`, (await e(`document.querySelector('.showcase-name span').textContent`)) !== first);
  // lightbox
  await e(`document.querySelectorAll('.filter-button')[0].click()`); await sleep(100);
  await e(`document.querySelector('.showcase-thumb').click()`); await sleep(500);
  check(`[${label}] lightbox opens`, await e(`getComputedStyle(document.querySelector('.lightbox')).display !== 'none'`));
  check(`[${label}] lightbox traps focus`, await e(`document.querySelector('.lightbox').contains(document.activeElement)`));
  const cap1 = await e(`document.querySelector('.lightbox figcaption span').textContent`);
  await p.key("ArrowRight", "ArrowRight", 39); await sleep(100);
  check(`[${label}] lightbox arrow key`, (await e(`document.querySelector('.lightbox figcaption span').textContent`)) !== cap1);
  await p.key("Escape", "Escape", 27); await sleep(600);
  check(`[${label}] lightbox closes on Esc`, await e(`getComputedStyle(document.querySelector('.lightbox')).display === 'none'`));
  // faq
  await e(`document.querySelector('.faq-question').click()`); await sleep(400);
  check(`[${label}] FAQ opens`, await e(`document.querySelector('.faq-question').getAttribute('aria-expanded') === 'true'`));
  // form: empty submit shows errors
  await e(SUBMIT); await sleep(200);
  check(`[${label}] empty submit shows 3 errors`, (await e(`[...document.querySelectorAll('.field-error')].filter(x=>getComputedStyle(x).display!=='none').length`)) === 3);
  // form: long paste doesn't hang the regex (bypasses maxlength via script, like a paste into a modified page)
  const t0 = Date.now();
  await e(`(() => { const el=document.getElementById('email'); el.value='a@'+'.'.repeat(50000)+'@'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('blur')); })()`);
  const ms = Date.now() - t0; await sleep(100);
  check(`[${label}] 50k-char email validated fast`, ms < 100 && (await e(`document.getElementById('email-error').textContent`)) === "That email address is too long.", `${ms} ms`);
  check(`[${label}] maxlength attributes`, (await e(`['name','email','phone','message'].map(i=>document.getElementById(i).maxLength).join()`)) === "100,254,30,5000");
  check(`[${label}] honeypot renamed`, (await e(`(() => { const h=document.getElementById('hp_field'); return !!h && h.autocomplete==='new-password' && !document.getElementById('company'); })()`)));
  // form: valid submit on a local copy with no endpoint -> success + console.info with trimmed values
  await e(FILL(GOOD)); await e(SUBMIT); await sleep(300);
  check(`[${label}] local + no endpoint -> success`, (await e(STATUS)) === "is-success");
  const info = p.logs.find((l) => l.type === "info" && l.text.includes("local copy only"));
  const preview = info?.args?.[1]?.preview?.properties?.map((x) => `${x.name}=${x.value}`).join("|") || "";
  check(`[${label}] logged payload is trimmed, no honeypot key`, preview.includes("name=Ada Lovelace") && preview.includes("email=ada@example.com") && !preview.includes("hp="), preview);
  const csp = await e(`window.__csp`);
  check(`[${label}] no CSP violations`, csp.length === 0, csp.join("; "));
  const errs = p.logs.filter((l) => ["error", "exception", "log-error"].includes(l.type) || /Content Security Policy/i.test(l.text)).filter((l) => !/404/.test(l.text) || !p.logs.length || false);
  const has404 = p.logs.some((l) => /404/.test(l.text));
  if (has404) console.log("      note: a 404 was logged (the harness server has no favicon.ico)");
  check(`[${label}] no console errors`, errs.length === 0, errs.map((x) => x.text).join(" | "));
  p.c.close();
}

// ---------- checks on the files in site/ (no browser needed) ----------
function parseCsp(csp) {
  const map = {};
  for (const d of csp.split(";").map((x) => x.trim()).filter(Boolean)) {
    const [name, ...values] = d.split(/\s+/);
    map[name] = values.join(" ");
  }
  return map;
}
function readCsps() {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
  return { meta: parseCsp(meta), header: parseCsp(parseHeadersFile()["Content-Security-Policy"] || "") };
}

// Vendor files are exactly what was verified (hashes recorded in docs §2).
function vendorChecks() {
  const dir = path.join(SITE, "js", "vendor");
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  check("[vendor] js/vendor/ holds only the expected files", present.join() === Object.keys(VENDOR_SHA384).sort().join(), present.join(", "));
  for (const [file, want] of Object.entries(VENDOR_SHA384)) {
    const f = path.join(dir, file);
    const got = fs.existsSync(f) ? crypto.createHash("sha384").update(fs.readFileSync(f)).digest("base64") : "missing";
    check(`[vendor] SHA-384 of ${file}`, got === want, got === want ? "" : `got ${got}`);
  }
}

// Security settings in the two CSP copies and _headers.
function headerChecks() {
  const { meta, header } = readCsps();
  const hdrs = parseHeadersFile();
  const headerComparable = Object.fromEntries(Object.entries(header).filter(([k]) => !HEADER_ONLY_DIRECTIVES.includes(k)));
  const diff = [...new Set([...Object.keys(meta), ...Object.keys(headerComparable)])]
    .filter((k) => meta[k] !== headerComparable[k])
    .map((k) => `${k}: index.html="${meta[k] ?? "(missing)"}" _headers="${headerComparable[k] ?? "(missing)"}"`);
  check("[csp] index.html and _headers policies match (apart from header-only directives)", diff.length === 0, diff.join("; "));
  check("[csp] header-only directives are in _headers", HEADER_ONLY_DIRECTIVES.every((k) => k in header));
  for (const [label, csp] of [["index.html", meta], ["_headers", header]]) {
    check(`[csp] no 'unsafe-inline' (${label})`, !Object.values(csp).some((v) => v.includes("'unsafe-inline'")));
    check(`[csp] object-src 'none' and base-uri 'none' (${label})`, csp["object-src"] === "'none'" && csp["base-uri"] === "'none'");
    check(`[csp] no data: in img-src (${label})`, csp["img-src"] === "'self'", `img-src ${csp["img-src"]}`);
  }
  check("[headers] COOP same-origin", hdrs["Cross-Origin-Opener-Policy"] === "same-origin");
  check("[headers] CORP same-origin", hdrs["Cross-Origin-Resource-Policy"] === "same-origin");
  const hsts = hdrs["Strict-Transport-Security"] || "";
  if (CLIENT_MODE) {
    // A client may add includeSubDomains after the checklist confirmation.
    const maxAge = Number(hsts.match(/^max-age=(\d+)/)?.[1] || 0);
    check("[headers] HSTS set for at least a year", maxAge >= 31536000, hsts);
  } else {
    check("[headers] HSTS default has no includeSubDomains", hsts === "max-age=31536000", hsts);
  }
}

// The client's own endpoint: set, a public https URL, and allowed by both CSPs.
function clientConfigChecks() {
  const src = fs.readFileSync(path.join(SITE, "js", "site-config.js"), "utf8");
  const value = src.match(ENDPOINT_RE)?.[2] ?? "";
  let url = null;
  try { url = new URL(value.trim()); } catch {}
  check("[client config] formEndpoint is set", value.trim() !== "", "empty: the form shows an error on the live site");
  check("[client config] formEndpoint is a full https:// URL with no credentials",
    !!url && url.protocol === "https:" && !!url.hostname && !url.username && !url.password, value);
  if (url) {
    const { meta, header } = readCsps();
    for (const [label, csp] of [["index.html", meta], ["_headers", header]]) {
      const sources = (csp["connect-src"] || "").split(/\s+/);
      check(`[client config] connect-src allows ${url.origin} (${label})`, sources.includes(url.origin) || sources.includes(url.origin + "/"), `connect-src ${csp["connect-src"]}`);
    }
  }
}

// The client's real page loads cleanly on a simulated live host with _headers applied.
async function clientSmoke() {
  const p = await newPage();
  // localhost: browsers don't apply upgrade-insecure-requests to it, and the
  // test server is plain http.
  await p.goto("http://localhost:8766/");
  check("[client page] Alpine started", await p.evalJS(`!!window.Alpine && Alpine.version === '3.14.1'`));
  const csp = await p.evalJS(`window.__csp`);
  check("[client page] no CSP violations on load", csp.length === 0, csp.join("; "));
  const errs = p.logs.filter((l) => ["error", "exception", "log-error"].includes(l.type) && !/404/.test(l.text));
  check("[client page] no console errors on load", errs.length === 0, errs.map((x) => x.text).join(" | "));
  p.c.close();
}

// Contact-form failure paths. Every test swaps in a fake endpoint, so these run
// safely against any copy of site/.
async function formSecuritySuite() {
  // Non-local host, empty endpoint -> must show ERROR, and must not log the payload.
  {
    const p = await newPage({ configOverride: "" });
    await p.goto("http://client-site.test:8765/");
    await p.evalJS(FILL(GOOD)); await p.evalJS(SUBMIT); await sleep(300);
    check("[live host, empty endpoint] shows error state", (await p.evalJS(STATUS)) === "is-error");
    check("[live host, empty endpoint] payload not logged", !p.logs.some((l) => l.text.includes("Ada")));
    p.c.close();
  }
  // Non-https endpoint -> startup error + error state, no request sent.
  {
    let sent = false;
    const p = await newPage({ configOverride: "http://forms.test/f", bypassCSP: true });
    p.c.on((m) => { if (m.method === "Runtime.consoleAPICalled") {} });
    await p.goto("http://client-site.test:8765/");
    check("[http:// endpoint] startup console error", p.logs.some((l) => l.text.includes("must be a full https:// URL")));
    await p.evalJS(FILL(GOOD)); await p.evalJS(SUBMIT); await sleep(300);
    check("[http:// endpoint] shows error state", (await p.evalJS(STATUS)) === "is-error");
    p.c.close();
  }
  // Endpoint that isn't in the CSP connect-src -> CSP violation + error state (troubleshooting row).
  {
    const p = await newPage({ configOverride: "https://forms.test/f" });
    await p.goto("http://client-site.test:8765/");
    await p.evalJS(FILL(GOOD)); await p.evalJS(SUBMIT); await sleep(800);
    const csp = await p.evalJS("window.__csp");
    check("[endpoint missing from CSP] blocked by connect-src + error state", csp.some((v) => v.startsWith("connect-src")) && (await p.evalJS(STATUS)) === "is-error", csp.join("; "));
    p.c.close();
  }
  // Working endpoint -> success; check payload, credentials and referrer.
  {
    let captured = null;
    const p = await newPage({ configOverride: "https://forms.test/f", bypassCSP: true, onRequest: async (c, params) => {
      if (params.request.method === "POST") captured = params.request;
      await c.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [
        { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Allow-Headers", value: "Content-Type, Accept" }, { name: "Access-Control-Allow-Methods", value: "POST" }], body: Buffer.from("{}").toString("base64") });
    } });
    await p.goto("http://client-site.test:8765/");
    await p.evalJS(FILL(GOOD)); await p.evalJS(SUBMIT); await sleep(800);
    check("[working endpoint] success state", (await p.evalJS(STATUS)) === "is-success");
    const body = captured && JSON.parse(captured.postData);
    check("[working endpoint] payload trimmed, 4 keys", body && body.name === "Ada Lovelace" && body.message === "Hello, I'd like to book a table for ten." && Object.keys(body).join() === "name,email,phone,message", captured?.postData);
    check("[working endpoint] referrer is origin only", !captured?.headers?.Referer || captured.headers.Referer === "http://client-site.test:8765/", captured?.headers?.Referer);
    check("[working endpoint] form cleared", (await p.evalJS(`document.getElementById('name').value`)) === "");
    p.c.close();
  }
  // Endpoint parsing: case and whitespace are tolerated,
  // an https URL with no host is rejected.
  for (const [label, value, ok] of [
    ["upper-case HTTPS://", "HTTPS://forms.test/f", true],
    ["leading space", " https://forms.test/f", true],
    ["https:// with no host", "https://", false],
    ["with embedded credentials", "https://user:secret@forms.test/f", false],
  ]) {
    let sentTo = null;
    const p = await newPage({ configOverride: value, bypassCSP: true, onRequest: async (c, params) => {
      if (params.request.method === "POST") sentTo = params.request.url;
      await c.send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [
        { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Allow-Headers", value: "Content-Type, Accept" }, { name: "Access-Control-Allow-Methods", value: "POST" }], body: Buffer.from("{}").toString("base64") });
    } });
    await p.goto("http://client-site.test:8765/");
    await p.evalJS(FILL(GOOD)); await p.evalJS(SUBMIT); await sleep(800);
    const status = await p.evalJS(STATUS);
    const loggedError = p.logs.some((l) => l.text.includes("must be a full https:// URL"));
    if (ok) check(`[endpoint ${label}] accepted and sent`, status === "is-success" && sentTo === "https://forms.test/f" && !loggedError, `${status}, sent to ${sentTo}`);
    else check(`[endpoint ${label}] rejected with console error`, status === "is-error" && sentTo === null && loggedError, status);
    p.c.close();
  }
  // Stalled endpoint -> error state after ~15 s.
  {
    const p = await newPage({ configOverride: "https://forms.test/f", bypassCSP: true, onRequest: async () => { /* never answer */ } });
    await p.goto("http://client-site.test:8765/");
    await p.evalJS(FILL(GOOD));
    const t0 = Date.now();
    await p.evalJS(SUBMIT); await sleep(300);
    check("[stalled endpoint] button shows Sending…", (await p.evalJS(`document.querySelector('.contact-form button[type=submit]').textContent`)) === "Sending…");
    let status = "none";
    while (Date.now() - t0 < 20000) { status = await p.evalJS(STATUS); if (status !== "none") break; await sleep(250); }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    check("[stalled endpoint] error state after ~15 s", status === "is-error" && secs >= 14.5 && secs <= 16.5, `${secs} s`);
    p.c.close();
  }

}

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }
  if (!fs.existsSync(path.join(SITE, "index.html"))) throw new Error(`No index.html in ${SITE}`);
  console.log(`${CLIENT_MODE ? "Client mode (security and deployment checks)" : "Template mode (full suite)"}: ${SITE}\n`);

  const plain = await startServer(8765, false);
  const withHeaders = await startServer(8766, true);

  if (!CLIENT_MODE) {
    // Template-only: these depend on the sample content (menu, photos, FAQ).
    const fileUrl = "file:///" + path.join(SITE, "index.html").replace(/\\/g, "/");
    await componentSuite("file://", fileUrl);
    await componentSuite("localhost server", "http://localhost:8765/");
    await componentSuite("_headers applied", "http://localhost:8766/");
  } else {
    // Client-only: the client's own endpoint and page.
    clientConfigChecks();
    await clientSmoke();
  }

  // Security and deployment checks: must pass for the template and every client copy.
  vendorChecks();
  headerChecks();
  await formSecuritySuite();
  {
    const redirects = fs.readFileSync(path.join(SITE, "_redirects"), "utf8");
    check("[deploy layout] _redirects guards project files outside site/",
      ["/.git/*", "/README.md", "/CHANGELOG.md", "/docs/*", "/tests/*", "/screenshots/*"].every((from) =>
        redirects.split(/\r?\n/).some((line) => { const [f, , code] = line.trim().split(/\s+/); return f === from && code === "404!"; })));
    check("[deploy layout] 404.html exists", fs.existsSync(path.join(SITE, "404.html")));
  }

  if (!CLIENT_MODE) {
    // Template-only: the test server serves only site/, never the project root.
    {
      const cases = [
        ["/.git/config", 404], ["/docs/", 404], ["/README.md", 404], ["/CHANGELOG.md", 404], ["/tests/browser-test.mjs", 404],
        ["/../.git/config", 404], ["/..%2F.git%2Fconfig", 404], ["/..%2FREADME.md", 404],
        ["/..%2F..%2F" + encodeURIComponent(path.basename(ROOT)) + "%2FREADME.md", 404],
        ["/%E0%A4%A", 400], ["/js", 404],
      ];
      for (const [p, want] of cases) {
        const got = await rawGet(8765, p);
        check(`[deploy layout] ${p} -> ${want}`, got === want, `got ${got}`);
      }
      check("[deploy layout] server still up after bad requests", (await rawGet(8765, "/")) === 200);
    }
  }

  plain.close(); withHeaders.close();
} catch (err) {
  console.error("HARNESS ERROR", err);
  results.push({ ok: false });
} finally {
  chrome.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
