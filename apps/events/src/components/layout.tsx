import type { ReactNode } from "react";

/**
 * Page furniture shared by every public route.
 *
 * None of it knows which theme is on: colour, radius, letter-spacing and the
 * vertical rhythm all arrive as --ev-* custom properties.
 */

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-5xl px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-24 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  id,
  kicker,
  children,
}: {
  id: string;
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-10">
      {kicker ? <p className="ev-kicker text-ev-accent-text">{kicker}</p> : null}
      <h2 id={`${id}-title`} className="ev-display mt-3 text-section">
        {children}
      </h2>
      <div
        aria-hidden="true"
        className="mt-6 w-16 bg-ev-accent"
        style={{ height: "var(--ev-rule)" }}
      />
    </div>
  );
}

export function SkipLink() {
  return (
    <a href="#main" className="ev-skip">
      Skip to the main content
    </a>
  );
}
