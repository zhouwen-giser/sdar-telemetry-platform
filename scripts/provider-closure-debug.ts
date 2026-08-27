import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { ClickHouseClient, configFromEnv } from "../packages/telemetry-clickhouse/src/index.js";
import { ProviderClosureRuntime, type ProviderClosureRegistration } from "../packages/telemetry-control-postgres/src/provider-closure-runtime.js";

const command=process.argv[2];
if(!["bootstrap","status"].includes(command??"")||process.argv.length!==3)throw new Error("PROVIDER_CLOSURE_DEBUG_ARGUMENT_INVALID");
const urlFile=process.env["CONTROL_POSTGRES_URL_FILE"];
const configFile=process.env["PROVIDER_CLOSURE_CONFIG_FILE"];
if(!urlFile||!configFile)throw new Error("PROVIDER_CLOSURE_DEBUG_CONFIGURATION_REQUIRED");
const registration=JSON.parse(await readFile(configFile,"utf8")) as ProviderClosureRegistration;
const pool=new Pool({connectionString:(await readFile(urlFile,"utf8")).trim(),max:1,connectionTimeoutMillis:5000});
try{
  const runtime=new ProviderClosureRuntime(pool,new ClickHouseClient(configFromEnv()),registration);
  if(command==="bootstrap")await runtime.initialize();
  const status=await runtime.status();
  process.stdout.write(JSON.stringify({status:command==="bootstrap"?"initialized":"available",...status})+"\n");
}finally{await pool.end();}
