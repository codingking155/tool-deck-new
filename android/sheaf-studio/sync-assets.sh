#!/usr/bin/env bash
# Build the web app and copy the Sheaf bundle into the Android assets folder.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run build
rm -rf android/sheaf-studio/app/src/main/assets/sheaf
cp -r dist/sheaf android/sheaf-studio/app/src/main/assets/sheaf
echo "Assets synced. Open android/sheaf-studio in Android Studio, or run: gradle -p android/sheaf-studio assembleDebug"
