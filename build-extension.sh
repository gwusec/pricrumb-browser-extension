#!/usr/bin/env bash
set -e

# Default values
TARGET=""
DEBUG=true

# Parse arguments
for arg in "$@"; do
  case $arg in
    chrome|firefox)
      TARGET=$arg
      shift
      ;;
    --production)
      DEBUG=false
      shift
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./build-extension.sh [chrome|firefox] [--production]"
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Error: Must specify target: chrome or firefox"
  exit 1
fi

SRC_DIR="extensions/desktop/merged"
OUT_DIR="build/$TARGET"
MANIFEST_SRC="$SRC_DIR/manifest.$TARGET.json"

if [[ ! -f "$MANIFEST_SRC" ]]; then
  echo "Missing $MANIFEST_SRC"
  exit 1
fi

# Clean output directory
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Copy all files except manifest variants
rsync -av --exclude="manifest.chrome.json" --exclude="manifest.firefox.json" "$SRC_DIR/" "$OUT_DIR/"

# Copy correct manifest
cp "$MANIFEST_SRC" "$OUT_DIR/manifest.json"

# Inject production mode into HTML
HTML_FILE="$OUT_DIR/popup_welcome.html"
if [[ -f "$HTML_FILE" ]]; then
  if [[ "$DEBUG" == "false" ]]; then
    sed -i '' 's/__PRODUCTION_PLACEHOLDER__/class="production"/' "$HTML_FILE"
  else
    sed -i '' 's/__PRODUCTION_PLACEHOLDER__//g' "$HTML_FILE"
  fi
fi

echo "Build complete: $OUT_DIR (debug=$DEBUG)"