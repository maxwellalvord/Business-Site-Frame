// File-based security checks for a copy of site/: security headers, both
// Content-Security-Policy copies, the folder contents and the vendor files.
// No browser needed. Used by browser-test.mjs in both template and client mode.
//
// Every function takes the site folder to check and returns a list of
// problems (plain strings). An empty list means the check passed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Expected SHA-384 of every file in js/vendor/. When upgrading Alpine, update
// this table (see "Upgrading Alpine" in the docs).
export const VENDOR_SHA384 = {
  "alpine-3.14.1.min.js": "l8f0VcPi/M1iHPv8egOnY/15TDwqgbOR1anMIJWvU6nLRgZVLTLSaNqi/TOoT5Fh",
  "alpine-focus-3.14.1.min.js": "bKXNU7o2Y3Uk/F2PB6U0bMyGZf6pLDnePM70U7sTE3cXUQ+JLgzrr/kwipEh0p23",
};

// Headers every site must send from its "/*" block, with exactly these values.
// Strict-Transport-Security is checked separately: a client may add
// includeSubDomains once every subdomain serves HTTPS.
export const REQUIRED_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const SECURITY_HEADERS = ["Content-Security-Policy", "Strict-Transport-Security", ...Object.keys(REQUIRED_HEADERS)];

// CSP directives that only work as an HTTP header, so appear only in _headers.
export const HEADER_ONLY_DIRECTIVES = ["frame-ancestors", "upgrade-insecure-requests"];

