# Sheaf for Android

Sheaf is ToolDeck's offline PDF studio (`public/sheaf/`, see `docs/SHEAF.md`), packaged as an Android app
with [Capacitor](https://capacitorjs.com). It adds two camera tools:

- **Scan to PDF:** photograph pages. Sheaf finds the page edges, straightens the page, cleans it up
  (Colour, Greyscale, Document or Original) and builds one PDF. Photos from the gallery go through the same steps.
- **QR scanner:** reads codes from the camera or a photo and explains what they say: links, UPI payments,
  Wi-Fi, contacts, email, SMS, phone numbers and locations. It also keeps a list of recent scans. Barcodes are
  read too where the phone's WebView supports `BarcodeDetector`.

Everything runs on the phone. The app makes no network requests, and files are saved to **Documents/Sheaf**.

- App ID: `in.tooldeck.sheaf`. It cannot change once the app is on Play.
- Name: Sheaf.
- Requires Android 7.0 (API 24) or later.
- Targets API 36.

## How it is put together

    app/                  the app layer (plain scripts, loaded after Sheaf's own)
      native.src.js       Capacitor bridge: save to Documents, share sheet, back button (bundled by esbuild)
      scan-core.js        pure maths: page detection, perspective warp, filters, QR payload parsing
      camera.js           camera stream, full-screen layers, clipboard
      scan.js             the Scan to PDF tool (camera, corner editor, looks)
      qr.js               the QR scanner tool
      mobile.js           adds the Scan group, wraps Sheaf's save/result/home for the phone
      mobile.css
    scripts/build-web.mjs builds www/ from ../public/sheaf plus app/ (a few "browser tab" strings are reworded)
    scripts/make-icons.mjs  launcher icons, splash and Play Store graphics from the logo
    android/              the Capacitor Android project (committed; build output is ignored)
    store/                Play Store icon (512 px) and feature graphic (1024×500)
    tests/                unit tests for scan-core.js

Sheaf's own files are not forked. Every app build copies the current `public/sheaf/`, so fixes to the website's
Sheaf reach the app on the next release.

## Commands

    npm ci
    npm test              # unit tests
    npm run build         # www/ only
    npm run serve         # www/ in a browser at http://localhost:4180 (camera works on localhost)
    npm run sync          # www/ + copy into android/
    npx cap open android  # open in Android Studio, then Run on a phone

To build on your own machine you need JDK 21 and the Android SDK, which Android Studio installs. Then run:

    cd android && ./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
    cd android && ./gradlew bundleRelease      # app/build/outputs/bundle/release/app-release.aab

## CI

`.github/workflows/sheaf-android.yml` runs on every push that touches `sheaf-app/` or `public/sheaf/`. It runs
the tests, builds a **debug APK** that you can install on a phone straight away, and builds the **release AAB**
for Play. Download both from the run's Artifacts. The version code is the run number, so each build can be uploaded.

## Publishing on Google Play

1. **Create a developer account.** Sign up at https://play.google.com/console. It costs a one-time US$25 fee
   and needs ID verification. New personal accounts must run a closed test with at least 12 testers for
   14 days before they can publish to production.
2. **Make an upload key** (once), and back it up somewhere safe:

       keytool -genkeypair -v -keystore sheaf-upload.jks -alias sheaf -keyalg RSA -keysize 2048 -validity 10000

   Keep the file and passwords out of git. With Play App Signing, Google holds the real app-signing key, and a
   lost upload key can be reset through Play support.
3. **Add the repository secrets** (GitHub → Settings → Secrets and variables → Actions):
   - `SHEAF_KEYSTORE_BASE64`: the output of `base64 -w0 sheaf-upload.jks`
   - `SHEAF_KEYSTORE_PASSWORD`, `SHEAF_KEY_ALIAS` (`sheaf`), `SHEAF_KEY_PASSWORD`

   Re-run the workflow and `sheaf-release-aab` comes out signed. To sign locally instead, put
   `storeFile`, `storePassword`, `keyAlias` and `keyPassword` in `android/keystore.properties`, which git ignores.
4. **Create the app in Play Console** and upload the `.aab` to a testing track. To fill in the listing:
   - Icon: `store/icon-512.png`. Feature graphic: `store/feature-graphic.png`.
   - Screenshots: at least 2 phone screenshots, taken from the app on a phone.
   - Privacy policy: `https://tooldeck.in/sheaf/privacy.html` (from `public/sheaf/privacy.html`).
   - Data safety: no data collected, no data shared. Files and camera images stay on the device.
   - Content rating questionnaire: a utility with no user-generated content.
   - Category: Productivity.

Suggested short description (80 characters at most):
*Scan documents to PDF, merge, compress and sign PDFs, read QR codes. Offline.*

## Ideas for later

- "Open with Sheaf" and "Share to Sheaf" for PDFs coming from other apps (Android intent filters).
- A QR code generator.
- OCR (tesseract.js is already used by ToolDeck's PDF Toolkit), to make scanned PDFs searchable.
