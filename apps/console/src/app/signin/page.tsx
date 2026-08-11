import { redirect } from "next/navigation";
import { auth, signIn } from "~/server/auth";

export const dynamic = "force-dynamic";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { sent } = await searchParams;
  const devMode = !process.env.RESEND_API_KEY;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-gold">Ovation</p>
        <h1 className="mt-3 text-3xl">Sign in</h1>

        {sent ? (
          <p className="mt-6 rounded border border-good/40 bg-good/10 p-4 text-sm">
            Check your inbox for the link.
            {devMode ? " In dev it is printed to the server console." : null}
          </p>
        ) : null}

        <form
          className="mt-6 space-y-3"
          action={async (formData: FormData) => {
            "use server";
            await signIn("resend", {
              email: String(formData.get("email") ?? ""),
              redirectTo: "/",
            });
          }}
        >
          <label className="block text-xs uppercase tracking-widest text-ink-subtle">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              className="mt-2 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-gold focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded bg-gold px-4 py-2 text-sm font-medium text-ink-inverse transition-colors hover:bg-gold-bright"
          >
            Send magic link
          </button>
        </form>

        {devMode ? (
          <p className="mt-6 text-xs leading-relaxed text-ink-subtle">
            No <code>RESEND_API_KEY</code> set — the sign-in link will be
            printed to the terminal running <code>pnpm dev</code>. Use the
            seeded owner address to land in the demo organisation.
          </p>
        ) : null}
      </div>
    </main>
  );
}
