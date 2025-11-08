/**
 * @fileoverview Adapter registry utilities for headless-coder-sdk.
 */

import type { AdapterFactory, AdapterName, HeadlessCoder, StartOpts } from './types.js';

const registry = new Map<AdapterName, AdapterFactory>();

/**
 * Registers an adapter factory under the provided identifier.
 *
 * Calling this multiple times with the same name replaces the existing factory.
 */
export function registerAdapter(name: AdapterName, factory: AdapterFactory): void {
  registry.set(name, factory);
}

/**
 * Removes a previously registered adapter factory.
 */
export function unregisterAdapter(name: AdapterName): void {
  registry.delete(name);
}

/**
 * Removes all registered adapters (primarily useful in tests).
 */
export function clearRegisteredAdapters(): void {
  registry.clear();
}

/**
 * Creates a headless coder instance using a registered adapter factory.
 *
 * @throws When no adapter is registered under the supplied name.
 */
export function createCoder(name: AdapterName, defaults?: StartOpts): HeadlessCoder {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`Adapter "${name}" not registered. Did you forget registerAdapter()?`);
  }
  return factory(defaults);
}

/**
 * Returns the adapter factory associated with the supplied name.
 */
export function getAdapterFactory(name: AdapterName): AdapterFactory | undefined {
  return registry.get(name);
}
