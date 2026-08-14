# Setting up on a new computer

Seven steps. Copy each line, run it, check you got the expected result.

If something goes wrong, stop at that step — don't push on. The last section
lists the three things that actually go wrong.

---

## 1. Install the tools

You need Node 22 and pnpm.

- Node: download the **LTS** installer from <https://nodejs.org> and run it.
- pnpm: open a terminal and run

```bash
npm install -g pnpm
```

Check both:

```bash
node --version     # expect v22 or higher
pnpm --version     # expect 10 or higher
```

## 2. Get the code

```bash
git clone https://github.com/TomVdv187/ovation.git
cd ovation
```

Everything from here runs inside that `ovation` folder.

## 3. Install the dependencies

```bash
pnpm install
```

Takes a few minutes the first time.

## 4. Sign in to Vercel

The passwords and API keys are not in GitHub — deliberately. They live in
Vercel, and these next two steps fetch them.

```bash
npm install -g vercel
vercel login
```

`vercel login` opens your browser. Sign in with the same account you use for
the OVATION projects.

## 5. Connect this folder to the project

```bash
vercel link --yes --scope tomvdvs-projects-f898ed4a --project ovation
```

Expect: `Linked to tomvdvs-projects-f898ed4a/ovation`.

## 6. Fetch the secrets

```bash
node scripts/bootstrap-from-vercel.mjs
```

This writes two files, `.env` and `.env.production`. They are ignored by git,
which is why they were not in the clone.

Expect to see `wrote .env` and `wrote .env.production`, then a short list under
**Still needs a human** — those are the Resend, Stripe and realtime keys. Ignore
them for now; everything works without them except email, payments and the live
announcements.

## 7. Start it

```bash
pnpm db:generate
pnpm dev
```

Open <http://localhost:3000>. Sign in with your own email address — the
sign-in link is **printed in the terminal**, not emailed, because the email key
is blank. Copy it from the terminal into your browser.

You should also be able to open:

- <http://localhost:3001/e/meridian-summit-2026> — the public event page
- <http://localhost:3002> — the live check-in app

---

## If something goes wrong

**`pnpm dev` shows database or certificate errors.** Some antivirus and most
corporate networks inspect encrypted traffic, which breaks the database
connection. Run this once, then start again:

```bash
node scripts/trust-local-tls.mjs
pnpm dev
```

**An error mentioning `28P01` or `password authentication failed`.** The
database password changed. Fix it with:

```bash
node scripts/pull-db-credentials.mjs
```

If it says the old credential still works, nothing rotated and the problem is
something else.

**`vercel link` says it cannot find the project.** You are signed in to the
wrong Vercel account. Run `vercel logout`, then `vercel login` again with the
account that owns the OVATION projects.

---

## What you do NOT need to do

- You do not need to create a database. It already exists and both machines
  share the same development one.
- You do not need to run `pnpm db:seed`. The demo data is already there, and
  re-seeding would duplicate it.
- You do not need to copy `.env` from the old computer. Step 6 rebuilds it.
