// Headless-Chrome browser tests for the site in site/.
//
// Template mode (the full suite, run in this repository):
//   node tests/browser-test.mjs [projectDir]
//   projectDir defaults to the folder above tests/.
//
// Client mode (security and deployment checks only, for a client's copy of
// site/ with its own config and content; see README "Tests"):
//   node tests/browser-test.mjs --client <path-to-client-site-folder> [--allow "<exception>" ...]
// The client's policy is compared with the template's own site/ folder. Any
// difference other than the form endpoint's origin in connect-src fails,
// unless it's passed with --allow (record every exception in the client register).
//
// Set CHROME_PATH to use a Chrome/Chromium other than the default Windows
// install location. Test pages can't reach anything outside this machine:
// every request to another host is stubbed by a test or blocked.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  ENDPOINT_RE, VENDOR_SHA384, parseCsp, readPolicies, siteWideHeaders,
  policyChecks, folderProblems, vendorProblems,
} from "./site-policy.mjs";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_SITE = path.join(TESTS_DIR, "..", "site"); // the baseline for client mode
const args = process.argv.slice(2);
const CLIENT_MODE = args[0] === "--client";
const ALLOWS = [];
for (let i = CLIENT_MODE ? 2 : 1; i < args.length; i += 2) {
  if (args[i] !== "--allow" || args[i + 1] === undefined) { console.error(`Unexpected argument: ${args[i]}`); process.exit(2); }
  ALLOWS.push(args[i + 1]);
}
if (CLIENT_MODE && !args[1]) {
  console.error('Usage: node tests/browser-test.mjs --client <path-to-client-site-folder> [--allow "<exception>" ...]');
  process.exit(2);
}
if (!CLIENT_MODE && ALLOWS.length) { console.error("--allow only applies with --client"); process.exit(2); }
const ROOT = CLIENT_MODE ? null : path.resolve(args[0] || path.join(TESTS_DIR, ".."));
const SITE = CLIENT_MODE ? path.resolve(args[1]) : path.join(ROOT, "site"); // the only folder that is deployed

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- static server (optionally applying _headers) ----------
// Behaves like the intended production host: serves only files inside site/,
// never dotfiles, and answers bad requests with 400 instead of crashing.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
function resolveSitePath(urlPath, root = SITE) {
  let p;
  try {
    p = decodeURIComponent(new URL(urlPath, "http://x").pathname);
  } catch {
    return { status: 400 };
  }
  if (p === "/") p = "/index.html";
  const f = path.join(root, p);
  const rel = path.relative(root, f);
  const outside = rel.startsWith("..") || path.isAbsolute(rel);
  const dotfile = rel.split(path.sep).some((seg) => seg.startsWith("."));
  if (outside || dotfile || !fs.existsSync(f) || !fs.statSync(f).isFile()) return { status: 404 };
  return { status: 200, file: f };
}
// getRoot: the folder to serve, read on every request (the weakened-copy
// server switches between copies). That server also turns caching off, so a
// page never comes from a previous copy.
function startServer(port, applyHeaders, getRoot = null) {
  const hdrs = applyHeaders ? siteWideHeaders(SITE) : getRoot ? { "Cache-Control": "no-store" } : {};
  const srv = http.createServer((req, res) => {
    // A test-only script, loaded by the page like its own scripts so it runs
    // under the page's real Content-Security-Policy. It records whether eval
    // works. Not part of the site; only this test server serves it.
    if (req.url === "/__eval-probe.js") {
      res.writeHead(200, { "Content-Type": "text/javascript", ...hdrs });
      return res.end('try { new Function("return 1")(); window.__evalProbe = "allowed"; } catch (e) { window.__evalProbe = "blocked"; }');
    }
    const { status, file } = resolveSitePath(req.url, getRoot ? getRoot() : SITE);
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
// Details are printed only when a check fails, so a PASS line never shows
// text that reads like a problem.
const check = (name, ok, failDetail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && failDetail ? "\n        " + failDetail : ""}`);
};
const checkGroups = (prefix, groups) => { for (const g of groups) check(`${prefix} ${g.name}`, g.problems.length === 0, g.problems.join("\n        ")); };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "client-site.test"]);
function isLocalTestUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "file:" || (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname));
  } catch { return false; }
}

// Runs at the start of every page, in an isolated world: the page's own
// scripts share the DOM but can't reach anything defined here. readCspMetas()
// returns the CSP meta tags as the browser parsed them, and lists any script
// that changed or removed a <meta> tag afterwards (a policy the browser has
// applied stays applied, whatever the tag says later).
const READ_WORLD = "site-policy-read";
const META_WATCH = `(() => {
  const changes = new Set();
  const isMeta = (n) => n.nodeType === 1 && n.localName === "meta";
  const note = (records) => { for (const r of records) {
    if (r.type === "attributes" && isMeta(r.target)) changes.add("a script changed the " + r.attributeName + " attribute of a <meta> tag after the page loaded it");
    if (r.type === "childList") for (const n of r.removedNodes) {
      if (isMeta(n) || (n.nodeType === 1 && n.querySelector("meta"))) changes.add("a script removed a <meta> tag after the page loaded it");
    }
  } };
  const watch = new MutationObserver(note);
  watch.observe(document, { subtree: true, childList: true, attributes: true });
  globalThis.readCspMetas = () => {
    note(watch.takeRecords());
    const tags = [...document.querySelectorAll("meta[http-equiv]")].filter((m) => m.getAttribute("http-equiv").trim().toLowerCase() === "content-security-policy");
    return { url: location.origin + location.pathname, changes: [...changes],
      metas: tags.map((m) => ({ content: m.getAttribute("content") ?? "", inHead: !!document.head && document.head.contains(m) })) };
  };
})();`;

// configPatch: optional function that rewrites site-config.js before the page
// sees it; returning null makes the file fail to load (404).
async function newPage({ bypassCSP = false, configOverride = null, configPatch = null, onRequest = null } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" });
  const { id: targetId, webSocketDebuggerUrl } = await res.json();
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
  const { frameTree } = await c.send("Page.getFrameTree");
  let readWorld = null;
  c.on((m) => {
    const ctx = m.method === "Runtime.executionContextCreated" && m.params.context;
    if (ctx && ctx.name === READ_WORLD && ctx.auxData?.frameId === frameTree.frame.id) readWorld = ctx.id;
  });
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: META_WATCH, worldName: READ_WORLD });
  if (bypassCSP) await c.send("Page.setBypassCSP", { enabled: true });
  // Record CSP violations from inside the page (CDP-injected scripts aren't subject to CSP).
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source:
    "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));" });
  // Every request is intercepted. Only the local test servers are reached;
  // https requests go to the test's onRequest stub if it has one; everything
  // else is blocked and recorded. So no test can reach a real form endpoint
  // or any other outside host.
  const blocked = [];
  const patterns = [{ urlPattern: "*", requestStage: "Request" }];
  if (configOverride !== null || configPatch) patterns.push({ urlPattern: "*site-config.js*", requestStage: "Response" });
  {
    await c.send("Fetch.enable", { patterns });
    c.on(async (m) => {
      if (m.method !== "Fetch.requestPaused") return;
      const { requestId, request, responseStatusCode } = m.params;
      if (responseStatusCode !== undefined && request.url.includes("site-config.js")) {
        const body = await c.send("Fetch.getResponseBody", { requestId });
        let src = body.base64Encoded ? Buffer.from(body.body, "base64").toString() : body.body;
        if (configPatch) {
          src = configPatch(src);
          if (src === null) return c.send("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" });
        }
        // Swap the endpoint after the file has run, the same way whatever the
        // file looks like (comments included). Strict mode makes a missing or
        // read-only window.SITE throw, so the page fails visibly instead of
        // keeping the client's real endpoint.
        if (configOverride !== null) src += `\n;(function () { "use strict"; window.SITE.formEndpoint = ${JSON.stringify(configOverride)}; })();\n`;
        await c.send("Fetch.fulfillRequest", { requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from(src).toString("base64") });
      } else if (responseStatusCode !== undefined) {
        await c.send("Fetch.continueRequest", { requestId });
      } else if (isLocalTestUrl(request.url)) {
        await c.send("Fetch.continueRequest", { requestId });
      } else if (onRequest && request.url.startsWith("https://")) {
        await onRequest(c, m.params);
      } else {
        blocked.push(request.url);
        await c.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
      }
    });
  }
  const evalIn = async (expr, contextId) => {
    const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const evalJS = (expr) => evalIn(expr);
  const evalRead = (expr) => {
    if (!readWorld) throw new Error("the read world wasn't created in the page");
    return evalIn(expr, readWorld);
  };
  const key = async (k, code, vk, { text, modifiers = 0 } = {}) => {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text, modifiers });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const goto = async (url) => {
    await c.send("Page.navigate", { url });
    await sleep(1500);
  };
  const close = async () => { c.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => {}); };
  return { c, logs, blocked, evalJS, evalRead, key, goto, close };
}

// Load one page and read what the browser applied: its CSP meta tags and, with
// `endpoint`, window.SITE.formEndpoint. This is the only place a site's
// scripts run, inside Chrome's sandbox. Outside requests are blocked as usual.
async function readPage(url, { endpoint = false } = {}) {
  const page = new URL(url).pathname.replace(/^\/$/, "/index.html").slice(1);
  const out = { page: { metas: [], problems: [] }, endpoint: null, endpointProblems: [] };
  const p = await newPage();
  const within = (promise) => Promise.race([promise, sleep(10000).then(() => { throw new Error("no answer within 10 s"); })]);
  try {
    const loaded = new Promise((r) => p.c.on((m) => { if (m.method === "Page.loadEventFired") r(); }));
    await p.c.send("Page.navigate", { url });
    await within(loaded);
    const read = await within(p.evalRead("readCspMetas()"));
    const want = new URL(url);
    if (read.url !== want.origin + want.pathname) out.page.problems.push(`${page}: the page moved to ${read.url} while it was read`);
    out.page.problems.push(...read.changes.map((x) => `${page}: ${x}`));
    out.page.metas = read.metas;
    if (endpoint) {
      const r = await within(p.evalJS(`(() => { const v = window.SITE?.formEndpoint; return typeof v === "string" ? { value: v } : { type: v === undefined ? "missing" : "not a string" }; })()`));
      if ("value" in r) out.endpoint = r.value;
      else {
        const errors = p.logs.filter((l) => l.type === "exception").map((l) => l.text);
        out.endpointProblems.push(`window.SITE.formEndpoint is ${r.type} in the loaded page${errors.length ? ` (site-config.js errors: ${errors.join(" | ")})` : ""}`);
      }
    }
  } catch (err) {
    out.page.problems.push(`${page}: couldn't be read in the browser: ${err.message}`);
    if (endpoint) out.endpointProblems.push(`formEndpoint couldn't be read from the loaded page: ${err.message}`);
  } finally {
    await p.close();
  }
  return out;
}

// What policyChecks() needs from the browser, for the site served at `base`.
async function readSite(base) {
  const index = await readPage(`${base}/`, { endpoint: true });
  const notFound = await readPage(`${base}/404.html`);
  return { endpoint: index.endpoint, endpointProblems: index.endpointProblems, pages: { "index.html": index.page, "404.html": notFound.page } };
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
  check(`[${label}] no requests to other hosts`, p.blocked.length === 0, p.blocked.join(", "));
  const warnings = p.logs.filter((l) => l.type === "warning");
  check(`[${label}] no console warnings (the CSP build warns about expressions it can't run)`, warnings.length === 0, warnings.map((x) => x.text).join(" | "));
  p.c.close();
}

// The client's own endpoint: set, a public https URL, and allowed by both CSPs.
// siteReads: what the browser read from the client's page (readSite()).
function clientConfigChecks(siteReads) {
  const value = siteReads.endpoint ?? "";
  let url = null;
  try { url = new URL(value.trim()); } catch {}
  check("[client config] formEndpoint is set", value.trim() !== "", "formEndpoint is empty: the form would show an error on the live site");
  check("[client config] formEndpoint is a full https:// URL with no credentials",
    !!url && url.protocol === "https:" && !!url.hostname && !url.username && !url.password, `formEndpoint is "${value}"`);
  if (url) {
    const { meta, header } = readPolicies(SITE);
    for (const [label, csp] of [["index.html", meta], ["_headers", header]]) {
      const sources = csp?.["connect-src"] || [];
      check(`[client config] connect-src allows the form endpoint's origin (${label})`, sources.includes(url.origin), `connect-src is "${sources.join(" ")}", needs ${url.origin}`);
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
  // The test blocks every outside request itself; those show up as
  // ERR_BLOCKED_BY_CLIENT and are judged by the request check below instead.
  const errs = p.logs.filter((l) => ["error", "exception", "log-error"].includes(l.type) && !/404|ERR_BLOCKED_BY_CLIENT/.test(l.text));
  check("[client page] no console errors on load", errs.length === 0, errs.map((x) => x.text).join(" | "));
  // Requests to origins passed with --allow are expected (they're still
  // blocked, so the test never contacts them). Anything else fails.
  const allowedOrigins = ALLOWS.flatMap((a) => a.trim().split(/\s+/).slice(1)).filter((t) => /^https:\/\/[^/]+$/.test(t));
  const expected = p.blocked.filter((u) => allowedOrigins.some((o) => u.startsWith(o + "/")));
  const unexpected = p.blocked.filter((u) => !expected.includes(u));
  const warnings = p.logs.filter((l) => l.type === "warning");
  check("[client page] no console warnings on load", warnings.length === 0, warnings.map((x) => x.text).join(" | "));
  check("[client page] no requests to other hosts on load, except --allow origins", unexpected.length === 0, `the page tried to load: ${unexpected.join(", ")}`);
  if (expected.length) console.log(`      (requests to --allow origins, blocked by the test as expected: ${expected.join(", ")})`);
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

// The page's policy must block eval (the site runs on Alpine's CSP build).
// Code run through the debugging protocol isn't subject to the page's CSP, so
// the probe is a script the page loads itself. The control run, with CSP
// bypassed, must report "allowed", which shows the probe can tell the difference.
async function evalBlockedSuite() {
  const probe = async (url, options) => {
    const p = await newPage(options);
    await p.goto(url);
    await p.evalJS(`(() => { const s = document.createElement('script'); s.src = '/__eval-probe.js'; document.head.append(s); })()`);
    await sleep(300);
    const result = await p.evalJS("window.__evalProbe || 'did not run'");
    p.c.close();
    return result;
  };
  check("[eval] blocked by the index.html policy", (await probe("http://localhost:8765/")) === "blocked");
  check("[eval] blocked by the _headers policy", (await probe("http://localhost:8766/")) === "blocked");
  check("[eval] control: the probe detects eval when there's no policy", (await probe("http://localhost:8765/", { bypassCSP: true })) === "allowed");
}

// Template mode only: walk the page with the keyboard (Tab, Enter, Space,
// arrows, Esc) and check the accessibility behaviour listed in the docs.
async function keyboardSuite() {
  const TAB = ["Tab", "Tab", 9];
  const ENTER = ["Enter", "Enter", 13, { text: "\r" }];
  const SPACE = [" ", "Space", 32, { text: " " }];
  const ESC = ["Escape", "Escape", 27];
  const describe = `(() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
    return a.id ? '#' + a.id : '.' + [...a.classList].join('.') + (a.textContent.trim() ? ' ' + a.textContent.trim().slice(0, 20) : ''); })()`;
  const tabTo = async (p, selector, max = 80) => {
    for (let n = 0; n < max; n++) {
      if (await p.evalJS(`document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`)) return true;
      await p.key(...TAB);
    }
    return false;
  };

  // Wide screen: the whole tab order.
  {
    const p = await newPage();
    await p.c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.goto("http://localhost:8766/");
    const order = [];
    for (let n = 0; n < 40; n++) { await p.key(...TAB); order.push(await p.evalJS(describe)); }
    check("[keyboard] first Tab reaches the skip link", order[0].startsWith(".skip-link"), order[0]);
    const want = [".skip-link", ".brand", "Menu", "Hours", "FAQ", "Contact", ".button Get in touch", "See hours", ".filter-button", ".showcase-thumb", "#faq-q-0", "#name", "#email", "#phone", "#message", ".button Send message"];
    let pos = 0;
    for (const d of order) if (pos < want.length && d.includes(want[pos])) pos++;
    check("[keyboard] tab order: skip link, nav, hero, filters, photos, FAQ, form fields, send", pos === want.length, `stopped before "${want[pos]}"; order was: ${order.join(" → ")}`);
    check("[keyboard] the honeypot is never focused", !order.includes("#hp_field"));

    // Skip link moves to the main content.
    await p.goto("http://localhost:8766/");
    await p.key(...TAB); await p.key(...ENTER); await sleep(100); await p.key(...TAB);
    const afterSkip = await p.evalJS(describe);
    check("[keyboard] skip link jumps past the header", afterSkip.includes("Get in touch"), afterSkip);

    // Filters: aria-pressed follows the active category.
    await tabTo(p, ".filter-button:nth-of-type(2)");
    await p.key(...ENTER); await sleep(150);
    check("[keyboard] Enter on a filter selects it (aria-pressed)", await p.evalJS(`[...document.querySelectorAll('.filter-button')].map(b => b.getAttribute('aria-pressed')).join() === 'false,true,false'`),
      await p.evalJS(`[...document.querySelectorAll('.filter-button')].map(b => b.getAttribute('aria-pressed')).join()`));
    check("[keyboard] filters are a labelled group", await p.evalJS(`(() => { const g = document.querySelector('.showcase-filters'); return g.getAttribute('role') === 'group' && !!g.getAttribute('aria-label'); })()`));

    // Lightbox: opens on Enter, traps focus, arrows, Esc, focus returns.
    check("[keyboard] photo buttons have hidden 'Enlarge photo' text", await p.evalJS(`document.querySelector('.showcase-thumb .sr-only').textContent.startsWith('Enlarge photo: ')`));
    await tabTo(p, ".showcase-thumb");
    await p.key(...ENTER); await sleep(500);
    check("[keyboard] Enter on a photo opens the lightbox dialog", await p.evalJS(`(() => { const d = document.querySelector('.lightbox'); return getComputedStyle(d).display !== 'none' && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true'; })()`));
    let trapped = true;
    for (let n = 0; n < 6; n++) { await p.key(...TAB); trapped &&= await p.evalJS(`document.querySelector('.lightbox').contains(document.activeElement)`); }
    check("[keyboard] Tab stays inside the open lightbox", trapped);
    const cap = await p.evalJS(`document.querySelector('.lightbox figcaption span').textContent`);
    await p.key("ArrowRight", "ArrowRight", 39); await sleep(100);
    check("[keyboard] arrow keys move between photos", (await p.evalJS(`document.querySelector('.lightbox figcaption span').textContent`)) !== cap);
    await p.key(...ESC); await sleep(600);
    check("[keyboard] Esc closes the lightbox and focus returns to the photo",
      await p.evalJS(`getComputedStyle(document.querySelector('.lightbox')).display === 'none' && document.activeElement.matches('.showcase-thumb')`), await p.evalJS(describe));

    // FAQ: Enter opens, Space closes; ids and labels line up.
    await tabTo(p, ".faq-question");
    await p.key(...ENTER); await sleep(400);
    check("[keyboard] Enter opens an FAQ answer (aria-expanded, labelled region)", await p.evalJS(`(() => {
      const q = document.activeElement, a = document.getElementById(q.getAttribute('aria-controls'));
      return q.closest('h3') !== null && q.getAttribute('aria-expanded') === 'true' && !!a && a.getAttribute('role') === 'region'
        && a.getAttribute('aria-labelledby') === q.id && getComputedStyle(a).display !== 'none'; })()`));
    await p.key(...SPACE); await sleep(400);
    check("[keyboard] Space closes it again", await p.evalJS(`document.activeElement.getAttribute('aria-expanded') === 'false'`));

    // Form: leaving an empty field shows its error; submit moves focus to the first invalid field.
    await tabTo(p, "#name"); await p.key(...TAB); await sleep(150);
    check("[keyboard] leaving an empty field shows its error (aria-invalid, aria-describedby)", await p.evalJS(`(() => {
      const f = document.getElementById('name'), err = document.getElementById(f.getAttribute('aria-describedby'));
      return f.getAttribute('aria-invalid') === 'true' && getComputedStyle(err).display !== 'none' && document.querySelector('label[for=name]') !== null; })()`));
    await tabTo(p, ".contact-form button[type=submit]");
    await p.key(...ENTER); await sleep(300);
    check("[keyboard] submitting with errors moves focus to the first invalid field", (await p.evalJS(describe)) === "#name", await p.evalJS(describe));
    await p.c.send("Input.insertText", { text: "Ada Lovelace" });
    await p.key(...TAB); await p.c.send("Input.insertText", { text: "ada@example.com" });
    await p.key(...TAB); await p.key(...TAB); await p.c.send("Input.insertText", { text: "Hello, a table for ten please." });
    await tabTo(p, ".contact-form button[type=submit]");
    await p.key(...ENTER); await sleep(400);
    check("[keyboard] the form can be filled and sent by keyboard; status is announced (role=status)",
      await p.evalJS(`(() => { const s = document.querySelector('.form-status'); return s.getAttribute('role') === 'status' && getComputedStyle(s.querySelector('.is-success')).display !== 'none'; })()`));
    p.c.close();
  }

  // Narrow screen: the menu button.
  {
    const p = await newPage();
    await p.c.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 800, deviceScaleFactor: 1, mobile: true });
    await p.goto("http://localhost:8766/");
    const ok = await tabTo(p, ".nav-toggle", 10);
    check("[keyboard] narrow screen: the menu button is reachable and labelled", ok && await p.evalJS(`(() => { const b = document.activeElement;
      return b.getAttribute('aria-controls') === 'site-nav' && b.getAttribute('aria-expanded') === 'false' && b.querySelector('.sr-only').textContent === 'Menu'; })()`));
    await p.key(...ENTER); await sleep(150);
    check("[keyboard] Enter opens the menu (aria-expanded)", await p.evalJS(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'true' && document.getElementById('site-nav').classList.contains('is-open')`));
    await p.key(...TAB);
    check("[keyboard] Tab moves into the open menu", (await p.evalJS(describe)).includes("Menu"), await p.evalJS(describe));
    await p.key(...ESC); await sleep(150);
    check("[keyboard] Esc closes the menu", await p.evalJS(`document.querySelector('.nav-toggle').getAttribute('aria-expanded') === 'false'`));
    p.c.close();
  }
}

// Template mode only: a mistake in site-config.js must only affect the part of
// the page it belongs to. In every case the rest of the page, and above all the
// contact form, must keep working, and the mistake must be reported once in
// the console.
async function brokenConfigSuite() {
  // Tolerate missing elements here, so a page that failed to start shows up as
  // failed checks rather than stopping the run.
  const SUBMIT_IF_PRESENT = `document.querySelector('.contact-form button[type=submit]')?.click()`;
  const FILL_IF_PRESENT = (vals) => `document.getElementById('name') ? ${FILL(vals)} : false`;
  const cases = [
    ["opening time \"7am\"", (s) => s.replace('mon: [{ open: "07:00"', 'mon: [{ open: "7am"'), 'hours.mon[0].open: invalid time "7am"', { hours: false }],
    ["misspelled time zone", (s) => s.replace('timeZone: "America/Los_Angeles"', 'timeZone: "America/Portland"'), 'timeZone "America/Portland" isn\'t a valid', { hours: false }],
    ["unknown day name", (s) => s.replace("    mon: [", "    monday: ["), "hours.monday: unknown day", { hours: false }],
    ["faqs isn't a list", (s) => s.replace("  faqs: [", '  faqs: "see below",\n  unusedFaqs: ['), "faqs in site-config.js must be a list", { faq: false }],
    ["site-config.js fails to load", () => null, "site-config.js didn't load", { hours: false, faq: false, menu: false }],
    // A typo that breaks the file's syntax: the browser reports the syntax
    // error itself, then the page carries on as if the file were missing.
    ["syntax error in site-config.js", (s) => s.replace("  faqs: [", "  faqs: [[;"), "site-config.js didn't load", { hours: false, faq: false, menu: false, syntaxError: true }],
  ];
  for (const [label, patch, expectedError, broken] of cases) {
    const p = await newPage({ configPatch: patch });
    await p.goto("http://localhost:8765/");
    const e = p.evalJS;
    const tag = `[broken config: ${label}]`;
    const errors = p.logs.filter((l) => l.type === "error");
    const exceptions = p.logs.filter((l) => l.type === "exception");
    check(`${tag} reported once in the console`, errors.length === 1 && errors[0].text.includes(expectedError),
      errors.map((x) => x.text).join(" | ") || "nothing reported");
    if (broken.syntaxError) {
      check(`${tag} only the file's own syntax error is uncaught`, exceptions.length === 1 && /SyntaxError/.test(exceptions[0].text), exceptions.map((x) => x.text).join(" | "));
    } else {
      check(`${tag} no uncaught exceptions`, exceptions.length === 0, exceptions.map((x) => x.text).join(" | "));
    }
    const visible = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && getComputedStyle(el).display !== 'none'; })()`;
    if (broken.hours === false) {
      check(`${tag} hours badge and table hidden, fallback shown`,
        !(await e(visible(".status-badge"))) && !(await e(visible(".hours-table"))) && (await e(visible(".hours-unavailable"))));
    }
    // Everything else still works.
    await e(`document.querySelector('.nav-toggle')?.click()`); await sleep(100);
    check(`${tag} nav still works`, await e(`document.getElementById('site-nav').classList.contains('is-open')`));
    await p.key("Escape", "Escape", 27); await sleep(100);
    if (broken.faq !== false) {
      await e(`document.querySelector('.faq-question')?.click()`); await sleep(300);
      check(`${tag} FAQ still works`, await e(`document.querySelector('.faq-question')?.getAttribute('aria-expanded') === 'true'`));
    }
    if (broken.menu !== false) {
      check(`${tag} menu still shows items`, (await e(`document.querySelectorAll('.showcase-item').length`)) > 0);
    }
    if (broken.hours !== false) {
      check(`${tag} hours still shown`, (await e(visible(".status-badge"))) && (await e(`document.querySelectorAll('.hours-table tbody tr').length`)) === 7);
    }
    await e(SUBMIT_IF_PRESENT); await sleep(200);
    check(`${tag} contact form still validates`, (await e(`[...document.querySelectorAll('.field-error')].filter(x=>getComputedStyle(x).display!=='none').length`)) === 3);
    await e(FILL_IF_PRESENT(GOOD)); await e(SUBMIT_IF_PRESENT); await sleep(300);
    check(`${tag} contact form still submits`, (await e(STATUS)) === "is-success");
    p.c.close();
  }
}

// Template mode only: prove the client checks catch weakened copies. Each case
// starts from a correctly configured client copy (a form endpoint, and its
// origin added to connect-src in both CSP copies), which must pass. Then one
// change is made per case, and the checks must report at least one problem.
// Each copy is served on its own port and read in the browser, like a client's.
let copyRoot = null;
const COPY_PORT = 8767;
const readCopy = (dir) => { copyRoot = dir; return readSite(`http://localhost:${COPY_PORT}`); };
async function weakenedCopySuite() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-copy-"));
  const edit = (dir, rel, fn) => { const f = path.join(dir, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, "utf8"))); };
  const bothCsps = (dir, fn) => {
    edit(dir, "index.html", (s) => s.replace(/(http-equiv="Content-Security-Policy" content=")([^"]+)"/, (_, a, csp) => `${a}${fn(csp)}"`));
    edit(dir, "_headers", (s) => s.replace(/(Content-Security-Policy: )(.+)/, (_, a, csp) => a + fn(csp)));
  };
  const makeClient = (name) => {
    const dir = path.join(tmp, name);
    fs.cpSync(SITE, dir, { recursive: true });
    edit(dir, "js/site-config.js", (s) => s.replace(ENDPOINT_RE, 'formEndpoint: "https://forms.example/f/abc"'));
    bothCsps(dir, (csp) => csp.replace("connect-src 'self'", "connect-src 'self' https://forms.example"));
    return dir;
  };
  const problemsFor = async (dir, allows = []) => [
    ...policyChecks(dir, SITE, allows, { pageReads: await readCopy(dir) }).groups.flatMap((g) => g.problems),
    ...folderProblems(dir),
    ...vendorProblems(dir),
  ];
  // CSP meta tags that read one way as text and another way in the browser.
  // The "weak" policy adds https://evil.example to script-src.
  const META_TAG = /<meta http-equiv="Content-Security-Policy"[^>]*>/;
  const widen = (csp) => csp.replace("script-src 'self'", "script-src 'self' https://evil.example");
  const metaTrick = (fn) => (d) => edit(d, "index.html", (s) => s.replace(META_TAG, (tag) => fn(tag, widen(tag))));
  const twoContents = (tag) => tag.replace(/content="([^"]*)"/, (_, csp) => `content="${widen(csp)}" content="${csp}"`);
  const strictContent = (d) => fs.readFileSync(path.join(d, "index.html"), "utf8").match(META_TAG)[0].match(/content="([^"]*)"/)[1];

  try {
    const clean = makeClient("clean");
    const cleanProblems = await problemsFor(clean);
    check("[weakened copies] a correctly configured client copy passes", cleanProblems.length === 0, cleanProblems.join("\n        "));

    // Remove one header line from the "/*" block (spaces/tabs only, so the
    // line break before it is kept and the file stays well-formed).
    const headerLine = (name) => (dir) => edit(dir, "_headers", (s) => s.replace(new RegExp(`^[ \\t]+${name}:.*\\r?\\n`, "m"), ""));
    // [label, change, text the reported problem must contain]
    const cases = [
      ["any https: script allowed (both copies)", (d) => bothCsps(d, (c) => c.replace("script-src 'self'", "script-src 'self' https:")), 'scheme-wide source "https:"'],
      ["third-party script host added (both copies)", (d) => bothCsps(d, (c) => c.replace("script-src 'self'", "script-src 'self' https://cdn.example")), 'script-src adds "https://cdn.example"'],
      ["frame-ancestors *", (d) => edit(d, "_headers", (s) => s.replace("frame-ancestors 'none'", "frame-ancestors *")), "frame-ancestors must be 'none'"],
      ["X-Frame-Options removed", headerLine("X-Frame-Options"), 'X-Frame-Options is "(missing)"'],
      ["X-Content-Type-Options removed", headerLine("X-Content-Type-Options"), 'X-Content-Type-Options is "(missing)"'],
      ["Referrer-Policy removed", headerLine("Referrer-Policy"), 'Referrer-Policy is "(missing)"'],
      ["Permissions-Policy removed", headerLine("Permissions-Policy"), 'Permissions-Policy is "(missing)"'],
      ["Cross-Origin-Opener-Policy removed", headerLine("Cross-Origin-Opener-Policy"), 'Cross-Origin-Opener-Policy is "(missing)"'],
      ["HSTS shortened to 5 minutes", (d) => edit(d, "_headers", (s) => s.replace(/Strict-Transport-Security: .*/, "Strict-Transport-Security: max-age=300")), 'Strict-Transport-Security is "max-age=300"'],
      ["extra connect-src origin (both copies)", (d) => bothCsps(d, (c) => c.replace("connect-src 'self'", "connect-src 'self' https://evil.example")), 'connect-src adds "https://evil.example"'],
      ["default-src removed (both copies)", (d) => bothCsps(d, (c) => c.replace("default-src 'self'; ", "")), "default-src was removed"],
      ["'unsafe-eval' added back (both copies)", (d) => bothCsps(d, (c) => c.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")), "contains 'unsafe-eval'"],
      ["'unsafe-inline' styles (both copies)", (d) => bothCsps(d, (c) => c.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")), "style-src contains 'unsafe-inline'"],
      ["CSP changed in _headers only", (d) => edit(d, "_headers", (s) => s.replace("img-src 'self'", "img-src 'self' https://img.example")), "img-src: index.html"],
      ["second _headers block loosens the CSP for one page", (d) => edit(d, "_headers", (s) => s + "\n/index.html\n  Content-Security-Policy: default-src *\n"), '"/index.html" overrides Content-Security-Policy'],
      ["header repeated in the \"/*\" block", (d) => edit(d, "_headers", (s) => s.replace(/(^[ \t]+X-Frame-Options: .*$)/m, "$1\n  X-Frame-Options: SAMEORIGIN")), "sets X-Frame-Options more than once"],
      [".git/ folder copied in", (d) => { fs.mkdirSync(path.join(d, ".git")); fs.writeFileSync(path.join(d, ".git", "config"), "[core]\n"); }, ".git/: dotfiles"],
      [".env file", (d) => fs.writeFileSync(path.join(d, ".env"), "API_KEY=x\n"), ".env: dotfiles"],
      ["notes file at the top level", (d) => fs.writeFileSync(path.join(d, "NOTES.md"), "internal\n"), "NOTES.md: not part of the site"],
      ["backup of site-config.js", (d) => fs.copyFileSync(path.join(d, "js", "site-config.js"), path.join(d, "js", "site-config.js.bak")), "site-config.js.bak: this kind of file"],
      ["extra script in js/", (d) => fs.writeFileSync(path.join(d, "js", "analytics.js"), "\n"), "js/analytics.js: js/ may only hold"],
      ["SVG with a script", (d) => fs.writeFileSync(path.join(d, "images", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "logo.svg: SVG contains a script"],
      ["SVG with an event attribute", (d) => fs.writeFileSync(path.join(d, "images", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), "logo.svg: SVG contains a script"],
      ["vendor file changed by one byte", (d) => fs.appendFileSync(path.join(d, "js", "vendor", Object.keys(VENDOR_SHA384)[0]), " "), "SHA-384 is"],
      // The policy must be read the way the browser reads it.
      ["commented-out CSP meta tag above a widened real one", (d) => edit(d, "index.html", (s) => s.replace(/(\s*)(<meta http-equiv="Content-Security-Policy"[^>]*>)/,
        (_, ws, tag) => `${ws}<!-- ${tag} -->${ws}${tag.replace("script-src 'self'", "script-src 'self' https://evil.example")}`)), 'index.html: script-src adds "https://evil.example"'],
      ["second CSP meta tag", (d) => edit(d, "index.html", (s) => s.replace(/(<meta http-equiv="Content-Security-Policy"[^>]*>)/, "$1\n  $1")), "exactly one Content-Security-Policy meta tag outside comments (found 2)"],
      ["repeated directive, looser copy first (both copies)", (d) => bothCsps(d, (c) => "script-src 'self' https://evil.example; " + c), "script-src appears more than once"],
      ["repeated frame-ancestors, * first (_headers)", (d) => edit(d, "_headers", (s) => s.replace("Content-Security-Policy: ", "Content-Security-Policy: frame-ancestors *; ")), `frame-ancestors must be 'none' (is "*")`],
      ["commented-out old formEndpoint in site-config.js", (d) => edit(d, "js/site-config.js", (s) => s.replace("  formEndpoint:", '  // formEndpoint: "https://old-provider.example/f/1",\n  formEndpoint:')), "mentions formEndpoint 2 times"],
      ["formEndpoint changed later in site-config.js", (d) => fs.appendFileSync(path.join(d, "js", "site-config.js"), '\nwindow.SITE.formEndpoint = "https://other.example/f/2";\n'), "mentions formEndpoint 2 times"],
      ["'UNSAFE-INLINE' in upper case, with --allow (both copies)", (d) => bothCsps(d, (c) => c.replace("style-src 'self'", "style-src 'self' 'UNSAFE-INLINE'")), "style-src contains 'unsafe-inline'", ["style-src 'UNSAFE-INLINE'"]],
      ["'Unsafe-Eval' in mixed case, with --allow (both copies)", (d) => bothCsps(d, (c) => c.replace("script-src 'self'", "script-src 'self' 'Unsafe-Eval'")), "script-src contains 'unsafe-eval'", ["script-src 'Unsafe-Eval'"]],
      ["a keyword passed with --allow ('strict-dynamic')", (d) => bothCsps(d, (c) => c.replace("script-src 'self'", "script-src 'self' 'strict-dynamic'")), `"'strict-dynamic'" isn't a host source`, ["script-src 'strict-dynamic'"]],
      ["_redirects proxies a path to another host", (d) => fs.appendFileSync(path.join(d, "_redirects"), "/api/*  https://collector.example/:splat  200!\n"), "points to another host: /api/*"],
      ["_redirects sends a path to another host (301)", (d) => fs.appendFileSync(path.join(d, "_redirects"), "/order  //shop.example/  301\n"), "points to another host: /order"],
      ["_redirects rewrites a script path (200)", (d) => fs.appendFileSync(path.join(d, "_redirects"), "/js/extra.js  /images/photo-1.svg  200\n"), "is a 200 rewrite or proxy: /js/extra.js"],
      // The meta tag the browser applies must be the one the file reading found.
      ["CSP meta tag with two content attributes, the weaker first (browsers use the first)", metaTrick(twoContents), "index.html: the browser reads a different Content-Security-Policy meta tag"],
      ["weak CSP meta tag after <!--->, strict copy inside <template>", metaTrick((tag, weak) => `<!---> ${weak} <!-- -->\n  <template>${tag}</template>`), "index.html: the browser reads a different Content-Security-Policy meta tag"],
      ["weak CSP meta tag after a comment closed with --!>, strict copy inside <noscript>", metaTrick((tag, weak) => `<!-- old --!> ${weak} <!-- -->\n  <noscript>${tag}</noscript>`), "index.html: the browser reads a different Content-Security-Policy meta tag"],
      ["site-config.js rewrites the applied meta tag to match the file", (d) => {
        const strict = strictContent(d);
        metaTrick(twoContents)(d);
        fs.appendFileSync(path.join(d, "js", "site-config.js"), `\ndocument.querySelector('meta[http-equiv="Content-Security-Policy"]').setAttribute("content", ${JSON.stringify(strict)});\n`);
      }, "a script changed the content attribute of a <meta> tag"],
      ["CSP meta tag moved into <body>, where browsers ignore it", (d) => edit(d, "index.html", (s) => { const tag = s.match(META_TAG)[0]; return s.replace(tag, "").replace(/<body[^>]*>/, (b) => `${b}\n  ${tag}`); }), "index.html: a Content-Security-Policy meta tag is outside <head>"],
      // 404.html has its own, stricter policy.
      ["404.html allows inline scripts", (d) => edit(d, "404.html", (s) => s.replace("script-src 'none'", "script-src 'unsafe-inline'")), "404.html: script-src contains 'unsafe-inline'"],
      ["404.html may connect to another host", (d) => edit(d, "404.html", (s) => s.replace("connect-src 'none'", "connect-src https://evil.example")), '404.html: connect-src adds "https://evil.example"'],
      ["404.html without its CSP meta tag", (d) => edit(d, "404.html", (s) => s.replace(META_TAG, "")), "404.html must have exactly one Content-Security-Policy meta tag outside comments (found 0)"],
      ["404.html: weak CSP meta tag after <!--->, strict copy inside <template>", (d) => edit(d, "404.html", (s) => s.replace(META_TAG, (tag) => `<!---> ${tag.replace("script-src 'none'", "script-src 'unsafe-inline'")} <!-- -->\n  <template>${tag}</template>`)), "404.html: the browser reads a different Content-Security-Policy meta tag"],
    ];
    for (const [i, [label, weaken, expected, caseAllows = []]] of cases.entries()) {
      const dir = makeClient(`case-${i}`);
      weaken(dir);
      const problems = await problemsFor(dir, caseAllows);
      check(`[weakened copies] fails: ${label}`, problems.some((p) => p.includes(expected)),
        problems.length ? `expected a problem containing "${expected}"; got: ${problems.join(" | ")}` : "no problem reported");
    }

    // --allow: an intended exception passes only when it's passed explicitly,
    // an unused exception fails, and the hard limits can't be allowed away.
    const fonts = makeClient("fonts");
    bothCsps(fonts, (c) => c.replace("style-src 'self'", "style-src 'self' https://fonts.example"));
    check("[weakened copies] an extra source without --allow fails", (await problemsFor(fonts)).length > 0, "no problem reported");
    const allowed = await problemsFor(fonts, ["style-src https://fonts.example"]);
    check("[weakened copies] the same source with --allow passes", allowed.length === 0, allowed.join("\n        "));
    check("[weakened copies] an unused --allow fails", (await problemsFor(clean, ["style-src https://fonts.example"])).length > 0, "no problem reported");
    const inline = makeClient("inline");
    bothCsps(inline, (c) => c.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"));
    check("[weakened copies] 'unsafe-inline' fails even with --allow", (await problemsFor(inline, ["style-src 'unsafe-inline'"])).length > 0, "no problem reported");
    const block = makeClient("block");
    edit(block, "_headers", (s) => s + "\n/images/*\n  Cross-Origin-Resource-Policy: cross-origin\n");
    check("[weakened copies] a per-path security header passes only with --allow",
      (await problemsFor(block)).length > 0 && (await problemsFor(block, ["header /images/* Cross-Origin-Resource-Policy"])).length === 0, "not handled as expected");

    // The endpoint is the one the browser uses, not the first line that mentions it.
    const commented = makeClient("commented-endpoint");
    edit(commented, "js/site-config.js", (s) => s.replace("  formEndpoint:", '  // formEndpoint: "https://old-provider.example/f/1",\n  formEndpoint:'));
    const commentedRead = (await readCopy(commented)).endpoint;
    check("[weakened copies] formEndpoint is read from the loaded page, not from a comment",
      commentedRead === "https://forms.example/f/abc", `read "${commentedRead}"`);

    // site-config.js only ever runs in the browser. Code that would write a
    // file if it ran in Node (it can't break out of Chrome) must write nothing,
    // and the copy must still pass.
    const marker = path.join(tmp, "written-by-site-config.txt");
    const probe = makeClient("node-probe");
    fs.appendFileSync(path.join(probe, "js", "site-config.js"),
      `\ntry { this.constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "x"); } catch (e) {}\n`);
    const probeProblems = await problemsFor(probe);
    check("[weakened copies] site-config.js never runs in Node (code that would write a file there writes nothing)",
      !fs.existsSync(marker) && probeProblems.length === 0, fs.existsSync(marker) ? `${marker} was written` : probeProblems.join(" | "));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }
  if (!fs.existsSync(path.join(SITE, "index.html"))) throw new Error(`No index.html in ${SITE}`);
  console.log(`${CLIENT_MODE ? "Client mode (security and deployment checks)" : "Template mode (full suite)"}: ${SITE}\n`);

  const plain = await startServer(8765, false);
  const withHeaders = await startServer(8766, true);
  const copies = CLIENT_MODE ? null : await startServer(COPY_PORT, false, () => copyRoot);
  const siteReads = await readSite("http://localhost:8765");

  if (!CLIENT_MODE) {
    // Template-only: these depend on the sample content (menu, photos, FAQ).
    const fileUrl = "file:///" + path.join(SITE, "index.html").replace(/\\/g, "/");
    await componentSuite("file://", fileUrl);
    await componentSuite("localhost server", "http://localhost:8765/");
    await componentSuite("_headers applied", "http://localhost:8766/");
    await brokenConfigSuite();
    await keyboardSuite();
  } else {
    // Client-only: the client's own endpoint and page.
    clientConfigChecks(siteReads);
    await clientSmoke();
  }

  // Security and deployment checks: must pass for the template and every client copy.
  const vendor = vendorProblems(SITE);
  check("[vendor] js/vendor/ holds exactly the verified Alpine files", vendor.length === 0, vendor.join("\n        "));
  const policy = policyChecks(SITE, TEMPLATE_SITE, ALLOWS, { exactHsts: !CLIENT_MODE, pageReads: siteReads });
  checkGroups("[policy]", policy.groups);
  const folder = folderProblems(SITE);
  check("[folder] only site files, nothing that shouldn't be public", folder.length === 0, folder.join("\n        "));
  if (CLIENT_MODE && policy.usedAllows.length) {
    console.log(`\n      Exceptions allowed with --allow (record each one, with the reason, in the client register):\n        ${policy.usedAllows.join("\n        ")}\n`);
  }
  await evalBlockedSuite();
  await formSecuritySuite();
  if (!CLIENT_MODE) await weakenedCopySuite();
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

  plain.close(); withHeaders.close(); copies?.close();
} catch (err) {
  console.error("HARNESS ERROR", err);
  results.push({ ok: false });
} finally {
  chrome.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
