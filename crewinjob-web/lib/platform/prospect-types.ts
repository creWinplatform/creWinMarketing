// B2B prospects for standard projects: client-safe types only; the store lives in prospects.ts.
// Companies come from the team; evidence comes from the company's own public page. No people or email addresses.
export const PROSPECT_LIMITS={prospects:200,checksPerDay:50} as const;
export type ProspectState='candidate'|'approved'|'rejected';
export type ProspectView={
  id:string;company:string;website:string;sector:string;country:string;reason:string;contactRole:string;reasonSource:'human'|'ai'|null;
  check:{status:'not_checked'|'ok'|'unreachable';sourceUrl:string|null;pageTitle:string|null;summary:string|null;evidence:string|null;checkedAt:string|null};
  state:ProspectState;decidedAt:string|null;note:string;task:{id:string;status:string}|null;revision:number;createdAt:string;updatedAt:string;
};
export type ProspectsSnapshot={prospects:ProspectView[];counts:Record<ProspectState,number>;checksLeft:number;aiConfigured:boolean;canWrite:boolean;canApprove:boolean};
