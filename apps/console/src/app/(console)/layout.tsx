import type { ReactNode } from "react";
import { ChatPanel } from "~/components/chat/chat-panel";
import { Rail } from "~/components/rail";
import { requireConsoleEvent } from "~/server/current-event";

export const dynamic = "force-dynamic";

/**
 * The console chrome: a 64px icon rail, the view, and a 360px agent panel that
 * never goes away. The chat is part of the furniture, not a drawer you open.
 */
export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { event, session, autoApproveCosmetic } = await requireConsoleEvent();

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Rail />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-gold">
              Ovation
            </p>
            <h1 className="ov-display truncate text-lg text-ink">
              {event?.title ?? "No event yet"}
            </h1>
          </div>
          <p className="shrink-0 text-xs text-ink-subtle">
            {session.user.email}
          </p>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {event ? (
        <ChatPanel
          eventId={event.id}
          autoApproveCosmetic={autoApproveCosmetic}
        />
      ) : (
        <aside className="flex w-chat shrink-0 items-center border-l border-line bg-surface p-6">
          <p className="text-sm text-ink-muted">
            The agent needs an event to work on. This organisation has none
            yet — create one and the panel comes to life.
          </p>
        </aside>
      )}
    </div>
  );
}
