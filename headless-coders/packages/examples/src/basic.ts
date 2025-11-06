/**
 * Demonstrates how to execute a single headless coder turn via the shared factory.
 */

import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createCoder } from '@headless-coders/core/factory';
import type { Provider, PromptInput } from '@headless-coders/core/types';

const SUPPORTED_PROVIDERS: Provider[] = ['codex', 'claude', 'gemini'];

/**
 * Parses CLI arguments into a provider and prompt payload.
 *
 * Args:
 *   argv: Raw command-line arguments (excluding the Node binary).
 *
 * Returns:
 *   Tuple containing the provider and prompt input.
 */
function parseArgs(argv: string[]): [Provider, PromptInput] {
  const [providerMaybe, ...promptParts] = argv;
  const provider = SUPPORTED_PROVIDERS.includes(providerMaybe as Provider)
    ? (providerMaybe as Provider)
    : 'codex';
  const prompt =
    promptParts.join(' ').trim() ||
    'Summarise the shared headless coder abstraction in three bullet points.';
  return [provider, prompt];
}

/**
 * Runs a single prompt turn through the selected provider and logs the result.
 *
 * Args:
 *   argv: Raw command-line arguments (excluding the Node binary).
 *
 * Returns:
 *   A promise that resolves once the run finishes and the response is printed.
 *
 * Raises:
 *   Error: When the underlying provider fails to complete the run.
 */
export async function main(argv: string[]): Promise<void> {
  const [provider, prompt] = parseArgs(argv);
  const coder = createCoder(provider, {
    workingDirectory: process.cwd(),
  });
  const thread = await coder.startThread();
  const result = await coder.run(thread, prompt);
  const output = result.text ?? JSON.stringify(result.json ?? result.raw, null, 2);
  // eslint-disable-next-line no-console -- Example script prints to stdout.
  console.log(output);
}

const thisFile = fileURLToPath(import.meta.url);
const executedDirectly = process.argv[1] === thisFile;

if (executedDirectly) {
  main(process.argv.slice(2)).catch(error => {
    // eslint-disable-next-line no-console -- Example script prints failures to stderr.
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
