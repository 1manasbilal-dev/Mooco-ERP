#!/usr/bin/env python3
"""Decode Google Drive `download_file_content` results into image files.

When a Drive download is too large for the chat, the tool result is saved as a
JSON file ({content, id, mimeType, title}). Pass those saved files here to get
real images you can open and look at.

Usage:
    python decode_drive_download.py OUT_DIR SAVED_RESULT.json [SAVED_RESULT.json ...]

Each image is written as OUT_DIR/<drive-id>__<title>, so the Drive id stays
attached to the file for moving and tagging it later.
"""
import base64
import json
import os
import sys


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    for path in sys.argv[2:]:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        title = os.path.basename(data.get("title") or "untitled").replace("/", "_")
        target = os.path.join(out_dir, f"{data['id']}__{title}")
        with open(target, "wb") as fh:
            fh.write(base64.b64decode(data["content"]))
        print(f"{data['id']}\t{title}\t{target}")


if __name__ == "__main__":
    main()
