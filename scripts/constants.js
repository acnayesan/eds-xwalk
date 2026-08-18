export const STATES = [
  { name: 'Colorado', code: 'co' },
  { name: 'Michigan', code: 'mi' },
  { name: 'Minnesota', code: 'mn' },
  { name: 'New Mexico', code: 'nm' },
  { name: 'North Dakota', code: 'nd' },
  { name: 'South Dakota', code: 'sd' },
  { name: 'Texas', code: 'tx' },
  { name: 'Wisconsin', code: 'wi' },
];

export const SITE_STATES = STATES.map((s) => s.code);
export const SITE_LOCALES = ['en', 'fr', 'es'];

// Shared localStorage key — must also match the hardcoded list in head.html
export const STORAGE_KEY = 'xcel-selected-state';
