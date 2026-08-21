-- Capture the binding-first manifest at one immutable cutoff.
SELECT *
FROM sdar_mart.v_episode_smpp_provider_readiness
WHERE tenant_id = {tenantId:String}
  AND project_id = {projectId:String}
  AND environment = {environment:String}
  AND episode_id = {episodeId:String}
  AND as_of_projected_at <= {asOfProjectedAt:DateTime64(3)}
LIMIT 1;

-- Binding keyset page. origin metadata is intentionally absent from the predicate.
SELECT *
FROM sdar_mart.v_episode_smpp_provider_binding_closure
WHERE tenant_id = {tenantId:String}
  AND project_id = {projectId:String}
  AND environment = {environment:String}
  AND episode_id = {episodeId:String}
  AND projected_at <= {asOfProjectedAt:DateTime64(3)}
  AND (updated_at, binding_id) > ({cursorUpdatedAt:DateTime64(3)}, {cursorBindingId:String})
ORDER BY updated_at, binding_id
LIMIT {limit:UInt32};

-- Fact keyset page selected by the authoritative binding closure view.
SELECT *
FROM sdar_mart.v_episode_smpp_provider_fact_closure
WHERE tenant_id = {tenantId:String}
  AND project_id = {projectId:String}
  AND environment = {environment:String}
  AND episode_id = {episodeId:String}
  AND projected_at <= {asOfProjectedAt:DateTime64(3)}
  AND (occurred_at, fact_id) > ({cursorOccurredAt:DateTime64(3)}, {cursorFactId:String})
ORDER BY occurred_at, fact_id
LIMIT {limit:UInt32};

-- Reconciliation material is scoped to already-selected facts and never selects facts.
SELECT *
FROM sdar_mart.v_episode_smpp_origin_claim_reconciliation
WHERE tenant_id = {tenantId:String}
  AND project_id = {projectId:String}
  AND environment = {environment:String}
  AND episode_id = {episodeId:String}
  AND projected_at <= {asOfProjectedAt:DateTime64(3)}
  AND (claim_type, claim_id) > ({cursorClaimType:String}, {cursorClaimId:String})
ORDER BY claim_type, claim_id
LIMIT {limit:UInt32};
