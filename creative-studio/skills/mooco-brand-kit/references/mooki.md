# Mooki — Mooco's mascot

Concept sketch: `../assets/mooki-concept.jpg`. Final approved artwork lives in Drive: `Mooco Creative Studio / 03_Brand-Kit / Mascot-Mooki`. Once that folder has a master sheet, it overrides the sketch.

## Character bible

| | |
|---|---|
| Name | **Mooki** |
| Who | Mooco family ka sab se chhota member — a baby calf (bachra), the little version of the cow in the logo |
| Look | Chibi proportions: big round head, small round body, short legs |
| Eyes | Two huge round eyes with thick lime rims, exactly like the two "O"s of the logo; big dark pupils with white sparkles |
| Colors | Body Mooco Lime `#98C237`; belly and tail tuft Doodh Cream `#FFF8E8`; inner ears and hooves Olive Leaf `#6F8A3C`; muzzle soft green `#C9E28E` with olive nostrils; small cream horn buds `#FFF0B3`; soft pink cheeks |
| Signature item | Ghee Gold `#F2C14E` bell on a gold collar — always visible |
| Personality | Joyful, curious, a bit naughty but innocent, loves food, greets everyone with a happy "Moo!" |
| Never | Sad, angry, scary, injured, eating meat, doing anything unsafe, or replacing the logo |

## How Mooki is used

- **Supporting character, not the logo.** The real logo still appears on every post.
- **Fixed sticker pack first.** Consistency comes from a fixed set of approved poses (transparent PNGs in the Drive folder) that are placed in Canva — not from generating a new Mooki for every post.
- When a post needs a new pose, generate it in Gemini **with the master sheet attached** and the instruction "keep Mooki exactly the same character". Add the approved result to the sticker pack.
- Mooki never holds or wears a fake Mooco pack. Next to products Mooki points, hugs a plain glass or bowl, or reacts; the real product photo stays the hero.
- Respectful occasions (Ashura, 12 Rabi ul Awal, Kashmir Day, Defence Day): no Mooki, or a calm, quiet pose only — never jokes.

## Sticker pack (v1 target: 12 poses)

1. Waving hello — default
2. Thumbs-up hoof with a wink — "approved / order confirmed"
3. Excited jump with sparkles — offers and announcements
4. Hugging a glass of milk — product posts
5. Licking lips next to a bowl of dahi — food posts
6. Pointing sideways — "yeh dekho" for prices and CTAs
7. Sunglasses with a glass of lassi — summer
8. Scarf, sleepy, cup of warm milk — winter
9. Small lantern (fanoos) and crescent — Ramzan
10. Eid joy with a small gift — Eid
11. Holding a Pakistan flag — 14 August / 23 March
12. Chef cap with a spoon — recipes

## Gemini prompts (Nano Banana, Gemini AI Pro)

Gemini cannot make transparent backgrounds. Always generate on a plain solid background, then remove it with a free background remover (Adobe Express, remove.bg) before saving the PNG to the Drive folder. Canva Free has no background remover.

### Step 1 — master design
Attach: the Mooco logo + `mooki-concept.jpg`.

> Using the attached logo and sketch as reference, design a cute baby calf mascot named "Mooki" for a Pakistani dairy brand called Mooco. Keep these exact colors: body lime green #98C237, belly and tail tuft cream #FFF8E8, inner ears and hooves olive green #6F8A3C, muzzle soft light green #C9E28E with olive nostrils, tiny cream horn buds, soft pink cheeks, and a golden bell on a gold collar #F2C14E. Huge round shiny eyes with thick lime-green rims, exactly like the two O letters in the logo. Chibi proportions: big round head, small round body, short legs. Joyful, innocent, friendly smile. Style: {STYLE}. Full body, front view, standing, centered, on a plain solid cream background #FFF8E8. No text, no logo, no other objects.

`{STYLE}` options — make both and choose one:
- **3D:** "soft 3D character render, Pixar-like, smooth matte clay texture, soft studio lighting, gentle shadow under the feet"
- **Flat:** "clean flat 2D vector illustration matching the logo style, soft simple shading, smooth rounded shapes"

### Step 2 — turnaround sheet
> Create a character turnaround sheet of exactly this same Mooki: front, three-quarter, side and back views in one row, same size, same colors, same proportions and the same bell. Plain solid cream background #FFF8E8. No text.

### Step 3 — sticker poses
> Using exactly this same Mooki character (same colors, eyes, proportions and gold bell), draw 6 separate poses in a 3×2 grid with generous space between them, on a plain solid white background: {POSES}. Keep the character identical in every pose. No text, no logo.

Use the sticker pack list above for `{POSES}` (two batches of six).
