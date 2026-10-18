export type BillingPlan = {id:string;name:string;amountMinor:number;currency:'USD';cadence:'monthly'|'yearly'};
export type BillingOrderState = 'preparing'|'pending'|'test_paid'|'test_failed'|'rejected'|'uncertain'|'review';
export type BillingCheckOutcome='checking'|'confirmed'|'not_confirmed'|'mismatch'|'unavailable'|'changed';
export type BillingCheckReason='matched'|'no_confirmed_payment'|'provider_unavailable'|'invalid_response'|'details_mismatch'|'refund_observed'|'configuration_changed'|'authority_lost'|'order_changed'|'interrupted'|'review_required'|'contradicting_result';
export type BillingCheck={outcome:BillingCheckOutcome;reason:BillingCheckReason|null;createdAt:string;completedAt:string|null;interrupted:boolean};
export type BillingOrder = {
  id:string;planName:string;amountMinor:number;currency:'USD';cadence:'monthly'|'yearly';
  state:BillingOrderState;createdAt:string;expiresAt:string;updatedAt:string;checkoutUrl:string|null;
  settlementSource:'notification'|'status_inquiry'|null;latestCheck:BillingCheck|null;canCheck:boolean;
};
export type BillingReadiness = {
  provider:'paytr';mode:'sandbox';liveEnabled:false;subscriptionEnabled:false;
  checks:{gate:boolean;credentials:boolean;usdAcknowledged:boolean;origin:boolean;catalog:boolean};
  ready:boolean;
};
export type ProjectBillingView = {
  projectId:string;readiness:BillingReadiness;emailVerified:boolean;plans:BillingPlan[];orders:BillingOrder[];statusCheckEnabled:boolean;
};
