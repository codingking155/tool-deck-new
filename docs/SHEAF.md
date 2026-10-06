# Sheaf (PDF Toolkit studio)

Lives in `public/sheaf/`, served at `/sheaf/index.html` and framed by the PDF Toolkit
(`?t=sheaf` or `?t=sheaf:<tool>`, see `src/tools/pdf/SheafStudio.jsx`). It follows ToolDeck's theme
from the parent page (`js/theme.js`). `/sheaf/` has its own CSP rule in `vercel.json` (`frame-ancestors 'self'`).

Browser-only PDF tools. No backend: every file is processed in the tab and never uploaded.

## Run

`npm run dev` and open `/sheaf/index.html`. The `sheafVendor` plugin in `vite.config.js` copies the
libraries and fonts from node_modules into `public/sheaf/vendor/` (gitignored) on every dev/build start.

## Layout

    index.html          page shell and library tags
    js/theme.js         mirrors ToolDeck's light/dark theme
    js/pdfjs.js         loads the pdf.js module and exposes window.pdfjsLib
    css/styles.css      design tokens (light and dark) and all styles
    js/core.js          DOM helpers, icons, saving, opening files, rendering, PDF building blocks
    js/components.js    file grid, page grid, page preview, sidebar controls, signature dialog
    js/tools.js         the 15 tools
    js/app.js           home page, tool page, results, routing, drag and drop

The scripts are plain (not modules) and load in that order, sharing one top-level scope.

## Tools

Organize: Merge, Split, Remove pages, Extract pages, Organize
Optimize: Compress
Convert: Image to PDF, PDF to JPG/PNG
Edit: Rotate, Page numbers, Watermark, Crop
Security: Protect, Unlock, Sign

## Adding a tool

Add an object to the `TOOLS` array in `js/tools.js`:

    {
      id: 'mytool', name: 'My tool', cat: 'edit', icon: 'crop',
      accept: 'pdf',            // or 'image'
      multiple: false,          // true to take several files
      pages: false,             // true to get one entry per page in ctx.pages
      cta: 'Do the thing', busy: 'Working', desc: 'One line for the card.',
      init: () => ({ /* default options, kept in ctx.o */ }),
      mount(ctx, work, side) { /* build the workspace and options; call ctx.setReady(ok, hint) */ },
      async run(ctx, progress) { return { title: 'Done', outputs: [pdfOut('name.pdf', bytes)] }; },
    }

It appears on the home page and gets routing, drag and drop, progress and the result screen for free.

## Libraries (npm, self-hosted)

- @cantoo/pdf-lib: writes PDFs, AES encryption and decryption
- pdfjs-dist (the app's 4.x, with its module worker): draws pages
- jszip: ZIP downloads
- sortablejs: drag to reorder
- @fontsource Besley, Instrument Sans, Mrs Saint Delafield

## Not included

Office conversions (Word, Excel, PowerPoint), HTML to PDF, PDF/A, OCR, Repair, Compare,
Redact, Edit PDF and Forms need a server or a much larger editor and are not in this build.
