export function codexLiveSkipReason(error: unknown): string | undefined {
  const messages = collectErrorMessages(error).join('\n');
  if (messages.includes('model is not supported when using Codex with a ChatGPT account')) {
    return 'Skipping Codex live test because the configured Codex account does not support the selected model.';
  }
  if (messages.includes('not authenticated') || messages.includes('No API key found')) {
    return 'Skipping Codex live test because Codex credentials are unavailable.';
  }
  if (messages.includes('codex executable') || messages.includes('ENOENT')) {
    return 'Skipping Codex live test because the Codex executable is unavailable.';
  }
  return undefined;
}

function collectErrorMessages(error: unknown): string[] {
  if (!error) return [];
  if (error instanceof Error) {
    return [
      error.message,
      error.stack ?? '',
      ...collectErrorMessages((error as Error & { cause?: unknown }).cause),
    ].filter(Boolean);
  }
  return [String(error)];
}
