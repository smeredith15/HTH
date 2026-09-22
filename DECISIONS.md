# Decisions

Assumptions made while building, per SPEC §0: *"When a requirement is ambiguous,
choose the option that asks less of the owner, note the assumption here, and ask."*

Anything in here is reversible. Say the word and it changes.

---

## Answered by the owner before Phase 2

| Question | Answer |
|---|---|
| Print vendor / giclée | **CanvasChamp** (canvaschamp.com). Recorded as `print_vendor` on the three canvas listings. The process stays `unknown` — see below. |
| `{{history_paragraph}}` source | **A new public `history` field.** Separate from private `notes`. |
| Split the custom listing | **Yes, seed all three** (pet, family, sports) as drafts from B.7. |
| Branch | Phase 1 merged to `main`; Phase 2 built on a branch restarted from it. |

### The giclée question — settled

CanvasChamp's own product pages answer it, and the answer is no. Two different
processes, neither of them giclée:

| Line | What the vendor says | `print_process` |
|---|---|---|
| Canvas | "UV-resistant & solvent-free **latex inks**" on premium poly-cotton canvas over a wood frame | `digital` |
| Wood | "We print directly on wood with permanent **UV ink**" onto "MDF composite wood material" | `uv_direct` |

Giclée means archival **pigment** ink on a fine-art substrate. Latex is a
durable inkjet process and UV-cured ink is durable too, but neither is that.
So `print_process` is now recorded as confirmed fact rather than `unknown`, and
`print_vendor: 'CanvasChamp'` is on all six print listings.

**What this changes:**

1. The **whale and the flag** sit in Etsy's *Giclée* category on a claim the
   vendor does not support. The validator flags both. The fix is moving them to
   *Digital Prints* — which is what `suggestCategoryPath` now proposes for
   every one of these listings, since none can be giclée.
2. `suggestMaterials` used to put **"archival ink"** on every print. That was
   wrong and is now derived from the process: `latex ink`, `uv ink`, or
   `archival pigment ink` — and **nothing at all** when the process is
   unconfirmed, because an unsupported claim is worse than a missing one.
3. A new check, `archival_claim`, catches "archival" anywhere in a print's
   title, description or materials unless the process really is giclée. A
   companion note flags "museum quality", which is the vendor's marketing
   phrase rather than a property of the listing. A test asserts that no
   generated listing can produce a claim its own validators would reject.
4. The print description now carries an accurate ink sentence:
   *"The inks are solvent-free and UV-resistant."* for canvas,
   *"The ink is permanent UV ink, cured onto the surface."* for wood.
   Those are claims that can be stood behind.

### CanvasChamp contradicts itself on the wood substrate

Their wood page says the panels are "Chromaluxe Wooden Panels" in one section
and "MDF composite wood material" in another. The spec calls the surf van and
cactus prints "print on MDF" and the ship wheel a "wood print", so the seed
keeps `mdf` for the first two and `wood_panel` for the third. Worth one
question to the vendor if the Etsy materials list needs to be exact — it is the
kind of small contradiction §1.1 is about.

### Their recommended input resolution is far above ours

CanvasChamp asks for 1040 DPI input on wood prints. §5.4's limits stay at
150 DPI good / 100 DPI floor, because those are the spec's numbers and they are
the right thresholds for judging a master. But it does mean the lost-catalog
problem is worse than the app currently shows: files that clear our 150 DPI bar
may still be below what the vendor wants.

## Answered by the owner before Phase 1

| Question | Answer |
|---|---|
| How much to build in one pass | **Phase 1 only, then review.** |
| Budgeting — the spec has pricing and per-sale net but no expense ledger | **Add an expenses module.** Date, amount, category, vendor, note, optional artwork link, feeding a profit view and a year-to-date summary. |
| Two devices, two IndexedDB databases | **Phone-primary.** The Pixel is the device of record; the desktop is read-mostly and imports from it. |
| A public web portfolio as well as the kiosk | **Yes.** Same `catalog.json`, a responsive gallery at the Pages URL, shareable from Etsy or a business card. Kiosk stays a separate fullscreen mode. |

