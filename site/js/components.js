// Alpine components for the site. This file must load before Alpine itself so
// the `alpine:init` listener is registered in time (see the script order in
// index.html).
//
// The site uses Alpine's CSP build, which can't evaluate JavaScript written in
// the HTML. Every x-/:/@ attribute names a property, getter or method defined
// here, so all logic lives in this file. Methods used from the HTML are called
// with the element's whole scope as `this`, so inside an x-for they can read
// the loop variables (`this.item`, `this.i`). Values read from the HTML must
// never be `undefined` (the CSP build warns about it), so optional config
// fields are normalised to "" or null.

// ---------------------------------------------------------------------------
// Hours helpers (plain functions, no Alpine) — all times are "minutes since
// Sunday 00:00" so a whole week is one number line from 0 to WEEK.
// ---------------------------------------------------------------------------
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 24 * 60;
const WEEK = 7 * DAY;

// "07:30" -> 450. Strict 24-hour "HH:MM", so a typo such as "7am" or "7:30"
// is reported instead of silently producing NaN.
function toMinutes(hhmm) {
  const match = typeof hhmm === "string" && hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`invalid time ${JSON.stringify(hhmm)}: use 24-hour "HH:MM", such as "07:30"`);
  return Number(match[1]) * 60 + Number(match[2]);
}

// Check the hours and time zone from site-config.js before using them, so a
// mistake is reported with its location instead of failing somewhere later.
function validateHours(hours, timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`timeZone ${JSON.stringify(timeZone)} isn't a valid IANA time zone, such as "America/Los_Angeles"`);
  }
  if (typeof timeZone !== "string") throw new Error("timeZone is missing");
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) throw new Error("hours is missing or isn't an object");
  for (const [key, ranges] of Object.entries(hours)) {
    if (!DAY_KEYS.includes(key)) throw new Error(`hours.${key}: unknown day; use ${DAY_KEYS.join(", ")}`);
    if (!Array.isArray(ranges)) throw new Error(`hours.${key} must be a list of { open, close } ranges, or [] when closed`);
    ranges.forEach((range, i) => {
      for (const field of ["open", "close"]) {
        try {
          toMinutes(range?.[field]);
        } catch (err) {
          throw new Error(`hours.${key}[${i}].${field}: ${err.message}`);
        }
      }
    });
  }
}

// Current minute-of-week in the business's time zone, not the visitor's.
function minuteOfWeekInZone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return day * DAY + Number(get("hour")) * 60 + Number(get("minute"));
}

// Flatten the config into [{ start, end }] ranges on the weekly number line.
function weeklyRanges(hours) {
  return DAY_KEYS.flatMap((key, day) =>
    (hours[key] || []).map(({ open, close }) => {
      const start = day * DAY + toMinutes(open);
      let end = day * DAY + toMinutes(close);
      if (end <= start) end += DAY; // closes after midnight
      return { start, end };
    })
  );
}

