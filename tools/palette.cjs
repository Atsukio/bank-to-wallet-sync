// Regenerates the Material Design 3 colour tokens in style.css from a seed colour, using Google's official algorithm.
//
//   npm i --no-save @material/material-color-utilities@0.3.0     (once, in the repo root; node_modules is gitignored)
//   node tools/palette.cjs "#1a73e8"            print the tokens
//   node tools/palette.cjs "#1a73e8" --write    rewrite the generated block in style.css
//   Prefix the seed with "tonal:" for the calmer Tonal Spot scheme (default is Vibrant), e.g. "tonal:#006a60".
//
// Only the block between the BEGIN/END markers in style.css is rewritten. Light and dark schemes are both generated.
const fs = require('fs');
const path = require('path');
const m = require('@material/material-color-utilities');
const D = m.MaterialDynamicColors;

const ROLES = {
  '--md-primary': D.primary, '--md-on-primary': D.onPrimary,
  '--md-primary-container': D.primaryContainer, '--md-on-primary-container': D.onPrimaryContainer,
  '--md-secondary': D.secondary, '--md-secondary-container': D.secondaryContainer, '--md-on-secondary-container': D.onSecondaryContainer,
  '--md-tertiary': D.tertiary, '--md-tertiary-container': D.tertiaryContainer, '--md-on-tertiary-container': D.onTertiaryContainer,
  '--md-error': D.error, '--md-error-container': D.errorContainer, '--md-on-error-container': D.onErrorContainer,
  '--md-surface': D.surface, '--md-on-surface': D.onSurface, '--md-on-surface-variant': D.onSurfaceVariant,
  '--md-surface-container': D.surfaceContainer, '--md-surface-container-high': D.surfaceContainerHigh,
  '--md-outline': D.outline, '--md-outline-variant': D.outlineVariant,
};

function tokens(spec, dark) {
  const tonal = spec.startsWith('tonal:');
  const seed = m.argbFromHex(spec.replace(/^(tonal:|vib:)/, ''));
  const scheme = new (tonal ? m.SchemeTonalSpot : m.SchemeVibrant)(m.Hct.fromInt(seed), dark, 0);
  const out = {};
  for (const [name, role] of Object.entries(ROLES)) out[name] = m.hexFromArgb(role.getArgb(scheme));
  // M3 has no income or warning role: a green and an amber, pulled toward the scheme's primary so they sit in the palette.
  const primary = D.primary.getArgb(scheme);
  out['--credit'] = m.hexFromArgb(m.Blend.harmonize(m.TonalPalette.fromHueAndChroma(145, 50).tone(dark ? 80 : 32), primary));
  out['--warn'] = m.hexFromArgb(m.Blend.harmonize(m.TonalPalette.fromHueAndChroma(80, 60).tone(dark ? 80 : 30), primary));
  return out;
}

const lines = (t, indent) => Object.entries(t).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');

function generate(spec) {
  return [
    `/* Material Design 3 colour roles generated from seed ${spec} (light, then dark). Do not edit by hand. */`,
    ':root {',
    lines(tokens(spec, false), '  '),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    lines(tokens(spec, true), '    '),
    '  }',
    '}',
  ].join('\n');
}

if (require.main === module) {
  const spec = process.argv[2];
  if (!spec) { console.error('usage: node tools/palette.cjs "<#hex or tonal:#hex>" [--write]'); process.exit(1); }
  const block = generate(spec);
  if (!process.argv.includes('--write')) { console.log(block); process.exit(0); }
  const file = path.join(__dirname, '..', 'style.css');
  let css = fs.readFileSync(file, 'utf8');
  const crlf = css.includes('\r\n');
  css = css.replace(/\r\n/g, '\n');
  const re = /\/\* BEGIN GENERATED M3 TOKENS[^\n]*\*\/\n[\s\S]*?\/\* END GENERATED M3 TOKENS \*\//;
  if (!re.test(css)) { console.error('markers not found in style.css'); process.exit(1); }
  css = css.replace(re, () => `/* BEGIN GENERATED M3 TOKENS (node tools/palette.cjs "${spec}" --write) */\n${block}\n/* END GENERATED M3 TOKENS */`);
  fs.writeFileSync(file, crlf ? css.replace(/\n/g, '\r\n') : css);
  console.log('style.css updated from seed', spec);
}

module.exports = { tokens, generate };
