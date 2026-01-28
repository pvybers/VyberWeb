export function newId(): string {
  // Node/Edge compatible in Next.js server runtime.
  return crypto.randomUUID();
}

