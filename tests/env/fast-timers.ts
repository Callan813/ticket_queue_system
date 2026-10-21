// Imported FIRST by tests that need holds / unpaid bookings to expire quickly.
// Must run before src/config.ts is loaded, which happens on the next import.
process.env.HOLD_TTL_SECONDS = '1';
process.env.PAYMENT_TIMEOUT_SECONDS = '1';
