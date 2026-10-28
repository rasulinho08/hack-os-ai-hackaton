-- Migration: Add profile fields to users table
-- Run this against your PostgreSQL database before deploying

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS age          SMALLINT,
  ADD COLUMN IF NOT EXISTS country      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS timezone     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS linkedin     TEXT,
  ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS university   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS cohort       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS skills       JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS experience   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS role_preference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS dietary      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tshirt_size  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS motivation   TEXT,
  ADD COLUMN IF NOT EXISTS how_heard    VARCHAR(100);
