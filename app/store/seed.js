// Seed catalog — SPEC Appendix A, as read on 22 September 2026.
//
// `?` in the spec imports as null so Scott can fill it in; unknown disposition
// imports as the `unknown` enum value. Rights flags are the September 2026
// reading and are advisory — every one of them is editable.
//
// Visibility: the nine pieces currently listed on Etsy (A.1) seed as `public`
// so the catalog builder and kiosk have something to show. Everything else —
// including every sports portrait — seeds `private`. See DECISIONS.md.

import { newArtwork } from './schema.js';

// Appendix A was read on this date. Seed records carry it rather than the
// moment they were loaded: a device that re-seeds must not look like it edited
// all 61 pieces just now, or a merge import would let the seed beat real work.
export const SEED_AT = '2026-09-22T00:00:00.000Z';

const A1 = [
  {
    id: 'cilleyville-covered-bridge',
    title: 'Cilleyville Covered Bridge',
    subject_name: 'Cilleyville Bridge (Bog Bridge)',
    subject_location: 'Andover, NH',
    category: 'architecture',
    status: 'finished',
    disposition: 'available',
    visibility: 'public',
    on_hand: true,
    width_in: 12, height_in: 12, shape: 'square',
    framed: true, frame_material: 'gold metal float',
    asking_price: 285,
    techniques: ['scorch_and_carve'],
    history: 'Built in 1887, the Cilleyville Bridge is a Town lattice truss and one of the last of its kind in the region. It was added to the National Register of Historic Places in 1989. Locals still call it the Bog Bridge.',
    notes: 'Winter scene. Reference source unknown — fill in.',
    reference_source: null,
    rights: { flags: [], print_ok: null, listing_ok: null },
    primary_listing_url: 'https://www.etsy.com/listing/4577252633',
  },
  {
    id: 'moose',
    title: 'Scorched wood moose',
    subject_name: 'Moose',
    category: 'wildlife',
    status: 'finished',
    disposition: 'available',
    visibility: 'public',
    on_hand: true,
    width_in: 16, height_in: 12, shape: 'rect',
    substrate: 'pine',
    framed: false, frame_material: null,
    asking_price: 250,
    techniques: ['scorch_and_carve'],
    notes: 'VERIFY EVERY SPEC. This listing once carried the golf bag’s dimensions (18.5 × 31, birch with pine frame) because it was built by copying that listing. Frame unknown.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/4301574396',
  },
  {
    id: 'surf-van',
    title: 'Surf van beach art',
    subject_name: 'Surf van',
    category: 'coastal',
    status: 'finished',
    disposition: 'unknown',
    visibility: 'public',
    on_hand: false,
    width_in: 24, height_in: 24, shape: 'square',
    techniques: ['scorch_and_carve'],
    notes: 'Original is gone. Backlog: paint the VW roundel out of the print file, re-crop the primary image, drop the round variant, relist to replace the old /vw/ URL slug. Suppression suspected.',
    rights: {
      flags: ['trademark_or_logo', 'family_personal'],
      edits_required: 'Paint VW roundel out of print file',
      notes: 'Roundel carved on the nose. The figure on the roof is Scott’s wife.',
    },
    primary_listing_url: 'https://www.etsy.com/listing/1884246466',
  },
  {
    id: 'western-cactus-longhorn-skull',
    title: 'Cactus and longhorn skull',
    subject_name: 'Cactus and longhorn skull',
    category: 'other',
    status: 'finished',
    disposition: 'unknown',
    visibility: 'public',
    width_in: 24, height_in: 16, shape: 'rect',
    substrate: 'birch',
    techniques: ['scorch_and_carve', 'stain', 'relief_carve'],
    notes: 'Listing has video. Not suppressed. Owner confirmed the 24 × 16 print looks good.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/1759413854',
  },
  {
    id: 'golf-bag',
    title: 'Vintage golf bag',
    subject_name: 'Vintage golf bag',
    category: 'still_life',
    status: 'finished',
    disposition: 'available',
    visibility: 'public',
    on_hand: true,
    width_in: 18.5, height_in: 31, depth_in: 1, shape: 'rect',
    substrate: 'birch',
    framed: true, frame_material: 'pine',
    hanging_hardware: 'sawtooth',
    asking_price: 495,
    techniques: ['scorch_and_carve'],
    notes: 'Has video and a process photo. Suggested channel: country clubs, not Etsy browse.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/1239539354',
  },
  {
    id: 'toucan',
    title: 'Toucan',
    subject_name: 'Toucan',
    category: 'wildlife',
    status: 'finished',
    disposition: 'unknown',
    visibility: 'public',
    techniques: ['paint'],
    notes: 'Painted, not scorched. $47 is off-range and off-technique for the shop — see backlog.',
    rights: { flags: [] },
    primary_listing_url: 'https://www.etsy.com/listing/1167916799',
  },
  {
    id: 'humpback-whale',
    title: 'Humpback whale',
    subject_name: 'Humpback whale',
    category: 'wildlife',
    series: 'Coastal',
    status: 'finished',
    disposition: 'sold',
    visibility: 'public',
    substrate: 'pine',
    techniques: ['scorch_and_carve', 'paint', 'stain'],
    colors: ['blue', 'white', 'gold'],
    notes: 'Best-performing listing: 18 favorites, 2 sales, 5-star review Nov 2022. Original sold. Title not yet updated; still starts at $50.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/1167279219',
  },
  {
    id: 'longhorn-skull-flag',
    title: 'American flag with longhorn skull',
    subject_name: 'American flag with longhorn skull',
    category: 'other',
    status: 'finished',
    disposition: 'unknown',
    visibility: 'public',
    substrate: 'pine',
    techniques: ['scorch_and_carve', 'stain', 'relief_carve'],
    colors: ['red stain', 'blue stain'],
    notes: 'Roughly 2:1. 10 favorites, 1 sale. Suppression suspected. Title still says "Texas Longhorn" (B.4) and should lead with "American Flag". Bedroom mockup is currently the primary image.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/1167295187',
  },
  {
    id: 'peace-sign-globe-ship-wheel',
    title: 'Ship wheel, globe, peace sign',
    subject_name: 'Ship wheel, globe and peace sign',
    category: 'other',
    status: 'finished',
    disposition: 'unknown',
    visibility: 'public',
    shape: 'square',
    techniques: ['scorch_and_carve'],
    notes: '1 favorite. Stone-wall mockup is a broken semi-transparent composite; the round crop cuts the wheel handles. Drop the round variant.',
    rights: { flags: ['own_design'] },
    primary_listing_url: 'https://www.etsy.com/listing/1851378216',
  },
];

