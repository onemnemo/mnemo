#!/usr/bin/env bash
# Fetches the pinned Typst binary into Mnemo.Host/TypstRuntime/binaries/<rid>/.
#
# The Typst binary (~52 MB per RID) is not committed; this restores it from the GitHub
# release pinned in scripts/typst-manifest.json, verifying the archive checksum. The mitex
# package under Mnemo.Host/TypstRuntime/typst-packages/ IS committed, so it is not fetched.
# Run once after cloning; pass --force to re-fetch.
#
# CI passes --rid explicitly (one per build-matrix leg); local devs can omit it for the host RID.
#
# Usage: scripts/restore-typst.sh [--rid <rid>] [--force]
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
manifest="$script_dir/typst-manifest.json"

rid=""
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --rid)   rid="$2"; shift 2 ;;
    --force) force=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required (install jq)." >&2; exit 1; }

resolve_host_rid() {
  local os arch
  case "$(uname -s)" in
    Linux)  os="linux" ;;
    Darwin) os="osx" ;;
    *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  echo "$os-$arch"
}

[ -n "$rid" ] || rid="$(resolve_host_rid)"

typst_version="$(jq -r '.typstVersion' "$manifest")"
base_url="$(jq -r '.baseUrl' "$manifest")"
asset="$(jq -r --arg r "$rid" '.rids[$r].asset // empty' "$manifest")"
sha256="$(jq -r --arg r "$rid" '.rids[$r].sha256 // empty' "$manifest")"
binary="$(jq -r --arg r "$rid" '.rids[$r].binary // empty' "$manifest")"

if [ -z "$asset" ]; then
  known="$(jq -r '.rids | keys | join(", ")' "$manifest")"
  echo "No Typst binary pinned for RID '$rid'. Known RIDs: $known" >&2
  exit 1
fi

dest_dir="$repo_root/Mnemo.Host/TypstRuntime/binaries/$rid"
dest_binary="$dest_dir/$binary"

if [ -f "$dest_binary" ] && [ "$force" -eq 0 ]; then
  echo "Typst $typst_version for $rid already present at $dest_binary (use --force to re-fetch)."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="$base_url/$asset"
echo "Downloading $url ..."
curl -fsSL "$url" -o "$tmp/$asset"

echo "$sha256  $tmp/$asset" | sha256sum -c - >/dev/null 2>&1 \
  || { actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"; \
       echo "Checksum mismatch for $asset." >&2; \
       echo "  expected $sha256" >&2; echo "  actual   $actual" >&2; exit 1; }
echo "Checksum OK."

mkdir -p "$tmp/x"
case "$asset" in
  *.zip)    unzip -q "$tmp/$asset" -d "$tmp/x" ;;
  *.tar.xz) tar -xf "$tmp/$asset" -C "$tmp/x" ;;
  *) echo "Unknown archive format: $asset" >&2; exit 1 ;;
esac

found="$(find "$tmp/x" -type f -name "$binary" | head -n1)"
[ -n "$found" ] || { echo "Binary '$binary' not found inside $asset." >&2; exit 1; }

mkdir -p "$dest_dir"
cp "$found" "$dest_binary"
chmod +x "$dest_binary"
echo "Installed Typst $typst_version for $rid -> $dest_binary"
