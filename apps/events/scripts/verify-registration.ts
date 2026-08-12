import { loadRootEnv } from "./env";

/**
 * Proves the registration path end to end against the real database.
 *
 *   pnpm --filter @ovation/events verify:registration
 *
 * Registers a throwaway guest, checks the Guest row, checks that the QR token
 * parses against qrTokenPayloadSchema (the contract Agent 5 verifies at the
 * door), re-registers the same email to prove the duplicate case updates rather
 * than explodes, and puts everything back. Pass --keep to leave the guest in
 * place and look at it in the console.
 *
 * Everything is imported after the environment is loaded, which is why the
 * imports below are dynamic: @ovation/core/db builds its client on first load.
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  const { db } = await import("@ovation/core/db");
  const { qrTokenPayloadSchema } = await import("@ovation/core");
  const { register } = await import("../src/server/registration");
  const { verifyQrToken } = await import("../src/server/qr-token");

  const arg = process.argv[2];
  const slug = arg && !arg.startsWith("--") ? arg : "meridian-summit-2026";
  const keep = process.argv.includes("--keep");
  const email = `verify-${Date.now()}@ovation.test`;

  const event = await db.event.findUnique({
    where: { slug },
    select: { id: true, title: true, rsvpConversions: true },
  });
  if (!event) {
    console.error(`No event with slug "${slug}". Run pnpm db:seed first.`);
    process.exit(1);
  }

  // Sweeps up anything an earlier --keep run left behind.
  if (process.argv.includes("--cleanup")) {
    const stale = await db.guest.findMany({
      where: { eventId: event.id, email: { endsWith: "@ovation.test" } },
      select: { id: true, email: true },
    });
    await db.emailMessage.deleteMany({
      where: { guestId: { in: stale.map((g) => g.id) } },
    });
    await db.order.deleteMany({
      where: { guestId: { in: stale.map((g) => g.id) } },
    });
    await db.guest.deleteMany({ where: { id: { in: stale.map((g) => g.id) } } });
    console.log(`Removed ${stale.length} test guest(s).`);
    await db.$disconnect();
    return;
  }

  console.log(`\n${event.title} — registering ${email}\n`);

  const first = await register(slug, {
    name: "Verification Guest",
    email,
    company: "Ovation QA",
    dietary: "Vegetarian",
    plusOnes: "1",
    consent: "on",
  });

  check("registration succeeds", first.ok, JSON.stringify(first));
  if (!first.ok) process.exit(1);

  console.log(`  status: ${first.status}`);

  const guest = await db.guest.findUnique({
    where: { eventId_email: { eventId: event.id, email } },
  });

  check("guest row exists", guest !== null);
  check(
    "rsvpStatus is CONFIRMED",
    guest?.rsvpStatus === "CONFIRMED",
    guest?.rsvpStatus,
  );
  check('source is "registration"', guest?.source === "registration");
  check("registeredAt is set", Boolean(guest?.registeredAt));
  check("plus-one recorded", guest?.plusOnes === 1, String(guest?.plusOnes));
  check("dietary recorded", guest?.dietary === "Vegetarian");

  // The QR token is the contract with Agent 5 · MAÎTRE D'.
  const claims = (first.token ?? "").split(".")[1] ?? "";
  const parsed = qrTokenPayloadSchema.safeParse(
    JSON.parse(Buffer.from(claims, "base64url").toString("utf8")),
  );
  check("QR payload parses against qrTokenPayloadSchema", parsed.success);
  if (parsed.success) {
    check("payload.gid is the guest", parsed.data.gid === guest?.id);
    check("payload.eid is the event", parsed.data.eid === event.id);
    check("payload.exp is after payload.iat", parsed.data.exp > parsed.data.iat);
    console.log(`  payload: ${JSON.stringify(parsed.data)}`);
  }

  const verified = verifyQrToken(first.token ?? "");
  check("signature verifies", verified.ok, verified.ok ? "" : verified.reason);
  check(
    "a tampered token is rejected",
    !verifyQrToken(`${first.token ?? ""}x`).ok,
  );

  // The unique constraint on (eventId, email) means a returning guest must be
  // an update, never a crash.
  const second = await register(slug, {
    name: "Verification Guest",
    email,
    company: "Ovation QA",
    dietary: "Vegan",
    plusOnes: "0",
    consent: "on",
  });
  check("re-registering the same email succeeds", second.ok);
  check("it is recognised as a returning guest", second.ok && second.returning);

  const updated = await db.guest.findUnique({
    where: { eventId_email: { eventId: event.id, email } },
    select: { dietary: true, plusOnes: true, registeredAt: true },
  });
  check(
    "the update took",
    updated?.dietary === "Vegan" && updated?.plusOnes === 0,
  );
  check(
    "the original registration time is kept",
    updated?.registeredAt?.getTime() === guest?.registeredAt?.getTime(),
  );

  // Consent is not optional, and neither is a valid address.
  const refused = await register(slug, {
    name: "No Consent",
    email: `refused-${Date.now()}@ovation.test`,
    plusOnes: "0",
  });
  check("a submission without consent is refused", !refused.ok);

  const after = await db.event.findUnique({
    where: { id: event.id },
    select: { rsvpConversions: true },
  });
  check(
    "rsvpConversions counted the registration exactly once",
    after?.rsvpConversions === event.rsvpConversions + 1,
    `${event.rsvpConversions} -> ${after?.rsvpConversions}`,
  );

  if (!keep && guest) {
    await db.emailMessage.deleteMany({ where: { guestId: guest.id } });
    await db.guest.delete({ where: { id: guest.id } });
    await db.event.update({
      where: { id: event.id },
      data: { rsvpConversions: event.rsvpConversions },
    });
    console.log("\n  cleaned up");
  }

  await db.$disconnect();
}

main()
  .then(() => {
    console.log(
      failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