Consequences already in the code:

- **Phone-primary** shaped the admin UI: 44 px minimum touch targets throughout
  (not just in kiosk), navigation pinned under the thumb below 720 px, 16 px
  form text so iOS does not zoom on focus, no hover-only affordances.
- **Phone-primary** also made import a **merge** rather than an overwrite. A
  blind replace would silently discard whichever device was edited second.
  `mergeStore` takes the newer `updated_at` per record and reports anything
  divergent without a usable timestamp instead of picking for you. Replace is
  still available and says plainly what it will do.
- **The expenses module** has its store and settings (`expense_categories`)
  wired into the schema, export and import now, so no migration is needed
  later. Its screens land with the rest of the money features in Phase 6.

---

## Print costs (added after Phase 2)

Scott can buy canvas or MDF prints from CanvasChamp, or genuine giclée from
Nations Photo Lab, which is local to him. §8.1's price floor is built on hours,
which is the right question for an original and the wrong one for a print: a
print costs what the lab charges, however long the original took. So prints get
their own arithmetic.

### The template

`Settings → Print costs`, or `#/print-costs`. Four lab lines × twelve sizes =
48 rows, **all blank**. Blank is the normal state — fill in only the sizes
worth offering and delete the rest. Nothing is guessed, because a margin built
on an invented cost is worse than no margin at all.

The twelve sizes are the five the live listings already sell (8 × 12, 12 × 12,
12 × 18, 16 × 24, 24 × 24) plus the common ladder. Sizes are matched
orientation-agnostically, so a 16 × 20 row covers a 20 × 16 variant.

Filling 48 cells on a phone is friction, so the template round-trips through
CSV: download, fill the `unit_cost` column in a spreadsheet, upload. Only the
columns present in the file are touched, so a two-column `id,unit_cost` sheet
changes only the price. Unknown ids are reported rather than silently creating
rows, and a blank cell clears a value rather than reading as zero.

### The arithmetic

`fulfilment` on each lab decides which postage Scott actually pays:

| | Inbound | He posts it |
|---|---|---|
| `dropship` — lab ships to the buyer | lab's charge | no |
| `receive_and_ship` — lab ships to him | lab's charge | yes |
| `local_pickup` — he collects | none | yes |

Nations is seeded `local_pickup`, which is worth real money: being local saves
the inbound leg on every print.

    landed  = lab cost + inbound + postage out + packaging
    breakEven = (landed + fixed fees) ÷ (1 − fee rate)
    target    = (landed + fixed fees) ÷ (1 − fee rate − margin)

Default target margin is **55%** of the sale price, with postage at $12 and
packaging at $2.50 — all three editable on the same screen. None of these are
in §5.10; they are additions.

### What it drives

1. **A lab comparison**, per size, cheapest first. The gap between two rows is
   what genuine giclée costs the buyer. Worked example with $20 CanvasChamp
   canvas against $34 Nations giclée at 16 × 20: $40.50 landed against $48.50,
   so $115.35 against $137.89 at the same margin — **+$22.54** on the shelf.
2. **Per-variant margin in the listing editor** — landed cost, break even,
   target and what the current price actually leaves, for every variant whose
   size is priced.
3. **A new `print_below_cost` check**, at `stop` level. Unlike the hours floor,
   this one is not a judgement call: under it, every sale loses money. A
   separate `print_margin` note fires when a price clears cost but misses the
   target margin.

### The two labs quote different products

Established October 2026, and it matters more than the headline prices do:

- **CanvasChamp** quotes a finished piece. Proofing and hanging hardware are in
  the price, so nothing is added to make it ready to hang.
- **Nations Photo Lab** quotes a bare print. Ready to hang needs a 3/16 in
  white foamcore mount at roughly **50% of the base price again**.

