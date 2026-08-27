import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { hashCanonicalDomainProjectionJson as hash } from "../../telemetry-contracts/src/index.js";
import { assembleProviderEpisodeClosure, type ProviderEpisodeClosure } from "../../telemetry-smpp-consumer/src/closure-v2.js";
import { CanonicalProviderClosureSource, failure, text, timestamp, type CanonicalClosureOrigin, type ClosureWarehouse } from "../../telemetry-smpp-consumer/src/canonical-closure-source.js";
import { publishClosureDetails } from "../../telemetry-smpp-consumer/src/closure-publisher.js";

export interface ProviderClosureRegistration extends Omit<CanonicalClosureOrigin,"notBefore"> { readonly originId: string }
type OriginRow={scope_json:Omit<ProviderClosureRegistration,"originId">;scope_hash:string;not_before:Date;scan_projected_at:Date;scan_row_id:string};
type Lease={episode_id:string;lease_token:string;pending_snapshot:ProviderEpisodeClosure|null;pending_input_hash:string|null;last_input_hash:string|null};

/** Owns only projection intake, leases and checkpoints; never Task or Provider state. */
export class ProviderClosureRuntime {
  private readonly owner = `provider-closure-${randomUUID()}`;
  constructor(private readonly pool:Pool,private readonly warehouse:ClosureWarehouse,readonly registration:ProviderClosureRegistration) {}

