// Alpine components for the site. This file must load before Alpine itself so
// the `alpine:init` listener is registered in time (see the script order in
// index.html).

// ---------------------------------------------------------------------------
// Hours helpers (plain functions, no Alpine) — all times are "minutes since
// Sunday 00:00" so a whole week is one number line from 0 to WEEK.
// ---------------------------------------------------------------------------
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY = 24 * 60;
const WEEK = 7 * DAY;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
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
  const site = window.SITE;

  // Mobile nav: just an open/closed flag. CSS decides whether the menu is a
  // dropdown (small screens) or always visible (wide screens).
  Alpine.data("mobileNav", () => ({
    open: false,
    toggle() {
      this.open = !this.open;
    },
    close() {
      this.open = false;
    },
  }));

  // Hours are a *store* rather than a component because two separate parts of
  // the page (the hero badge and the hours table) show the same live status.
  Alpine.store("hours", {
    status: { isOpen: false, label: "", detail: "" },
    todayIndex: null,
    // Table rows, Monday first. These never change, so build them once.
    days: [1, 2, 3, 4, 5, 6, 0].map((i) => ({
      index: i,
      name: DAY_NAMES[i],
      text: (site.hours[DAY_KEYS[i]] || [])
        .map(({ open, close }) => `${formatTime(toMinutes(open))} – ${formatTime(toMinutes(close))}`)
        .join(", ") || "Closed",
    })),

    // Alpine calls a store's init() automatically.
    init() {
      this.refresh();
      setInterval(() => this.refresh(), 60 * 1000);
    },

    refresh() {
      const now = minuteOfWeekInZone(site.timeZone);
      const result = getOpenStatus(site.hours, now);
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

  // FAQ accordion: only one answer open at a time, tracked by index.
  Alpine.data("faq", () => ({
    items: site.faqs,
    openIndex: null,
    toggle(i) {
      this.openIndex = this.openIndex === i ? null : i;
    },
    isOpen(i) {
      return this.openIndex === i;
    },
  }));

  // Menu / gallery showcase: category filter buttons, a list or grid of items,
  // and a lightbox for any item that has an image. `index` is kept when
  // closing so the image doesn't blank out during the fade-out transition.
  Alpine.data("showcase", () => ({
    layout: site.showcase.layout,
    categories: site.showcase.categories,
    activeCategory: 0,
    isOpen: false,
    index: 0,
    get items() {
      return this.categories[this.activeCategory].items;
    },
    // The lightbox steps through only the items that have a photo.
    get images() {
      return this.items.filter((item) => item.image);
    },
    get current() {
      return this.images[this.index];
    },
    // "Oat milk latte · $5.50", or just the name when there's no price.
    get caption() {
      return this.current ? [this.current.name, this.current.price].filter(Boolean).join(" · ") : "";
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
});
