"""Run from the project root:  python3 apply_goback.py
Replaces every router.back() in src/ with the safe goBack() helper
(src/lib/navigation.ts) and adds the import. Safe to run more than once."""
import os

SRC = 'src'
SKIP = {os.path.join(SRC, 'components', 'CreateSheet.tsx'), os.path.join(SRC, 'lib', 'navigation.ts')}
count = 0
for root, _, files in os.walk(SRC):
    for name in files:
        if not name.endswith('.tsx'):
            continue
        path = os.path.join(root, name)
        if path in SKIP:
            continue
        text = open(path, encoding='utf-8').read()
        if 'router.back()' not in text:
            continue
        text = text.replace('router.back()', 'goBack()')
        if 'import { goBack }' not in text:
            rel = os.path.relpath(os.path.join(SRC, 'lib', 'navigation'), os.path.dirname(path)).replace(os.sep, '/')
            if not rel.startswith('.'):
                rel = './' + rel
            text = f"import {{ goBack }} from '{rel}';\n" + text
        open(path, 'w', encoding='utf-8').write(text)
        count += 1
print(f'Updated {count} files')