export const ENDPOINT_RE = /formEndpoint\s*:\s*(["'`])(.*?)\1/;

// ---------- parsing ----------

// _headers as blocks: [{ path, headers: [[name, value], ...] }], in file order.
export function parseHeadersBlocks(siteDir) {
  const file = path.join(siteDir, "_headers");
  if (!fs.existsSync(file)) return { blocks: [], problems: ["_headers is missing"] };
  const blocks = [];
  const problems = [];
  for (const [i, line] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      blocks.push({ path: line.trim(), headers: [] });
      continue;
    }
    const m = line.match(/^\s+([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m) problems.push(`_headers line ${i + 1} isn't "Name: value": ${line.trim()}`);
    else if (!blocks.length) problems.push(`_headers line ${i + 1} is a header outside any path block`);
    else blocks.at(-1).headers.push([m[1], m[2].trim()]);
  }
  return { blocks, problems };
}

// The "/*" block as a { name: value } map (what the host sends for index.html).
export function siteWideHeaders(siteDir) {
  const block = parseHeadersBlocks(siteDir).blocks.find((b) => b.path === "/*");
  return Object.fromEntries(block ? block.headers : []);
}

export function parseCsp(csp) {
  const map = {};
  for (const d of (csp || "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const [name, ...values] = d.split(/\s+/);
    map[name.toLowerCase()] = values;
  }
  return map;
}

export function readPolicies(siteDir) {
  const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  return {
    meta: meta === undefined ? null : parseCsp(meta),
    header: parseCsp(siteWideHeaders(siteDir)["Content-Security-Policy"]),
  };
}

export function readEndpoint(siteDir) {
  const src = fs.readFileSync(path.join(siteDir, "js", "site-config.js"), "utf8");
  return src.match(ENDPOINT_RE)?.[2] ?? null;
}

// "--allow" values. Two forms:
//   "<csp-directive> <source> [<source> ...]"   e.g. "font-src https://fonts.gstatic.com"
//   "header <path> <Header-Name>"               e.g. "header /images/* Cache-Control"
export function parseAllows(list) {
  const csp = {};
  const headers = [];
  const problems = [];
  for (const raw of list) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === "header" && parts.length === 3) headers.push({ path: parts[1], name: parts[2], raw });
    else if (parts.length >= 2 && /^[a-z-]+$/.test(parts[0])) (csp[parts[0]] ||= []).push(...parts.slice(1));
    else problems.push(`can't read --allow "${raw}"`);
  }
  return { csp, headers, problems, raw: list };
}

// ---------- checks ----------

// Sources that are never acceptable, whatever --allow says, and directives
// whose value is fixed. Both are reported by hardFloorProblems().
const isForbiddenSource = (t) => t === "'unsafe-inline'" || t === "*" || /^[a-z][a-z0-9+.-]*:$/i.test(t);
const FIXED_DIRECTIVES = ["object-src", "base-uri", "frame-ancestors"];

function hardFloorProblems(label, csp, { headerCopy }) {
  const problems = [];
  if (!csp) return [`${label}: no Content-Security-Policy`];
  const want = { "object-src": "'none'", "base-uri": "'none'", ...(headerCopy ? { "frame-ancestors": "'none'" } : {}) };
  for (const [d, v] of Object.entries(want)) {
    if ((csp[d] || []).join(" ") !== v) problems.push(`${label}: ${d} must be ${v} (is "${(csp[d] || ["(missing)"]).join(" ")}")`);
  }
  for (const [d, tokens] of Object.entries(csp)) {
    for (const t of tokens) {
      if (t === "'unsafe-inline'") problems.push(`${label}: ${d} contains 'unsafe-inline'`);
      if (t === "*") problems.push(`${label}: ${d} contains the wildcard source "*"`);
      else if (/^[a-z][a-z0-9+.-]*:$/i.test(t)) problems.push(`${label}: ${d} contains the scheme-wide source "${t}" (allows any host)`);
    }
  }
  return problems;
}

// One CSP copy against the same copy in the template. Every directive must
// match the template, except:
//   - connect-src may add the form endpoint's origin (and nothing else)
//   - any directive may add sources passed with --allow
// Removing sources from a directive is allowed (it's stricter). Removing a
// whole directive isn't, because the browser then falls back to default-src.
function baselineProblems(label, csp, base, { endpointOrigin, allows, used }) {
  const problems = [];
  if (!csp || !base) return problems;
  for (const d of Object.keys(base)) {
    if (!(d in csp)) problems.push(`${label}: ${d} was removed (template: "${base[d].join(" ")}")`);
  }
  for (const [d, tokens] of Object.entries(csp)) {
    const baseTokens = base[d] || [];
    for (const t of tokens) {
      if (baseTokens.includes(t)) continue;
      if (isForbiddenSource(t) || FIXED_DIRECTIVES.includes(d)) continue; // a hard limit; can't be allowed
      if (d === "connect-src" && t === endpointOrigin) continue;
      if ((allows.csp[d] || []).includes(t)) { used.add(`${d} ${t}`); continue; }
      problems.push(`${label}: ${d} adds "${t}", which the template doesn't have (use --allow "${d} ${t}" if it's intended)`);
    }
  }
  return problems;
}

// All policy checks, grouped so the output names what failed.
// templateDir: the template's own site/ folder (the baseline).
export function policyChecks(siteDir, templateDir, allowList = [], { exactHsts = false } = {}) {
  const allows = parseAllows(allowList);
  const used = new Set();
  const groups = [];
  const add = (name, problems) => groups.push({ name, problems });

  const parsed = parseHeadersBlocks(siteDir);
  const blockProblems = [...parsed.problems];
  const siteWide = parsed.blocks.filter((b) => b.path === "/*");
  if (siteWide.length !== 1) blockProblems.push(`_headers must have exactly one "/*" block (found ${siteWide.length})`);
  for (const b of parsed.blocks) {
    const seen = new Set();
    for (const [name] of b.headers) {
      if (seen.has(name.toLowerCase())) blockProblems.push(`"${b.path}" sets ${name} more than once`);
      seen.add(name.toLowerCase());
      if (b.path !== "/*" && SECURITY_HEADERS.some((h) => h.toLowerCase() === name.toLowerCase())) {
        const allowed = allows.headers.find((a) => a.path === b.path && a.name.toLowerCase() === name.toLowerCase());
        if (allowed) used.add(allowed.raw);
        else blockProblems.push(`"${b.path}" overrides ${name}; security headers belong only in "/*" (use --allow "header ${b.path} ${name}" if it's intended)`);
      }
    }
  }
  add("_headers blocks are well-formed; security headers only in \"/*\"", blockProblems);

  const hdrs = siteWideHeaders(siteDir);
  add("security headers present with the template's values", Object.entries(REQUIRED_HEADERS)
    .filter(([n, v]) => hdrs[n] !== v)
    .map(([n, v]) => `${n} is "${hdrs[n] ?? "(missing)"}", must be "${v}"`));
  const hsts = hdrs["Strict-Transport-Security"] ?? "";
  const hstsMatch = hsts.match(/^max-age=(\d+)(; includeSubDomains)?$/);
  add(exactHsts ? "HSTS is the template default (no includeSubDomains)" : "HSTS is set for at least a year",
    exactHsts ? (hsts === "max-age=31536000" ? [] : [`Strict-Transport-Security is "${hsts}"`])
      : (hstsMatch && Number(hstsMatch[1]) >= 31536000 ? [] : [`Strict-Transport-Security is "${hsts || "(missing)"}"`]));

  const site = readPolicies(siteDir);
  const base = readPolicies(templateDir);
  const endpoint = readEndpoint(siteDir);
  let endpointOrigin = null;
  try { endpointOrigin = endpoint ? new URL(endpoint.trim()).origin : null; } catch {}

  add("CSP hard limits (both copies)", [
    ...hardFloorProblems("index.html", site.meta, { headerCopy: false }),
    ...hardFloorProblems("_headers", site.header, { headerCopy: true }),
  ]);
  const ctx = { endpointOrigin, allows, used };
  add("CSP matches the template, apart from the form endpoint and --allow exceptions", [
    ...baselineProblems("index.html", site.meta, base.meta, ctx),
    ...baselineProblems("_headers", site.header, base.header, ctx),
  ]);

  // The two copies must agree, apart from the header-only directives.
  const drift = [];
  if (site.meta && site.header) {
    const header = Object.fromEntries(Object.entries(site.header).filter(([d]) => !HEADER_ONLY_DIRECTIVES.includes(d)));
    for (const d of new Set([...Object.keys(site.meta), ...Object.keys(header)])) {
      const a = (site.meta[d] || []).join(" ");
      const b = (header[d] || []).join(" ");
      if (a !== b) drift.push(`${d}: index.html "${site.meta[d] ? a : "(missing)"}" vs _headers "${header[d] ? b : "(missing)"}"`);
    }
    for (const d of HEADER_ONLY_DIRECTIVES) if (!(d in site.header)) drift.push(`${d} is missing from _headers`);
    for (const d of HEADER_ONLY_DIRECTIVES) if (d in site.meta) drift.push(`${d} is in the index.html meta tag, where browsers ignore it`);
  }
  add("the two CSP copies match", drift);

  const allowProblems = [...allows.problems];
  for (const [d, tokens] of Object.entries(allows.csp)) {
    for (const t of tokens) if (!used.has(`${d} ${t}`)) allowProblems.push(`--allow "${d} ${t}" isn't needed; remove it so the client register stays accurate`);
  }
  for (const a of allows.headers) if (!used.has(a.raw)) allowProblems.push(`--allow "${a.raw}" isn't needed; remove it`);
  add("every --allow exception is used", allowProblems);

  return { groups, usedAllows: [...used] };
}

// The client folder may only contain what the site needs (everything in it is published).
const TOP_LEVEL = new Set(["index.html", "404.html", "_headers", "_redirects", "css", "js", "images"]);
const FORBIDDEN_FILE = /\.(md|env|bak|orig|map|zip|log|mjs|ts)$|\.env/i;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".svg"]);

