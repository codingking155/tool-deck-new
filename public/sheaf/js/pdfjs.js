/* Sheaf: pdfjs.js
   pdf.js ships as an ES module; expose it as the global the plain scripts expect. */
import * as pdfjsLib from '../vendor/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
window.pdfjsLib = pdfjsLib;
