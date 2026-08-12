import { createCallerFactory } from "@ovation/core";
import { guestsRouter } from "../../src/router";
import { createFakeDb, type FakeDb, type World } from "./fake-db";
import { daysBefore, EVENT, guestRow, ORG_ID } from "./factories";

/**
 * A small Meridian Summit, shaped like the seed but sized for assertions you can
 * read: one guest per interesting case rather than two hundred of them.
 */
export function buildWorld(): World {
  return {
    organisations: [{ id: ORG_ID, name: "Meridian Collective" }],
    events: [EVENT],
    guests: [
      guestRow({
        id: "g-vip",
        name: "Charlotte Peeters",
        email: "charlotte.peeters@helviongroup.be",
        company: "Helvion Group",
        title: "CEO",
        segment: "VIP",
        rsvpStatus: "CONFIRMED",
        interests: ["energy transition", "leadership"],
        dietary: "Vegetarian",
        plusOnes: 1,
        emailOpens: 8,
        emailClicks: 4,
        pageVisits: 6,
        lastSeenAt: daysBefore(6),
        registeredAt: daysBefore(70),
        createdAt: daysBefore(95),
        whiteGlove: { transport: "Car from Antwerpen-Centraal", seating: null, dietary: null, host: null, done: [] },
      }),
      guestRow({
        id: "g-client",
        name: "Thijs van Dijk",
        email: "thijs.vandijk@northgatebank.nl",
        company: "Northgate Bank",
        title: "CFO",
        segment: "CLIENT",
        rsvpStatus: "CONFIRMED",
        interests: ["private equity"],
        emailOpens: 5,
        emailClicks: 1,
        pageVisits: 2,
        lastSeenAt: daysBefore(40),
        registeredAt: daysBefore(65),
        createdAt: daysBefore(80),
      }),
      guestRow({
        id: "g-silent",
        name: "Bart Cools",
        email: "bart.cools@atlasinsurance.com",
        company: "Atlas Insurance",
        title: "Innovation Lead",
        segment: "PROSPECT",
        rsvpStatus: "INVITED",
        createdAt: daysBefore(75),
      }),
      guestRow({
        id: "g-newcomer",
        name: "Iris Bakker",
        email: "iris.bakker@solvenda.be",
        company: "Solvenda",
        title: "Programme Director",
        segment: "PROSPECT",
        rsvpStatus: "INVITED",
        createdAt: daysBefore(3),
      }),
      guestRow({
        id: "g-wait-partner",
        name: "Bram Willems",
        email: "bram.willems@nexasystems.com",
        company: "Nexa Systems",
        title: "Head of Partnerships",
        segment: "PARTNER",
        rsvpStatus: "WAITLISTED",
        emailOpens: 5,
        emailClicks: 2,
        pageVisits: 4,
        lastSeenAt: daysBefore(12),
        createdAt: daysBefore(50),
      }),
      guestRow({
        id: "g-wait-prospect",
        name: "Fien Maes",
        email: "fien.maes@rivotechnologies.eu",
        company: "Rivo Technologies",
        title: "Product Director",
        segment: "PROSPECT",
        rsvpStatus: "WAITLISTED",
        emailOpens: 1,
        emailClicks: 0,
        pageVisits: 1,
        lastSeenAt: daysBefore(55),
        createdAt: daysBefore(20),
      }),
      guestRow({
        id: "g-declined",
        name: "Koen Aerts",
        email: "koen.aerts@vantagepharma.com",
        company: "Vantage Pharma",
        rsvpStatus: "DECLINED",
        createdAt: daysBefore(60),
      }),
      guestRow({
        id: "g-checkedin",
        name: "Sanne Visser",
        email: "sanne.visser@lumenenergy.be",
        company: "Lumen Energy",
        rsvpStatus: "CHECKED_IN",
        emailOpens: 3,
        emailClicks: 1,
        pageVisits: 2,
        lastSeenAt: daysBefore(2),
        registeredAt: daysBefore(30),
        createdAt: daysBefore(45),
      }),
      guestRow({
        id: "g-press",
        name: "Noémie Lefebvre",
        email: "noemie.lefebvre@detijd.be",
        company: "De Tijd",
        title: "Senior Correspondent",
        segment: "PRESS",
        rsvpStatus: "INVITED",
        emailOpens: 2,
        createdAt: daysBefore(40),
      }),
      guestRow({
        id: "g-sponsor-contact",
        name: "Griet Segers",
        email: "griet.segers@helviongroup.be",
        company: "Helvion Group",
        title: "Head of Communications",
        segment: "PROSPECT",
        rsvpStatus: "CONFIRMED",
        emailOpens: 4,
        emailClicks: 2,
        pageVisits: 3,
        lastSeenAt: daysBefore(20),
        registeredAt: daysBefore(55),
        createdAt: daysBefore(70),
      }),
    ],
    orders: [
      {
        id: "ord-vip",
        eventId: EVENT.id,
        guestId: "g-vip",
        amountCents: 120_000,
        status: "PAID",
        tier: { name: "VIP Table" },
      },
      {
        id: "ord-client",
        eventId: EVENT.id,
        guestId: "g-client",
        amountCents: 14_500,
        status: "PAID",
        tier: { name: "Standard" },
      },
      {
        id: "ord-checkedin",
        eventId: EVENT.id,
        guestId: "g-checkedin",
        amountCents: 9_500,
        status: "PAID",
        tier: { name: "Early" },
      },
      {
        id: "ord-sponsor-contact",
        eventId: EVENT.id,
        guestId: "g-sponsor-contact",
        amountCents: 14_500,
        status: "PAID",
        tier: { name: "Standard" },
      },
      {
        id: "ord-pending",
        eventId: EVENT.id,
        guestId: "g-silent",
        amountCents: 14_500,
        status: "PENDING",
        tier: { name: "Standard" },
      },
    ],
    sponsors: [
      {
        id: "sp-helvion",
        eventId: EVENT.id,
        name: "Helvion Group",
        contactEmail: "griet.segers@helviongroup.be",
      },
      { id: "sp-nexa", eventId: EVENT.id, name: "Nexa Systems", contactEmail: null },
    ],
    emails: [],
  };
}

const createCaller = createCallerFactory(guestsRouter);

export interface Harness {
  caller: ReturnType<typeof createCaller>;
  fake: FakeDb;
}

export function harness(world: World = buildWorld(), organisationId: string | null = ORG_ID): Harness {
  const fake = createFakeDb(world);
  const caller = createCaller({
    db: fake.client,
    headers: null,
    session: {
      user: {
        id: "user-1",
        email: "tom@meridian.test",
        name: "Tom Van Devenne",
        organisationId,
        role: "OWNER",
      },
    },
  });
  return { caller, fake };
}
