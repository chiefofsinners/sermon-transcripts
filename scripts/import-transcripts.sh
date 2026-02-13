#!/bin/bash
# Reads transcript .txt files from data/transcripts/ and populates the
# "transcript" field in the matching data/sermons/<id>.json file.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export TRANSCRIPTS_DIR="$PROJECT_DIR/data/transcripts"
export SERMONS_DIR="$PROJECT_DIR/data/sermons"

python3 << 'PYTHON_SCRIPT'
import json
import glob
import os

transcripts_dir = os.environ["TRANSCRIPTS_DIR"]
sermons_dir = os.environ["SERMONS_DIR"]

txt_files = glob.glob(os.path.join(transcripts_dir, "*.txt"))
updated = 0
skipped = 0

for txt_path in sorted(txt_files):
    basename = os.path.splitext(os.path.basename(txt_path))[0]
    json_path = os.path.join(sermons_dir, f"{basename}.json")

    if not os.path.exists(json_path):
        print(f"  SKIP {basename} — no matching JSON file")
        skipped += 1
        continue

    with open(txt_path, "r") as f:
        transcript_text = f.read().strip()

    with open(json_path, "r") as f:
        sermon = json.load(f)

    sermon["transcript"] = transcript_text

    with open(json_path, "w") as f:
        json.dump(sermon, f, indent=2)

    print(f"  OK   {basename}")
    updated += 1

print(f"\nDone. Updated: {updated}, Skipped: {skipped}")
PYTHON_SCRIPT
