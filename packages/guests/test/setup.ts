/**
 * Importing the router pulls in @ovation/core/db, which constructs a Prisma
 * client at module load. A syntactically valid URL is enough — nothing in this
 * suite opens a connection; every test drives the router through a fake client.
 */
process.env["DATABASE_URL"] ??= "postgresql://ovation:ovation@localhost:5432/ovation_test";
process.env["DIRECT_URL"] ??= process.env["DATABASE_URL"];
