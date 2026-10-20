// Run from the project root:  node apply_goback.js
// Replaces every router.back() in src/ with the safe goBack() helper
// (src/lib/navigation.ts) and adds the import. Safe to run more than once.
const fs = require('fs');
const path = require('path');

const SRC = 'src';
const SKIP = new Set([
  path.join(SRC, 'components', 'CreateSheet.tsx'),
  path.join(SRC, 'lib', 'navigation.ts'),
]);
let count = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.tsx') || SKIP.has(full)) continue;
    let text = fs.readFileSync(full, 'utf8');
    if (!text.includes('router.back()')) continue;
    text = text.split('router.back()').join('goBack()');
    if (!text.includes('import { goBack }') && !/import \{[^}]*\bgoBack\b[^}]*\} from/.test(text)) {
      let rel = path.relative(path.dirname(full), path.join(SRC, 'lib', 'navigation')).split(path.sep).join('/');
      if (!rel.startsWith('.')) rel = './' + rel;
      text = `import { goBack } from '${rel}';\n` + text;
    }
    fs.writeFileSync(full, text, 'utf8');
    count += 1;
  }
}

if (!fs.existsSync(SRC)) { console.error('Run this from the project root (the folder containing src/).'); process.exit(1); }
walk(SRC);
console.log(`Updated ${count} files`);