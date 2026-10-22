---
name: mooco-style-library
description: Library of visual styles for Mooco (Mooco.pk dairy) social media posts — each style is a full art-direction guide with when to use it, palette, composition, lighting, props, copy tone and Gemini prompt ingredients. Use whenever choosing or applying a look for a Mooco post, ad, story or banner, comparing styles for a brief, or when the owner asks which style suits a product, offer or occasion — usually together with mooco-post-studio and mooco-brand-kit.
---

# Mooco Style Library

A style decides how a post **looks**; the `mooco-brand-kit` decides what must stay **Mooco** in every post. Always apply both: chosen style + brand kit. When they conflict, the brand kit wins on logo, product truth, voice and text colors.

## Styles

| Style | File | Type | Best for | Avoid for |
|---|---|---|---|---|
| **Doodh Fresh** | `styles/doodh-fresh.md` | Core | Milk, dahi, badam doodh showcases; morning, summer, freshness | Offers with lots of text; night/premium |
| **Desi Kitchen** | `styles/desi-kitchen.md` | Core | Recipes, kheer, raita, family moments, Jumma, Ramzan sehri/iftar | Pure product showcases on busy weeks |
| **Lime Pop** | `styles/lime-pop.md` | Core | Offers, deals, announcements, app/website launch | Respectful occasions; slow, emotional posts |
| **Golden Raat** | `styles/golden-raat.md` | Core | Desi ghee, premium shots, night, Ramzan, winter warmth | Bright summer freshness; kids' posts |

These four are **house styles (v0)**, built from the brand kit so posts can start now. Styles learned from the owner's inspiration posts (Drive `00_Inbox` → `01_Styles`) will be added by `mooco-library-builder`, each in its own file with the same template (`styles/_template.md`).

## How to choose

Score each style 1–5 on:
1. **Goal fit** — sale → Lime Pop; recipe/engagement → Desi Kitchen; showcase → Doodh Fresh or Golden Raat.
2. **Product fit** — milk/dahi/badam doodh → Doodh Fresh; ghee → Golden Raat; kheer → Desi Kitchen.
3. **Occasion fit** — summer → Doodh Fresh; winter/night/Ramzan → Golden Raat or Desi Kitchen; Eid/14 Aug → Lime Pop or Desi Kitchen.
4. **Brand fit** — always 4–5 for house styles; check inspiration styles carefully.
5. **Freshness** — lower the score if the style was used in the last 2–3 posts.
6. **Results** — raise styles that performed well in the Post Log.

Keep the 80/20 rule: about 80% of posts from core styles so the feed looks like one brand, about 20% experiments. Within a week, avoid the same style twice in a row.

## Using a style

Read the chosen style file and take from it: the scene and composition for the Gemini prompt, the prompt ingredients, the avoid list, and the copy tone. Mention the style name in the Post Package so the Post Log can track results by style.
