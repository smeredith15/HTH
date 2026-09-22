# High Tide Handmade — Art Catalog App

**Build specification, v1.0 — September 2026**
Owner: Scott Meredith · Etsy shop HighTideHandmade25 · Hampstead, Maryland

---

## 0. For the implementing agent

Read this whole document before writing code. Section 3 lists hard constraints; do not violate them. Build in the phases in Section 12, and meet each phase's acceptance criteria before starting the next. Appendix A is seed data for the catalog. Appendix B holds the domain rules the listing generator and validators depend on. Appendix C is business context explaining *why* features exist.

When a requirement is ambiguous, choose the option that asks less of the owner (Principle 2.1), note the assumption in `DECISIONS.md`, and ask.

---

## 1. Purpose

A personal static web app, hosted on GitHub Pages, that serves as:

1. **The catalog of record** for every piece Scott has made — specs, hours, costs, sales, rights status, photographs, and where it is now.
2. **A listing-copy generator** that builds Etsy listings from the record instead of from memory.
3. **A print-master registry** tracking which pieces have files good enough to reproduce, and how large.
4. **A commission queue** with deadlines and capacity.
5. **Inventory**, including what is physically on hand for a craft fair.
6. **A kiosk-mode portfolio** for a tablet on a craft fair table: touch-driven, offline, customer-facing.

### 1.1 Problems this app exists to prevent

Each was found in an audit of the Etsy shop in September 2026.

- **Spec drift.** One listing called its substrate both canvas and MDF. The moose listing was built by copying the golf-bag listing and inherited its dimensions (18.5 × 31 in, birch with pine frame) while the description said 16 × 12. Three listings in a row carried substrate contradictions.
- **Lost catalog.** Originals were sold without full-resolution photographs and can never be printed. Four lighthouses (two Assateague, two Cape Hatteras) exist only as snapshots. The Hooper Strait Lighthouse exists only as a 1,440 px file.
- **Invisible hourly rate.** Portraits sold at about $150 for 25–50 hours of work — roughly $3–6 an hour — without that number ever being seen.
- **Unknown rights exposure.** No record of which pieces contain trademarks, logos, or public-figure likenesses.
- **No commission queue.** Custom-order quantity was held at 1 on Etsy to avoid overlapping deadlines, which displayed "Only 1 left" to shoppers.

---

## 2. Design principles

**2.1 Minimal friction.** Scott does not want to document process and has said it slows the work. Every field except `title` is optional. Adding a piece must take under a minute. Never require step-by-step logging. Hours can be one number entered at the end.

**2.2 One record, many outputs.** Specs are entered once. Listings, kiosk cards, print size limits, and price floors are derived from them.

**2.3 Public and private are separated by construction** (Section 4). Private data must be impossible to publish by accident.

**2.4 Offline first.** Craft fairs have unreliable connectivity. Kiosk mode must work with no network at all after first load.

**2.5 The artwork is the loud thing.** The work is dark, textured, and warm. The interface stays quiet so the pieces carry the screen.

**2.6 No backend and no required build step.** Scott should be able to edit a file and push.

---

## 3. Hard constraints

- **Hosting:** GitHub Pages, static files only. No server code, no hosted database.
- **The repository is assumed public.** Anything committed is readable by anyone on the internet. Serving Pages from a private repo requires a paid GitHub plan; do not assume one.
- **No secrets in the repo.** No tokens, no passphrases, no customer data.
- **Stack:** vanilla HTML, CSS, and JavaScript as ES modules. No framework and no build step required. Any third-party library must be **vendored into the repo** rather than loaded from a CDN at runtime, so the app works offline.
- **Devices:**
  - Admin on desktop browser and Android phone (Scott uses a Google Pixel).
  - Kiosk on a tablet in landscape. Platform is not decided — test on both iPadOS Safari and Android Chrome.
- **File sizes:** keep every committed file under 50 MB (GitHub warns at 50 MB and rejects at 100 MB). Keep the whole repo well under 1 GB.
- **Print masters are never committed.** Only web-sized derivatives of images go in the repo. Masters live externally (e.g. Google Drive or local disk) and the registry records where.
- **Accessibility floor:** keyboard focus visible, `prefers-reduced-motion` respected, text contrast WCAG AA, touch targets at least 48 × 48 px in kiosk mode.

---

## 4. Data architecture

Two layers joined by piece `id`.

### 4.1 Public layer — committed to the repo

- `data/catalog.json` — contains only artworks whose `visibility` is `public`, and only fields marked **P** in Section 5.
- `images/<artwork-id>/*.jpg` — web and thumbnail derivatives.

Kiosk mode and any public portfolio page read only this layer.

### 4.2 Private layer — on the admin device

- IndexedDB in the admin browser holds everything: all artworks with all fields, listings, sales, customers, commissions, settings.
- On first run call `navigator.storage.persist()`.
- **Export / import** the entire private layer as one JSON file named `hightide-private-YYYY-MM-DD.json`.
- Show **"Last exported: <date>"** on the admin home screen. Warn when it is more than 14 days old.
- Browsers can clear site storage (the user clearing data; some browsers evicting storage for sites not visited recently — installing the app to the home screen reduces this). **Exports are the backup of record.** Say so in the UI once, plainly.

### 4.3 Publishing flow

1. Scott edits in admin; changes live in the private layer.
2. **Publish catalog** builds `catalog.json` from public-visible artworks, stripping every private field, and downloads it together with any new or changed web images.
3. Scott commits the files and pushes.

Before building the file, show a preview listing every artwork being published and confirm. A unit test must assert that no private field name ever appears in generated `catalog.json` output.

### 4.4 Device roles

- **Admin devices** (phone, desktop) hold the private layer.
- **Kiosk device** (tablet) should run from the public catalog only and ideally hold no private data.
- If one device does both, admin sits behind a PIN. The PIN is a UI lock to keep fair visitors out of admin screens, not security; state this in code comments and the settings screen.

### 4.5 Optional encrypted sync (Phase 7)

To sync private data between devices with no backend: encrypt the private export in the browser using WebCrypto (AES-GCM, key derived from a passphrase with PBKDF2-SHA-256 at no fewer than 600,000 iterations, random salt and IV stored alongside the ciphertext) and commit it as `data/private.enc.json`. The passphrase is never stored or committed. Security depends entirely on passphrase strength; warn the user of that at setup.

---
## 5. Data model

Conventions: ids are readable slugs (`hooper-strait-lighthouse`), immutable once created. Dates are ISO 8601. Money is USD as a number with two decimals. Dimensions are inches. **P** = eligible for the public catalog. **V** = private only.

