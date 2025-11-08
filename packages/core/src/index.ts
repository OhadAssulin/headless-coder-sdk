/**
 * @fileoverview Entry point for the headless-coder-sdk core package.
 */

export * from './types.js';
export {
  registerAdapter,
  unregisterAdapter,
  clearRegisteredAdapters,
  getAdapterFactory,
  createCoder,
} from './factory.js';
