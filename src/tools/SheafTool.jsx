/* Sheaf PDF Studio: the Sheaf app (public/sheaf) shown as-is, framed same-origin so it follows
   ToolDeck's theme. /tool/sheaf/<id> deep-links one of its tools (Sheaf routes on #/<id>). */
export default function SheafTool({ arg }) {
  const tool = arg && /^[a-z0-9]+$/.test(arg) ? arg : "";
  return <iframe className="sheaf-frame" src={`/sheaf/index.html${tool ? `#/${tool}` : ""}`} title="Sheaf PDF Studio" />;
}
