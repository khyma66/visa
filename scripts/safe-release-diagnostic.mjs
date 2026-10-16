// CLI failures must be actionable without publishing credentials or raw logs.
export function safeReleaseDiagnostic(output, secrets = []) {
  let text = String(output ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  for (const value of secrets.filter(value => typeof value === 'string' && value.length > 3).sort((a, b) => b.length - a.length)) {
    text = text.split(value).join('[REDACTED]');
  }
  text = text.replace(/\b(?:gsk_|sk-|apify_api_)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|signature|authorization)=)[^\s&#"']+/gi, '$1[REDACTED]');
  // Keep only error paragraphs, not binding tables or general CLI output.
  const errors = text.split(/\n\s*\n/).filter(block => /\[ERROR\]|Error:|error TS\d+|error code/i.test(block));
  return (errors.join('\n\n') || 'CLI exited without an error paragraph.').slice(-4000);
}
