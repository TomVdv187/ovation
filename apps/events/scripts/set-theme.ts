import { loadRootEnv } from "./env";

/**
 * Flips an event's theme preset in the database.
 *
 *   pnpm --filter @ovation/events theme meridian-summit-2026 blacktie
 *   pnpm --filter @ovation/events theme meridian-summit-2026 classic
 *
 * The point of the exercise: reload /e/<slug> afterwards and the page is a
 * different design with no code changed, no rebuild and no restart. If that
 * ever stops being true, something has grown a branch it should not have.
 */
async function main(): Promise<void> {
  loadRootEnv();

  const { db } = await import("@ovation/core/db");
  const { themePresetSchema, eventThemeSchema } = await import("@ovation/core");
  const { parseTheme } = await import("../src/lib/theme");

  const slug = process.argv[2];
  const preset = themePresetSchema.safeParse(process.argv[3]);

  if (!slug || !preset.success) {
    console.error(
      "usage: theme <event-slug> <classic|blacktie>\n" +
        "       (the presets live in packages/core/src/design/tokens.ts)",
    );
    process.exit(1);
  }

  const event = await db.event.findUnique({
    where: { slug },
    select: { id: true, title: true, theme: true },
  });
  if (!event) {
    console.error(`No event with slug "${slug}".`);
    process.exit(1);
  }

  const current = parseTheme(event.theme);
  const next = eventThemeSchema.parse({ ...current, preset: preset.data });

  await db.event.update({
    where: { id: event.id },
    data: { theme: next as unknown as Record<string, never> },
  });

  console.log(
    `${event.title}: ${current.preset} -> ${preset.data}. Reload /e/${slug}.`,
  );

  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
