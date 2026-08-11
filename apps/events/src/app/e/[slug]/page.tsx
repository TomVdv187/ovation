import { notFound } from "next/navigation";
import { SectionRenderer } from "~/components/sections";
import { VisitBeacon } from "~/components/visit-beacon";
import { getPage } from "~/server/page-data";

/**
 * The public event page.
 *
 * Entirely server-rendered from page.render — there is no client-side fetch for
 * anything a guest reads. The body is a list of sections the router built from
 * the Event row, so the page is only ever as right as the contract is.
 */
export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const hasProgramme = page.sections.some(
    (section) => section.kind === "programme",
  );

  return (
    <>
      {page.sections.map((section, index) => (
        <SectionRenderer
          key={`${section.kind}-${index}`}
          section={section}
          timezone={page.event.timezone}
          hasProgramme={hasProgramme}
        />
      ))}
      <VisitBeacon slug={slug} />
    </>
  );
}