Comparing $20 against $34 without that is comparing a finished canvas against a
sheet of paper. Each product line therefore carries `includes` and `finishing`,
and the mount lands inside the landed cost rather than beside it. The Mount
column can be unticked to price a bare print, or typed over with a flat figure
when the percentage is wrong.

### Both labs drop-ship

Confirmed by the owner, October 2026. Neither lab is handled by Scott: no
inbound leg, no postage out, no packaging. Landed cost is the lab's price plus
the lab's own shipping, plus mounting where the lab does not include it.

CanvasChamp also carries a `quality_checked_on` date — they have produced good
work before. Nations is **assumed** good pending a proof, so its comparison
rows still say "not proofed" until one has been ordered and approved.

### Superseded: Nations drop-ships

They are local, but their site offers no in-person collection, and their
postage is likely cheaper than Scott's. So `fulfilment` is `dropship`: they
ship to the buyer, their shipping charge is the only postage, and Scott pays no
packaging.

That is a real asymmetry against CanvasChamp, which is `receive_and_ship` —
Scott pays inbound, postage out and packaging on every one of those. It is
worth checking whether CanvasChamp will drop-ship too, because it is worth
about $14.50 a print.

Worked at 16 × 20 on the real quotes, both labs drop-shipping:

| | Landed | Target at 55% |
|---|---|---|
| CanvasChamp canvas $22.27, hardware included | $32.26 | $92.14 |
| Nations giclée $39.85 + $19.93 mount | $69.73 | $197.69 |

Genuine giclée more than doubles the shelf price at that size.

### What the real quotes showed (22 September 2026)

**The MDF line cannot carry the shop's prices.** CanvasChamp wood runs about
28¢ a square inch against 6¢ for canvas — three to four times the cost for the
same image. The cactus print's sizes today:

| Size | Price | Landed | Profit | Margin | Break even |
|---|---|---|---|---|---|
| 12 × 8 | $55 | $40.18 | $9.14 | 17% | $44.90 |
| 18 × 12 | $75 | $58.96 | $8.46 | 11% | $65.65 |
| 24 × 16 | $140 | $117.31 | $8.94 | 6% | $130.12 |

Every size earns about nine dollars, and the largest is $10 above the price at
which it earns nothing. Reaching the target margin at 24 × 16 would mean $331.72,
which is not a price anyone pays for a print.

**Canvas is the opposite story.** 24 × 36 canvas lands at $41.99, so the whale
and flag listings' top variant at $340 runs a 78% margin. Their $50 entry
variant runs 25%.

**Giclée paper is cheapest at small sizes and dearest at large.** Below about
12 × 12 it beats canvas even after mounting; from 16 × 20 up it is roughly
double. That suits it as a small premium option rather than the large-format
one.

**Nations giclée on canvas is entirely unpriced**, and it is the only true
like-for-like against CanvasChamp canvas.

### Cost sanity checks

Lab price ladders are lumpy, so the check only fires when a print at least 10%
larger costs at least 10% less — an inversion that is either a sale or a typo.
A loose per-square-inch guard catches a misplaced decimal point. Tighter
thresholds flagged fourteen things on Scott's real data, almost all of them
aspect-ratio granularity; these thresholds flag three, and all three are real.

### CSV import creates sizes it has not seen

Scott's own file carried fourteen sizes the seeded template never had, and the
first import silently dropped every one of them — which also hid one of the
three anomalies. A row whose id is unknown is now created, as long as it
carries a size and a line that can be read from its id or its vendor columns.
Without that, an export could not rebuild a catalogue after browser storage was
cleared, which is exactly what an export is for.

### Neither lab is proofed yet

Each lab carries a `quality_checked_on` date, empty until Scott has held one of
their prints and been happy with it. Until then every comparison row says "not
proofed", because a cost comparison between two products nobody has seen is
only half an answer.

### Open

The template is empty until Scott fills it. Until then the margin columns stay
blank and the check stays quiet — it never invents a cost to have something to
say.