// Returns { isOpen, closesAt } or { isOpen, opensAt } (minute-of-week, or null
// if the business has no hours at all).
function getOpenStatus(hours, now) {
  const ranges = weeklyRanges(hours);

  // Also test `now + WEEK` so a Saturday-night range that spills into Sunday
  // morning still matches early on Sunday.
  const current = ranges.find(
    (r) => (now >= r.start && now < r.end) || (now + WEEK >= r.start && now + WEEK < r.end)
  );
  if (current) return { isOpen: true, closesAt: current.end % WEEK };

  if (ranges.length === 0) return { isOpen: false, opensAt: null };
  const minutesUntil = (r) => (r.start - now + WEEK) % WEEK;
  const next = ranges.reduce((best, r) => (minutesUntil(r) < minutesUntil(best) ? r : best));
  return { isOpen: false, opensAt: next.start % WEEK };
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

// "today" / "tomorrow" / "Monday", relative to `now`.
function dayLabel(target, now) {
  const diff = (Math.floor(target / DAY) - Math.floor(now / DAY) + 7) % 7;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return DAY_NAMES[Math.floor(target / DAY)];
}

// ---------------------------------------------------------------------------
// Alpine registrations
// ---------------------------------------------------------------------------
document.addEventListener("alpine:init", () => {
  // Each component below copes with its own part of the config being missing
  // or wrong, so one mistake can't take down the rest of the page (above all,
  // the contact form).
  const site = window.SITE || {};
  if (!window.SITE) console.error("site-config.js didn't load, so the page is using empty settings.");
  const listOrEmpty = (value, name) => {
    if (Array.isArray(value)) return value;
    if (value !== undefined) console.error(`${name} in site-config.js must be a list.`);
    return [];
  };
  const text = (value) => (value === undefined || value === null ? "" : String(value));

  // Mobile nav: just an open/closed flag. CSS decides whether the menu is a
  // dropdown (small screens) or always visible (wide screens).
  Alpine.data("mobileNav", () => ({
    open: false,
    get navClass() {
      return { "is-open": this.open };
    },
    toggle() {
      this.open = !this.open;
    },
    close() {
      this.open = false;
    },
  }));

  // Hours are a *store* rather than a component because two separate parts of
  // the page (the hero badge and the hours table) show the same live status.
  // If the hours or time zone in the config are wrong, `available` stays false:
  // the badge and table are hidden, a "please call us" line shows instead, and
  // the problem is reported in the console.
  Alpine.store("hours", {
    available: false,
    status: { isOpen: false, label: "", detail: "" },
    todayIndex: null,
    days: [],
    get unavailable() {
      return !this.available;
    },
    get badgeClass() {
      return this.status.isOpen ? "is-open" : "is-closed";
    },
    get detailText() {
      return this.status.detail ? `· ${this.status.detail}` : "";
    },

    // Alpine calls a store's init() automatically.
    init() {
      try {
        validateHours(site.hours, site.timeZone);
        // Table rows, Monday first. These never change, so build them once.
        this.days = [1, 2, 3, 4, 5, 6, 0].map((i) => ({
          index: i,
          name: DAY_NAMES[i],
          text: (site.hours[DAY_KEYS[i]] || [])
            .map(({ open, close }) => `${formatTime(toMinutes(open))} – ${formatTime(toMinutes(close))}`)
            .join(", ") || "Closed",
        }));
      } catch (err) {
        // A missing config file is already reported above; don't add a second message.
        if (window.SITE) console.error(`Opening hours are hidden because of a problem in site-config.js: ${err.message}`);
        return;
      }
      this.refresh();
      setInterval(() => this.refresh(), 60 * 1000);
    },

    refresh() {
      let now, result;
      try {
        now = minuteOfWeekInZone(site.timeZone);
        result = getOpenStatus(site.hours, now);
      } catch (err) {
        console.error("Opening hours are hidden because the status couldn't be worked out:", err);
        this.available = false;
        return;
      }
      this.available = true;
      this.todayIndex = Math.floor(now / DAY);

      if (result.isOpen) {
        this.status = { isOpen: true, label: "Open now", detail: `Closes at ${formatTime(result.closesAt % DAY)}` };
      } else if (result.opensAt === null) {
        this.status = { isOpen: false, label: "Closed", detail: "" };
      } else {
        const when = dayLabel(result.opensAt, now);
        this.status = { isOpen: false, label: "Closed", detail: `Opens ${when} at ${formatTime(result.opensAt % DAY)}` };
      }
    },
  });

  // The hero "Open now" badge reads everything from $store.hours; it only
  // needs a named component because the CSP build can't use a bare x-data.
  Alpine.data("hoursBadge", () => ({}));

  // Hours table: highlights today's row. `this.day` is the x-for row.
  Alpine.data("hoursTable", () => ({
    rowClass() {
      return { "is-today": this.day.index === Alpine.store("hours").todayIndex };
    },
  }));

  // FAQ accordion: only one answer open at a time, tracked by index. The
  // *This* methods are used inside the x-for, where `this.i` is the row.
  Alpine.data("faq", () => ({
    items: listOrEmpty(site.faqs, "faqs").map((item) => ({ q: text(item?.q), a: text(item?.a) })),
    openIndex: null,
    toggle(i) {
      this.openIndex = this.openIndex === i ? null : i;
    },
    isOpen(i) {
      return this.openIndex === i;
    },
    toggleThis() {
      this.toggle(this.i);
    },
    isThisOpen() {
      return this.isOpen(this.i);
    },
    questionId() {
      return `faq-q-${this.i}`;
    },
    answerId() {
      return `faq-a-${this.i}`;
    },
  }));

  // Menu / gallery showcase: category filter buttons, a list or grid of items,
  // and a lightbox for any item that has an image. `index` is kept when
  // closing so the image doesn't blank out during the fade-out transition.
  // Items are normalised so every field the HTML reads exists ("" or null).
  const showcaseItem = (item) => ({
    name: text(item?.name),
    description: text(item?.description),
    price: text(item?.price),
    image: item?.image?.src ? { src: text(item.image.src), alt: text(item.image.alt) } : null,
  });

  Alpine.data("showcase", () => ({
    layout: site.showcase?.layout === "gallery" ? "gallery" : "menu",
    categories: listOrEmpty(site.showcase?.categories, "showcase.categories")
      .filter((c) => Array.isArray(c?.items))
      .map((c) => ({ name: text(c.name), items: c.items.map(showcaseItem) })),
    activeCategory: 0,
    isOpen: false,
    index: 0,
    get items() {
      return this.categories[this.activeCategory]?.items || [];
    },
    // The lightbox steps through only the items that have a photo.
    get images() {
      return this.items.filter((item) => item.image);
    },
    get current() {
      return this.images[this.index] || null;
    },
    // "Oat milk latte · $5.50", or just the name when there's no price.
    get caption() {
      return this.current ? [this.current.name, this.current.price].filter(Boolean).join(" · ") : "";
    },
    get layoutClass() {
      return `layout-${this.layout}`;
    },
    get hasFilters() {
      return this.categories.length > 1;
    },
    get hasSeveralImages() {
      return this.images.length > 1;
    },
    // null leaves the lightbox <img> without a src when there's no photo.
    get currentSrc() {
      return this.current ? this.current.image.src : null;
    },
    get currentAlt() {
      return this.current ? this.current.image.alt : "";
    },
    get counter() {
      return `${this.index + 1} / ${this.images.length}`;
    },
    // Used inside the x-for loops: `this.i` is the filter button's index,
    // `this.item` is the showcase item.
    isActiveCategory() {
      return this.activeCategory === this.i;
    },
    selectThisCategory() {
      this.selectCategory(this.i);
    },
    openThisItem() {
      this.open(this.item);
    },
    enlargeLabel() {
      return `Enlarge photo: ${this.item.name}`;
    },
    selectCategory(i) {
      this.activeCategory = i;
      this.isOpen = false;
    },
    open(item) {
      this.index = this.images.indexOf(item);
      this.isOpen = true;
    },
    close() {
      this.isOpen = false;
    },
    next() {
      this.index = (this.index + 1) % this.images.length;
    },
    prev() {
      this.index = (this.index - 1 + this.images.length) % this.images.length;
    },
  }));

  // Contact form with client-side validation. Each rule returns an error
  // message, or "" when the value is valid. Lengths are checked before the
  // email regex, which gets slow on very long input. The limits match the
  // `maxlength` attributes in index.html.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const rules = {
    name: (v) => {
      const t = v.trim();
      if (!t) return "Please enter your name.";
      return t.length > 100 ? "Name is too long." : "";
    },
    email: (v) => {
      const t = v.trim();
      if (!t) return "Please enter your email.";
      if (t.length > 254) return "That email address is too long.";
      return EMAIL_RE.test(t) ? "" : "That email address doesn't look right.";
    },
    phone: (v) => {
      if (!v.trim()) return "";
      if (v.length > 30) return "Please enter a valid phone number.";
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15 ? "" : "Please enter a valid phone number.";
    },
    message: (v) => {
      const t = v.trim();
      if (t.length < 10) return "Please write at least 10 characters.";
      return t.length > 5000 ? "Please keep your message under 5,000 characters." : "";
    },
  };

  // Without an endpoint, submissions are only logged to the console. That is
  // allowed on a local copy (file:// or localhost) and nowhere else, so a live
  // site with no endpoint shows the error state instead of a fake "Thanks".
  const isLocal = ["", "localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const SEND_TIMEOUT_MS = 15000;

  // Form data must never travel over plain HTTP. Parse the endpoint once:
  // the normalised https URL, or null if it's malformed, not https, has no
  // host, or contains credentials (everything in site/ is public, so a
  // password in this URL would be readable by anyone). Case and surrounding
  // whitespace don't matter.
  function parseEndpoint(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  }
  const endpoint = site.formEndpoint ? parseEndpoint(site.formEndpoint) : null;
  if (site.formEndpoint && !endpoint) {
    console.error("formEndpoint in site-config.js must be a full https:// URL. The contact form will not send.");
  }

  const emptyFields = () => ({ name: "", email: "", phone: "", message: "", hp: "" });

  Alpine.data("contactForm", () => ({
    // `hp` is a honeypot: hidden from people, but bots tend to fill it.
    fields: emptyFields(),
    errors: { name: "", email: "", phone: "", message: "" },
    status: "idle", // idle | sending | success | error

    get invalid() {
      return Object.fromEntries(Object.entries(this.errors).map(([name, message]) => [name, !!message]));
    },
    get isSending() {
      return this.status === "sending";
    },
    get isSuccess() {
      return this.status === "success";
    },
    get isError() {
      return this.status === "error";
    },
    get buttonLabel() {
      return this.isSending ? "Sending…" : "Send message";
    },

    // Each input names its field in data-field. Typing updates the field and,
    // if it's already showing an error, re-checks it so the error clears as
    // soon as it's fixed. Leaving a field checks it.
    onInput(event) {
      const name = event.target.dataset.field;
      this.fields[name] = event.target.value;
      if (this.errors[name]) this.validateField(name);
    },
    onBlur(event) {
      this.validateField(event.target.dataset.field);
    },

    validateField(name) {
      this.errors[name] = rules[name](this.fields[name]);
      return !this.errors[name];
    },

    validateAll() {
      // map() first so every field gets checked, not just up to the first failure.
      return Object.keys(rules).map((name) => this.validateField(name)).every(Boolean);
    },

    async submit() {
      if (!this.validateAll()) {
        this.$nextTick(() => this.$root.querySelector('[aria-invalid="true"]')?.focus());
        return;
      }

      const { hp, ...raw } = this.fields;
      if (hp) {
        this.status = "success"; // pretend it worked so the bot moves on
        return;
      }
      const payload = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.trim()]));

      this.status = "sending";
      try {
        if (site.formEndpoint) {
          if (!endpoint) throw new Error("formEndpoint must be a full https:// URL");

          // AbortController + setTimeout rather than AbortSignal.timeout(),
          // which older Safari versions lack.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(payload),
              credentials: "omit", // never send cookies to a third-party form service
              referrerPolicy: "strict-origin",
              signal: controller.signal, // a stalled endpoint shows the error state
            });
            if (!res.ok) throw new Error(`Form endpoint responded ${res.status}`);
          } finally {
            clearTimeout(timer);
          }
        } else if (isLocal) {
          console.info("No formEndpoint configured (local copy only). Form data:", payload);
        } else {
          throw new Error("formEndpoint is not configured in site-config.js");
        }
        this.status = "success";
        this.fields = emptyFields();
      } catch (err) {
        console.error(err);
        this.status = "error";
      }
    },
  }));

  // Footer copyright year (the visitor's clock).
  Alpine.data("footer", () => ({
    year: new Date().getFullYear(),
  }));
});
