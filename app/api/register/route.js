import bcrypt from 'bcryptjs';
import { prisma } from '../../../lib/prisma';
export async function POST(req) {
  const { email, name, password } = await req.json();
  if (!email || !name || !password || password.length < 6)
    return Response.json({ error: 'Name, email and a 6+ char password required' }, { status: 400 });
  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (exists) return Response.json({ error: 'Email already registered' }, { status: 409 });
  await prisma.user.create({
    data: { email: email.toLowerCase(), name, password: await bcrypt.hash(password, 10) },
  });
  return Response.json({ ok: true });
}
