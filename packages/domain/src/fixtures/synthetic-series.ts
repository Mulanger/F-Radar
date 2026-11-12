/**
 * SYNTHETIC forecast series for demo mode.
 *
 * This is the exact generator from the approved design prototype
 * (FastighetsRadar.dc.html → `series()`), moved here so the demo charts look
 * identical. The output is NOT a forecast and must never be shown in live mode.
 */

export interface SyntheticSeriesInput {
  seed: number;
  temp: number;
  rain24: number;
  wind: number;
  hum: number;
}

export interface SyntheticSeries {
  temp: number[];
  rain: number[];
  wind: number[];
  hum: number[];
}

function rng(seed: number) {
  let s = seed % 2147483647;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function syntheticSeries(p: SyntheticSeriesInput): SyntheticSeries {
  const r = rng(p.seed * 977 + 13);
  const n = 24;
  const peak = 8 + (p.seed % 4) * 2;
  const raw = [...Array(n)].map((_, i) => Math.max(0.02, Math.exp(-((i - peak) ** 2) / 14) + r() * 0.15));
  const sum = raw.reduce((a, b) => a + b, 0);
  // Order of evaluation matters: the design consumed the RNG in this exact sequence.
  const temp = [...Array(n)].map(
    (_, i) =>
      +(
        p.temp +
        1.8 * Math.cos((i / 24) * Math.PI * 2) -
        0.8 * Math.sin((i / 24) * Math.PI * 2) +
        (r() - 0.5) * 0.5 -
        1.2 * (i > 10 && i < 20 ? 1 : 0)
      ).toFixed(1),
  );
  const rain = raw.map((v) => +((v / sum) * p.rain24).toFixed(2));
  const wind = [...Array(n)].map(
    (_, i) => +Math.max(1, p.wind + 3 * Math.sin((i - peak + 6) / 6) + (r() - 0.5) * 1.6).toFixed(1),
  );
  const hum = [...Array(n)].map(
    (_, i) => +Math.min(99, Math.max(40, p.hum + 5 * Math.sin((i / 24) * Math.PI * 2 + 1) + (r() - 0.5) * 3)).toFixed(0),
  );
  return { temp, rain, wind, hum };
}
