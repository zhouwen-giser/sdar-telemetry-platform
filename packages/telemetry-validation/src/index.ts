import {createHash} from "node:crypto";
export function canonical(v:unknown):string {if(v===null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(canonical).join(",")}]`;const o=v as Record<string,unknown>;return `{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;}
export function sha256(v:unknown):string{return createHash("sha256").update(typeof v==="string"?v:canonical(v)).digest("hex")}
const secretKeys=/(password|passwd|secret|private[_-]?key|authorization|bearer|access[_-]?token|refresh[_-]?token)/i;
export function scanSecrets(v:unknown,path="$",hits:string[]=[]):string[]{if(!v||typeof v!=="object")return hits;if(Array.isArray(v)){v.forEach((x,i)=>scanSecrets(x,`${path}[${i}]`,hits));return hits;}for(const [k,x] of Object.entries(v as Record<string,unknown>)){if(secretKeys.test(k))hits.push(`${path}.${k}`);scanSecrets(x,`${path}.${k}`,hits)}return hits;}
export function assertSafeSqlIdentifier(v:string):string{if(!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(v))throw new Error("unsafe SQL identifier");return v}
