# FILTER_SHEETS (R2-FILTERS): real names are for our records only, never in the game
Flow = the maker's maximum at zero head (not the flow at the game's head). src: f = maker page fetched, s = figures from a web-search summary of that listing (page itself not opened).

| kind | size | real product | flow L/h | head m | 2nd curve pt | W | tank L | media | tube mm | size mm | URL (src) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bed pump | S | Eheim compactON 300 | 170-300 adj. | 0.6 | not found | 7 | n/a | none | 12 suction | 38x72x62 | https://eheim.com/en_GB/aquatics/technology/pumps/compacton/compacton-600 (f, page lists 300-3000) |
| bed pump | M | Eheim compactON 600 | 250-600 adj. | 1.0 | not found | 7 | n/a | none | 12 suction | 38x72x62 | same (f) |
| bed pump | L | Eheim compactON 1000 | 400-1000 adj. | 1.4 | not found | 15 | n/a | none | 16 suction | 47x79x73 | same (f). Same page, bigger: 2100 = 1400-2100 L/h, 2.4 m, 38 W, 19 mm; 3000 = 1800-3000, 2.7 m, 55 W |
| HOB | S | Fluval AquaClear 20 | 379 | not found | not found | 7 (120 V) | 18-76 | foam, carbon, BioMax ceramic (litres not found) | not found | not found | https://fluvalaquatics.com/us/shop/product/fluval-aquaclear-20-power-filter-with-media-5-20-us-gal-18-76-l (s) |
| HOB | M | Fluval AquaClear 50 | 757 | not found | not found | 7 (120 V) | 76-190 | same three stages | not found | not found | https://fluvalaquatics.com/us/shop/product/fluval-aquaclear-50-power-filter-with-media-20-50-us-gal-76-190-l (s) |
| HOB | L | Fluval AquaClear 110 | 1892 | not found | not found | 14 (120 V) | 227-416 | same three stages | not found | not found | https://fluvalaquatics.com/us/shop/product/fluval-aquaclear-110-power-filter-with-media-60-110-us-gal-227-416-l (s); manual https://fluvalaquatics.com/manuals/AC110_Manual_English.pdf (not opened) |
| internal | S | Eheim aquaball 60 | 150-480 adj. | not found | not found | 5 | 30-60 | mech+bio cartridge, 0.18 L (types not found) | not found | dia 96 x 160 | https://eheim.com/media/pdf/a8/f4/20/EHEIM_-20aquaball_60_130_180_manual.pdf (s; maker manual listed, not opened) |
| internal | M | Eheim aquaball 180 | 210-650 adj. | not found | not found | 6 | 80-180 | same, 0.45 L (aquaball 130: 180-550 L/h, 6 W, 60-130 L, 0.32 L) | not found | dia 96 x 270 | same (s) |
| internal | L | Aquael Turbo Filter 2000 | 2000 adj. | not found | not found | 27 (230 V) | over 350 | not found | not found | not found | https://www.natureaquariums.com.au/products/aquael-turbo-filter-2000 (s, retailer; maker page not found) |

## Game names (invented; the existing gear is plain descriptive English, sentence case, no model codes)
- Bed pump: "Tower pump Tern" (S), "Tower pump Heron" (M), "Tower pump Crane" (L).
- Hang-on-back: "Hang-on-back filter Alder" (S), "Hang-on-back filter Birch" (M), "Hang-on-back filter Oak" (L).
- Internal: "Internal filter Pebble" (S), "Internal filter Cobble" (M), "Internal filter Boulder" (L).

## Existing kinds against the real range (equipment.js FILTERS rows at 164-173)
- sponge (pump 190 L/h, hmax 145 cm, working 120): flow is inside the real small-pump range (150-480 L/h), hmax is about 2.5x too high: the sheets give 0.6 m at 300 L/h and 1.0 m at 600 (a 190 L/h pump is nearer 0.4-0.5 m, guess).
- matten (150 L/h, hmax 80 cm): flow is at the very bottom of the real range (150 L/h is the aquaball 60 minimum), hmax about 2x high against 0.6 m at 300 L/h (guess 0.3-0.4 m at 150).
- canister (pump 560 L/h, hmax 150 cm, working 400): inside the usual 300-1000 L/h and 1.1-1.8 m head for a canister for 100-300 L, from memory only (no canister sheet fetched; not verified).
- Naming: "Sponge filter", "Corner foam filter (Mattenfilter)", "Canister filter", "Hang-on-back filter", "Internal filter", "False-bottom bed filter": kind first, plain words, no brand, no number.

## Not found
- Head (m) and a second curve point for every HOB and internal filter, and for the pumps (only max head on the pump pages); tube diameters of HOB and internal; media litres for HOB and Turbo 2000; media types for aquaball.
- A maker page for the large internal (Aquael): only a retailer listing. The aquaball range ends at 180 L; Fluval U4 (130-240 L, 1000 L/h, 10 W, search summary) is the nearest maker-named alternative.
- Noticed: equipment.js comments at lines 174 and 179 name real brands (AquaClear, Tidal, Fluval U, Eheim Pickup): code comments only, not shown to the player.
- Guess, not a sheet: HOB lift is small (an impeller lifting over a rim), so the existing hob hmax 120 cm is probably high; no sheet gave a number.