export function folderProblems(siteDir) {
  const problems = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(siteDir, full).split(path.sep).join("/");
      const parts = rel.split("/");
      if (entry.name.startsWith(".")) { problems.push(`${rel}${entry.isDirectory() ? "/" : ""}: dotfiles and dot-folders must not be published`); continue; }
      if (parts.length === 1 && !TOP_LEVEL.has(entry.name)) { problems.push(`${rel}: not part of the site (allowed at the top level: ${[...TOP_LEVEL].join(", ")})`); continue; }
      if (entry.isDirectory()) { walk(full); continue; }
      if (FORBIDDEN_FILE.test(entry.name)) { problems.push(`${rel}: this kind of file must not be published`); continue; }
      if (parts[0] === "images") {
        const ext = path.extname(entry.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) problems.push(`${rel}: images/ may only hold ${[...IMAGE_EXT].join(" ")} files`);
        else if (ext === ".svg") {
          const svg = fs.readFileSync(full, "utf8");
          if (/<script/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) problems.push(`${rel}: SVG contains a script or an on… event attribute`);
        }
      }
      if (parts[0] === "js" && parts[1] !== "vendor" && !["js/site-config.js", "js/components.js"].includes(rel)) {
        problems.push(`${rel}: js/ may only hold site-config.js, components.js and vendor/`);
      }
      if (parts[0] === "css" && path.extname(entry.name) !== ".css") problems.push(`${rel}: css/ may only hold .css files`);
    }
  };
  walk(siteDir);
  return problems;
}

// The vendor files are exactly the ones whose hashes were verified.
export function vendorProblems(siteDir) {
  const problems = [];
  const dir = path.join(siteDir, "js", "vendor");
  const present = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const expected = Object.keys(VENDOR_SHA384).sort();
  if (present.join() !== expected.join()) problems.push(`js/vendor/ holds ${present.join(", ") || "nothing"}; expected ${expected.join(", ")}`);
  for (const [file, want] of Object.entries(VENDOR_SHA384)) {
    const f = path.join(dir, file);
    const got = fs.existsSync(f) ? crypto.createHash("sha384").update(fs.readFileSync(f)).digest("base64") : "missing";
    if (got !== want) problems.push(`${file}: SHA-384 is ${got}, expected ${want}`);
  }
  return problems;
}
