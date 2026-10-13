export function readSeedEnvironment(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .flatMap((line) => {
        const separator = line.indexOf('=');
        if (separator <= 0) return [];
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [[key, value]];
      }),
  );
}

export function assertSeedAllowed(value: string | undefined): void {
  if (value !== 'true') {
    throw new Error('Seeding is disabled. Set SEED_ALLOWED=true only for a development project.');
  }
}

export function getProjectRef(supabaseUrl: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  const hostname = parsedUrl.hostname;
  if (!hostname.endsWith('.supabase.co')) {
    throw new Error('SUPABASE_URL must use a project-specific *.supabase.co hostname.');
  }
  const projectRef = hostname.slice(0, -'.supabase.co'.length);
  if (!/^[a-z0-9-]+$/.test(projectRef)) {
    throw new Error('Could not read a valid Supabase project ref from SUPABASE_URL.');
  }
  return projectRef;
}

export function assertProjectRefConfirmation(typedRef: string, expectedRef: string): void {
  if (typedRef.trim() !== expectedRef) {
    throw new Error('The typed project ref did not match. No seed data was changed.');
  }
}

export function parseMeEmail(args: string[]): string | null {
  const index = args.indexOf('--me');
  if (index < 0) return null;
  const email = args[index + 1]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Use --me with the email address of your signed-in Wimpex account.');
  }
  return email;
}
