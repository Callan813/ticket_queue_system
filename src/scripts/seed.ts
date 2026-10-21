import bcrypt from 'bcrypt';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export const DEMO_PASSWORD = 'password123';

const ORGANISER = { name: 'Priya (Organiser)', email: 'organiser@demo.dev' };
const ATTENDEES = [
  { name: 'Alice', email: 'alice@demo.dev' },
  { name: 'Bob', email: 'bob@demo.dev' },
  { name: 'Carol', email: 'carol@demo.dev' },
];

/** Rows A-B are VIP, C-E standard, 10 seats each = 50 seats. Prices in paise. */
function seatLayout() {
  return ['A', 'B', 'C', 'D', 'E'].flatMap((row) =>
    Array.from({ length: 10 }, (_, i) => ({
      row,
      number: i + 1,
      tier: row <= 'B' ? 'VIP' : 'STANDARD',
      price: row <= 'B' ? 150000 : 50000,
    })),
  );
}

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000);

/**
 * Creates 1 organiser, 3 attendees and 2 published events with 50 seats each.
 * Idempotent: does nothing if the demo organiser already exists.
 */
export async function seedDemoData() {
  if (await prisma.user.findUnique({ where: { email: ORGANISER.email } })) {
    logger.info('Demo data already present, skipping seed');
    return false;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const organiser = await prisma.user.create({ data: { ...ORGANISER, passwordHash, role: 'ORGANISER' } });
  await prisma.user.createMany({ data: ATTENDEES.map((a) => ({ ...a, passwordHash, role: 'ATTENDEE' as const })) });

  const events = [
    {
      title: 'TechFest 2026: Opening Keynote',
      description: 'The college tech fest kicks off with a keynote and live demos.',
      venue: 'Main Auditorium',
      startsAt: daysFromNow(30),
    },
    {
      title: 'Hackathon Finals Showcase',
      description: 'Top 10 teams demo their 36-hour builds. Judges pick the winners live.',
      venue: 'Innovation Hall',
      startsAt: daysFromNow(45),
    },
  ];
  for (const event of events) {
    await prisma.event.create({
      data: { ...event, organiserId: organiser.id, status: 'PUBLISHED', seats: { create: seatLayout() } },
    });
  }

  logger.info(
    { users: [ORGANISER.email, ...ATTENDEES.map((a) => a.email)], password: DEMO_PASSWORD },
    'Seeded demo data',
  );
  return true;
}

if (require.main === module) {
  seedDemoData()
    .catch((err) => {
      logger.error({ err }, 'Seed failed');
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
