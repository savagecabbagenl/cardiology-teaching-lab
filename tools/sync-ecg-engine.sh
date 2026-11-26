#!/usr/bin/env bash
# Rebuild ecg-basics/ecg-engine.js from the ECG Rhythm Lab so both tools share one conduction model.
# Run from the repo root after changing the engine in ecg-simulator/index.html.
set -euo pipefail
src=ecg-simulator/index.html
out=ecg-basics/ecg-engine.js
{
  echo "/* GENERATED from ecg-simulator/index.html by tools/sync-ecg-engine.sh. Do not edit by hand. */"
  # Engine: from the engine banner to the line before the UI's IIFE.
  awk '/^\/\* ECG engine/{on=1} on&&/^\(function\(\)\{/{exit} on{print}' "$src" | sed '$d'
  # Ladder diagram renderer (pure canvas function inside the UI block).
  awk '/^\/\/ ---------- ladder diagram/{on=1} /^\/\/ ---------- measurements/{exit} on{print}' "$src"
} > "$out"
node --check "$out"
echo "wrote $out ($(wc -c < "$out") bytes)"
