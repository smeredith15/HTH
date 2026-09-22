# Decisions

Assumptions made while building, per SPEC §0: *"When a requirement is ambiguous,
choose the option that asks less of the owner, note the assumption here, and ask."*

Anything in here is reversible. Say the word and it changes.

---

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

## Assumptions made without asking

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
6. **No photographs exist in the repo.** Phase 3 builds the in-browser resizing
   and Phase 4 publishes images, but the kiosk and the portfolio will be empty
   until pieces are actually shot.

---

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
3. **Both field lists are allow-lists, not deny-lists.** A field added to the
   model later is private until someone deliberately adds its name to
   `PUBLIC_ARTWORK_FIELDS`. That is the safer default for §2.3's "impossible to
   publish by accident", and `tests/schema.test.js` asserts the two lists never
   overlap.