### 5.1 Artwork

The physical or designed piece. One artwork can have many listings (the original, several print editions).

| Field | Type | Layer | Notes |
|---|---|---|---|
| `id` | string | P | slug, unique |
| `title` | string | P | the only required field |
| `status` | enum | P | `idea`, `in_progress`, `finished`, `archived` |
| `disposition` | enum | P | `available`, `sold`, `gifted`, `commission_delivered`, `kept`, `lost`, `unknown` |
| `on_hand` | bool | V | physically in Scott's possession right now |
| `location_stored` | string | V | e.g. "studio shelf 2", "fair bin A" |
| `visibility` | enum | V | `public` or `private`; default `private` |
| `category` | enum | P | `lighthouse`, `coastal`, `wildlife`, `landscape`, `architecture`, `portrait_person`, `portrait_pet`, `sports`, `music`, `seasonal`, `still_life`, `fantasy`, `other` |
| `series` | string | P | e.g. "Lighthouses" |
| `subject_name` | string | P | e.g. "Hooper Strait Lighthouse" |
| `subject_location` | string | P | e.g. "St. Michaels, MD" |
| `year` | number | P | |
| `date_finished` | date | V | |
| `width_in`, `height_in`, `depth_in` | number | P | |
| `shape` | enum | P | `rect`, `square`, `round`, `oval`, `live_edge`, `other` |
| `substrate` | enum | P | `pine`, `birch`, `birch_plywood`, `mdf`, `live_edge_round`, `skateboard_deck`, `other` |
| `substrate_note` | string | P | free text |
| `framed` | bool | P | |
| `frame_material` | string | P | e.g. "pine", "gold metal float" |
| `hanging_hardware` | string | P | e.g. "sawtooth", "wire", "none" |
| `finish` | string | P | sealant or topcoat |
| `techniques` | enum[] | P | `scorch_and_carve`, `pyrography_line`, `stain`, `paint`, `gold_leaf`, `relief_carve` |
| `colors` | string[] | P | e.g. `["red stain","blue stain"]`. Filterable: color pieces have drawn far more interest |
| `has_face` | bool | V | faces take 20–50+ hours regardless of size |
| `subject_count` | number | V | |
| `hours` | number | V | total; optional |
| `hours_sessions` | object[] | V | optional `[{date, hours, note}]`; never required |
| `materials_cost` | number | V | |
| `asking_price` | number | P | price of the original if available |
| `show_price_in_kiosk` | bool | V | default true when `available` |
| `blurb` | string | P | one or two sentences for kiosk and portfolio |
| `notes` | string | V | |
| `reference_source` | string | V | where the reference image came from |
| `rights` | object | V | Section 5.2 |
| `print_master` | object | V | Section 5.4 |
| `images` | Image[] | P/V | Section 5.3 |
| `primary_listing_url` | string | P | current live Etsy URL, for kiosk QR codes |
| `commission_id` | string | V | if made for a commission |
| `created_at`, `updated_at` | datetime | V | |

### 5.2 Rights (private)

Advisory only. Visibility and listing decisions belong to the owner; the app warns, it never blocks.

| Field | Type | Notes |
|---|---|---|
| `flags` | enum[] | `own_design`, `own_photo_reference`, `public_domain_reference`, `customer_photo`, `family_personal`, `public_figure_likeness`, `trademark_or_logo`, `third_party_photo`, `third_party_artwork` |
| `print_ok` | enum | `yes`, `ask_first`, `no`, `unknown` |
| `listing_ok` | enum | same values |
| `edits_required` | string | e.g. "Paint VW roundel out of print file" |
| `consent_obtained` | object | `{from, date, note}` |
| `notes` | string | |

**Default derivation** when not set by the owner:
- only `own_design`, `own_photo_reference`, or `public_domain_reference` → `yes`
- any of `customer_photo`, `family_personal` → `ask_first`
- any of `public_figure_likeness`, `trademark_or_logo`, `third_party_photo`, `third_party_artwork` → `no`

Show a non-blocking warning when an artwork whose `print_ok` is not `yes` is attached to a print listing, or when `listing_ok` is not `yes` and it is attached to any Etsy listing.

### 5.3 Image

| Field | Type | Layer | Notes |
|---|---|---|---|
| `id` | string | P | |
| `role` | enum | P | `primary`, `straight_on`, `detail_raking`, `in_room`, `scale`, `back_hardware`, `signature`, `process`, `mockup`, `group` |
| `is_mockup` | bool | P | digital composite rather than a photograph |
| `web_path` | string | P | e.g. `images/hooper-strait-lighthouse/straight_on.jpg` |
| `thumb_path` | string | P | |
| `width_px`, `height_px` | number | P | of the web file |
| `alt` | string | P | required before publishing |
| `kiosk_order` | number | P | |
| `in_kiosk` | bool | P | default true |
| `quality_flags` | enum[] | V | `warm_cast`, `angled`, `low_res`, `compressed`, `blurry`, `watermark`, `broken_composite`, `cluttered_background` |

**Image processing, in the browser** (canvas API): when Scott adds a photo, generate a web version at 2,000 px on the long edge, JPEG quality about 0.82, target under 600 KB, and a thumbnail at 600 px. Read the original's pixel dimensions and offer to record them in the print-master registry. Do not upload or keep the original in the repo.

### 5.4 Print master (private)

| Field | Type | Notes |
|---|---|---|
| `exists` | bool | |
| `location` | string | external path or URL — never the repo |
| `filename` | string | |
| `long_edge_px`, `short_edge_px` | number | |
| `captured_on` | date | |
| `capture_notes` | string | lighting, device |
| `print_ready` | enum | `yes`, `needs_retouch`, `no` |
| `retouch_notes` | string | e.g. "commission date digitally removed" |
| `max_long_edge_in_150dpi` | derived | `long_edge_px / 150` |
| `max_long_edge_in_100dpi` | derived | `long_edge_px / 100` |

Display both limits. 150 DPI is good quality; 100 DPI is the floor for large pieces viewed from across a room. Example: 3,600 px → 24 in at 150 DPI; 1,440 px → about 9.6 in at 150 DPI.

When a print listing variant exceeds the 150 DPI limit, warn. When it exceeds the 100 DPI limit, warn more strongly.

### 5.5 Listing

Relisting on Etsy creates a new listing id; keep the history.

