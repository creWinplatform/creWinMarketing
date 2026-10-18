export type SesProof={identity:boolean;dkim:boolean;account:boolean;events:boolean;sandbox:boolean;mailFrom:'custom_verified'|'provider_managed'|'not_verified'};
export type SesSettings={configured:boolean;revision:number;region:string|null;configurationSet:string;topicArn:string;checkedAt:string|null;verified:boolean;proof:SesProof|null;lastError:string;feedbackObservedAt:string|null;endpoint:string|null;deploymentEnabled:boolean;ready:boolean};
export const emptySesProof=():SesProof=>({identity:false,dkim:false,account:false,events:false,sandbox:true,mailFrom:'not_verified'});
