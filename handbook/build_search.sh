#!/usr/bin/env bash
# Regenerate the search index for the SCEN Coordinator Handbook.
#
# 1. Builds the site into ./_site (a throwaway local build — NOT the deployment
#    artifact, which goes to ../backend/handbook-dist/). The build is needed so
#    heading anchors and page URLs are exactly what MkDocs produced.
# 2. Chunks every <h2> section into docs/assets/search/search-data.json.
#
# The index is TEXT-ONLY and loads no model, so this is fast. Ranking quality
# comes from the in-browser cross-encoder reranker at query time, not from here.
#
# Requires: uv (for mkdocs-material) and Node. One-time: cd search && npm install
set -euo pipefail
cd "$(dirname "$0")"

echo "==> mkdocs build (local, into ./_site)"
uv run --with mkdocs-material mkdocs build --config-file mkdocs.yml --site-dir _site

echo "==> generating search index"
cd search
node build_index.mjs

echo "==> done. Preview with:"
echo "    uv run --with mkdocs-material mkdocs serve --dev-addr 127.0.0.1:8001"