| Field | Type | Notes |
|---|---|---|
| `id` | string | internal |
| `artwork_id` | string | nullable — custom-order listings have none |
| `channel` | enum | `etsy`, `fair`, `offline`, `website` |
| `etsy_listing_id`, `etsy_url` | string | |
| `listing_type` | enum | `original`, `print`, `custom` |
| `print_substrate` | enum | `canvas`, `mdf`, `wood_panel`, `paper`, `metal` |
| `print_process` | enum | `giclee`, `uv_direct`, `digital`, `unknown` — use `giclee` only after the print vendor confirms it |
| `print_vendor` | string | |
| `variants` | object[] | `[{label, width_in, height_in, shape, price}]` |
| `title` | string | |
| `tags` | string[] | |
| `materials` | string[] | |
| `description` | string | |
| `category_path` | string | Etsy category as selected |
| `quantity` | number | |
| `processing_weeks` | [number, number] | min, max |
| `free_shipping` | bool | |
| `status` | enum | `draft`, `active`, `inactive`, `sold_out`, `deleted`, `relisted` |
| `replaced_by` | string | listing id, when relisted |
| `suppression_suspected` | bool | e.g. mature-content rating found in the public page metadata |
| `suppression_checked_on` | date | |
| `favorites_snapshot` | number | entered by hand |
| `created_on` | date | |

### 5.6 Sale (private)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `artwork_id`, `listing_id`, `commission_id` | string | any may be null |
| `channel` | enum | `etsy`, `fair`, `offline`, `gift` |
| `date` | date | |
| `customer_id` | string | |
| `relationship` | enum | `stranger`, `friend`, `family`, `repeat` — most portrait sales so far were to friends, which distorts price signals |
| `source` | enum | `etsy_search`, `etsy_ads`, `offsite_ads`, `reddit`, `instagram`, `tiktok`, `referral`, `fair`, `repeat`, `unknown` |
| `gross_price` | number | item price |
| `shipping_charged`, `shipping_cost` | number | |
| `fees` | number | computed from Settings for Etsy sales, editable |
| `materials_cost`, `hours` | number | default from the artwork |
| `net` | derived | gross + shipping_charged − fees − shipping_cost − materials_cost |
| `effective_hourly` | derived | net ÷ hours, shown only when hours exist |
| `payment_method` | enum | `etsy`, `cash`, `card_reader`, `venmo`, `other` |
| `notes` | string | |

**Quick sale** form for fairs: artwork, price, payment method — three taps. Everything else defaults. Sets the artwork's `disposition` to `sold` and `on_hand` to false.

### 5.7 Customer (private)

`id`, `name`, `contact` (email, phone, or Etsy username), `relationship`, `first_purchase_on`, `ok_to_contact` (bool — only reach out if they agreed), `notes`. Report: repeat buyers, and past commission customers not contacted in 6+ months.

### 5.8 Commission (private)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `customer_id` | string | |
| `type` | enum | `pet`, `person`, `couple`, `family`, `sports`, `place`, `other` |
| `subject_count` | number | |
| `size` | string | matches a pricing variant |
| `quoted_price` | number | |
| `deposit_paid`, `deposit_date` | number, date | |
| `reference_notes` | string | photo quality assessment |
| `rights_flags` | enum[] | as 5.2 — e.g. `customer_photo` for the buyer's own athlete vs `public_figure_likeness` for a professional |
| `status` | enum | `inquiry`, `quoted`, `accepted`, `in_progress`, `awaiting_approval`, `finished`, `shipped`, `delivered`, `cancelled` |
| `due_date` | date | when the customer needs it |
| `ship_by` | date | |
| `estimated_hours`, `actual_hours` | number | |
| `artwork_id` | string | created when work starts |
| `notes` | string | |

**Queue view**: open commissions sorted by `ship_by`. Using `hours_per_week` from Settings, compute a projected finish date for each in order and flag any that miss `ship_by`. Show "Capacity: can accept N more before <date>". This is what allows Etsy quantity above 1 without the risk of missed deadlines.

### 5.9 Monthly shop snapshot (private, optional)

Manual entry once a month: `month`, `visits`, `views`, `orders`, `revenue`, `conversion_pct`, `favorites`, `followers`, `note`. Chart the trend. Supports the 30/60/90-day review in Appendix C.

### 5.10 Settings (private)

| Setting | Default | Notes |
|---|---|---|
| `target_hourly` | 25 | used for price floors |
| `hours_per_week` | 8 | used for commission capacity |
| `etsy_transaction_pct` | 6.5 | |
| `etsy_processing_pct` | 3.0 | US Etsy Payments |
| `etsy_processing_fixed` | 0.25 | |
| `etsy_listing_fee` | 0.20 | per listing and per renewal |
| `offsite_ads_enrolled` | true | optional while trailing-365-day sales are under $10,000 |
| `offsite_ads_pct` | 15 | 12% once over $10,000, when enrollment becomes permanent |
| `offsite_ads_cap` | 100 | per attributed order |
| `kiosk_pin` | unset | |
| `kiosk_idle_seconds` | 90 | |
| `kiosk_show_sold` | true | |
| `shop_url` | `https://www.etsy.com/shop/HighTideHandmade25` | |
| `custom_listing_url` | set by owner | |
| `trademark_blocklist` | Appendix B.4 | |

Fee defaults reflect Etsy's published schedule as of mid-2026. Show a "Verify against Etsy's current fees" link next to them; Etsy changes fees periodically.

---
## 6. Admin features

### 6.1 Catalog

- Grid and list views of all artworks, with thumbnails.
- Filters: status, disposition, on hand, category, series, color vs monochrome, has face, rights `listing_ok`, print master exists, visibility.
- Search across title, subject, location, notes.
- **Quick add**: title plus optional photo. Everything else can be filled later.
- **Duplicate as new**: copies category, substrate, frame, techniques, and series only. It must **not** copy dimensions, title, description, price, images, hours, or rights — copying those is exactly how the moose inherited the golf bag's dimensions.
- Artwork detail page with a **completeness meter** showing missing fields that matter: dimensions, substrate, straight-on photo, raking-light detail, print master, alt text, rights.

### 6.2 Photo checklist per artwork

Show the recommended roles as a checklist with the current photo for each:

1. Straight-on, daylight, on a plain wall — required for a print master
2. Raking-light detail showing carved depth
3. In a real room for scale
4. Scale reference
5. Back and hanging hardware
6. Signature
7. Process shot, only if one already exists (never required)

