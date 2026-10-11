// Shared catalog of icons used for category badges throughout the app.
// Built-in categories are mapped by name; custom categories pick from PICKER_ICONS.

const ICON_PATHS = {
  // Built-ins (reused for matching default category names)
  characters:   'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  environments: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z',
  props:        'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z',
  materials:    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  hdris:        'M12 3a6 6 0 009 9 9 9 0 11-9-9z',
  vfx:          'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  rigs:         'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
  scenes:       'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  default:      'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',

  // Picker icons (extra options users can pick for custom categories)
  cube:    'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  sword:   'M14.5 17.5L3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2',
  shield:  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  hammer:  'M14 7l-7.07 7.07a2.5 2.5 0 003.54 3.54L17.54 10.5 M14.5 7.5L20 2 M11.5 4.5L8 8',
  gem:     'M6 3h12l4 6-10 13L2 9l4-6z M11 3L8 9l4 13 4-13-3-6 M2 9h20',
  bolt:    'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  star:    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  heart:   'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  globe:   'M12 2a10 10 0 100 20 10 10 0 000-20z M2 12h20 M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z',
  sun:     'M12 1v2 M12 21v2 M4.22 4.22l1.42 1.42 M18.36 18.36l1.42 1.42 M1 12h2 M21 12h2 M4.22 19.78l1.42-1.42 M18.36 5.64l1.42-1.42 M12 7a5 5 0 100 10 5 5 0 000-10z',
  moon:    'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  tree:    'M12 22V12 M9 17l3 3 3-3 M5 12l7-9 7 9-7 8-7-8z',
  mountain:'M8 3l-6 18h20L14 3l-3 5-3-5z',
  skull:   'M12 2a8 8 0 00-8 8v6l2 2v3h12v-3l2-2v-6a8 8 0 00-8-8z M9 12a1 1 0 100-2 1 1 0 000 2z M15 12a1 1 0 100-2 1 1 0 000 2z M9 18v3 M15 18v3 M12 18v3',
  ghost:   'M9 10h.01 M15 10h.01 M12 2a8 8 0 00-8 8v12l3-2 3 2 2-2 2 2 3-2 3 2V10a8 8 0 00-8-8z',
  robot:   'M12 8V4H8 M16 12h2 M6 12h2 M9 16v-1 M15 16v-1 M9 4a2 2 0 014 0v4 M5 8h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8a2 2 0 012-2z',
  car:     'M3 13l2-7h14l2 7 M5 17h14 M7 17v3 M17 17v3 M3 13h18v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4z M7 13h.01 M17 13h.01',
  rocket:  'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91-.79-.79-2.07-.8-2.91-.09z M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5',
  flask:   'M9 2v6L4 18a2 2 0 002 3h12a2 2 0 002-3L15 8V2 M7 2h10 M9 14h6',
  film:    'M3 3h18v18H3z M7 3v18 M17 3v18 M3 12h18 M3 7h4 M3 17h4 M17 7h4 M17 17h4',
  paint:   'M19 11V8a2 2 0 00-2-2H7a2 2 0 00-2 2v3 M5 11h14v3a2 2 0 01-2 2h-1v3a2 2 0 01-2 2h-4a2 2 0 01-2-2v-3H7a2 2 0 01-2-2v-3z',
  music:   'M9 18V5l12-2v13 M9 13a3 3 0 11-3-3 M21 11a3 3 0 11-3-3',
  flag:    'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7',
  book:    'M2 19.5A2.5 2.5 0 014.5 17H20V2H4.5A2.5 2.5 0 002 4.5v15z M4.5 17H20v5H4.5A2.5 2.5 0 012 19.5z',
  bug:     'M8 2l1.88 1.88 M14.12 3.88L16 2 M9 7.13v-1a3.003 3.003 0 016 0v1 M12 20c-3.3 0-6-2.69-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.31-2.7 6-6 6z M12 20v-9 M6.53 9C4.6 8.8 3 7.1 3 5 M19.47 9c1.93-.2 3.53-1.9 3.53-4 M5.5 14h-2 M20.5 14h-2 M6.53 19c-1.93.2-3.53 1.9-3.53 4 M19.47 19c1.93.2 3.53 1.9 3.53 4',
}

// What gets shown in the icon picker for custom categories
export const PICKER_ICONS = [
  'cube','sword','shield','hammer','gem','bolt','star','heart',
  'globe','sun','moon','tree','mountain','skull','ghost','robot',
  'car','rocket','flask','film','paint','music','flag','book','bug',
]

// Friendly labels for the picker tooltips
export const ICON_LABELS = {
  cube: 'Cube', sword: 'Sword', shield: 'Shield', hammer: 'Hammer',
  gem: 'Gem', bolt: 'Bolt', star: 'Star', heart: 'Heart',
  globe: 'Globe', sun: 'Sun', moon: 'Moon', tree: 'Tree',
  mountain: 'Mountain', skull: 'Skull', ghost: 'Ghost', robot: 'Robot',
  car: 'Car', rocket: 'Rocket', flask: 'Flask', film: 'Film',
  paint: 'Paint', music: 'Music', flag: 'Flag', book: 'Book', bug: 'Bug',
}

// Resolve a category/application name + optional override icon to an
// ICON_PATHS key. Override always wins. Names are normalised by lowercasing
// and stripping non-alphanumerics so "3ds Max" → "3dsmax", "Cinema 4D" →
// "cinema4d", "Substance Painter" → "substancepainter" (which falls back to
// "substance" via a startsWith check).
export function resolveIconKey(categoryName, overrideKey) {
  if (overrideKey && ICON_PATHS[overrideKey]) return overrideKey
  if (!categoryName) return 'default'
  // Match the base before any "/" — e.g. "Characters/Human" → "characters"
  const base = categoryName.split('/')[0].toLowerCase()
  if (ICON_PATHS[base]) return base
  // Normalised match for multi-word app names
  const normalised = base.replace(/[^a-z0-9]/g, '')
  if (ICON_PATHS[normalised]) return normalised
  // Loose prefix match so "Substance Painter" / "Substance Designer" resolve
  // to the generic "substance" icon, "Cinema 4D Studio" → "cinema4d", etc.
  for (const key of Object.keys(ICON_PATHS)) {
    if (key.length >= 4 && normalised.startsWith(key)) return key
  }
  return 'default'
}

export default function CategoryIcon({ name, iconKey, size = 14, strokeWidth = 1.8, ...rest }) {
  const key = resolveIconKey(name, iconKey)
  const d = ICON_PATHS[key] || ICON_PATHS.default
  // Some paths embed multiple sub-paths via spaces; we render them as a single `d` attribute
  // which is valid SVG for chained M/L commands.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={d}/>
    </svg>
  )
}
