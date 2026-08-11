"use client";

import { useId, useMemo, useState } from "react";

/**
 * Arrivals per 15 minutes. Hand-rolled SVG, no chart library.
 *
 * One series, so no legend — the heading says what is plotted. Colour is the
 * one validated data hue (--ov-chart-1); gold stays chrome, because a data
 * mark and a piece of furniture wearing the same colour is how a dashboard
 * stops being readable at a glance.
 *
 * The last bucket is still filling. It is drawn in the same hue at low opacity
 * rather than a second colour: a near-neighbour hue would claim to be a second
 * category, and a bar that is 40% of the way through its quarter hour is not a
 * different thing, it is the same thing incomplete.
 *
 * Empty buckets are kept, not skipped. A lull compressed out of the axis hides
 * exactly the arrival-rate drop the organiser is watching for.
 */

export interface ArrivalBucket {
  bucketStart: Date;
  count: number;
}

const BAR_MAX = 24;
const BAR_GAP = 2;
const PAD = { top: 18, right: 8, bottom: 26, left: 34 };
const HEIGHT = 168;

export function ArrivalsChart({
  buckets,
  className,
}: {
  buckets: ArrivalBucket[];
  className?: string;
}) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const { width, plotW, plotH, max, ticks, band, barW, peakIndex } =
    useMemo(() => {
      const n = Math.max(1, buckets.length);
      const band = Math.max(8, Math.min(40, 520 / n));
      const barW = Math.max(3, Math.min(BAR_MAX, band - BAR_GAP));
      const plotW = band * n;
      const plotH = HEIGHT - PAD.top - PAD.bottom;
      const rawMax = Math.max(1, ...buckets.map((b) => b.count));
      const max = niceCeil(rawMax);
      const ticks = tickValues(max);
      let peakIndex = -1;
      let peak = -1;
      buckets.forEach((b, i) => {
        if (b.count > peak) {
          peak = b.count;
          peakIndex = i;
        }
      });
      return {
        width: plotW + PAD.left + PAD.right,
        plotW,
        plotH,
        max,
        ticks,
        band,
        barW,
        peakIndex,
      };
    }, [buckets]);

  if (buckets.length === 0) {
    return (
      <p className={`text-sm text-ink-subtle ${className ?? ""}`}>
        No arrivals yet. The first scan starts the chart.
      </p>
    );
  }

  const lastIndex = buckets.length - 1;
  // Label sparingly: the peak and the bucket in progress, never every bar.
  const labelled = new Set([peakIndex, lastIndex]);

  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const active = hover === null ? null : buckets[hover];

  return (
    <figure className={className}>
      <div className="relative overflow-x-auto">
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          preserveAspectRatio="xMinYMid meet"
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>
            Arrivals per 15 minutes. Peak {buckets[peakIndex]?.count ?? 0} in
            one quarter hour.
          </title>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--ov-line)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD.left - 6}
                y={y(t) + 3.5}
                textAnchor="end"
                className="fill-[var(--ov-ink-subtle)] text-[9px] [font-variant-numeric:tabular-nums]"
              >
                {t}
              </text>
            </g>
          ))}

          {buckets.map((b, i) => {
            const h = (b.count / max) * plotH;
            const x = PAD.left + i * band + (band - barW) / 2;
            const isLast = i === lastIndex;
            return (
              <g key={b.bucketStart.getTime()}>
                {/* Full-height hit target: a 3px bar is impossible to hover. */}
                <rect
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
                {b.count > 0 ? (
                  <path
                    d={roundedTop(x, y(b.count), barW, h, 4)}
                    fill="var(--ov-chart-1)"
                    opacity={isLast ? 0.42 : hover === null || hover === i ? 1 : 0.55}
                    pointerEvents="none"
                  />
                ) : null}
                {labelled.has(i) && b.count > 0 ? (
                  <text
                    x={x + barW / 2}
                    y={y(b.count) - 5}
                    textAnchor="middle"
                    className="fill-[var(--ov-ink-muted)] text-[9px] [font-variant-numeric:tabular-nums]"
                    pointerEvents="none"
                  >
                    {b.count}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            stroke="var(--ov-line-strong)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          {buckets.map((b, i) =>
            i % xLabelEvery(buckets.length) === 0 || i === lastIndex ? (
              <text
                key={`x-${b.bucketStart.getTime()}`}
                x={PAD.left + i * band + band / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-[var(--ov-ink-subtle)] text-[9px] [font-variant-numeric:tabular-nums]"
              >
                {hhmm(b.bucketStart)}
              </text>
            ) : null,
          )}
        </svg>

        {active ? (
          <div className="pointer-events-none absolute left-2 top-0 rounded border border-line bg-surface-raised px-2 py-1 text-xs text-ink shadow-card">
            <span className="[font-variant-numeric:tabular-nums]">
              {hhmm(active.bucketStart)}–{hhmm(new Date(active.bucketStart.getTime() + 15 * 60000))}
            </span>
            <span className="ml-2 text-ink-muted">
              {active.count} arrival{active.count === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}
      </div>

      <figcaption className="mt-1 text-xs text-ink-subtle">
        Arrivals per 15 min · last bar still filling
      </figcaption>

      {/* Non-visual route to the same numbers. */}
      <table className="sr-only">
        <caption>Arrivals per 15 minutes</caption>
        <thead>
          <tr>
            <th scope="col">Quarter hour</th>
            <th scope="col">Arrivals</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={`r-${b.bucketStart.getTime()}`}>
              <th scope="row">{hhmm(b.bucketStart)}</th>
              <td>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Rounded cap, square baseline — a bar grows out of the axis, it does not float. */
function roundedTop(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const radius = Math.min(r, w / 2, h);
  const bottom = y + h;
  return [
    `M ${x} ${bottom}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${bottom}`,
    "Z",
  ].join(" ");
}

function niceCeil(n: number): number {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (mag / 2)) * (mag / 2);
}

function tickValues(max: number): number[] {
  return [0, max / 2, max].map((v) => Math.round(v));
}

function xLabelEvery(n: number): number {
  return n <= 8 ? 1 : n <= 16 ? 2 : Math.ceil(n / 8);
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
