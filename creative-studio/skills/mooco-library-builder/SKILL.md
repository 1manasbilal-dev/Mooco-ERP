---
name: mooco-library-builder
description: Builds and maintains Mooco's style library from the owner's inspiration posts in Google Drive — analyzes every image in "Mooco Creative Studio/00_Inbox", writes a Style DNA card for each, clusters them into named styles with the owner's approval, moves them into 01_Styles folders, writes a style guide per style for mooco-style-library, and runs the monthly review of the Post Log to learn which styles actually perform. Use when the owner says things like "inbox analyze karo", "nayi posts daali hain", "styles banao", "library update karo", "folders mein sort karo" or "mahine ka review karo", or whenever new inspiration images need sorting.
---

# Mooco Library Builder

Turns "posts I like" into a style library Mooco can use — and later into "styles that actually sell".

Drive layout (folder names are fixed):
```
Mooco Creative Studio/
├── 00_Inbox/           new inspiration (unsorted)
├── 01_Styles/<Style>/  sorted inspiration, one folder per approved style
├── 02_Emerging/        candidates with fewer than 5 examples
├── 03_Brand-Kit/       logo, product photos (not touched here)
├── 04_Own-Winners/     Mooco's own best posts
├── 05_Outputs/         finished posts
├── Post Log            sheet: one row per published post + results
└── Mooco Occasion Calendar 2026-27
```

Talk to the owner in simple Roman Urdu. Never start the analysis on your own initiative — the owner decides when (it takes time and tokens).

## Step 0 — get the images in front of you

Find the inbox: Drive search `title = '00_Inbox'`, then list `parentId = '<inbox id>'` and follow every `nextPageToken` (pages can be short; drop repeated ids).

- **If you can run code** (Claude Code, cloud sessions, Cowork): call `download_file_content` for each image. Large results are saved to a file; decode them with `scripts/decode_drive_download.py OUT_DIR <saved files>` (files keep their Drive id as `<id>__<title>`). Then build numbered sheets with `scripts/contact_sheet.py OUT_DIR sheet --per-sheet 16` and look at each sheet. Open single images only when a detail matters.
- **If you cannot run code** (plain chat): ask the owner to upload the images into the chat in batches of 10–15, and number them as you go.

Start with a test batch of about 10 images, confirm the method works, then do the rest.

## Step 1 — Style DNA card for every image

Fill the card in `references/style-dna.md` for each image. Keep it compact; it is a tool for clustering, not an essay. If you can, save the card's one-line summary + tags into the image's Drive **description** (`update_file` → `description`) so the tags stay with the file and are searchable later.

Ignore an image's subject (lungs, phones, shoes…) when it doesn't matter: a pneumonia-awareness post can still teach a great layout. Judge what Mooco could learn from it.

## Step 2 — propose styles (owner approves)

Follow `references/clustering.md`: look across all cards, group by **look** (not by product or purpose), aim for 6–10 styles, each with at least 5 examples. Purpose (sale, recipe, festive…) stays a tag, not a folder.

Present the proposal in one message: per style a name, a one-line identity, the image numbers, the best-fit Mooco use, and one contact sheet per style if you can make them. Candidates with fewer than 5 examples go to `02_Emerging`. Ask the owner to approve, rename, merge or split. **Do not move any file before approval.**

## Step 3 — organize Drive

After approval:
1. Create `01_Styles/<Style-Name>` folders (`create_file` with `contentMimeType: application/vnd.google-apps.folder`).
2. Move each image with `update_file` (`parentId`), and rename it readably: `<style-slug>-<NN>-<2-3 words>.jpg` (e.g. `doodh-fresh-03-milk-splash.jpg`).
3. Move emerging images to `02_Emerging`, leave nothing in `00_Inbox`.
4. Verify by listing each folder; report counts.

## Step 4 — write the style guides

For each approved style, write `styles/<style-slug>.md` in the `mooco-style-library` skill using `styles/_template.md`, and add a row to the table in its SKILL.md. Write it **for Mooco**: what to adopt from the references, and how to adapt it to the brand kit (palette for text and brand elements, Fredoka/Nunito, real packs, Roman Urdu copy). List the 3 best reference images by their new Drive names. Mark it **Experiment** unless the owner says it is core.

Learn principles — composition, lighting, color mood, typography rhythm — never copy another brand's logo, text, mascot or exact layout.

Then hand back the updated skill: if you can edit files, update the skill folder and package it (`.skill` / zip) for the owner to re-upload; otherwise give the full new style file text for the owner to add.

## Step 5 — monthly upkeep

Run `references/monthly-review.md` when the owner asks for "mahine ka review" or after about 20 new posts in the Post Log: sort new inbox images into existing styles (or Emerging), promote Emerging groups that reached 5, and learn from the Post Log which styles and concepts perform.

## Ground rules

- Only the owner approves new styles and folder moves.
- Never trash or delete Drive files; move them. The connectors cannot restore a trashed file.
- Never touch `03_Brand-Kit` here.
- Report what you did with counts and links; if something failed (a download, a move), say exactly which files.
