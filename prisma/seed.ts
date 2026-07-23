// =========================================================================
// AL-HARAM GOLD JEWELLERS — Database seed
//
//   Tenant : AL-HARAM GOLD JEWELLERS / Haji Abdul Rehman / 03001234567
//            / Shop 12, Sona Bazaar, Lahore
//   Branch : Main Branch (isDefault: true)
//   Admin  : Admin / admin@alharam.pk / Admin@123 / role ADMIN
//   Rates  : K24=9400, K22=8950, K21=8550, K18=7300 (per gram, from today)
//
// Passwords are bcrypt-hashed here — plaintext is never stored.
// Idempotent: re-running with the tenant already present is a no-op.
// =========================================================================

import { PrismaClient, Purity } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SHOP_NAME = "AL-HARAM GOLD JEWELLERS";
const ADMIN_EMAIL = "admin@alharam.pk";
const ADMIN_PASSWORD = "Admin@123";

async function main() {
  const existing = await prisma.tenant.findFirst({
    where: { shopName: SHOP_NAME },
  });
  if (existing) {
    console.log(`Seed skipped: tenant already exists (${existing.id}).`);
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      shopName: SHOP_NAME,
      ownerName: "Haji Abdul Rehman",
      phone: "03001234567",
      address: "Shop 12, Sona Bazaar, Lahore",
    },
  });

  const branch = await prisma.branch.create({
    data: {
      tenantId: tenant.id,
      name: "Main Branch",
      isDefault: true,
    },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      branchId: branch.id,
      name: "Admin",
      email: ADMIN_EMAIL,
      passwordHash,
      role: "ADMIN",
    },
  });

  const effectiveFrom = new Date();
  const rates: { purity: Purity; ratePerGram: string }[] = [
    { purity: "K24", ratePerGram: "9400.00" },
    { purity: "K22", ratePerGram: "8950.00" },
    { purity: "K21", ratePerGram: "8550.00" },
    { purity: "K18", ratePerGram: "7300.00" },
  ];
  await prisma.goldRate.createMany({
    data: rates.map((r) => ({
      tenantId: tenant.id,
      purity: r.purity,
      ratePerGram: r.ratePerGram,
      effectiveFrom,
      createdByUserId: admin.id,
    })),
  });

  console.log("Seed complete:");
  console.log(`  tenant  ${tenant.id}  (${tenant.shopName})`);
  console.log(`  branch  ${branch.id}  (${branch.name}, isDefault=${branch.isDefault})`);
  console.log(`  admin   ${admin.id}  (${admin.email}, role=${admin.role})`);
  console.log(`  rates   ${rates.length} gold rates effectiveFrom ${effectiveFrom.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