Whether CanvasChamp will drop-ship is unasked, and worth about $14.50 a print.

## Assumptions made without asking

### 0. Two B.6 templates deviate from the spec text

B.6's print template reads *"The original measured {{orig_width}} ×
{{orig_height}} in and took about {{hours}} hours."* — but §2.1 makes every
field optional, and most seeded pieces have no hours. Rendered verbatim that
produces *"took about  hours."*, and a piece with no dimensions produces
*"Measures  ×  in."*

The fragile placeholders are therefore composed sentences that vanish cleanly
when the record cannot supply them:

| Was | Now |
|---|---|
| `Measures {{width_in}} × {{height_in}} × {{depth_in}} in. {{substrate_note}}.` | `{{measures_sentence}} {{substrate_note_sentence}}` |
| `The original measured {{orig_width}} × {{orig_height}} in and took about {{hours}} hours.` | `{{original_size_sentence}}` |

The raw values are still in the template context, so a hand-edited template can
use them. Templates are editable in Settings and resettable to the B.6 seeds.

The renderer also fixes article agreement — B.6's *"a {{print_substrate}}
print"* produced *"a MDF print"*.

### 1. Seed visibility

§5.1 defaults `visibility` to `private`, so importing Appendix A verbatim would
leave the catalog builder and kiosk with nothing to show.

**Assumed:** the nine pieces currently listed on Etsy (A.1) seed as `public`.
Everything else — the whole portfolio in A.2, every sports portrait in A.3, and
all the ideas in A.4 — seeds `private`.

The sports portraits are deliberate: §A.3 says they stay offline private
commissions, and they all carry `public_figure_likeness` and
`trademark_or_logo`. `tests/seed.test.js` asserts none of them can seed public.

### 2. `estimated_shipping` is in the price-floor formula but is not a field

§8.1's formula has an `estimated_shipping` term and no field in §5 supplies one.

**Assumed:** a settings value, `default_shipping_estimate`, seeded at **$20**,
overridable per artwork through an `estimated_shipping` field. Change the
default in Settings → Your rate.

### 3. "Print master coverage" means a *usable* master

§6.4 asks for "percentage of artworks with a usable master". §5.4 has both an
`exists` boolean and a `print_ready` enum, and Hooper Strait shows why they are
not the same thing: a file exists, it is 1,440 px, it prints to 9.6 in, and the
spec marks it `no`.

**Assumed:** coverage and the completeness meter count `exists && print_ready !== 'no'`.
On that reading, **not one piece that has left the studio can be printed today** —
which is the §1.1 problem stated as a number. The artwork page distinguishes
"no master at all" from "a master that is not good enough".

### 4. Seed records carry the hand-off date

Records created at seed time would otherwise be stamped with the moment the
browser first loaded them, which makes a freshly-seeded device look like it
just edited all 61 pieces — and a merge import would then let the seed beat
real work. Seed rows carry `2026-09-22`, the date Appendix A was read.

### 5. Single dark theme

§11 asks for a cool mid-tone ground that flatters dark, warm artwork. The admin
is one dark theme rather than light/dark variants. Worth re-testing against the
real photographs once they exist — the spec says to, and there are no images in
the repo yet.

### 6. Tooling

- Tests run under Node's built-in runner: `npm test`. No dependencies, no build
  step. A browser test page can be added if you want to run them on the tablet.
- `package.json` exists only to set `"type": "module"` and hold two scripts.
  Nothing installs it and nothing bundles.
- Routes are hash-based (`#/catalog`) so the app works from a GitHub Pages
  subpath with no server rewrite rules.

---

## Open questions

Nothing is blocked on these — each has a working default in place.

1. **Committing from the phone.** Phone-primary and "edit a file and push"
   (§2.6) do not compose well: Android has no comfortable git client, and the
   publish step (§4.3) hands you a `catalog.json` plus images to commit by hand.
   Phase 7's direct commit through the GitHub API, with a fine-grained token
   scoped to this one repo and held only in IndexedDB, is probably worth pulling
   forward into Phase 4. Worth deciding before the publish step is built.
