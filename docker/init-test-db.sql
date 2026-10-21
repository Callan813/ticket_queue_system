-- Runs once when the postgres volume is first created.
-- A separate database keeps `npm test` from wiping demo data.
CREATE DATABASE ticketing_test;
