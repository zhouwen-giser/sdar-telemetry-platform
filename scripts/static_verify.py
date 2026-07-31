from pathlib import Path
import re,sys,json
root=Path(__file__).resolve().parents[1]
compose=(root/'deploy/compose.external-clickhouse.yaml').read_text()
assert not re.search(r'^\s{2}clickhouse:',compose,re.M), 'default compose contains clickhouse service'
assert (root/'vendor/sdar-clickhouse-schema/sdar_clickhouse_schema_v1_0/migrations/13_sdar_v1_4_capability_chain.sql').exists()
for forbidden in ['node_modules','.git','.env']:
    hits=[p for p in root.rglob('*') if forbidden in p.parts and 'vendor' not in p.parts and p != root/'.git' and (root/'.git') not in p.parents]
    assert not hits, (forbidden,hits[:3])
print('static_verify: PASS')
