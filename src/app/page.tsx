import PortDeckApp from '@/components/PortDeckApp';
import { getDemoCatalog } from '@/lib/demo-catalog';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const catalog = await getDemoCatalog();
  return <PortDeckApp catalog={catalog} />;
}
