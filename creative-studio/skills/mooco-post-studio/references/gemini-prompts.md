# Gemini prompts (Nano Banana)

The owner uses Gemini on the AI Pro plan (Nano Banana image model). ChatGPT free is the backup; Canva Free is used for text. Gemini responds best to a **descriptive paragraph** — describe the scene like a photographer's brief, not a list of keywords.

## Prompt structure for a product edit (default route)

Write one prompt in this order:

1. **Role of each attached image** — "Image 1 is my product photo." (+ "Image 2 is only a style reference for lighting and mood; do not copy its objects or brand.")
2. **Product lock** — "Keep the product exactly as it is in Image 1: same shape, label, logo, text, colors and size. Do not redraw, retype or restyle the pack. Show only this one pack." (For a deliberate multi-pack shot, give the exact number and say all are identical to Image 1.)
3. **Scene** — surface, background, props, setting (Pakistani home, kitchen, dastarkhwan, studio), time of day.
4. **Composition & camera** — product position, angle (eye-level, 45°, top-down), lens feel (50 mm, shallow depth of field), what is in focus.
5. **Light & mood** — soft morning window light / warm golden side light / studio with rim light; 3–5 mood words.
6. **Colors** — palette in words + hex from the brand kit and the chosen style.
7. **Text space** — "Leave the top third calm and empty (soft background only) for a headline added later."
8. **Format** — "Portrait 4:5." (Story: "Vertical 9:16, keep the top 15% and bottom 20% free of important details.")
9. **Exclusions** — "No text, letters, numbers, logos or watermarks anywhere except what is already printed on the pack. No people's faces." (Allow hands when the concept needs them.)

## Example — Dahi, Safe, Doodh Fresh style

Attach: `Mooco Dahi 500g.jpg`

```
Image 1 is my product photo of a Mooco Dahi 500g pouch. Keep the pouch exactly as it is: same shape, label, logo, text, colors and size. Do not redraw, retype or restyle the pack, and show only this one pouch.

Create an appetizing, airy product photo for social media. Place the pouch standing slightly right of center on a light wooden table in a bright Pakistani kitchen. Next to it, on the left, a white ceramic bowl of thick, creamy dahi with a spoon resting on the rim, a few fresh mint leaves and a small matka in the soft-focus background.

Camera at a 30-degree angle, 50 mm lens feel, shallow depth of field with the pouch and bowl in sharp focus. Soft morning window light from the left, gentle shadows, fresh and clean mood: fresh, homely, cool, inviting.

Colors: soft cream background (#FFF8E8) with a light buttery-yellow (#FFF0B3) glow and touches of fresh lime green (#98C237) from the mint and the pack.

Keep the top third of the image calm and empty for a headline that will be added later. Portrait 4:5. No added text, letters, numbers, logos or watermarks anywhere except what is already printed on the pouch. No people.
```

## Scene-only prompt (greetings, respectful occasions)

Skip the product lock; describe the scene, a calm empty area for the message (e.g. "a large soft empty space in the center"), the palette and the format. Respectful occasions: calm, minimal, no festive confetti, no food waste.

## Background-only prompt (Canva template route)

"Create a clean background for a social media offer post: a bold diagonal gradient from fresh lime green (#98C237) to deep leaf green (#4E7A1E) with soft rounded abstract shapes in light lime (#B9D96F) and a soft glow in the center. No objects, no text. Portrait 4:5." The product cut-out and text are placed in Canva.

## Dairy food-styling vocabulary

- **Milk:** condensation drops on a cold pack, a glass with a soft milk splash, morning sunlight, steel glass, chai cup with steam.
- **Dahi:** thick creamy swirl, spoon standing upright, clay matka, mint, cucumber, cumin sprinkle (raita), steel katori.
- **Ghee:** glistening golden texture, grainy desi look, warm brass or copper bowl, hot roti or paratha, halwa, warm side light.
- **Badam doodh:** almonds, a few saffron strands, cardamom, cold bottle with droplets or a warm cup in winter.
- **Kheer:** served in a clay or glass bowl, pistachio and almond slivers, silver varq (optional), cardamom, festive brass tray.

## ChatGPT variant (only if the owner asks)

Same paragraph, plus at the start: "Edit my uploaded photo." ChatGPT is weaker at keeping packs unchanged, so stress the product lock and expect to retry.

## Iterating

Always iterate **in the same Gemini chat** with one short edit line at a time (see `qa.md`). A new chat loses what already worked. If after 3 edits the pack keeps changing, start a new chat, attach the photo again and add "The product must look exactly like the attached photo — this is critical."
