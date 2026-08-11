import type { ReactNode } from "react";

/**
 * Stat tile: label, value, optional note. Values use proportional figures —
 * tabular-nums is for columns that must align, and at tile size it makes a
 * number like 121 read loose.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  hero?: boolean;
  tone?: "default" | "good" | "warning" | "critical";
}) {
  const toneClass =
    tone === "good"
      ? "text-good"
      : tone === "warning"
        ? "text-warning"
        : tone === "critical"
          ? "text-critical"
          : "text-ink";

  return (
    <div className="rounded border border-line bg-surface px-4 py-3">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </p>
      <p
        className={`mt-1 font-semibold leading-none ${hero ? "text-5xl" : "text-2xl"} ${toneClass}`}
      >
        {value}
      </p>
      {note ? <p className="mt-1.5 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

/**
 * Capacity meter. Fill carries severity; the track is a dimmer step of the
 * same idea, so state reads across the whole bar rather than only at the tip.
 */
export function Meter({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill =
    clamped >= 95
      ? "var(--ov-critical)"
      : clamped >= 70
        ? "var(--ov-warning)"
        : "var(--ov-chart-1)";
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Capacity used"
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-ov"
        style={{ width: `${clamped}%`, background: fill }}
      />
    </div>
  );
}
