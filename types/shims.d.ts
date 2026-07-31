declare const process: any;
declare const Buffer: any;
type Buffer = any;
declare const crypto: Crypto;
declare module "node:crypto" { export function createHash(a:string): any; export function randomUUID(): string; }
declare module "node:fs/promises" { export const mkdir:any,open:any,readdir:any,readFile:any,stat:any,truncate:any,writeFile:any,mkdtemp:any,appendFile:any,rm:any; }
declare module "node:path" { const path:any; export default path; }
declare module "node:os" { const os:any; export default os; }
declare module "node:http" { const http:any; export default http; export type ServerResponse=any; }
declare module "node:test" { const test:any; export default test; }
declare module "node:assert/strict" { const assert:any; export default assert; }
declare module "pg" { export class Pool { constructor(config?: unknown); query<T=unknown>(sql:string, params?:unknown[]): Promise<{rows:T[]; rowCount:number|null}>; connect():Promise<any>; end():Promise<void>; } }