A short shooting guide appears on this screen, collapsible: open shade or overcast daylight; no flash; camera square to the center of the piece; tripod; a sheet of white paper in one frame for color correction; transfer originals by cable or cloud drive rather than messaging apps, which compress them.

The prompt that matters most: when `disposition` changes to `sold` or `gifted` and `print_master.exists` is false, show **"Photograph this before it leaves."** with a snooze option.

### 6.3 Inventory

- **On hand**: every artwork with `on_hand = true`, with size, price, and storage location.
- **Fair pack list**: select artworks for an event; output a printable list with title, size, price, and a checkbox, plus totals by count and retail value.
- **After the fair**: pieces packed but not sold return to on hand; pieces sold through Quick Sale are recorded.

### 6.4 Dashboard

- Counts by status and disposition.
- **Effective hourly by category** and by `has_face`, from sales with hours recorded. This view should make the portrait-versus-lighthouse difference obvious.
- **Print master coverage**: percentage of artworks with a usable master. List "sold without a master" as lost catalog.
- **Needs photographing**: on-hand pieces missing a straight-on photo.
- **Commission queue** summary and capacity.
- **Listings needing attention**: suppression suspected, rights warnings, validator failures, prices below floor.
- **Last exported** date.
- Monthly snapshot chart, if entries exist.

---

## 7. Listing generator

Builds Etsy copy from the artwork record so specs cannot drift.

### 7.1 Inputs

An artwork (or none, for custom listings), a listing type, variants, and a template.

### 7.2 Outputs, each with a copy button

- Title, with a live counter to 140
- 13 tags, each with a live counter to 20
- Materials list
- Description
- Suggested category path
- A reminder checklist: attributes filled, 10 photo slots, video, processing time, quantity

### 7.3 Templates

Stored in Settings, editable, using `{{field}}` placeholders. Size blocks are generated from `variants`. Every spec in the description comes from the record, never from free text. Seed templates are in Appendix B.6.

### 7.4 Validators — run on every change, warn, never block

| Check | Rule |
|---|---|
| Title length | ≤ 140 characters |
| Title separators | no `||`, `//`, or `///` |
| Title opener | does not begin with "Handmade" — every item on Etsy is handmade; the first ~40 characters should be the search phrase |
| Tag count | exactly 13 recommended |
| Tag length | each ≤ 20 characters |
| Tag form | flag single-word tags |
| Tag duplicates | no repeats |
| Trademark terms | any blocklist term in title, tags, materials, or description (Appendix B.4) |
| Substrate consistency | description must not mention a substrate word other than the listing's own (e.g. "canvas" in an MDF listing) |
| Dimension consistency | any dimensions in the description must match `variants` or the artwork |
| Off-site redirects | flag Instagram/TikTok handles in the description |
| Round variant | warn when a `round` variant is offered for a non-round composition |
| Print resolution | variant larger than the master supports (Section 5.4) |
| Rights | artwork `listing_ok` or `print_ok` is not `yes` |
| Price floor | original priced below the floor in Section 8 |
| Processing vs quantity | custom listing with quantity 1 — suggest raising quantity and lengthening processing time |
| Giclée claim | "giclée" used while `print_process` is not `giclee` |

---

## 8. Pricing

### 8.1 Price floor for originals and commissions

```
floor = (hours × target_hourly + materials_cost + estimated_shipping) ÷ (1 − fee_rate)
```

`fee_rate` = transaction % + processing % (+ offsite ads % as a worst case, shown separately). Add the processing fixed fee and listing fee.

Show the floor next to the asking price everywhere a price is entered, with the implied effective hourly at the current price. Do not auto-change prices.

### 8.2 Commission price table

Editable in Settings. Seed values (proposed September 2026, not yet adopted on Etsy):

| Size | Subjects | Price |
|---|---|---|
| 8 × 10 | 1 | $400 |
| 11 × 14 | 1 | $500 |
| 11 × 14 | 2 | $650 |
| 16 × 20 | 1 | $650 |
| 16 × 20 | 2 | $800 |
| any | 3+ | quote |

For comparison, the live custom listing was $150 for the smallest option, and faces take 20–50+ hours regardless of size.

### 8.3 Suggested ranges (reference only)

- Tower lighthouse originals: $350–450
- Screw-pile lighthouse originals: $600+ (far more detailed and time-consuming)
- Large framed originals generally: $350+; very large $500+
- Large prints: $150–340

---

## 9. Kiosk mode

A customer-facing portfolio for a tablet on a fair table.

### 9.1 Entry and exit

- Route `#/kiosk`. Also a large "Start kiosk" button in admin.
- Requests fullscreen and a screen wake lock (Wake Lock API; fail silently where unsupported and tell Scott once to disable auto-lock manually).
- Hides all admin navigation.
- Exit: long-press a corner for 3 seconds, then PIN. If no PIN is set, require one before kiosk can start on a device holding private data.

### 9.2 Data

Reads **only** `data/catalog.json` and `images/`. Must never read the private IndexedDB store, even when present on the same device. Enforce this with a separate module that has no import path to the private store, and a test.

### 9.3 Screens

- **Home**: a full-bleed rotating feature image, the shop name, and large category buttons generated from categories that have public artworks (e.g. Lighthouses, Coastal, Wildlife, Seasonal, Portraits).
- **Gallery**: large-tile grid, swipeable, filtered by category.
- **Detail**: the image as large as the screen allows, swipe between the artwork's kiosk images, then title, size, substrate, and one of:
  - available: price, and "Ask me about this piece"
  - sold / delivered: "Sold — commissions welcome"
  - kept: no price
- **QR code** on detail, linking to `primary_listing_url` if present, else the shop. Generated client-side with a vendored library so it works offline.
- **How it's made**: one screen with the process paragraph (Appendix B.5) and a before-and-after pair if images exist — a fully scorched blank panel and a finished piece.
- **Commissions**: the price table, timeline (6–8 weeks), and a QR code to the custom listing.

### 9.4 Behavior

- Idle for `kiosk_idle_seconds` → return to Home.
- Portrait-orientation layout as fallback; landscape is primary.
- No text input anywhere in kiosk mode.
- Works fully offline after one online load (Section 10).

### 9.5 Signature moment

When a detail view opens, the image emerges from black — a short reveal (about 700 ms) mirroring the scorch-and-carve process, where light areas appear out of char. Implement as a mask or luminance wipe. This is the one orchestrated animation in the app; everything else is quiet. With `prefers-reduced-motion`, show the image immediately.

---

## 10. Offline / PWA

