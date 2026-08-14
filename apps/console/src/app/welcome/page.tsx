import { redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";
import { auth } from "~/server/auth";
import { api } from "~/trpc/server";

export const dynamic = "force-dynamic";

/**
 * The first screen of a new installation.
 *
 * Signing in creates a User with no organisation, and every console procedure
 * refuses one of those. Until now the only cure was `pnpm db:bootstrap` from a
 * terminal holding the production database credentials — which is not a step a
 * deployed product can ask of the person it just emailed a magic link to.
 */

/** Sensible default: a fortnight out, at 19:00 local. */
function defaultDate(): string {
  const when = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  when.setHours(19, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (session.user.organisationId) redirect("/");

  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
      <h1 className="ov-display mt-3 text-3xl">Set up your organisation</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        This is a fresh installation, so there is nothing here yet. Name the
        organisation and open its first event — you can change every part of
        this afterwards.
      </p>

      {error ? (
        <p className="mt-6 rounded border border-critical/40 bg-critical/10 p-4 text-sm">
          {error}
        </p>
      ) : null}

      <form
        className="mt-8 space-y-5"
        action={async (formData: FormData) => {
          "use server";

          const name = String(formData.get("name") ?? "").trim();
          const title = String(formData.get("title") ?? "").trim();
          const venue = String(formData.get("venue") ?? "").trim();
          const date = String(formData.get("date") ?? "");
          const capacity = Number(formData.get("capacity") ?? 0);

          const fail = (message: string) =>
            redirect(`/welcome?error=${encodeURIComponent(message)}`);

          if (!name) fail("Give the organisation a name.");
          if (!title || !venue || !date || !Number.isFinite(capacity) || capacity < 1) {
            fail("Fill in the event title, date, venue and capacity.");
          }

          const when = new Date(date);
          if (Number.isNaN(when.getTime())) fail("That date could not be read.");

          try {
            await (await api()).organisation.create({
              name,
              event: {
                title,
                date: when,
                venue,
                capacity: Math.floor(capacity),
                timezone: "Europe/Brussels",
                currency: "EUR",
                publish: true,
              },
            });
          } catch (cause) {
            // redirect() throws NEXT_REDIRECT; it must keep going.
            if (cause instanceof TRPCError) {
              console.error("[welcome] setup failed:", cause.code, cause.message);
              fail(cause.message);
            }
            throw cause;
          }

          redirect("/");
        }}
      >
        <label className="block text-xs uppercase tracking-widest text-ink-subtle">
          Organisation
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Meridian Events"
            className="mt-2 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-gold focus:outline-none"
          />
        </label>

        <div className="border-t border-line pt-5">
          <p className="text-xs uppercase tracking-widest text-ink-subtle">
            First event
          </p>

          <div className="mt-3 space-y-3">
            <input
              name="title"
              required
              maxLength={200}
              placeholder="Event title"
              className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-gold focus:outline-none"
            />
            <input
              name="venue"
              required
              maxLength={200}
              placeholder="Venue"
              className="w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-gold focus:outline-none"
            />
            <div className="flex gap-3">
              <input
                name="date"
                type="datetime-local"
                required
                defaultValue={defaultDate()}
                className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
              />
              <input
                name="capacity"
                type="number"
                min={1}
                required
                defaultValue={120}
                aria-label="Capacity"
                className="w-28 rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full rounded bg-gold px-4 py-2 text-sm font-medium text-ink-inverse transition-colors hover:bg-gold-bright"
        >
          Create and open the console
        </button>
      </form>

      <p className="mt-6 text-xs leading-relaxed text-ink-subtle">
        The event is published, so its public page and the door app work
        immediately. Unpublish it from the event page if you would rather it
        stayed private.
      </p>
    </main>
  );
}
