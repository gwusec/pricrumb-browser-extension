#!/usr/bin/env bash
set -e
# Default values
TARGET=""
DEBUG=true
NO_ZIP=false
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
--no-zip)
      NO_ZIP=true
      shift
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: ./build-extension.sh [chrome|firefox] [--production] [--no-zip]"
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
# Copy all files except manifest variants and local/private key material
rsync -av \
--exclude="manifest.chrome.json" \
--exclude="manifest.firefox.json" \
--exclude="domain_hmac.key" \
--exclude="test" \
"$SRC_DIR/" "$OUT_DIR/"
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
# Zip the extension for production builds (unless --no-zip is set)
if [[ "$DEBUG" == "false" && "$NO_ZIP" == "false" ]]; then
  ZIP_FILE="build/${TARGET}-extension.zip"
  rm -f "$ZIP_FILE"
  (cd "$OUT_DIR" && zip -r "../../$ZIP_FILE" .)
  echo "Zipped: $ZIP_FILE"
fi