- `manifest.webmanifest` with name "High Tide Handmade", icons, `display: standalone`, landscape preferred for kiosk.
- `sw.js` service worker precaches the app shell and vendored libraries, and caches `data/catalog.json` and all images listed in it.
- **"Prepare for offline"** button in admin and kiosk: fetches every catalog image, reports progress, and confirms "Ready offline: 42 pieces, 118 images."
- Version the cache from a hash or version field in `catalog.json` so a new publish refreshes it.

---

## 11. Visual design

The implementing agent should follow the frontend design guidance available to it and treat the following as the brief.

- **Subject**: hand-scorched and carved wood art from the Chesapeake region — lighthouses, water, wildlife, portraits. The process is subtractive: black char cut back to reveal pale wood.
- **Audience**: Scott (admin, efficient, spreadsheet-literate) and craft-fair visitors (kiosk, casual, browsing by touch).
- **Primary job**: make the pieces look as good on a screen as they do in person, and keep records without friction.
- **Direction**: take palette cues from the materials — char, raw pine and birch, and a cool Chesapeake grey-blue that sets off the warm wood. A cool mid-tone ground tends to flatter dark, warm artwork better than pure black or cream; test with the real images before committing.
- **Restraint**: the work is the loud thing; one signature motion (Section 9.5); no decorative gradients or card-grid kit.
- **Admin** can be denser and utilitarian. **Kiosk** is spacious and image-first.

---

## 12. Build phases

Meet each phase's acceptance criteria before starting the next.

### Phase 1 — Catalog and storage

Artwork CRUD, quick add, duplicate-as-new with the restricted field copy, IndexedDB layer, export/import, persistent storage request, last-exported warning, seed data import from Appendix A.

*Accept when*: all Appendix A artworks load; an export imports cleanly into a fresh browser; duplicate-as-new copies none of the forbidden fields.

### Phase 2 — Listing generator and validators

Templates, outputs, every validator in 7.4, price floor display.

*Accept when*: generating the surf van MDF listing produces no "canvas" anywhere; a title containing `||` or "VW" warns; a 21-character tag warns.

### Phase 3 — Images and print masters

In-browser resizing, photo checklist, print-master registry and print-size limits, "photograph before it leaves" prompt.

*Accept when*: a 4,000 px photo produces a 2,000 px web image under 600 KB and a 600 px thumbnail; the Hooper Strait record shows a 9.6 in limit at 150 DPI.

### Phase 4 — Publish and kiosk

`catalog.json` builder with the private-field test, publish preview, kiosk mode, QR codes.

*Accept when*: the generated catalog contains no private field names; kiosk shows only public artworks; kiosk code cannot reach the private store.

### Phase 5 — Offline

Manifest, service worker, "Prepare for offline".

*Accept when*: with the network disabled after preparing, kiosk browses every public artwork and image on both iPadOS Safari and Android Chrome.

### Phase 6 — Sales, commissions, inventory, dashboard

Quick sale, customers, commission queue with capacity, fair pack list, dashboard, monthly snapshot.

*Accept when*: a quick sale takes three taps; the queue flags a commission that cannot finish by `ship_by`; effective hourly appears by category.

### Phase 7 — Optional

Encrypted private sync (4.5); direct commit through the GitHub API using a fine-grained token stored only in IndexedDB and scoped to this one repo.

---

## 13. Repository layout

```
/
├── index.html
├── manifest.webmanifest
├── sw.js
├── SPEC.md                 this document
├── DECISIONS.md            assumptions made during the build
├── app/
│   ├── main.js
│   ├── router.js
│   ├── store/              private IndexedDB layer
│   ├── public/             catalog loader — kiosk imports only from here
│   ├── admin/
│   ├── kiosk/
│   ├── listing/            templates and validators
│   ├── images/             resize and dimension utilities
│   └── vendor/             QR library and any other vendored code
├── styles/
├── data/
│   └── catalog.json        public catalog — generated, committed
├── images/
│   └── <artwork-id>/       web images and thumbnails only
└── tests/                  runnable in the browser or with Node
```

---

## 14. Testing

Plain JavaScript tests that run in a browser test page or under Node without a build step. Required coverage:

- every validator in 7.4, with passing and failing cases
- price floor and effective hourly calculations
- print size limits
- the catalog builder never emits private fields
- the kiosk module has no dependency on the private store
- export → import round trip is lossless

---

## 15. Non-goals

- **Etsy API integration.** Etsy's API requires OAuth and app registration, and a static site cannot hold its credentials safely. Listing copy is copied by hand.
- Payment processing.
- Multiple users or accounts.
- Any server, hosted database, or analytics tracking.
- Social media posting or scheduling.
- Storing full-resolution print masters.

---
## Appendix A — Seed catalog

Import these as the starting data. `?` means unknown; import as null and let Scott fill it in. Rights flags are the best reading from the September 2026 review and are advisory; Scott may override any of them.

### A.1 Current Etsy listings (as of 17 September 2026)

