import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_LOGIN_USERNAME;
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !email || !password) {
    throw new Error("Set ADMIN_LOGIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before seeding the admin account.");
  }
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name: "RecoverX Administrator", passwordHash, role: "ADMIN" },
    create: { name: "RecoverX Administrator", email, passwordHash, role: "ADMIN" }
  });
  console.log(`Admin account ready: username=${username}, email=${admin.email}, role=${admin.role}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
