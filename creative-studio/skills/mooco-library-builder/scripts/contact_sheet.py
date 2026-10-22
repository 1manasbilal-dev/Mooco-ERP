#!/usr/bin/env python3
"""Build numbered contact sheets so many images can be reviewed in one look.

Usage:
    python contact_sheet.py IMAGE_DIR OUT_PREFIX [--per-sheet 16] [--cols 4] [--cell 320]

Writes OUT_PREFIX-1.jpg, OUT_PREFIX-2.jpg, ... and prints "number<TAB>file" for
every image so a number seen on a sheet can be traced back to its file (and
Drive id, when files are named <drive-id>__<title>).
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

EXTS = (".jpg", ".jpeg", ".png", ".webp")


def load_font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                 "/Library/Fonts/Arial Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image_dir")
    parser.add_argument("out_prefix")
    parser.add_argument("--per-sheet", type=int, default=16)
    parser.add_argument("--cols", type=int, default=4)
    parser.add_argument("--cell", type=int, default=320)
    args = parser.parse_args()

    files = sorted(f for f in os.listdir(args.image_dir) if f.lower().endswith(EXTS))
    font = load_font(max(14, args.cell // 16))
    cell, label_h = args.cell, max(26, args.cell // 10)
    for sheet_no, start in enumerate(range(0, len(files), args.per_sheet), 1):
        batch = files[start:start + args.per_sheet]
        rows = (len(batch) + args.cols - 1) // args.cols
        sheet = Image.new("RGB", (args.cols * cell, rows * (cell + label_h)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, name in enumerate(batch):
            number = start + i + 1
            img = Image.open(os.path.join(args.image_dir, name)).convert("RGB")
            img.thumbnail((cell - 12, cell - 12))
            x, y = (i % args.cols) * cell, (i // args.cols) * (cell + label_h)
            sheet.paste(img, (x + (cell - img.width) // 2, y + (cell - img.height) // 2))
            draw.rectangle([x + 4, y + 4, x + 4 + label_h * 1.6, y + 4 + label_h], fill="black")
            draw.text((x + 10, y + 6), str(number), fill="white", font=font)
            short = name.split("__", 1)[-1][:34]
            draw.text((x + 6, y + cell + 2), short, fill="black", font=load_font(max(11, args.cell // 26)))
            print(f"{number}\t{name}")
        out = f"{args.out_prefix}-{sheet_no}.jpg"
        sheet.save(out, quality=85)
        print(f"# sheet {sheet_no}: {out}")


if __name__ == "__main__":
    main()
