#!/usr/bin/env bash
#
# Regenerate all committed visual-regression baselines (app pages + Storybook).
#
# Baseline filenames include the OS platform (`-linux`, `-darwin`, …) because
# font rasterisation and antialiasing differ across OSes. Baselines MUST be
# generated on Linux to match CI — run this script inside a Linux container or
# CI runner, or locally if you are already on Linux.
#
# Usage:
#   scripts/visual/update-baselines.sh
#
# Optional env:
#   SKIP_STORYBOOK=1   only regenerate the page baselines (skips build-storybook)
#
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ "$(uname -s)" != "Linux" ]]; then
  cat >&2 <<'EOF'
warning: you are not on Linux. Baselines are platform-specific
(`*-chromium-<platform>.png`) and CI compares against the `-linux` set.
Generate on Linux (container/CI) or commit only the matching platform set.
EOF
fi

# Page/app baselines (spins up the dev server on port 3100 with mock auth).
npm run test:visual:update

# Storybook baselines — requires a fresh build of storybook-static/ first.
if [[ "${SKIP_STORYBOOK:-0}" != "1" ]]; then
  npm run build-storybook
  npm run test:storybook:visual:update
fi

cat <<'EOF'

Baselines regenerated. Review the new PNGs under:
  e2e/visual/baselines/
  e2e/storybook-visual/baselines/
git diff won't show pixel changes — open the files, then commit them with
your UI change.
EOF
