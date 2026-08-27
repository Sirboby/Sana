import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_BANDS = new Set([
  'EMERGENCY',
  'SEE_DOCTOR_TODAY',
  'SEE_DOCTOR_SOON',
  'SELF_CARE_REASONABLE',
]);

const DOSE_REGEX = /\b\d+\s?(mg|ml|g|mcg|iu|tablets?|capsules?|pills?)\b/i;

const TREATMENT_MED_REGEX =
  /\b(take|use|swallow|prescribe|administer)\s+[A-Z][a-z]+/i;

function lintFile(filePath: string): string[] {
  const errors: string[] = [];
  const contentStr = fs.readFileSync(filePath, 'utf-8');
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(contentStr);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Invalid JSON syntax in ${filePath}: ${msg}`);
    return errors;
  }

  // 1. Check urgency rules bands
  if (Array.isArray(data.urgencyRules)) {
    data.urgencyRules.forEach((rule: Record<string, unknown>, idx: number) => {
      const band = typeof rule.band === 'string' ? rule.band : undefined;
      if (!band || !ALLOWED_BANDS.has(band)) {
        errors.push(
          `[Rule ${String(rule.id || idx)}] Invalid urgency band: "${band}". Allowed: ${Array.from(ALLOWED_BANDS).join(', ')}`,
        );
      }
    });
  }

  // 2. Check for dose figures & treatment verbs in text values
  function walkStrings(obj: unknown, pathStr = '') {
    if (typeof obj === 'string') {
      if (DOSE_REGEX.test(obj)) {
        errors.push(`[${pathStr}] Prohibited dose figure found: "${obj}"`);
      }
      if (TREATMENT_MED_REGEX.test(obj)) {
        errors.push(
          `[${pathStr}] Prohibited medication treatment claim found: "${obj}"`,
        );
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, val] of Object.entries(obj)) {
        walkStrings(val, pathStr ? `${pathStr}.${key}` : key);
      }
    }
  }

  walkStrings(data);

  return errors;
}

function main() {
  const dirPath = path.resolve(process.cwd(), 'content/rulepack');
  if (!fs.existsSync(dirPath)) {
    console.log(
      'Notice: content/rulepack directory does not exist. Skipping lint.',
    );
    process.exit(0);
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log(
      'Notice: No rulepack JSON files found in content/rulepack/*.json. Skipping lint.',
    );
    process.exit(0);
  }

  let hasErrors = false;
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    console.log(`Linting rulepack: ${file}`);
    const errors = lintFile(fullPath);
    if (errors.length > 0) {
      hasErrors = true;
      console.error(`❌ Errors in ${file}:`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
    } else {
      console.log(`✅ ${file} passed rulepack linting.`);
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

main();
