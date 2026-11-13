export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api';
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_MIN = 4;
export const PIN_MAX = 6;
