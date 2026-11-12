import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { prisma } from '../../../lib/prisma';
import langs from '../../../lib/languages';
const { LANGS, DEFAULT_LANG } = langs;

export async function GET() {
  const s = await getServerSession(authOptions);
  if (!s) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const rooms = await prisma.room.findMany({
    where: { ownerId: s.user.id }, orderBy: { createdAt: 'desc' }, take: 8,
    select: { code: true, language: true, createdAt: true },
  });
  return Response.json({ rooms });
}

export async function POST(req) {
  const s = await getServerSession(authOptions);
  if (!s) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const language = LANGS[body.language] ? body.language : DEFAULT_LANG;
  const code = Math.random().toString(36).slice(2, 8);
  await prisma.room.create({ data: { code, ownerId: s.user.id, language, content: LANGS[language].template } });
  return Response.json({ code });
}