2. **GitHub Pages is not enabled** on `smeredith15/HTH` yet. That is a one-time
   toggle in the repository settings, and nothing is servable until it is on.
3. **The repository is public**, as §3 assumes. Confirmed on 22 September 2026.
4. **Appendix A has real gaps** — frame material on the moose, reference source
   on the Cilleyville bridge, disposition on about twenty portfolio pieces,
   hours on nearly everything. These import as blanks, and the completeness
   meter shows what each piece is missing. They do not need filling before
   Phase 2.
5. **Category for the two western pieces.** The cactus-and-skull and the
   flag-and-skull have no obvious home in the §5.1 enum; both seeded as `other`.
   A `western` category may be worth adding.
6. **Which wood panel does CanvasChamp actually use** — Chromaluxe or MDF
   composite? Their own pages say both. Only matters for the Etsy materials
   list being exact.
7. **No photographs exist in the repo.** Phase 3 builds the in-browser resizing
   and Phase 4 publishes images, but the kiosk and the portfolio will be empty
   until pieces are actually shot.

---

### 7. Holiday cutoff

B.6's custom template needs `{{holiday_cutoff}}` and nothing supplies a date.
Seeded at **23 October 2026** — Christmas minus the 8-week worst case, minus a
week to ship. Editable in Settings → Custom listings.

### 8. Seed catch-up on an already-seeded device

Phase 1 seeded 10 listings; Phase 2 adds three drafts and B.7's copy. Rather
than leave existing devices behind, the app tops itself up on boot: a seed row
is refreshed **only while its `updated_at` is still the 2026-09-22 seed date**,
which means it has never been touched. Anything edited keeps its own version.
Verified in a browser against a simulated Phase 1 database.

## Spec issues found

Recorded rather than fixed unilaterally.

1. **`asking_price` is public but `show_price_in_kiosk` is private.** §5.1 marks
   the price **P** and the show/hide flag **V**. The kiosk reads only
   `catalog.json`, so it would receive a price it has been told not to show —
   and a price meant to be hidden would sit in a public file regardless.
   **Proposed fix for Phase 4:** the catalog builder omits `asking_price`
   entirely when `show_price_in_kiosk` is false, so a suppressed price never
   reaches the public layer at all. Not yet implemented.
2. **Nested private fields.** §4.1 says `catalog.json` carries only **P** fields,
   but §5.1 marks `images` as **P/V** and §5.3 marks `Image.quality_flags` as
   **V**. The builder has to strip per-image private fields too, not just
   top-level ones. `PUBLIC_IMAGE_FIELDS` in `app/store/schema.js` is the
   allow-list for that; the Phase 4 test will assert against both.
3. **§7.4 lists 17 checks, not 16.** Counted: title length, title separators,
   title opener, tag count, tag length, tag form, tag duplicates, trademark
   terms, substrate consistency, dimension consistency, off-site redirects,
   round variant, print resolution, rights, price floor, processing vs
   quantity, giclée claim. All 17 are implemented, plus one the spec implies
   but does not tabulate: a suppression-suspected listing says so.
4. **The substrate validator needs to know about frames.** §7.4 says the
   description must not mention a substrate word other than the listing's own,
   but the golf bag is birch *in a pine frame* and the Cilleyville bridge hangs
   in a *gold metal float*. Taken literally the rule flags both. The
   implementation masks `frame_material`, `hanging_hardware` and `finish` out of
   the text before scanning.
5. **Both field lists are allow-lists, not deny-lists.** A field added to the
   model later is private until someone deliberately adds its name to
   `PUBLIC_ARTWORK_FIELDS`. That is the safer default for §2.3's "impossible to
   publish by accident", and `tests/schema.test.js` asserts the two lists never
   overlap.
