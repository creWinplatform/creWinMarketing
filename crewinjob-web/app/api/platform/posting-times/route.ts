import { platformDatabase } from '@/lib/platform/database';
import { PostingTimes } from '@/lib/platform/posting-times';
import { coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
// When the team's own measured posts did best, per channel (read only).
export const GET=coachRoute(async scope=>new PostingTimes(platformDatabase(),scope).view());
