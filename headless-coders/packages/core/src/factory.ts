/**
 * @fileoverview Factory helpers for creating headless coder adapters.
 */

import { CodexAdapter } from '@headless-coders/codex-adapter';
import { ClaudeAdapter } from '@headless-coders/claude-adapter';
import { GeminiAdapter } from '@headless-coders/gemini-adapter';
import type { Provider, StartOpts, HeadlessCoder } from './types';

/**
 * Creates a provider-specific headless coder instance.
 *
 * @param provider Provider identifier.
 * @param defaults Default start options injected into the adapter.
 * @returns Provider-specific `HeadlessCoder` implementation.
 */
export function createCoder(provider: Provider, defaults?: StartOpts): HeadlessCoder {
  switch (provider) {
    case 'codex':
      return new CodexAdapter(defaults);
    case 'claude':
      return new ClaudeAdapter(defaults);
    case 'gemini':
      return new GeminiAdapter(defaults);
    default:
      throw new Error(`Unsupported provider: ${provider satisfies never}`);
  }
}

