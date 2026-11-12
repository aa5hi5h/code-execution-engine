import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { prisma } from '../../../../lib/prisma';

export async function GET(_req, { params }) {
  const s = await getServerSession(authOptions);
  if (!s) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const r = await prisma.room.findUnique({ where: { code: params.code }, select: { code: true, language: true } });
  if (!r) return Response.json({ error: 'Room not found' }, { status: 404 });
  return Response.json(r);
}
