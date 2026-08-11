"use client";

import { useMemo, useState } from "react";

/**
 * Registrations over time. Hand-rolled SVG, no chart library.
 *
 * The line is the cumulative curve, because that is the number an organiser
 * actually watches; the daily count rides along in the tooltip. Sighted users
 * get hover readouts, everyone else gets role="img" with a written summary and
 * the same figures in a visually hidden table.
 */

export interface RegistrationPoint {
  date: Date;
  registrations: number;
  cumulative: number;
}

const W = 720;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };

const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function RegistrationsChart({
  points,
  capacity,
}: {
  points: RegistrationPoint[];
  capacity: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const maxY = Math.max(capacity, ...points.map((p) => p.cumulative), 1);
    const maxDaily = Math.max(...points.map((p) => p.registrations), 1);

    const x = (i: number) =>
      PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.cumulative)}`).join(" ");
    const area = `${line} L${x(points.length - 1)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      v: Math.round(maxY * f),
      y: y(maxY * f),
    }));

    return { x, y, line, area, maxY, maxDaily, innerH, innerW, ticks };
  }, [points, capacity]);

  if (!geometry || points.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-subtle">
        No registrations recorded yet.
      </p>
    );
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const total = last.cumulative - first.cumulative + first.registrations;
  const busiest = points.reduce((a, b) => (b.registrations > a.registrations ? b : a));

  const summary = `Registrations from ${fmtDay(first.date)} to ${fmtDay(last.date)}. ${last.cumulative} registered in total against a capacity of ${capacity}. ${total} came in during this window, busiest day ${fmtDay(busiest.date)} with ${busiest.registrations}.`;

  const active = hover === null ? null : points[hover];

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={summary}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const fx = ((e.clientX - box.left) / box.width) * W;
          const t = (fx - PAD.left) / (W - PAD.left - PAD.right);
          const i = Math.round(t * (points.length - 1));
          setHover(Math.min(Math.max(i, 0), points.length - 1));
        }}
      >
        <defs>
          <linearGradient id="ov-reg-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ov-gold)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--ov-gold)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {geometry.ticks.map((tick) => (
          <g key={tick.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--ov-line)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={tick.y + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--ov-ink-subtle)"
              fontFamily="var(--ov-font-mono)"
            >
              {tick.v}
            </text>
          </g>
        ))}

        {capacity <= geometry.maxY && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={geometry.y(capacity)}
            y2={geometry.y(capacity)}
            stroke="var(--ov-critical)"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.6}
          />
        )}

        {/* Daily intake, so a quiet week is visible under the smooth curve. */}
        {points.map((p, i) => {
          if (p.registrations === 0) return null;
          const barH = (p.registrations / geometry.maxDaily) * (geometry.innerH * 0.28);
          return (
            <rect
              key={i}
              x={geometry.x(i) - 1.5}
              y={PAD.top + geometry.innerH - barH}
              width={3}
              height={barH}
              fill="var(--ov-gold-dim)"
              opacity={0.5}
            />
          );
        })}

        <path d={geometry.area} fill="url(#ov-reg-fill)" />
        <path
          d={geometry.line}
          fill="none"
          stroke="var(--ov-gold)"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {hover !== null && active && (
          <g>
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={PAD.top}
              y2={PAD.top + geometry.innerH}
              stroke="var(--ov-line-strong)"
              strokeWidth={1}
            />
            <circle
              cx={geometry.x(hover)}
              cy={geometry.y(active.cumulative)}
              r={3.5}
              fill="var(--ov-gold-bright)"
            />
          </g>
        )}

        <text
          x={PAD.left}
          y={H - 8}
          fontSize={10}
          fill="var(--ov-ink-subtle)"
          fontFamily="var(--ov-font-mono)"
        >
          {fmtDay(first.date)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          textAnchor="end"
          fontSize={10}
          fill="var(--ov-ink-subtle)"
          fontFamily="var(--ov-font-mono)"
        >
          {fmtDay(last.date)}
        </text>
      </svg>

      {hover !== null && active && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-surface-raised px-2.5 py-1.5 shadow-pop"
          style={{ left: `${(geometry.x(hover) / W) * 100}%` }}
        >
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
            {fmtDay(active.date)}
          </p>
          <p className="mt-0.5 text-sm text-ink">
            {active.cumulative.toLocaleString("en-GB")} registered
          </p>
          <p className="text-xs text-gold">
            +{active.registrations} that day
          </p>
        </div>
      )}

      <figcaption className="sr-only">
        {summary}
        <table>
          <caption>Registrations by day</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">New registrations</th>
              <th scope="col">Total registered</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i}>
                <th scope="row">{fmtDay(p.date)}</th>
                <td>{p.registrations}</td>
                <td>{p.cumulative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
