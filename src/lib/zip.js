import JSZip from "jszip";

/** items: [{ name, blob }] -> one ZIP Blob. Duplicate names get " (2)", " (3)"… */
export async function zipFiles(items) {
  const zip = new JSZip(), seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.name) || 0) + 1; seen.set(it.name, n);
    const name = n === 1 ? it.name : it.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    zip.file(name, it.blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
