/** Field limits for the pilot request form. Client-safe; the database enforces the same. */
export const PILOT_LIMITS = {
  name: 120,
  email: 254,
  company: 200,
  building: 2000,
  usage: 2000,
  services: 500,
} as const;
