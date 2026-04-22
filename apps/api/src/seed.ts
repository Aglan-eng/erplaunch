/**
 * Database seed — uses the custom SQLite db layer (no Prisma required).
 * Invoked by START.bat on first launch.
 */
import bcrypt from 'bcryptjs';
import {
  initDb,
  createFirm,
  findFirmBySlug,
  createUser,
  findUserByEmail,
  resetUserPassword,
  createEngagement,
  listEngagements,
  replacePhases,
} from './db/index.js';

interface FirmRow { id: string; name: string; slug: string }
interface EngagementRow { id: string; clientName: string }

async function main() {
  console.log('Seeding database...');

  await initDb();

  // ── Firm ─────────────────────────────────────────────────────────────────
  let firm = (await findFirmBySlug('ofoq')) as FirmRow | null;
  if (!firm) {
    firm = (await createFirm({ name: 'Ofoq Consulting', slug: 'ofoq', plan: 'STARTER' })) as FirmRow | null;
    if (!firm) throw new Error('Failed to create seed firm');
    console.log('Firm created:', firm.name);
  } else {
    console.log('Firm already exists:', firm.name);
  }

  // ── User ─────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 10);
  const existing = await findUserByEmail('consultant@test.ofoq.app');
  if (!existing) {
    const user = await createUser({
      firmId: firm.id,
      email: 'consultant@test.ofoq.app',
      name: 'Test Consultant',
      passwordHash,
      role: 'CONSULTANT',
    });
    console.log('User created:', (user as unknown as { email: string }).email);
  } else {
    // Always reset the password so FIX LOGIN.bat reliably fixes auth issues
    await resetUserPassword('consultant@test.ofoq.app', passwordHash);
    console.log('User password reset:', (existing as unknown as { email: string }).email);
  }

  // ── Engagement ────────────────────────────────────────────────────────────
  const engagements = await listEngagements(firm.id);
  if (engagements.length === 0) {
    // createEngagement automatically creates empty profile + license rows
    const eng = (await createEngagement({
      firmId: firm.id,
      clientName: 'Demo Client Ltd',
    })) as EngagementRow | null;
    if (!eng) throw new Error('Failed to create seed engagement');

    // Seed default phases
    await replacePhases(eng.id, [
      { name: 'Phase 1 — Foundation',  order: 1, flows: ['R2R'],        trigger: 'REQUIREMENT', status: 'PLANNED' },
      { name: 'Phase 2 — Operations',  order: 2, flows: ['P2P', 'O2C'], trigger: 'REQUIREMENT', status: 'PLANNED' },
    ]);

    console.log('Engagement created:', eng.clientName);
  } else {
    console.log('Engagement already exists, skipping.');
  }

  console.log('\nSeed complete!');
  console.log('Login: consultant@test.ofoq.app / password123');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
