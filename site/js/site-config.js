// Per-business settings. Edit this file (plus the copy in index.html) when
// reusing the template for a new client. Components read it from window.SITE.
// Everything in site/ is public, including this file. Never put API keys,
// tokens or passwords here.
window.SITE = {
  // IANA time zone the business operates in. "Open now" is calculated in this
  // zone, so a visitor in another time zone still sees the correct status.
  timeZone: "America/Los_Angeles",

  // 24-hour "HH:MM" times. A day can have several ranges (e.g. a lunch break),
  // or an empty array when closed. A close time earlier than the open time
  // means the range runs past midnight into the next day.
  hours: {
    mon: [{ open: "07:00", close: "15:00" }],
    tue: [{ open: "07:00", close: "15:00" }],
    wed: [{ open: "07:00", close: "15:00" }],
    thu: [{ open: "07:00", close: "15:00" }],
    fri: [
      { open: "07:00", close: "15:00" },
      { open: "18:00", close: "00:30" },
    ],
    sat: [{ open: "08:00", close: "14:00" }],
    sun: [],
  },

  faqs: [
    {
      q: "Do you take reservations?",
      a: "We're walk-in only during the day. For groups of 8 or more, send us a message and we'll hold a table.",
    },
    {
      q: "Do you have dairy-free or gluten-free options?",
      a: "Yes. We carry oat and almond milk at no extra charge, and there are always at least two gluten-free pastries in the case.",
    },
    {
      q: "Is there parking nearby?",
      a: "There's free street parking on Pine St. and a paid lot behind the building on 3rd Ave.",
    },
    {
      q: "Do you cater events?",
      a: "We do coffee service and pastry trays for offices and events. Use the contact form below with your date and headcount.",
    },
  ],

  // The menu / gallery section.
  //
  // layout: "menu"    — list of items with name, description and price; photos
  //                     are optional small thumbnails. Good for food menus,
  //                     service lists, price lists.
  //         "gallery" — grid of photos with captions. Good for portfolios and
  //                     photo pages (give every item an image).
  //
  // Categories become filter buttons; with only one category they're hidden.
  // Every field on an item except `name` is optional. `price` is plain text,
  // so "From $40" or "Market price" work too. Any item with an image opens in
  // the lightbox when clicked.
  showcase: {
    layout: "menu",
    categories: [
      {
        name: "Coffee",
        items: [
          { name: "Drip coffee", description: "Rotating single origin, roasted in-house.", price: "$3", image: { src: "images/photo-1.svg", alt: "Placeholder photo 1" } },
          { name: "Cortado", description: "Double shot with an equal splash of steamed milk.", price: "$4.25" },
          { name: "Oat milk latte", description: "Our house espresso with oat milk.", price: "$5.50", image: { src: "images/photo-3.svg", alt: "Placeholder photo 3" } },
          { name: "Pour-over", description: "Ask what's on the bar today.", price: "$5" },
        ],
      },
      {
        name: "Bakery",
        items: [
          { name: "Butter croissant", description: "Laminated in-house over three days.", price: "$4", image: { src: "images/photo-2.svg", alt: "Placeholder photo 2" } },
          { name: "Morning bun", description: "Orange zest and cinnamon sugar.", price: "$4.50" },
          { name: "Gluten-free banana bread", price: "$3.75", image: { src: "images/photo-6.svg", alt: "Placeholder photo 6" } },
        ],
      },
      {
        name: "Merch",
        items: [
          { name: "Sticker pack", description: "Three die-cut vinyl stickers, weatherproof.", price: "$6", image: { src: "images/photo-4.svg", alt: "Placeholder photo 4" } },
          { name: "Ceramic mug", description: "12 oz, made by a local potter. Dishwasher safe.", price: "$22", image: { src: "images/photo-5.svg", alt: "Placeholder photo 5" } },
          { name: "Canvas tote", description: "Heavyweight cotton with our logo.", price: "$18" },
          { name: "Whole bean bag", description: "12 oz of this month's house roast.", price: "$16" },
        ],
      },
    ],
  },

  // Where the contact form POSTs JSON (e.g. a Formspree or Basin endpoint).
  // Must be a full https:// URL. Also add its origin to `connect-src` in the CSP
  // in index.html and _headers.
  // Empty is for local development only: on file:// or localhost submissions
  // are logged to the console. On any other host, an empty endpoint makes the
  // form show its error message. A site must not go live without one.
  formEndpoint: "",
};
