import { registerAdapter } from '@headless-coder-sdk/core/factory';
import {
  CODER_NAME as CODEX_CODER_NAME,
  createAdapter as createCodexAdapter,
} from '@headless-coder-sdk/codex-adapter';
import {
  CODER_NAME as CLAUDE_CODER_NAME,
  createAdapter as createClaudeAdapter,
} from '@headless-coder-sdk/claude-adapter';
import {
  CODER_NAME as GEMINI_CODER_NAME,
  createAdapter as createGeminiAdapter,
} from '@headless-coder-sdk/gemini-adapter';

let registered = false;

export function ensureAdaptersRegistered(): void {
  if (registered) return;
  registerAdapter(CODEX_CODER_NAME, createCodexAdapter);
  registerAdapter(CLAUDE_CODER_NAME, createClaudeAdapter);
  registerAdapter(GEMINI_CODER_NAME, createGeminiAdapter);
  registered = true;
}
