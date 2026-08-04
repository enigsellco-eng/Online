#!/usr/bin/env bash
# Re-stamp styles.css / app.js in index.html with a hash of their contents.
#
# GitHub Pages serves assets with max-age=14400 but HTML with max-age=600, so a
# visitor can run new markup against a four-hour-old script. Versioning the
# query string means changed files get a new URL and are fetched immediately.
#
# Run this after editing styles.css or app.js, before committing.
set -euo pipefail
cd "$(dirname "$0")"

for asset in styles.css app.js; do
  hash=$(shasum -a 256 "$asset" | cut -c1-8)
  perl -pi -e "s{/\Q$asset\E(\?v=[0-9a-f]+)?}{/$asset?v=$hash}g" index.html
  echo "$asset -> v=$hash"
done
