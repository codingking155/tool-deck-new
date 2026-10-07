/* Is it a sensible hour to phone someone? [tone, text] for a local hour (0-23). */
export function callWindow(hour) {
  if (hour >= 9 && hour < 18) return ["good", "Business hours there — a good time to call"];
  if ((hour >= 7 && hour < 9) || (hour >= 18 && hour < 21)) return ["warn", "Outside office hours there"];
  return ["bad", "Night-time there — they're probably asleep"];
}

/* "5h 30m ahead of you" from an offset difference in minutes. */
export function diffText(mins) {
  if (mins === 0) return "same time as you";
  const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""} ${mins > 0 ? "ahead of" : "behind"} you`;
}
