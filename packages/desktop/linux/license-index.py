#!/usr/bin/env python3
"""Writes <dir>/index.json from the licence files in <dir>/<library>/, in the shape the libs
releases use, for the modules this manifest builds:
  license-index.py <dir>"""
import json
import os
import sys

root = sys.argv[1]
libraries = [
    {'name': name, 'files': sorted(os.listdir(os.path.join(root, name)))}
    for name in sorted(os.listdir(root))
    if os.path.isdir(os.path.join(root, name))
]
with open(os.path.join(root, 'index.json'), 'w', encoding='utf8') as f:
    json.dump({'libraries': libraries}, f, indent=1)
