/* Sheaf: the visual PDF studio (public/sheaf), framed same-origin so it follows ToolDeck's theme.
   `tool` deep-links one of its tools (Sheaf routes on #/<id>). */
export default function SheafStudio({ tool, onBack }) {
  const src = `/sheaf/index.html${tool ? `#/${tool}` : ""}`;
  return (
    <div className="sheaf-wrap rise d1">
      <div className="sheaf-bar">
        <button className="btn gh" onClick={onBack}>← All PDF tools</button>
        <span className="sheaf-t">Sheaf studio · drag pages, live previews, nothing uploaded</span>
        <a className="btn gh" href={src} target="_blank" rel="noopener">Open full screen ↗</a>
      </div>
      <iframe className="sheaf-frame" src={src} title="Sheaf PDF studio" />
    </div>
  );
}
