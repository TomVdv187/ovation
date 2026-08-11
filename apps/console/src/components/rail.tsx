"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The 64px icon rail. Icons are inline SVG rather than a library: five glyphs
 * do not justify a dependency, and these inherit currentColor cleanly.
 */

interface RailItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ITEMS: RailItem[] = [
  {
    href: "/",
    label: "Overview",
    icon: (
      <>
        <rect x={3} y={3} width={7} height={9} rx={1} {...stroke} />
        <rect x={14} y={3} width={7} height={5} rx={1} {...stroke} />
        <rect x={14} y={12} width={7} height={9} rx={1} {...stroke} />
        <rect x={3} y={16} width={7} height={5} rx={1} {...stroke} />
      </>
    ),
  },
  {
    href: "/page",
    label: "Event Page",
    icon: (
      <>
        <rect x={3} y={4} width={18} height={16} rx={2} {...stroke} />
        <path d="M3 9h18M7 13h7M7 16h10" {...stroke} />
      </>
    ),
  },
  {
    href: "/guests",
    label: "Guests",
    icon: (
      <>
        <circle cx={9} cy={8} r={3.2} {...stroke} />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" {...stroke} />
        <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2-4.2" {...stroke} />
      </>
    ),
  },
  {
    href: "/revenue",
    label: "Revenue",
    icon: (
      <>
        <path d="M3 17.5 9 11l4 3.6L21 6" {...stroke} />
        <path d="M15.5 6H21v5.5" {...stroke} />
      </>
    ),
  },
  {
    href: "/live",
    label: "Live",
    icon: (
      <>
        <circle cx={12} cy={12} r={3} {...stroke} />
        <path d="M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11" {...stroke} />
      </>
    ),
  },
];

export function Rail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Console sections"
      className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-sunken py-4"
    >
      <Link
        href="/"
        className="mb-4 flex h-9 w-9 items-center justify-center rounded text-gold"
        aria-label="OVATION overview"
      >
        <span className="ov-display text-xl leading-none">O</span>
      </Link>

      {ITEMS.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={`group relative flex h-11 w-11 items-center justify-center rounded transition-colors duration-150 ease-ov ${
              active
                ? "bg-gold-wash text-gold"
                : "text-ink-subtle hover:bg-surface hover:text-ink-muted"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              {item.icon}
            </svg>
            <span className="pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded border border-line bg-surface-raised px-2 py-1 text-xs text-ink opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
