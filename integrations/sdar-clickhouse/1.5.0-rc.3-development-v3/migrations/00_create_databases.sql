-- SDAR ClickHouse Schema V1.1 (fresh-install baseline)
-- Compatibility: ClickHouse 24.8+; recommended 25.3 LTS+
-- All timestamps are UTC DateTime64(3).
-- Complex JSON payloads are stored as String CODEC(ZSTD(3)) for stable replay and compatibility.
-- Run migrations in filename order.


CREATE DATABASE IF NOT EXISTS sdar_meta ENGINE = Atomic;
CREATE DATABASE IF NOT EXISTS sdar_core ENGINE = Atomic;
CREATE DATABASE IF NOT EXISTS sdar_commander ENGINE = Atomic;
CREATE DATABASE IF NOT EXISTS sdar_npc ENGINE = Atomic;
CREATE DATABASE IF NOT EXISTS sdar_embodied ENGINE = Atomic;
CREATE DATABASE IF NOT EXISTS sdar_mart ENGINE = Atomic;
