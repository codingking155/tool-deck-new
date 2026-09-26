const DOTS = [
  { left: "12%", top: "18%", size: 6, delay: "0s" },
  { left: "82%", top: "12%", size: 8, delay: "-6s" },
  { left: "68%", top: "38%", size: 5, delay: "-11s" },
  { left: "22%", top: "52%", size: 7, delay: "-3s" },
  { left: "90%", top: "64%", size: 5, delay: "-15s" },
  { left: "6%", top: "78%", size: 6, delay: "-9s" },
];

export default function Background() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="bg-rays absolute inset-x-0 top-0 h-[80vh]" />
      {DOTS.map((d, i) => (
        <span
          key={i}
          className="absolute animate-drift rounded-full bg-teal-400/40"
          style={{ left: d.left, top: d.top, width: d.size, height: d.size, animationDelay: d.delay }}
        />
      ))}
    </div>
  );
}
