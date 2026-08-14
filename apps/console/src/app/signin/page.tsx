import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { auth, signIn } from "~/server/auth";

export const dynamic = "force-dynamic";

/**
 * Auth.js error codes are for us, not for the person locked out. Anything not
 * named here is a configuration fault on our side, and saying so is more use
 * than echoing `Configuration` at somebody trying to sign in.
 */
function explain(code: string): string {
  switch (code) {
    case "EmailSignInError":
    case "Verification":
      return "We could not send that link. Check the address and try again.";
    case "AccessDenied":
      return "That address is not allowed to sign in.";
    default:
      return "Sign-in is not working right now. The team has been sent the details.";
  }
}

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { sent, error } = await searchParams;
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

        {error ? (
          <p className="mt-6 rounded border border-critical/40 bg-critical/10 p-4 text-sm">
            {explain(error)}
          </p>
        ) : null}

        <form
          className="mt-6 space-y-3"
          action={async (formData: FormData) => {
            "use server";
            // signIn throws on failure. Uncaught, that renders Next's error
            // boundary — a blank 500 where the form was. Caught, the person
            // gets the form back with a sentence. AuthError only: the redirect
            // signIn throws on SUCCESS is not one, and must keep propagating.
            try {
              await signIn("resend", {
                email: String(formData.get("email") ?? ""),
                redirectTo: "/",
              });
            } catch (cause) {
              if (cause instanceof AuthError) {
                console.error("[signin] could not send the link:", cause.type, cause.message);
                redirect(`/signin?error=${encodeURIComponent(cause.type)}`);
              }
              throw cause;
            }
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
