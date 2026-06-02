import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? '';

  if (!['admin', 'sysadmin'].includes(role)) {
    redirect('/risansi');
  }

  return <>{children}</>;
}
