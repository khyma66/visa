/** A consistent, readable community handle; existing word casing is preserved. */
export function communityName(value: string): string {
  return value.trim().split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1)).join('');
}
