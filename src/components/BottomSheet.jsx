/* Bottom sheet component for mobile settings — slides up from bottom */

export default function BottomSheet({ isOpen, onClose, children, title }) {
  if (!isOpen) return null;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-content">
          {title && <div className="sheet-title">{title}</div>}
          {children}
        </div>
      </div>
    </>
  );
}
