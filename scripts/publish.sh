#!/usr/bin/env bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
tag="${GITHUB_REF_NAME:-}"
if [[ -n "$tag" && "$tag" != "v${version}" ]]; then
  echo "tag ${tag} does not match package version ${version}" >&2
  exit 1
fi
if [[ "${DRY_RUN:-0}" == 1 ]]; then
  npm publish --dry-run --access public
  exit 0
fi
npm publish --access public --provenance