| Artwork id | Listing | Type | Etsy id | Price | Known specs | Flags and notes |
|---|---|---|---|---|---|---|
| `cilleyville-covered-bridge` | Cilleyville Covered Bridge, Andover NH | original | 4577252633 | $285 | 12 × 12, framed (gold), winter scene | Built 1887, Town lattice truss, National Register 1989; also called Bog Bridge. Reference source `?` |
| — | Custom portrait | custom | 1863119781 | $150 from | quantity 1 | To be split into pet, family, and sports listings (B.7) and repriced (8.2) |
| `moose` | Scorched wood moose | original | 4301574396 | $250 | 16 × 12, pine; frame `?` | Once carried the golf bag's dimensions by template copying. Verify every spec |
| `surf-van` | Surf van beach art | print on MDF | 1884246466 | $80 from | original 24 × 24, original gone | `trademark_or_logo` (VW roundel carved on the nose), `family_personal` (the figure on the roof is Scott's wife). Suppression suspected. Paint roundel out of file; crop primary image; drop round variant; relist to replace the old `vw` URL slug |
| `western-cactus-longhorn-skull` | Cactus and longhorn skull | print on MDF | 1759413854 | $55 / $75 / $140 | original 24 × 16 birch, burnt, stained, carved; prints 12 × 8, 18 × 12, 24 × 16 | Has video. Not suppressed. Owner confirmed the 24 × 16 print looks good |
| `golf-bag` | Vintage golf bag | original | 1239539354 | $495 | 18.5 × 31 × 1, birch, pine frame, sawtooth | Has video and a process photo. Suggested channel: country clubs, not Etsy browse |
| `toucan` | Toucan | canvas print | 1167916799 | $47 | painted | Off-range price and off-technique for the shop |
| `humpback-whale` | Humpback whale | canvas print (giclée category) | 1167279219 | $50 from, up to $340 | original painted and stained burnt pine, sold | 18 favorites, 2 sales, 5-star review Nov 2022. Best-performing listing. Colors: blue, white, gold |
| `longhorn-skull-flag` | American flag with longhorn skull | canvas print (giclée category) | 1167295187 | $50 from, up to $340 | original stained red and blue over burnt pine, carved, roughly 2:1 | 10 favorites, 1 sale. Suppression suspected. Title still says "Texas Longhorn" (B.4) and should lead with "American Flag". Bedroom mockup is the current primary image |
| `peace-sign-globe-ship-wheel` | Ship wheel, globe, peace sign | wood print | 1851378216 | $80 | square; round variant offered | 1 favorite. Stone-wall mockup is a broken semi-transparent composite; round crop cuts the wheel handles |

### A.2 Portfolio — not currently listed

| Artwork id | Subject | Disposition | Notes |
|---|---|---|---|
| `hooper-strait-lighthouse` | Hooper Strait screw-pile lighthouse, St. Michaels MD | commission delivered (family) | Red sky in stain. Dated July 1, 2023; date digitally removed in a copy. Far more than 15 hours. Only file is 1,440 px — print master `no`. Owner reports family is fine with prints. Action: borrow it back and reshoot |
| `assateague-lighthouse-1`, `-2` | Assateague Lighthouse, VA — tower | sold | One via Etsy listing 1244975730 (5-star review, July 2022). One in red and white stain. No masters |
| `cape-hatteras-lighthouse-1`, `-2` | Cape Hatteras Lighthouse, NC — tower | sold | Tall vertical framed panels. No masters |
| `blue-crab` | Chesapeake blue crab | available, on hand | Owner considers it the weakest piece |
| `atlas-statue` | Atlas statue with gold drips | `?` | `third_party_photo` — from a found photograph |
| `mushroom-panel` | Row of mushrooms, horizontal | `?` | own design |
| `pumpkins` | Jack-o'-lantern and gourds | `?` | seasonal — list by early October |
| `gnome-triptych` | Three gnome panels on a burned base | `?` | seasonal — the most commercial piece in the portfolio; repeatable |
| `bears-moonlight` | Mother bear and cub under a blue moon | `?` | color; has an in-room mockup |
| `horse-live-edge` | Horse head on a live-edge round | `?` | |
| `surfer-longboard` | Surfer with longboard, tall narrow panel | `?` | |
| `astronaut-profile` | Profile in a helmet | `?` | has face |
| `porthole-seahorse` | Seahorse in a porthole with kelp | `?` | |
| `skateboard-astronaut` | Astronaut on a skateboard deck, gold | `?` | |
| `snoopy-snowman` | Snowman with Peanuts characters | `?` | `third_party_artwork`, `trademark_or_logo` |
| `anime-swordsman` | Anime-style swordsman, color | `?` | `third_party_artwork` |
| `rose-glasses-portrait` | Scott's wife, purple stain | kept | `family_personal` |
| `couple-portrait-1`, `-2` | Couple portraits | commission delivered | `customer_photo` |
| `blue-heeler-puppy` | Dog portrait | commission delivered | `customer_photo` |
| `golfer-school-logo` | Golfer with a school logo | commission delivered | `trademark_or_logo` |

### A.3 Sports portraits

All carry `public_figure_likeness` and `trademark_or_logo`; default `listing_ok` and `print_ok` are `no`. Owner intends to keep offering these as private, offline commissions. Most sold to friends for about $150.

| Artwork id | Subject | Notes |
|---|---|---|
| `tom-brady` | Tom Brady, Patriots | sold |
| `len-bias` | Len Bias | sold |
| `puka-nacua-1` | Puka Nacua, Rams | made for a family member; posted to Reddit |
| `puka-nacua-2` | Puka Nacua, Rams | sold to a stranger through the Etsy custom listing (small, one subject); source `reddit` |
| `aaron-rodgers` | Aaron Rodgers | sold to a friend |
| `jordan-love` | Jordan Love, Packers | same friend — repeat buyer |
| `ladainian-tomlinson` | LaDainian Tomlinson | sold to a friend |
| `russell-wilson` | Russell Wilson, Seahawks | same friend — repeat buyer |
| `josh-allen` | Josh Allen, Bills | sold |
| `orioles-1970-world-series` | Orioles 1970 World Series celebration | sold |
| `gunnar-henderson-card` | Gunnar Henderson, Topps card design | `?`; also `third_party_artwork` |

### A.4 Ideas

| Artwork id | Subject | Notes |
|---|---|---|
| `assateague-lighthouse-3` | Remake at print scale, color | tower, 10–15 hours; proven seller |
| `cape-hatteras-lighthouse-3` | Remake at print scale | tower |
| `currituck-beach-lighthouse` | Corolla, NC | tower |
| `bodie-island-lighthouse` | Outer Banks, NC | tower |
| `concord-point-lighthouse` | Havre de Grace, MD | tower |
| `cove-point-lighthouse` | Lusby, MD | tower |
| `hooper-strait-lighthouse-2` | Remake without date, at print scale | screw-pile, premium tier |
| `thomas-point-shoal-lighthouse` | Annapolis, MD | screw-pile, premium tier |
| `great-blue-heron` | Chesapeake heron | use a public-domain or own reference, not the watermarked stock image |
| `amanita-mushroom` | Yellow amanita | own photo reference |
| `bike-at-huntington-pier` | Wife on a bike at Huntington Beach pier | own photo; `family_personal`; bus seen from the rear |
| `bixby-bridge-kelp` | Bixby Bridge under water with shark and kelp | own composite reference |
| `beach-meditation` | Surfer meditating on the sand | own photo reference |
| `moonbeam-ocean`, `kingfisher`, `arch-moon` | Inspiration only | references are other people's work; sketches must be original compositions |
| `jerry-garcia`, `jimi-hendrix` | Musician portraits | `public_figure_likeness`; owner intends them for social engagement and private offers |

---

## Appendix B — Domain rules

### B.1 Etsy listing mechanics

- Title: up to 140 characters. The first ~40 carry the most search weight. Lead with the phrase buyers type.
- Tags: 13, each up to 20 characters, multi-word, no repeats. Single words waste slots.
- Materials: up to 13. Techniques such as "pyrography" are not materials.
- Photos: 10 slots plus one video. Etsy favors listings with video.
- Attributes: fill every one — they feed search filters and most sellers skip them.
- Category: only leaf categories can be selected. Type a leaf name into the category search rather than browsing. Prints: search "prints" → *Digital Prints*, or *Giclée* only if the vendor confirms the process. Originals: try "mixed media" or "sculpture"; fall back to *Wall Decor* rather than spending time on it.
- Made-to-order: use a longer processing time rather than quantity 1.
- Free shipping: Etsy's US search favors it. Build shipping into the price.
- Relisting: deletes history and URL, and earns a brief new-listing boost. Worth it when a listing has few favorites and a problem that editing cannot fix (a trademark in the URL slug, a suspected content rating).
- A shop announcement or policy untouched for years reads as abandoned; the traffic decline from 2022 tracked inactivity.
- Offsite Ads: 15% on attributed orders, capped at $100 per order, and **optional** while trailing-365-day sales are under $10,000. Once a shop reaches $10,000 the rate drops to 12% and enrollment becomes permanent.

### B.2 Photo slot order

1. Primary: in a room for scale, or an in-room mockup — not a mockup in every slot
2. Straight-on, true color
3. Raking-light macro showing carved depth
4. Angle showing panel thickness or frame
5. Back and hanging hardware
6. Scale reference
7. Signature
8. Process photo, if one exists
9–10. Alternate rooms or details
Video: a slow pan across the surface.

Avoid a shop logo in a photo slot and watermarks on listing photos.

### B.3 Content that has triggered problems

- A reclining figure in swimwear and a large photorealistic skull both appeared in listings whose public page metadata carried an adult content rating. The cause was never confirmed; relisting with a different primary image was the chosen remedy. Track with `suppression_suspected`.
- Round crops of rectangular compositions cut essential elements.
- Kitchen counters, warm bulbs, and cluttered backgrounds read as amateur.

### B.4 Trademark blocklist seed

Case-insensitive, whole-word where sensible. Editable in Settings.

`vw`, `volkswagen`, `vw bus`, `nfl`, `mlb`, `nba`, `ncaa`, `texas longhorns`, `topps`, `peanuts`, `snoopy`, `disney`, `marvel`, `packers`, `patriots`, `bills`, `seahawks`, `rams`, `chargers`, `ravens`, `orioles`, `terrapins`, `terps`, `green bay`, and player names from A.3.

The single word `longhorn` is a cattle breed and fine; `texas longhorns` is the University of Texas mark.

### B.5 Process paragraph

Use the short form in kiosk and listings, the long form in the Etsy About section.

*Short*
> Every piece starts the same way: the whole panel is scorched black. Then I carve back into it, removing char to reveal the pale wood underneath. The image emerges by subtraction. There's no undo.

*Long*
> Most wood burning starts with a blank panel and adds dark lines. I work the other way around. Every piece begins by scorching the entire surface black. Then I carve back into it, cutting away char to uncover the pale wood underneath. Every light area you see is wood I removed. Nothing is drawn on, and there is no undo — a slip doesn't get erased, it becomes part of the piece. That's why a small portrait can take forty hours and a large landscape fifteen. It depends on how much detail has to come out of the dark, not on how big the panel is.

### B.6 Description templates

*Original*
```
{{subject_line}} — burned and carved into {{substrate}}. One of a kind, signed, {{framed_phrase}}.

{{process_short}}

{{history_paragraph}}

Measures {{width_in}} × {{height_in}} × {{depth_in}} in. {{substrate_note}}. {{frame_sentence}} {{hardware_sentence}}
```

*Print*
```
{{subject_line}} — a {{print_substrate}} print of an original burned and carved into wood.

{{process_short}}

The original measured {{orig_width}} × {{orig_height}} in and took about {{hours}} hours. {{original_status_sentence}}

Sizes
{{variant_lines}}

{{print_substrate_sentence}} {{hardware_sentence}} Made to order.
```

*Custom (shared by all three custom listings)*
```
A hand-carved portrait in burnt wood, made from your photograph.

I don't draw on the wood. The whole panel gets scorched black first, then I carve back into it, cutting away char to uncover the pale wood underneath. Every highlight is wood I removed. Nothing is added, and there's no undo.

That's why a portrait takes 25 to 50 hours depending on how many subjects are in it.

How it works
1. Message me with your photo before ordering so I can tell you whether it will carve well
2. Choose your size and number of subjects
3. I send progress photos as I go
4. Your piece ships framed, signed, and ready to hang

What makes a good photo: strong light, clear contrast, faces in focus. I'll tell you honestly before you pay if yours won't work.

Sizes and pricing
{{commission_price_lines}}

Timing: {{processing_min}} to {{processing_max}} weeks. Holiday orders by {{holiday_cutoff}}.
```

Sports custom listing adds: *Portraits are made from your own photograph of your own athlete.*

### B.7 Drafted titles and tags

**Longhorn skull flag (canvas)**
Title: American Flag Wall Art, Longhorn Skull Canvas Print, Rustic Patriotic Western Decor, Distressed Flag Art, Ranch Farmhouse Wall Hanging
Tags: american flag art, rustic flag decor, longhorn skull art, western wall art, patriotic wall art, cow skull decor, distressed flag, ranch house decor, southwestern decor, veteran gift, july 4th decor, large canvas art, farmhouse wall art

**Surf van (MDF)**
Title: Surf Van Wall Art, Vintage Camper Beach Print on Wood, Coastal Van Life Decor, Retro Surfer Gift, Boho Beach House Art
Tags: surf van wall art, van life decor, beach wall art, coastal wall decor, surfer gift, vintage van art, camper van art, hippie wall art, boho beach decor, wood burning art, pyrography print, surf shack decor, retro van art

**Cactus and longhorn skull (MDF)**
Title: Cow Skull Wall Art, Western Desert Cactus Print on Wood, Southwestern Boho Decor, Longhorn Skull Rustic Ranch Art
Tags: cow skull wall art, steer skull decor, western wall art, boho desert decor, cactus wall art, southwestern decor, longhorn skull art, rustic wall art, wood burning art, desert wall art, ranch house decor, western gift, pyrography print

**Humpback whale (canvas)**
Title: Humpback Whale Wall Art, Large Coastal Canvas Print, Nautical Beach House Decor, Blue Ocean Whale Art, Carved Wood Reproduction
Tags: humpback whale art, whale wall art, coastal wall art, nautical wall decor, beach house decor, large canvas art, ocean wall art, whale canvas print, blue coastal decor, marine life art, beach wall art, whale lover gift, lake house decor

**Golf bag (original)**
Title: Golf Wall Art, Vintage Golf Bag Wood Carving, Original Clubhouse Decor, Antique Golfer Gift, Man Cave Sports Art, Handmade Wall Hanging
Tags: golf wall art, vintage golf decor, golf gift for him, clubhouse decor, man cave wall art, golf bag art, antique golf art, sports bar decor, original wood art, retirement gift, golfer gift, wood burning art, country club decor

**Moose (original)**
Title: Moose Wall Art, Scorched and Carved Wood, Original Cabin Decor, Rustic Lodge Wall Hanging, Woodland Nature Art, Hunting Cabin Gift
Tags: moose wall art, moose decor, cabin wall decor, lodge wall art, rustic wall art, wood burning art, pyrography art, original wood art, woodland decor, hunting cabin art, carved wood art, moose gift, log cabin decor

**Cilleyville bridge (original)**
Title: Cilleyville Covered Bridge Wood Burning Art, Andover NH Pyrography, Original Framed Wall Art, New Hampshire Winter Landscape
Tags: cilleyville bridge, bog bridge art, covered bridge art, new hampshire art, andover nh, pyrography art, wood burning art, new england decor, winter landscape, rustic wall art, original wood art, covered bridge gift, woodburned art

**Ship wheel (wood print)**
Title: Peace Sign Wall Art, World Map Ship Wheel Wood Print, Nautical Boho Decor, Travel Gift, Woodburned Globe Art
Tags: peace sign wall art, world map wall art, nautical wall decor, boho wall art, ship wheel decor, travel gift, globe wall art, wood burning art, coastal wall art, hippie home decor, pyrography print, world traveler gift, beach house art

**Custom pet portrait**
Title: Custom Pet Portrait on Wood, Hand Carved Pyrography from Your Photo, Dog Memorial Gift, Personalized Cat Portrait, Burnt Wood Art
Tags: custom pet portrait, pet memorial gift, dog portrait gift, custom dog art, cat portrait art, pet loss gift, personalized pet art, wood burned portrait, pet photo gift, dog mom gift, custom wood art, pyrography portrait, pet remembrance

**Custom family portrait**
Title: Custom Family Portrait on Wood, Hand Carved Pyrography from Your Photo, 5th Anniversary Wood Gift, Personalized Couple Portrait
Tags: custom portrait, family portrait art, anniversary gift, couple portrait, personalized gift, wedding gift art, custom wood art, photo to art gift, memorial portrait, parents gift, pyrography portrait, wood burned portrait, 5th anniversary

Wood is the traditional fifth-anniversary gift.

**Custom sports portrait**
Title: Custom Sports Portrait on Wood, Hand Carved Pyrography from Your Photo, Senior Night Gift, Coach Retirement Gift, Athlete Wall Art
Tags: custom sports art, senior night gift, coach gift, athlete portrait, football gift, baseball gift, sports wall art, team gift idea, custom wood art, personalized gift, pyrography portrait, graduation gift, sports memorabilia

### B.8 Open backlog at hand-off (22 September 2026)

Seed these as "Listings needing attention":

- Relist the longhorn skull flag with the B.7 title; suspected suppression
- Paint the roundel out of the surf van file, re-crop the primary, drop the round variant, relist
- Split the custom listing into three; adopt new prices; set quantity to 3 and processing to 6–8 weeks
- Whale and flag still start at $50; whale title not yet updated
- Toucan at $47 is off-range for the shop
- Shop section names still contain `||`
- Shop announcement routes custom requests to social media rather than the custom listing
- Etsy About section is empty (draft copy exists in B.5)
- Photograph every piece still on hand, outdoors, before listing
- List the pumpkins and gnomes while the season is open
- Decide whether to stay in Offsite Ads (optional under $10,000)

---

## Appendix C — Business context

### C.1 Baseline, all time through September 2026

| Measure | Value |
|---|---|
| Visits | 2,149 |
| Orders | 14 (the shop page shows 12 sales) |
| Revenue | $1,385 — about $99 per order |
| Conversion | 0.7% |
| Item favorites | 51 |
| Shop followers | 12 |
| Reviews | 3, all 5 stars |
| Repeat buyers | 2 |

Visits rose sharply around 2022 (about 640 a year), then declined to about 150 in 2026. Revenue per visitor rose in 2026. Zero abandoned carts suggests shoppers weren't being convinced, rather than being priced out.

### C.2 What the evidence shows

- **Color draws interest.** The two stained-color prints drew 18 and 10 favorites; monochrome listings drew about 2 each.
- **Lighthouses sell.** Four made, four sold. The best review is for an Assateague lighthouse.
- **Coastal is the natural lane.** The shop name, the best listing (whale), and the best review all point there.
- **Faces are the most expensive work.** 20–50+ hours regardless of size. Tower lighthouses run 10–15 hours; screw-pile lighthouses far more.
- **Sports portraits are the biggest seller overall.** About ten sold, nearly all offline, mostly to friends at about $150. One stranger found Scott through a Reddit post of another piece. Two friends became repeat buyers.
- **Etsy traffic for specific portraits is thin**, and the non-portrait work gets little social traction, so it rarely generates requests on its own.

### C.3 Strategy the app supports

- Offline commissions stay open for any subject, priced for the hours.
- The Etsy catalog is built from work that doesn't need a request: tower lighthouses as the core, screw-pile lighthouses as a premium tier, color where possible, seasonal pieces in season, plus mushrooms, the heron, and other clean subjects.
- Every finished piece is photographed properly before it leaves, so it becomes a permanent print master.
- Prints are made only from masters Scott owns at a resolution that supports the size.
- Social media is not a focus, and process documentation is not required.
- Craft fairs are a future channel, which is why kiosk mode and inventory exist.

### C.4 Review plan for the September 2026 listing changes

Measure Etsy-search views first. Expect little movement for two to three weeks while Etsy re-indexes.

- **30 days**: search views rising on the flag and cactus listings — the cleanest keyword tests, and the flag also tests whether relisting cleared the suspected suppression.
- **60 days**: favorites accumulating faster than before.
- **90 days**: visits on pace above 150 a year, conversion moving toward 1%, and one or two orders.
- **Stopping rule**: if search views are flat across every listing at 90 days, stop tuning Etsy and put those hours into the offline commission channel. Listing fixes should take about six hours in total; more than that is time away from the workbench.

The monthly snapshot (5.9) exists to make this review easy.
