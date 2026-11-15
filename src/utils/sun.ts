/**
 * Sub-solar point (where the Sun is directly overhead) for a UTC date —
 * NOAA solar-position approximation (declination + equation of time).
 * Accurate to well under 1° — used for honest "telemetry" and globe lighting.
 */
export function subsolarPoint(date = new Date()): { lat: number; lon: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - start) / 86400000; // fractional
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24); // fractional year (rad)
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g); // rad
  let lon = -15 * (hours - 12 + eqTime / 60);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: (decl * 180) / Math.PI, lon };
}
