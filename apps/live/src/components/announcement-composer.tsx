"use client";

import { useState } from "react";
import { api } from "~/trpc/react";

const CHANNELS = [
  { key: "guest-app", label: "Guest app" },
  { key: "host", label: "Hosts" },
  { key: "screens", label: "Info screens" },
] as const;

type ChannelKey = (typeof CHANNELS)[number]["key"];

/**
 * Announcement composer.
 *
 * Reports the *measured* delivery count — how many clients were subscribed to
 * the chosen channels at the moment of the push — not the number of guests on
 * the list. An organiser who is told "sent to 250" when three phones were open
 * will stop believing the number, and then stop using the feature.
 */
export function AnnouncementComposer({ eventId }: { eventId: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<Set<ChannelKey>>(
    new Set(["guest-app", "host", "screens"]),
  );
  const [sent, setSent] = useState<{
    count: number;
    at: Date;
    ms: number;
  } | null>(null);

  const announce = api.live.announce.useMutation();

  const toggle = (key: ChannelKey) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (body.trim().length === 0 || channels.size === 0) return;
    const t0 = performance.now();
    const result = await announce.mutateAsync({
      eventId,
      title: title.trim() || undefined,
      body: body.trim(),
      channels: [...channels],
    });
    setSent({
      count: result.deliveredCount,
      at: new Date(result.sentAt),
      ms: performance.now() - t0,
    });
    setBody("");
    setTitle("");
  };

  return (
    <form onSubmit={submit} className="rounded border border-line bg-surface p-4">
      <h2 className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
        Announcement
      </h2>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={120}
        className="mt-3 w-full select-text rounded border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
      />

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Dinner is served in the Salon Horta."
        rows={3}
        maxLength={2000}
        required
        className="mt-2 w-full select-text resize-y rounded border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            aria-pressed={channels.has(c.key)}
            className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.12em] transition-colors ${
              channels.has(c.key)
                ? "border-gold bg-gold-wash text-gold"
                : "border-line text-ink-subtle"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={
            announce.isPending || body.trim().length === 0 || channels.size === 0
          }
          className="rounded bg-gold px-4 py-2 text-sm font-medium uppercase tracking-[0.12em] text-ink-inverse disabled:opacity-40"
        >
          {announce.isPending ? "Pushing…" : "Push now"}
        </button>

        {sent ? (
          <p className="text-xs text-ink-muted">
            Delivered to{" "}
            <span className="text-good">{sent.count}</span>{" "}
            {sent.count === 1 ? "client" : "clients"} in {Math.round(sent.ms)} ms
          </p>
        ) : null}
        {announce.error ? (
          <p className="text-xs text-critical">{announce.error.message}</p>
        ) : null}
      </div>
    </form>
  );
}
