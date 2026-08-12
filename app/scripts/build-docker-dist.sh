#!/bin/bash

# Build a self-contained MyReader web bundle for the MyBooks embedded-reader
# Docker deployment (see document/MyReader_Embedded_WebApp.md §12). Runs
# `pnpm build-web-standalone` and assembles the result into app/myreader-dist/,
# which is the exact directory layout the mybooks repo's Dockerfile expects at
# myreader-dist/ (see mybooks/Dockerfile, COPY myreader-dist/ /var/www/myreader/).
#
# Usage: pnpm build-docker-dist
# Output: app/myreader-dist/ (gitignored) — copy this whole directory into the
# mybooks repo root before `docker build`, e.g.:
#   rsync -a --delete app/myreader-dist/ ../mybooks/myreader-dist/
#
# Layout of myreader-dist/ (must match: don't flatten it, see below):
#   myreader-dist/node_modules/   workspace-root-level hoisted deps
#   myreader-dist/app/server.js   entry point — run as `node app/server.js`
#   myreader-dist/app/node_modules/, .next/, public/

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

DIST_DIR="myreader-dist"

echo "Building standalone Next.js bundle (pnpm build-web-standalone)..."
pnpm build-web-standalone

echo "Assembling $DIST_DIR/ ..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# outputFileTracingRoot points at the pnpm workspace root (see next.config.mjs),
# so Next's standalone tracer splits the output across two node_modules dirs:
# .next/standalone/node_modules (workspace-root-level, pnpm .pnpm store layout)
# and .next/standalone/app/node_modules (app-local). The app-local one contains
# *relative* symlinks like `next -> ../../node_modules/.pnpm/next@.../node_modules/next`
# that assume this exact two-level nesting (app/ one level inside the root that
# holds node_modules/.pnpm). Flattening the two node_modules into one directory
# breaks those relative symlinks (they'd point one level too far up once
# app/node_modules is merged into the same dir as the root node_modules) — so
# this preserves the whole .next/standalone/ tree as-is, root node_modules AND
# nested app/ folder, instead of merging.
#
# rsync (not `cp -r`) because Next's .pnpm store layout here contains dangling
# symlinks for packages the tracer intentionally didn't inline; `cp -r` on
# macOS/BSD follows symlinks and errors out on a broken target, rsync
# preserves them as-is like a real pnpm store does.
rsync -a .next/standalone/. "$DIST_DIR/"
rsync -a public/ "$DIST_DIR/app/public/"
mkdir -p "$DIST_DIR/app/.next/static"
rsync -a .next/static/ "$DIST_DIR/app/.next/static/"

# sharp (and its platform-specific native binaries, @img/sharp-*, @img/sharp-libvips-*)
# gets traced into node_modules even though we never call it: `images.unoptimized`
# is set in next.config.mjs, so Next never invokes sharp for image optimization.
# The native binaries are also built for this build machine's OS/arch (e.g.
# darwin-arm64) and wouldn't load inside the Linux production container anyway.
# Safe to drop; this leaves a few harmless dangling symlinks elsewhere in
# node_modules/.pnpm (nothing require()s them since sharp is never invoked).
echo "Removing unused sharp package and native binaries..."
find "$DIST_DIR/node_modules/.pnpm" -maxdepth 1 -type d \( -name 'sharp@*' -o -name '@img+sharp*' \) -exec rm -rf {} +

echo "Done: $APP_DIR/$DIST_DIR"
echo "Run it with: cd $DIST_DIR && node app/server.js"
echo "Copy it into the mybooks repo root as myreader-dist/ before docker build, e.g.:"
echo "  rsync -a --delete $APP_DIR/$DIST_DIR/ <path-to-mybooks>/myreader-dist/"
