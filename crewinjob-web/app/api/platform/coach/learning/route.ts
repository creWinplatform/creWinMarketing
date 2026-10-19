import { platformDatabase } from '@/lib/platform/database';
import { CoachLearning } from '@/lib/platform/coach-learning';
import { coachRoute } from '../shared';
export const dynamic='force-dynamic';
const handle=coachRoute(async scope=>new CoachLearning(platformDatabase(),scope).read());
export const GET=handle;
