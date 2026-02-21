const { PrismaClient } = require('@prisma/client');

let prisma;
/**
 * Singleton Prisma client (Render friendly).
 */
function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

module.exports = { getPrisma };
