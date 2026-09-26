#!/usr/bin/env python3
"""Fills a metainfo file's <releases> from release-please's CHANGELOG.md.

    metainfo-releases.py <metainfo.xml> <CHANGELOG.md> <Cargo.toml>

A version the changelog does not have yet, such as a nightly, goes first as a
development release dated today.
"""
import datetime
import html
import re
import sys

KEEP = 10

metainfo_path, changelog_path, cargo_path = sys.argv[1:4]
version = re.search(r'^version = "([^"]+)"', open(cargo_path, encoding="utf-8").read(), re.M).group(1)
try:
    changelog = open(changelog_path, encoding="utf-8").read()
except FileNotFoundError:
    changelog = ""

# "## [0.2.0](https://…/compare/…) (2026-09-30)" or "## 0.2.0 (2026-09-30)"
heading = re.compile(r"^## \[?(\d[^\]\s]*)\]?(?:\([^)]*\))? \((\d{4}-\d{2}-\d{2})\)", re.M)
releases = []
matches = list(heading.finditer(changelog))
for i, m in enumerate(matches):
    body = changelog[m.end() : matches[i + 1].start() if i + 1 < len(matches) else len(changelog)]
    notes = []
    for line in body.splitlines():
        if not line.startswith("* "):
            continue
        text = line[2:]
        text = re.sub(r"^\*\*[^*]+:\*\* ", "", text)  # "**desktop:** "
        text = re.sub(r" \(\[[^\]]*\]\([^)]*\)\)", "", text)  # " ([abc123](…))"
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
        notes.append(text.strip())
    releases.append((m.group(1), m.group(2), "stable", notes))

if version not in [r[0] for r in releases]:
    releases.insert(0, (version, datetime.date.today().isoformat(), "development", []))

lines = ["<releases>"]
for ver, date, kind, notes in releases[:KEEP]:
    attrs = f'version="{html.escape(ver)}" date="{date}"' + ("" if kind == "stable" else f' type="{kind}"')
    if not notes:
        lines.append(f"    <release {attrs} />")
        continue
    lines.append(f"    <release {attrs}>")
    lines.append("      <description>")
    lines.append("        <ul>")
    lines += [f"          <li>{html.escape(n)}</li>" for n in notes]
    lines.append("        </ul>")
    lines.append("      </description>")
    lines.append("    </release>")
lines.append("  </releases>")

metainfo = open(metainfo_path, encoding="utf-8").read()
metainfo = re.sub(r"<releases>.*?</releases>", "\n".join(lines), metainfo, flags=re.S)
open(metainfo_path, "w", encoding="utf-8").write(metainfo)
