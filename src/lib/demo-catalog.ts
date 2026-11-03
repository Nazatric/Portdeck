import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { demoCatalog } from '@/db/schema';
import type { DemoCatalogItem } from './types';

const defaults: DemoCatalogItem[] = [
  { id: 'demo-split', name: 'Tip & Split', framework: 'React', sortOrder: 1 },
  { id: 'demo-notes', name: 'Scratchpad', framework: 'HTML', sortOrder: 2 },
  { id: 'demo-timer', name: 'Focus Timer', framework: 'Next.js', sortOrder: 3 },
];

export async function getDemoCatalog(): Promise<DemoCatalogItem[]> {
  try {
    const existing = await db.select().from(demoCatalog).orderBy(asc(demoCatalog.sortOrder));
    if (existing.length) return existing;
    await db.insert(demoCatalog).values(defaults).onConflictDoNothing();
    return defaults;
  } catch {
    // The local library remains available before the optional catalog is migrated.
    return defaults;
  }
}
