"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAction } from "@ovation/core";
import { api } from "~/trpc/react";
import { ProposalCard } from "./proposal-card";

/**
 * The persistent agent chat.
 *
 * Text streams in over /api/agent/stream; proposals come back through
 * agent.history, which is also what a reload reads, so the cards on screen and
 * the cards after F5 are the same rows from the same query.
 */

interface Notice {
  kind: "unavailable" | "error";
  message: string;
}

export function ChatPanel({ eventId }: { eventId: string }) {
  const utils = api.useUtils();
  const history = api.agent.history.useQuery(
    { eventId, limit: 50 },
    { refetchOnWindowFocus: false },
  );

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    await Promise.all([
      utils.agent.history.invalidate(),
      utils.agent.actions.invalidate(),
      utils.event.get.invalidate(),
      utils.event.stats.invalidate(),
    ]);
  }, [utils]);

  const approve = api.agent.approve.useMutation({
    onSuccess: async (data) => {
      const failure = data.results.find((r) => r.error);
      if (failure?.error) setNotice({ kind: "error", message: failure.error });
      await refresh();
    },
    onError: (e) => setNotice({ kind: "error", message: e.message }),
    onSettled: () => setBusyIds([]),
  });

  const reject = api.agent.reject.useMutation({
    onSuccess: refresh,
    onError: (e) => setNotice({ kind: "error", message: e.message }),
    onSettled: () => setBusyIds([]),
  });

  const messages = history.data?.messages ?? [];
  const openProposals = history.data?.openProposals ?? [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === "ASSISTANT");
  const chips = suggestions.length > 0 ? suggestions : (lastAssistant?.suggestions ?? []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streaming, pendingUser]);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || pendingUser) return;

      setNotice(null);
      setSuggestions([]);
      setDraft("");
      setPendingUser(text);
      setStreaming("");

      try {
        const response = await fetch("/api/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, message: text }),
        });

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? "The agent could not be reached.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim()) as {
              type: string;
              delta?: string;
              message?: string;
              code?: string;
              suggestions?: string[];
            };

            if (event.type === "text" && event.delta) {
              accumulated += event.delta;
              setStreaming(accumulated);
            } else if (event.type === "done") {
              setSuggestions(event.suggestions ?? []);
            } else if (event.type === "error") {
              setNotice({
                kind: event.code === "AGENT_UNAVAILABLE" ? "unavailable" : "error",
                message: event.message ?? "The agent could not finish that turn.",
              });
            }
          }
        }
      } catch (error) {
        setNotice({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "The agent could not be reached.",
        });
      } finally {
        setStreaming(null);
        setPendingUser(null);
        await refresh();
      }
    },
    [eventId, pendingUser, refresh],
  );

  const decide = (id: string, verb: "approve" | "reject") => {
    setBusyIds((ids) => [...ids, id]);
    setNotice(null);
    if (verb === "approve") approve.mutate({ actionIds: [id] });
    else reject.mutate({ actionIds: [id] });
  };

  const proposalsFor = (chatMessageId: string): AgentAction[] =>
    openProposals.filter((p) => p.chatMessageId === chatMessageId);
  const orphanProposals = openProposals.filter(
    (p) => !p.chatMessageId || !messages.some((m) => m.id === p.chatMessageId),
  );

  return (
    <aside
      aria-label="Agent chat"
      className="flex w-chat shrink-0 flex-col border-l border-line bg-surface"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="ov-display text-sm text-ink">Agent</h2>
          <p className="text-[11px] text-ink-subtle">
            Proposes. Never acts without you.
          </p>
        </div>
        <AutoApproveToggle onChanged={refresh} />
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {history.isLoading && (
          <p className="text-sm text-ink-subtle">Restoring the thread…</p>
        )}

        {!history.isLoading && messages.length === 0 && !pendingUser && (
          <EmptyState />
        )}

        {messages.map((message) => (
          <div key={message.id} className="space-y-3">
            <Bubble role={message.role} content={message.content} />
            {proposalsFor(message.id).map((action) => (
              <ProposalCard
                key={action.id}
                action={action}
                busy={busyIds.includes(action.id)}
                onApprove={(id) => decide(id, "approve")}
                onReject={(id) => decide(id, "reject")}
              />
            ))}
          </div>
        ))}

        {orphanProposals.length > 0 && (
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-widest text-ink-subtle">
              Waiting on you
            </p>
            {orphanProposals.map((action) => (
              <ProposalCard
                key={action.id}
                action={action}
                busy={busyIds.includes(action.id)}
                onApprove={(id) => decide(id, "approve")}
                onReject={(id) => decide(id, "reject")}
              />
            ))}
          </div>
        )}

        {pendingUser && <Bubble role="USER" content={pendingUser} />}
        {streaming !== null && (
          <Bubble
            role="ASSISTANT"
            content={streaming || "Thinking…"}
            muted={streaming === ""}
          />
        )}

        {notice && <NoticeCard notice={notice} />}
      </div>

      {chips.length > 0 && !pendingUser && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => void send(chip)}
              className="rounded-sm border border-line px-2 py-1 text-xs text-ink-muted transition-colors duration-150 ease-ov hover:border-gold-dim hover:text-gold"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <label htmlFor="agent-input" className="sr-only">
          Message the agent
        </label>
        <textarea
          id="agent-input"
          rows={2}
          value={draft}
          disabled={Boolean(pendingUser)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder="Make it black-tie…"
          className="w-full resize-none rounded border border-line bg-surface-sunken px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-gold-dim focus:outline-none disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-subtle">Enter to send</span>
          <button
            type="submit"
            disabled={Boolean(pendingUser) || draft.trim().length === 0}
            className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink-inverse transition-colors duration-150 ease-ov hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}

function Bubble({
  role,
  content,
  muted = false,
}: {
  role: string;
  content: string;
  muted?: boolean;
}) {
  if (role === "USER") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-gold-wash px-3 py-2 text-sm text-ink">
          {content}
        </p>
      </div>
    );
  }
  return (
    <p
      className={`whitespace-pre-wrap text-sm leading-relaxed ${
        muted ? "text-ink-subtle" : "text-ink-muted"
      }`}
    >
      {content}
    </p>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4">
      <p className="ov-display text-base text-ink">Ask for what you want.</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        The agent reads the whole event: guests, revenue, the programme. It
        proposes; you decide. Nothing reaches a guest without your approval.
      </p>
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  const unavailable = notice.kind === "unavailable";
  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-sm ${
        unavailable
          ? "border-warning/40 bg-warning/10 text-ink"
          : "border-critical/40 bg-critical/10 text-ink"
      }`}
    >
      <p className="text-[11px] uppercase tracking-widest text-ink-subtle">
        {unavailable ? "Agent unavailable" : "That did not go through"}
      </p>
      <p className="mt-1.5 leading-relaxed text-ink-muted">{notice.message}</p>
    </div>
  );
}

function AutoApproveToggle({ onChanged }: { onChanged: () => Promise<void> }) {
  const [on, setOn] = useState<boolean | null>(null);
  const mutation = api.agent.setAutoApprove.useMutation({
    onSuccess: async (data) => {
      setOn(data.autoApproveCosmetic);
      await onChanged();
    },
  });

  // Optimistic-only: the switch reflects what you last set it to this session.
  // It governs COSMETIC actions and nothing else, whatever it says.
  const checked = on ?? false;

  return (
    <label
      className="flex cursor-pointer items-center gap-2"
      title="Cosmetic actions only. Outbound and destructive proposals always wait for you."
    >
      <span className="text-[10px] uppercase tracking-widest text-ink-subtle">
        Auto cosmetic
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={mutation.isPending}
        onChange={(e) =>
          mutation.mutate({ autoApproveCosmetic: e.target.checked })
        }
      />
      <span
        aria-hidden="true"
        className={`relative h-4 w-7 rounded-full transition-colors duration-150 ease-ov ${
          checked ? "bg-gold" : "bg-line-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-bg transition-all duration-150 ease-ov ${
            checked ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}
