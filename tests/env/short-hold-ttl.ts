// Imported first by tests that need holds to expire quickly.
// Must run before src/config.ts is loaded, which happens on the next import.
process.env.HOLD_TTL_SECONDS = '1';
