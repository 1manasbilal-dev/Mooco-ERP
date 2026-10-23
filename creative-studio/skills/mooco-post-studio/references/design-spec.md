# Design spec

The spec turns the chosen concept into decisions the owner can execute without guessing.

## Spec format

```
Format:    Feed 4:5 (1080×1350) + Story 9:16 (1080×1920)
Route:     Gemini product edit / Canva template / Gemini scene (no product)
Layout:    [where product, headline, subline, logo, CTA, badge sit]
Colors:    [background, text, accent — palette names + hex]
Text:      Headline: "…" (Fredoka Bold) · Subline: "…" (Nunito SemiBold) · CTA: "…" · Price: only on offers
Mood:      [3–5 words: light, props, feeling]
```

## Production routes

| Route | When | How |
|---|---|---|
| **Gemini product edit** (default) | Any post showing a Mooco product | Attach the real pack photo; Gemini builds the scene around it; text added in Canva |
| **Canva template** | Text-heavy posts: offers with several items, rate lists, timings, announcements, app launch | Brand colors and a simple background (optionally a Gemini background without product) + product cut-out + text |
| **Gemini scene (no product)** | Greetings and respectful occasions | Calm scene, empty space for the message, logo small |

## Layouts by post type

**Product showcase (4:5)**
- Product 50–60% of the frame, slightly below center, on a styled surface.
- Headline in the top third (≤ 6 words), subline under it (≤ 10 words).
- Logo top-left (or top-right if the headline needs the left), small.
- CTA pill bottom-center, "mooco.pk par order karein".

**Recipe / idea (4:5, carousel optional)**
- Cover: the finished dish as hero with the Mooco product clearly beside it; headline like "5 minute ka raita".
- Carousel (optional, 3–5 slides): ingredients → 2–3 steps → final + CTA. Same background on all slides.
- Caption carries the full recipe; image text stays short.

**Offer / deal (4:5)**
- Style: Lime Pop. Big offer element (e.g. "20% OFF" or "1+1") in a Ghee Gold badge, product(s), price, deadline ("sirf Itwaar tak").
- This is the only post type where prices appear. Real prices only; otherwise `[PRICE]`.

**Occasion greeting (4:5)**
- Greeting is the hero ("Eid Mubarak"), product small or absent.
- Respectful occasions: calm palette, no badges, no product push, logo small at the bottom.

**Grocery delivery (other brands)**
- Grid or basket of items with "Mooco se poori grocery, ghar tak". No khalis/taaza promises for other brands; Mooco products may sit in front.

**Story / Status / TikTok (9:16)**
- Keep text, logo and price out of the top ~250 px and bottom ~340 px.
- One line of text, product big, CTA sticker-style ("Order: mooco.pk").

## Text hierarchy

| Element | Font | Size on 1080 px width | Max length |
|---|---|---|---|
| Headline | Fredoka Bold | 90–130 px | 6 words |
| Subline | Nunito SemiBold | 40–52 px | 10 words |
| CTA pill | Nunito ExtraBold | 36–44 px | 4–5 words |
| Badge / price | Fredoka Bold | 60–100 px | "Rs 300" / "20% OFF" |

Contrast rules from the brand kit apply, **measured against the real image area behind each element**: text ≥ 4.5:1, pills and badges ≥ 3:1 against their surroundings. On light photos use Pasture Green `#2F5A1E` headlines, Ink sublines, the split CTA pill (Ink pill + cream text + lime "mooco.pk →" chip) and the logo on a white chip. Lime pills only on dark backgrounds. Never white on lime or lime text on cream.

**CTA placement:** on the calmest area of the image (plain table, wall or background), never over the product, spoon, hands or busy props; align it with the text column or the opposite corner from the product.

## Fallback styles (only if `mooco-style-library` is unavailable)

1. **Doodh Fresh** — airy cream/makhan mesh, soft morning light, product hero. Milk, dahi, badam doodh showcases.
2. **Desi Kitchen** — warm Pakistani home kitchen or dastarkhwan, wood, steel and clay, hands serving. Recipes, kheer, family moments.
3. **Lime Pop** — bold lime gradient, graphic shapes, Ghee Gold badge. Offers and announcements.
4. **Golden Raat** — Raat Pasture dark background, warm golden rim light. Ghee, premium, night and Ramzan.
