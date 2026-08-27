import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { ProviderClosureRuntime, type ProviderClosureRegistration } from "../../../packages/telemetry-control-postgres/src/provider-closure-runtime.js";
import type { ClosureWarehouse } from "../../../packages/telemetry-smpp-consumer/src/canonical-closure-source.js";

export async function runProviderClosureLoop(warehouse:ClosureWarehouse,stopping:()=>boolean):Promise<void>{
  const configFile=process.env["PROVIDER_CLOSURE_CONFIG_FILE"];
  if(!configFile)return; // Production default remains disabled.
  const urlFile=process.env["CONTROL_POSTGRES_URL_FILE"];if(!urlFile)throw new Error("PROVIDER_CONTROL_CONFIGURATION_REQUIRED");
  const registration=JSON.parse(await readFile(configFile,"utf8")) as ProviderClosureRegistration;
  const pool=new Pool({connectionString:(await readFile(urlFile,"utf8")).trim(),max:3});
  const runtime=new ProviderClosureRuntime(pool,warehouse,registration);
  try{
    await runtime.initialize();
    while(!stopping()){
      try{await runtime.runOnce();}catch(error){
        const code=error instanceof Error&&"code" in error?error.code:"PROVIDER_CLOSURE_FAILED";
        process.stderr.write(JSON.stringify({component:"provider-closure",code,degraded:true})+"\n");
      }
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }finally{await pool.end();}
}
