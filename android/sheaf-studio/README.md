# Sheaf PDF Studio – Android

Offline WebView wrapper around the Sheaf web app (`public/sheaf/`). No INTERNET permission; PDFs never leave the device.

1. `./sync-assets.sh` (builds the site, copies `dist/sheaf` into `app/src/main/assets/sheaf`).
2. Open this folder in Android Studio and Run, or `gradle assembleDebug` (needs JDK 17 + Android SDK 34).

Saved files go to the device's Downloads folder (MediaStore, no storage permission needed on API 29+; on API 24-28 add `WRITE_EXTERNAL_STORAGE`).
Untested here: no Android SDK in this environment.
