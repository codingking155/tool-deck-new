import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherKind, weatherLabel, isNight, moonPhase, moonPhaseName } from "../src/lib/weather.js";

test("WMO codes map to kinds and labels", () => {
  assert.equal(weatherKind(0), "clear");
  assert.equal(weatherLabel(1), "Mostly clear");
  assert.equal(weatherKind(3), "cloudy");
  assert.equal(weatherKind(48), "fog");
  assert.equal(weatherKind(81), "rain");
  assert.equal(weatherKind(86), "snow");
  assert.equal(weatherLabel(95), "Thunderstorm");
});

test("day/night follows sunrise/sunset, not the site theme", () => {
  const w = { sunrise: 1000, sunset: 2000, isDay: 1 };
  assert.equal(isNight(w, 999_000), true);
  assert.equal(isNight(w, 1500_000), false);
  assert.equal(isNight(w, 2000_000), true);
  assert.equal(isNight({ isDay: 0 }, 0), true);
});

test("moon phase hits known new and full moons", () => {
  assert.equal(moonPhaseName(moonPhase(Date.UTC(2000, 0, 6, 18, 14))), "New moon");
  assert.equal(moonPhaseName(moonPhase(Date.UTC(2024, 3, 23, 23, 49))), "Full moon");
});
