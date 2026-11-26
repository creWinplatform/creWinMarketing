// Sales assistant, warm introductions: the team's own LinkedIn connections, matched with the companies in the pipeline
// and grouped by company, so the first customers can come from people who already know the team (Y Combinator: your
// first customers almost always come from your network). Messages are only prepared; a person sends them.
export const NETWORK_LIMITS = { contacts: 5000, perImport: 5000, importsPerDay: 3, draftsPerDay: 60, companies: 20, search: 100, words: 70 } as const;
export type NetworkState = 'new' | 'asked' | 'helped' | 'not_relevant';
export type NetworkContact = { id: string; name: string; position: string; company: string; url: string; state: NetworkState; askedAt: string | null; decisionMaker: boolean };
export type NetworkMatch = { contact: NetworkContact; prospects: { id: string; company: string; stage: string }[] };
export type NetworkCompany = { key: string; company: string; people: number; decisionMakers: number };
export type NetworkSnapshot = {
  total: number; asked: number; importedAt: string | null; termsAccepted: boolean;
  matches: NetworkMatch[]; companies: NetworkCompany[]; results: NetworkContact[];
  aiConfigured: boolean; canWrite: boolean;
};
