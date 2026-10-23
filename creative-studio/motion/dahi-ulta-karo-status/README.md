# Dahi "Ulta Karo, Girega Nahi!" — WhatsApp Status motion (15 s, 1080×1920)

Explainer-style motion version of the dahi proof post: hook → proof shot with headline, ring and badges → "Kyun Mooco Dahi?" feature list → dark end card with CTA.

Render (needs Node Playwright, Chromium and ffmpeg):

```bash
mkdir -p frames
NODE_PATH=/opt/node22/lib/node_modules node render.js frames 30 15
ffmpeg -framerate 30 -i frames/f%04d.jpg -f lavfi -i anullsrc=r=44100:cl=stereo \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -c:a aac -b:a 96k -shortest \
  -movflags +faststart mooco-dahi-status.mp4
```

`node render.js stills 30 15 1.6,4.2,6.6,9.9,13.9` renders single frames for checking. Timings live in `window.render(t)` in `status.html`; `photo916.jpg` is the Gemini image cropped to 9:16. Text, logo and CTA stay between y = 250 and y = 1580 (WhatsApp/Instagram story safe zone).
