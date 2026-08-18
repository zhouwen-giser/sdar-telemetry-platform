export interface ReconciliationResult{key:string;sdarCount:number;smppCount:number;status:"matched"|"gap";details:string[]}
export function reconcile(key:string,sdarIds:string[],smppIds:string[]):ReconciliationResult{return {key,sdarCount:new Set(sdarIds).size,smppCount:new Set(smppIds).size,status:sdarIds.length&&smppIds.length?"matched":"gap",details:[]}}
export * from "./domain.js";