const A2 = [
  {
    id: 'hooper-strait-lighthouse',
    title: 'Hooper Strait Lighthouse',
    subject_name: 'Hooper Strait Lighthouse',
    subject_location: 'St. Michaels, MD',
    category: 'lighthouse', series: 'Lighthouses',
    status: 'finished', disposition: 'commission_delivered',
    techniques: ['scorch_and_carve', 'stain'],
    colors: ['red stain'],
    notes: 'Screw-pile. Red sky in stain. Dated July 1 2023; the date was digitally removed in a copy. Far more than 15 hours. ACTION: borrow it back and reshoot — the only file is 1,440 px.',
    print_master: {
      exists: true, long_edge_px: 1440, print_ready: 'no',
      retouch_notes: 'Commission date digitally removed in one copy.',
      capture_notes: 'Low-resolution file only. Reshoot required.',
    },
    rights: {
      flags: ['family_personal'],
      print_ok: 'yes',
      notes: 'Owner reports the family is fine with prints.',
    },
  },
  { id: 'assateague-lighthouse-1', title: 'Assateague Lighthouse', subject_name: 'Assateague Lighthouse', subject_location: 'Assateague Island, VA', category: 'lighthouse', series: 'Lighthouses', status: 'finished', disposition: 'sold', techniques: ['scorch_and_carve'], notes: 'Tower. Sold via Etsy listing 1244975730 — 5-star review, July 2022. No print master.', rights: { flags: ['own_design'] } },
  { id: 'assateague-lighthouse-2', title: 'Assateague Lighthouse (red and white)', subject_name: 'Assateague Lighthouse', subject_location: 'Assateague Island, VA', category: 'lighthouse', series: 'Lighthouses', status: 'finished', disposition: 'sold', techniques: ['scorch_and_carve', 'stain'], colors: ['red stain', 'white stain'], notes: 'Tower. No print master.', rights: { flags: ['own_design'] } },
  { id: 'cape-hatteras-lighthouse-1', title: 'Cape Hatteras Lighthouse', subject_name: 'Cape Hatteras Lighthouse', subject_location: 'Buxton, NC', category: 'lighthouse', series: 'Lighthouses', status: 'finished', disposition: 'sold', framed: true, techniques: ['scorch_and_carve'], notes: 'Tower. Tall vertical framed panel. No print master.', rights: { flags: ['own_design'] } },
  { id: 'cape-hatteras-lighthouse-2', title: 'Cape Hatteras Lighthouse (second)', subject_name: 'Cape Hatteras Lighthouse', subject_location: 'Buxton, NC', category: 'lighthouse', series: 'Lighthouses', status: 'finished', disposition: 'sold', framed: true, techniques: ['scorch_and_carve'], notes: 'Tower. Tall vertical framed panel. No print master.', rights: { flags: ['own_design'] } },
  { id: 'blue-crab', title: 'Chesapeake blue crab', subject_name: 'Blue crab', subject_location: 'Chesapeake Bay', category: 'coastal', status: 'finished', disposition: 'available', on_hand: true, techniques: ['scorch_and_carve'], notes: 'Owner considers it the weakest piece.', rights: { flags: ['own_design'] } },
  { id: 'atlas-statue', title: 'Atlas statue with gold drips', subject_name: 'Atlas statue', category: 'other', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve', 'gold_leaf'], rights: { flags: ['third_party_photo'], notes: 'Worked from a found photograph.' } },
  { id: 'mushroom-panel', title: 'Row of mushrooms', subject_name: 'Mushrooms', category: 'still_life', status: 'finished', disposition: 'unknown', shape: 'rect', techniques: ['scorch_and_carve'], notes: 'Horizontal panel.', rights: { flags: ['own_design'] } },
  { id: 'pumpkins', title: 'Jack-o’-lantern and gourds', subject_name: 'Pumpkins', category: 'seasonal', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve'], notes: 'Seasonal — list by early October.', rights: { flags: ['own_design'] } },
  { id: 'gnome-triptych', title: 'Three gnome panels', subject_name: 'Gnomes', category: 'seasonal', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve'], notes: 'Three panels on a burned base. The most commercial piece in the portfolio, and repeatable. Seasonal — list while the season is open.', rights: { flags: ['own_design'] } },
  { id: 'bears-moonlight', title: 'Mother bear and cub under a blue moon', subject_name: 'Bears', category: 'wildlife', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve', 'stain'], colors: ['blue stain'], notes: 'Has an in-room mockup.', rights: { flags: ['own_design'] } },
  { id: 'horse-live-edge', title: 'Horse head on a live-edge round', subject_name: 'Horse', category: 'wildlife', status: 'finished', disposition: 'unknown', shape: 'live_edge', substrate: 'live_edge_round', techniques: ['scorch_and_carve'], rights: { flags: ['own_design'] } },
  { id: 'surfer-longboard', title: 'Surfer with longboard', subject_name: 'Surfer', category: 'coastal', status: 'finished', disposition: 'unknown', shape: 'rect', techniques: ['scorch_and_carve'], notes: 'Tall narrow panel.', rights: { flags: ['own_design'] } },
  { id: 'astronaut-profile', title: 'Astronaut profile in a helmet', subject_name: 'Astronaut', category: 'other', status: 'finished', disposition: 'unknown', has_face: true, subject_count: 1, techniques: ['scorch_and_carve'], rights: { flags: ['own_design'] } },
  { id: 'porthole-seahorse', title: 'Seahorse in a porthole', subject_name: 'Seahorse', category: 'coastal', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve'], notes: 'Seahorse in a porthole with kelp.', rights: { flags: ['own_design'] } },
  { id: 'skateboard-astronaut', title: 'Astronaut on a skateboard deck', subject_name: 'Astronaut', category: 'other', status: 'finished', disposition: 'unknown', substrate: 'skateboard_deck', techniques: ['scorch_and_carve', 'gold_leaf'], rights: { flags: ['own_design'] } },
  { id: 'snoopy-snowman', title: 'Snowman with Peanuts characters', subject_name: 'Snowman', category: 'seasonal', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve'], rights: { flags: ['third_party_artwork', 'trademark_or_logo'] } },
  { id: 'anime-swordsman', title: 'Anime-style swordsman', subject_name: 'Swordsman', category: 'fantasy', status: 'finished', disposition: 'unknown', techniques: ['scorch_and_carve', 'stain'], colors: ['color'], rights: { flags: ['third_party_artwork'] } },
  { id: 'rose-glasses-portrait', title: 'Portrait in rose glasses', category: 'portrait_person', status: 'finished', disposition: 'kept', has_face: true, subject_count: 1, techniques: ['scorch_and_carve', 'stain'], colors: ['purple stain'], notes: 'Scott’s wife.', rights: { flags: ['family_personal'] } },
  { id: 'couple-portrait-1', title: 'Couple portrait', category: 'portrait_person', status: 'finished', disposition: 'commission_delivered', has_face: true, subject_count: 2, techniques: ['scorch_and_carve'], rights: { flags: ['customer_photo'] } },
  { id: 'couple-portrait-2', title: 'Couple portrait (second)', category: 'portrait_person', status: 'finished', disposition: 'commission_delivered', has_face: true, subject_count: 2, techniques: ['scorch_and_carve'], rights: { flags: ['customer_photo'] } },
  { id: 'blue-heeler-puppy', title: 'Blue heeler puppy', category: 'portrait_pet', status: 'finished', disposition: 'commission_delivered', subject_count: 1, techniques: ['scorch_and_carve'], rights: { flags: ['customer_photo'] } },
  { id: 'golfer-school-logo', title: 'Golfer with a school logo', category: 'sports', status: 'finished', disposition: 'commission_delivered', has_face: true, subject_count: 1, techniques: ['scorch_and_carve'], rights: { flags: ['trademark_or_logo', 'customer_photo'] } },
];

// A.3 — sports portraits. All carry public_figure_likeness and
// trademark_or_logo; listing_ok and print_ok default to `no`. Owner intends to
// keep offering these as private, offline commissions. Most sold to friends
// for about $150.
const SPORTS = [
  ['tom-brady', 'Tom Brady', 'sold', 'Patriots.'],
  ['len-bias', 'Len Bias', 'sold', ''],
  ['puka-nacua-1', 'Puka Nacua', 'gifted', 'Rams. Made for a family member; posted to Reddit.'],
  ['puka-nacua-2', 'Puka Nacua (second)', 'sold', 'Rams. Sold to a stranger through the Etsy custom listing — small, one subject. Source: Reddit.'],
  ['aaron-rodgers', 'Aaron Rodgers', 'sold', 'Sold to a friend.'],
  ['jordan-love', 'Jordan Love', 'sold', 'Packers. Same friend as Aaron Rodgers — repeat buyer.'],
  ['ladainian-tomlinson', 'LaDainian Tomlinson', 'sold', 'Sold to a friend.'],
  ['russell-wilson', 'Russell Wilson', 'sold', 'Seahawks. Same friend as LaDainian Tomlinson — repeat buyer.'],
  ['josh-allen', 'Josh Allen', 'sold', 'Bills.'],
  ['orioles-1970-world-series', 'Orioles 1970 World Series celebration', 'sold', ''],
  ['gunnar-henderson-card', 'Gunnar Henderson, Topps card design', 'unknown', 'Also third_party_artwork — the card design is Topps’.'],
];

const A3 = SPORTS.map(([id, title, disposition, note]) => ({
  id,
  title,
  subject_name: title.replace(/ \(second\)$/, ''),
  category: 'sports',
  status: 'finished',
  disposition,
  has_face: id !== 'gunnar-henderson-card',
  subject_count: id === 'orioles-1970-world-series' ? null : 1,
  techniques: ['scorch_and_carve'],
  asking_price: null,
  notes: [note, 'Most sports portraits sold offline to friends for about $150.'].filter(Boolean).join(' '),
  rights: {
    flags: id === 'gunnar-henderson-card'
      ? ['public_figure_likeness', 'trademark_or_logo', 'third_party_artwork']
      : ['public_figure_likeness', 'trademark_or_logo'],
    print_ok: 'no',
    listing_ok: 'no',
    notes: 'Offline, private commissions only.',
  },
}));

// A.4 — ideas.
const IDEAS = [
  ['assateague-lighthouse-3', 'Assateague Lighthouse (print-scale remake)', 'lighthouse', 'Tower, 10–15 hours. Proven seller. Remake at print scale, in color.', ['own_design'], 'Assateague Island, VA'],
  ['cape-hatteras-lighthouse-3', 'Cape Hatteras Lighthouse (print-scale remake)', 'lighthouse', 'Tower. Remake at print scale.', ['own_design'], 'Buxton, NC'],
  ['currituck-beach-lighthouse', 'Currituck Beach Lighthouse', 'lighthouse', 'Tower.', ['own_design'], 'Corolla, NC'],
  ['bodie-island-lighthouse', 'Bodie Island Lighthouse', 'lighthouse', 'Tower.', ['own_design'], 'Outer Banks, NC'],
  ['concord-point-lighthouse', 'Concord Point Lighthouse', 'lighthouse', 'Tower.', ['own_design'], 'Havre de Grace, MD'],
  ['cove-point-lighthouse', 'Cove Point Lighthouse', 'lighthouse', 'Tower.', ['own_design'], 'Lusby, MD'],
  ['hooper-strait-lighthouse-2', 'Hooper Strait Lighthouse (remake)', 'lighthouse', 'Screw-pile, premium tier. Remake without the date, at print scale.', ['own_design'], 'St. Michaels, MD'],
  ['thomas-point-shoal-lighthouse', 'Thomas Point Shoal Lighthouse', 'lighthouse', 'Screw-pile, premium tier.', ['own_design'], 'Annapolis, MD'],
  ['great-blue-heron', 'Great blue heron', 'wildlife', 'Use a public-domain or own reference — not the watermarked stock image.', [], 'Chesapeake Bay'],
  ['amanita-mushroom', 'Yellow amanita', 'still_life', 'Own photo reference.', ['own_photo_reference'], null],
  ['bike-at-huntington-pier', 'Bike at Huntington Pier', 'coastal', 'Own photo. Bus seen from the rear — check for marks before listing.', ['own_photo_reference', 'family_personal'], 'Huntington Beach, CA'],
  ['bixby-bridge-kelp', 'Bixby Bridge under water with shark and kelp', 'landscape', 'Own composite reference.', ['own_photo_reference', 'own_design'], 'Big Sur, CA'],
  ['beach-meditation', 'Surfer meditating on the sand', 'coastal', 'Own photo reference.', ['own_photo_reference'], null],
  ['moonbeam-ocean', 'Moonbeam over the ocean', 'coastal', 'Inspiration only — the reference is someone else’s work. The sketch must be an original composition.', ['third_party_artwork'], null],
  ['kingfisher', 'Kingfisher', 'wildlife', 'Inspiration only — the reference is someone else’s work. The sketch must be an original composition.', ['third_party_artwork'], null],
  ['arch-moon', 'Arch and moon', 'landscape', 'Inspiration only — the reference is someone else’s work. The sketch must be an original composition.', ['third_party_artwork'], null],
  ['jerry-garcia', 'Jerry Garcia', 'music', 'Intended for social engagement and private offers.', ['public_figure_likeness'], null],
  ['jimi-hendrix', 'Jimi Hendrix', 'music', 'Intended for social engagement and private offers.', ['public_figure_likeness'], null],
];

const A4 = IDEAS.map(([id, title, category, note, flags, location]) => ({
  id,
  title,
  subject_name: title.replace(/ \(.*\)$/, ''),
  subject_location: location,
  category,
  series: category === 'lighthouse' ? 'Lighthouses' : null,
  status: 'idea',
  disposition: 'unknown',
  has_face: ['jerry-garcia', 'jimi-hendrix'].includes(id),
  notes: note,
  rights: { flags },
}));

export const SEED_ARTWORKS = [...A1, ...A2, ...A3, ...A4].map((patch) => ({
  ...newArtwork(patch),
  created_at: SEED_AT,
  updated_at: SEED_AT,
}));

const CUSTOM_DRAFTS = [
  {
    id: 'lst-custom-pet', custom_kind: 'pet',
    title: 'Custom Pet Portrait on Wood, Hand Carved Pyrography from Your Photo, Dog Memorial Gift, Personalized Cat Portrait, Burnt Wood Art',
    tags: ['custom pet portrait', 'pet memorial gift', 'dog portrait gift', 'custom dog art', 'cat portrait art', 'pet loss gift', 'personalized pet art', 'wood burned portrait', 'pet photo gift', 'dog mom gift', 'custom wood art', 'pyrography portrait', 'pet remembrance'],
  },
  {
    id: 'lst-custom-family', custom_kind: 'family',
    title: 'Custom Family Portrait on Wood, Hand Carved Pyrography from Your Photo, 5th Anniversary Wood Gift, Personalized Couple Portrait',
    tags: ['custom portrait', 'family portrait art', 'anniversary gift', 'couple portrait', 'personalized gift', 'wedding gift art', 'custom wood art', 'photo to art gift', 'memorial portrait', 'parents gift', 'pyrography portrait', 'wood burned portrait', '5th anniversary'],
  },
  {
    id: 'lst-custom-sports', custom_kind: 'sports',
    title: 'Custom Sports Portrait on Wood, Hand Carved Pyrography from Your Photo, Senior Night Gift, Coach Retirement Gift, Athlete Wall Art',
    tags: ['custom sports art', 'senior night gift', 'coach gift', 'athlete portrait', 'football gift', 'baseball gift', 'sports wall art', 'team gift idea', 'custom wood art', 'personalized gift', 'pyrography portrait', 'graduation gift', 'sports memorabilia'],
  },
].map((draft) => ({
  ...draft,
  artwork_id: null,
  channel: 'etsy',
  listing_type: 'custom',
  status: 'draft',
  quantity: 3,                 // §B.1: made-to-order takes processing time, not quantity 1
  processing_weeks: [6, 8],
  free_shipping: true,
  materials: ['birch', 'pine frame', 'sealant'],
  category_path: 'Art & Collectibles > Drawing & Illustration > Portraits',
  variants: [
    { label: '8 × 10, 1 subject', width_in: 8, height_in: 10, shape: 'rect', price: 400 },
    { label: '11 × 14, 1 subject', width_in: 11, height_in: 14, shape: 'rect', price: 500 },
    { label: '11 × 14, 2 subjects', width_in: 11, height_in: 14, shape: 'rect', price: 650 },
    { label: '16 × 20, 1 subject', width_in: 16, height_in: 20, shape: 'rect', price: 650 },
    { label: '16 × 20, 2 subjects', width_in: 16, height_in: 20, shape: 'rect', price: 800 },
  ],
}));

// Listings from A.1.
//
// Print processes confirmed from CanvasChamp's own product pages (October 2026):
//   canvas  — "UV-resistant & solvent-free latex inks" on premium poly-cotton
//             canvas over a wood frame. Latex inkjet, so `digital`.
//   wood    — "We print directly on wood with permanent UV ink" onto "MDF
//             composite wood material", so `uv_direct`.
// Neither is giclée, which means archival pigment ink on a fine-art substrate.
// The whale and the flag therefore sit in Etsy's Giclée category on a claim the
// vendor does not support, and the validator says so. The generator and validators arrive in Phase 2; these are
// seeded now so the Etsy record is captured in one pass.
export const SEED_LISTINGS = withSeedDate([
  { id: 'lst-cilleyville', title: "Cilleyville Covered Bridge Wood Burning Art, Andover NH Pyrography, Original Framed Wall Art, New Hampshire Winter Landscape", tags: ["cilleyville bridge", "bog bridge art", "covered bridge art", "new hampshire art", "andover nh", "pyrography art", "wood burning art", "new england decor", "winter landscape", "rustic wall art", "original wood art", "covered bridge gift", "woodburned art"], artwork_id: 'cilleyville-covered-bridge', channel: 'etsy', etsy_listing_id: '4577252633', etsy_url: 'https://www.etsy.com/listing/4577252633', listing_type: 'original', status: 'active', variants: [{ label: '12 × 12', width_in: 12, height_in: 12, shape: 'square', price: 285 }], created_on: null },
  { id: 'lst-custom-portrait', artwork_id: null, channel: 'etsy', etsy_listing_id: '1863119781', etsy_url: 'https://www.etsy.com/listing/1863119781', listing_type: 'custom', status: 'active', quantity: 1, variants: [{ label: 'smallest', price: 150 }], description: 'To be split into pet, family and sports listings (B.7) and repriced per §8.2.', replaced_by: 'lst-custom-pet,lst-custom-family,lst-custom-sports' },
  { id: 'lst-moose', title: "Moose Wall Art, Scorched and Carved Wood, Original Cabin Decor, Rustic Lodge Wall Hanging, Woodland Nature Art, Hunting Cabin Gift", tags: ["moose wall art", "moose decor", "cabin wall decor", "lodge wall art", "rustic wall art", "wood burning art", "pyrography art", "original wood art", "woodland decor", "hunting cabin art", "carved wood art", "moose gift", "log cabin decor"], artwork_id: 'moose', channel: 'etsy', etsy_listing_id: '4301574396', etsy_url: 'https://www.etsy.com/listing/4301574396', listing_type: 'original', status: 'active', variants: [{ label: '16 × 12', width_in: 16, height_in: 12, shape: 'rect', price: 250 }] },
  { id: 'lst-surf-van', title: "Surf Van Wall Art, Vintage Camper Beach Print on Wood, Coastal Van Life Decor, Retro Surfer Gift, Boho Beach House Art", tags: ["surf van wall art", "van life decor", "beach wall art", "coastal wall decor", "surfer gift", "vintage van art", "camper van art", "hippie wall art", "boho beach decor", "wood burning art", "pyrography print", "surf shack decor", "retro van art"], artwork_id: 'surf-van', channel: 'etsy', etsy_listing_id: '1884246466', etsy_url: 'https://www.etsy.com/listing/1884246466', listing_type: 'print', print_substrate: 'mdf', print_process: 'uv_direct', print_vendor: 'CanvasChamp', status: 'active', suppression_suspected: true, variants: [{ label: '12 × 12', width_in: 12, height_in: 12, shape: 'square', price: 80 }, { label: 'round', shape: 'round', price: 80 }] },
  { id: 'lst-cactus-skull', title: "Cow Skull Wall Art, Western Desert Cactus Print on Wood, Southwestern Boho Decor, Longhorn Skull Rustic Ranch Art", tags: ["cow skull wall art", "steer skull decor", "western wall art", "boho desert decor", "cactus wall art", "southwestern decor", "longhorn skull art", "rustic wall art", "wood burning art", "desert wall art", "ranch house decor", "western gift", "pyrography print"], artwork_id: 'western-cactus-longhorn-skull', channel: 'etsy', etsy_listing_id: '1759413854', etsy_url: 'https://www.etsy.com/listing/1759413854', listing_type: 'print', print_substrate: 'mdf', print_process: 'uv_direct', print_vendor: 'CanvasChamp', status: 'active', suppression_suspected: false, variants: [{ label: '12 × 8', width_in: 12, height_in: 8, shape: 'rect', price: 55 }, { label: '18 × 12', width_in: 18, height_in: 12, shape: 'rect', price: 75 }, { label: '24 × 16', width_in: 24, height_in: 16, shape: 'rect', price: 140 }] },
  { id: 'lst-golf-bag', title: "Golf Wall Art, Vintage Golf Bag Wood Carving, Original Clubhouse Decor, Antique Golfer Gift, Man Cave Sports Art, Handmade Wall Hanging", tags: ["golf wall art", "vintage golf decor", "golf gift for him", "clubhouse decor", "man cave wall art", "golf bag art", "antique golf art", "sports bar decor", "original wood art", "retirement gift", "golfer gift", "wood burning art", "country club decor"], artwork_id: 'golf-bag', channel: 'etsy', etsy_listing_id: '1239539354', etsy_url: 'https://www.etsy.com/listing/1239539354', listing_type: 'original', status: 'active', variants: [{ label: '18.5 × 31', width_in: 18.5, height_in: 31, shape: 'rect', price: 495 }] },
  { id: 'lst-toucan', artwork_id: 'toucan', channel: 'etsy', etsy_listing_id: '1167916799', etsy_url: 'https://www.etsy.com/listing/1167916799', listing_type: 'print', print_substrate: 'canvas', print_process: 'digital', print_vendor: 'CanvasChamp', status: 'active', variants: [{ label: 'standard', price: 47 }] },
  { id: 'lst-humpback-whale', title: "Humpback Whale Wall Art, Large Coastal Canvas Print, Nautical Beach House Decor, Blue Ocean Whale Art, Carved Wood Reproduction", tags: ["humpback whale art", "whale wall art", "coastal wall art", "nautical wall decor", "beach house decor", "large canvas art", "ocean wall art", "whale canvas print", "blue coastal decor", "marine life art", "beach wall art", "whale lover gift", "lake house decor"], artwork_id: 'humpback-whale', channel: 'etsy', etsy_listing_id: '1167279219', etsy_url: 'https://www.etsy.com/listing/1167279219', listing_type: 'print', print_substrate: 'canvas', print_process: 'digital', print_vendor: 'CanvasChamp', status: 'active', favorites_snapshot: 18, category_path: 'Giclée', variants: [{ label: 'from', price: 50 }, { label: 'largest', price: 340 }] },
  { id: 'lst-longhorn-skull-flag', title: "American Flag Wall Art, Longhorn Skull Canvas Print, Rustic Patriotic Western Decor, Distressed Flag Art, Ranch Farmhouse Wall Hanging", tags: ["american flag art", "rustic flag decor", "longhorn skull art", "western wall art", "patriotic wall art", "cow skull decor", "distressed flag", "ranch house decor", "southwestern decor", "veteran gift", "july 4th decor", "large canvas art", "farmhouse wall art"], artwork_id: 'longhorn-skull-flag', channel: 'etsy', etsy_listing_id: '1167295187', etsy_url: 'https://www.etsy.com/listing/1167295187', listing_type: 'print', print_substrate: 'canvas', print_process: 'digital', print_vendor: 'CanvasChamp', status: 'active', favorites_snapshot: 10, suppression_suspected: true, category_path: 'Giclée', variants: [{ label: 'from', price: 50 }, { label: 'largest', price: 340 }] },
  { id: 'lst-peace-sign', title: "Peace Sign Wall Art, World Map Ship Wheel Wood Print, Nautical Boho Decor, Travel Gift, Woodburned Globe Art", tags: ["peace sign wall art", "world map wall art", "nautical wall decor", "boho wall art", "ship wheel decor", "travel gift", "globe wall art", "wood burning art", "coastal wall art", "hippie home decor", "pyrography print", "world traveler gift", "beach house art"], artwork_id: 'peace-sign-globe-ship-wheel', channel: 'etsy', etsy_listing_id: '1851378216', etsy_url: 'https://www.etsy.com/listing/1851378216', listing_type: 'print', print_substrate: 'wood_panel', print_process: 'uv_direct', print_vendor: 'CanvasChamp', status: 'active', favorites_snapshot: 1, variants: [{ label: 'square', shape: 'square', price: 80 }, { label: 'round', shape: 'round', price: 80 }] },
  // B.8: split the $150 custom listing into three, adopt the §8.2 prices, set
  // quantity to 3 and processing to 6–8 weeks. Seeded as drafts — nothing is
  // live on Etsy until Scott creates them there.
  ...CUSTOM_DRAFTS,
]);

function withSeedDate(rows) {
  return rows.map((row) => ({ ...row, created_at: SEED_AT, updated_at: SEED_AT }));
}

// Appendix B.8 — open backlog at hand-off, seeded as "listings needing attention".
export const SEED_BACKLOG = [
  'Relist the longhorn skull flag with the B.7 title; suspected suppression',
  'Paint the roundel out of the surf van file, re-crop the primary, drop the round variant, relist',
  'Split the custom listing into three; adopt new prices; set quantity to 3 and processing to 6–8 weeks',
  'Whale and flag still start at $50; whale title not yet updated',
  'Toucan at $47 is off-range for the shop',
  'Shop section names still contain ||',
  'Shop announcement routes custom requests to social media rather than the custom listing',
  'Etsy About section is empty (draft copy exists in B.5)',
  'Photograph every piece still on hand, outdoors, before listing',
  'List the pumpkins and gnomes while the season is open',
  'Decide whether to stay in Offsite Ads (optional under $10,000)',
].map((text, i) => ({
  id: `backlog-${i + 1}`, text, done: false, created_at: SEED_AT, updated_at: SEED_AT,
}));