  async initialize():Promise<CanonicalClosureOrigin> {
    const {originId,...scope}=this.registration;
    if(Object.values(this.registration).some(value=>typeof value!=="string"||!value||value.length>256))throw failure("PROVIDER_ORIGIN_INVALID");
    await this.pool.query(`INSERT INTO telemetry_control.provider_closure_origin(origin_id,scope_json,scope_hash)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[originId,scope,hash(scope)]);
    const row=await this.origin();
    if(row.scope_hash!==hash(scope)||hash(row.scope_json)!==row.scope_hash)throw failure("PROVIDER_ORIGIN_SCOPE_DRIFT");
    return {...scope,notBefore:row.not_before.toISOString()};
  }
  private async origin():Promise<OriginRow> {
    const result=await this.pool.query<OriginRow>("SELECT * FROM telemetry_control.provider_closure_origin WHERE origin_id=$1",[this.registration.originId]);
    if(!result.rows[0])throw failure("PROVIDER_ORIGIN_NOT_INITIALIZED");return result.rows[0];
  }
  async runOnce():Promise<void> {
    const origin=await this.initialize(); const source=new CanonicalProviderClosureSource(this.warehouse,origin);
    const cursor=await this.origin();
    const discovered=await source.discover({projectedAt:cursor.scan_projected_at.toISOString(),rowId:cursor.scan_row_id});
    if(discovered.length){
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        for(const row of discovered)await client.query(`INSERT INTO telemetry_control.provider_closure_episode(origin_id,episode_id)
          VALUES($1,$2) ON CONFLICT DO NOTHING`,[this.registration.originId,text(row,"episode_id")]);
        const last=discovered[discovered.length-1];
        await client.query(`UPDATE telemetry_control.provider_closure_origin SET scan_projected_at=$2,scan_row_id=$3
          WHERE origin_id=$1 AND (scan_projected_at,scan_row_id)<($2::timestamptz,$3::text)`,[this.registration.originId,timestamp(text(last,"projected_at")),text(last,"row_id")]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    }
    const claimed=await this.pool.query<Lease>(`WITH candidate AS (
      SELECT origin_id,episode_id FROM telemetry_control.provider_closure_episode WHERE origin_id=$1
      AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
      ORDER BY next_attempt_at,episode_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE telemetry_control.provider_closure_episode e SET lease_owner=$2,lease_token=e.lease_token+1,
      lease_until=clock_timestamp()+interval '5 minutes',attempts=e.attempts+1
      FROM candidate c WHERE e.origin_id=c.origin_id AND e.episode_id=c.episode_id RETURNING e.*`,[this.registration.originId,this.owner]);
    const lease=claimed.rows[0];if(!lease)return;
    const keys=[this.registration.originId,lease.episode_id,this.owner,lease.lease_token];
    try{
      let closure=lease.pending_snapshot;
      let inputHash=lease.pending_input_hash;
      if(!closure){
        const scope={tenantId:origin.tenantId,projectId:origin.projectId,environment:origin.environment,episodeId:lease.episode_id};
        const captured=await source.capture(scope);
        if(captured.identityHash===lease.last_input_hash){await this.release(keys);return;}
        closure=await assembleProviderEpisodeClosure(source,{...scope,required:true,asOfProjectedAt:captured.asOfProjectedAt});
        if(closure.readiness.status==="blocked_drift")throw failure("PROVIDER_SOURCE_MOVED_DURING_SNAPSHOT");
        inputHash=captured.identityHash;
        const saved=await this.pool.query(`UPDATE telemetry_control.provider_closure_episode SET pending_snapshot=$5,pending_input_hash=$6
          WHERE origin_id=$1 AND episode_id=$2 AND lease_owner=$3 AND lease_token=$4 AND lease_until>clock_timestamp() RETURNING episode_id`,[...keys,closure,inputHash]);
        if(saved.rows.length!==1)throw failure("PROVIDER_LEASE_LOST");
      }
      if(closure.scope.episodeId!==lease.episode_id||closure.scope.tenantId!==origin.tenantId||closure.scope.projectId!==origin.projectId||closure.scope.environment!==origin.environment||Date.parse(closure.snapshot.asOfProjectedAt)<Date.parse(origin.notBefore))throw failure("PROVIDER_PENDING_SCOPE_INVALID");
      const commitManifest=await publishClosureDetails(this.warehouse,closure);
      const client=await this.pool.connect();
      try{
        await client.query("BEGIN");
        const locked=await client.query(`SELECT episode_id FROM telemetry_control.provider_closure_episode
          WHERE origin_id=$1 AND episode_id=$2 AND lease_owner=$3 AND lease_token=$4 AND lease_until>clock_timestamp() FOR UPDATE`,keys);
        if(locked.rows.length!==1)throw failure("PROVIDER_LEASE_LOST");
        // The row lock fences takeover while publishing the last CH commit marker.
        await commitManifest();
        await client.query(`UPDATE telemetry_control.provider_closure_episode SET pending_snapshot=NULL,pending_input_hash=NULL,
          last_input_hash=$5,last_snapshot_id=$6,last_status=$7,last_error_code=NULL,published=published+1,
          lease_owner=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
          WHERE origin_id=$1 AND episode_id=$2 AND lease_owner=$3 AND lease_token=$4`,[...keys,inputHash,hash(closure),closure.readiness.status]);
        await client.query("COMMIT");
      }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    }catch(error){
      const code=error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"&&/^[A-Z0-9_]+$/u.test(error.code)?error.code:"PROVIDER_CLOSURE_FAILED";
      await this.pool.query(`UPDATE telemetry_control.provider_closure_episode SET last_error_code=$5,last_status='blocked',lease_owner=NULL,lease_until=NULL,
        next_attempt_at=clock_timestamp()+interval '15 seconds',updated_at=clock_timestamp()
        WHERE origin_id=$1 AND episode_id=$2 AND lease_owner=$3 AND lease_token=$4`,[...keys,code]);
      throw failure(code);
    }
  }
  private async release(keys:unknown[]):Promise<void>{await this.pool.query(`UPDATE telemetry_control.provider_closure_episode
    SET lease_owner=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '15 seconds' WHERE origin_id=$1 AND episode_id=$2 AND lease_owner=$3 AND lease_token=$4`,keys);}
  async status():Promise<Record<string,unknown>>{
    const origin=await this.origin();
    const result=await this.pool.query(`SELECT last_status,count(*)::int AS episodes,sum(published)::text AS snapshots,
      count(*) FILTER(WHERE pending_snapshot IS NOT NULL)::int AS pending,array_remove(array_agg(DISTINCT last_error_code),NULL) AS reasons
      FROM telemetry_control.provider_closure_episode WHERE origin_id=$1 GROUP BY last_status`,[this.registration.originId]);
    return {originId:this.registration.originId,notBefore:origin.not_before.toISOString(),checkpoint:{projectedAt:origin.scan_projected_at.toISOString(),rowId:origin.scan_row_id},
      data:result.rows.length?"observed":"waiting_source",states:result.rows};
  }
}
