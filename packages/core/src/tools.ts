/**
 * @fileoverview Helper utilities for creating custom tools following Claude Agent SDK patterns.
 */

import type {
  ToolDefinition,
  ToolHandler,
  ToolInputSchema,
  MCPServer,
} from './types.js';

/**
 * Creates a custom tool definition.
 *
 * @param name - Unique tool name (will be prefixed with mcp__{server_name}__ when used)
 * @param description - Description of what the tool does
 * @param inputSchema - Schema defining the tool's input parameters
 * @param handler - Function that executes the tool logic
 * @returns Tool definition object
 *
 * @example
 * ```typescript
 * import { tool } from '@headless-coder-sdk/core';
 *
 * const weatherTool = tool(
 *   'get_weather',
 *   'Get current temperature for a location using coordinates',
 *   {
 *     latitude: { type: 'number', description: 'Latitude coordinate' },
 *     longitude: { type: 'number', description: 'Longitude coordinate' }
 *   },
 *   async (args) => {
 *     const response = await fetch(
 *       `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`
 *     );
 *     const data = await response.json();
 *     return {
 *       content: [{
 *         type: 'text',
 *         text: `Temperature: ${data.current.temperature_2m}°F`
 *       }]
 *     };
 *   }
 * );
 * ```
 */
export function tool<TArgs = any>(
  name: string,
  description: string,
  inputSchema: ToolInputSchema,
  handler: ToolHandler<TArgs>
): ToolDefinition<TArgs> {
  return {
    name,
    description,
    inputSchema,
    handler,
  };
}

/**
 * Creates an MCP server with custom tools.
 *
 * @param config - Server configuration including name, version, and tools
 * @returns MCP server object that can be passed to StartOpts.mcpServers
 *
 * @example
 * ```typescript
 * import { createMCPServer, tool } from '@headless-coder-sdk/core';
 *
 * const myServer = createMCPServer({
 *   name: 'my-tools',
 *   version: '1.0.0',
 *   tools: [
 *     tool('calculate', 'Perform calculations', { expression: 'string' }, async (args) => ({
 *       content: [{ type: 'text', text: `Result: ${eval(args.expression)}` }]
 *     })),
 *     tool('translate', 'Translate text', { text: 'string', target: 'string' }, async (args) => ({
 *       content: [{ type: 'text', text: `Translated: ${args.text}` }]
 *     }))
 *   ]
 * });
 *
 * // Use with coder
 * const coder = createCoder('claude', {
 *   mcpServers: { 'my-tools': myServer },
 *   allowedTools: ['mcp__my-tools__calculate', 'mcp__my-tools__translate']
 * });
 * ```
 */
export function createMCPServer(config: {
  name: string;
  version: string;
  tools: ToolDefinition[];
  [key: string]: any;
}): MCPServer {
  return config as MCPServer;
}

/**
 * Helper to normalize input schema from simple type mapping to JSON Schema format.
 *
 * @param schema - Simple schema (e.g., { latitude: 'number' }) or JSON Schema
 * @returns JSON Schema object
 *
 * @example
 * ```typescript
 * // Simple type mapping
 * const schema1 = normalizeInputSchema({ name: 'string', age: 'number' });
 * // Returns: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'number' } }, required: ['name', 'age'] }
 *
 * // Already JSON Schema - returns as-is
 * const schema2 = normalizeInputSchema({
 *   type: 'object',
 *   properties: { name: { type: 'string' } }
 * });
 * ```
 */
export function normalizeInputSchema(schema: ToolInputSchema): Record<string, any> {
  // If already a JSON Schema with 'type' field, return as-is
  if (schema.type === 'object') {
    return schema;
  }

  // Convert simple type mapping to JSON Schema
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'string') {
      // Simple type like { name: 'string', age: 'number' }
      properties[key] = { type: value };
      required.push(key);
    } else if (typeof value === 'function') {
      // Constructor like { name: String, age: Number }
      const typeName = value.name.toLowerCase();
      properties[key] = { type: typeName };
      required.push(key);
    } else if (typeof value === 'object' && value !== null) {
      // Already a schema object like { name: { type: 'string', description: '...' } }
      properties[key] = value;
      if (!value.optional) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * Helper to generate the full tool name as it appears to the AI model.
 *
 * @param serverName - MCP server name
 * @param toolName - Tool name within the server
 * @returns Full qualified tool name
 *
 * @example
 * ```typescript
 * const fullName = getToolName('my-tools', 'get_weather');
 * // Returns: 'mcp__my-tools__get_weather'
 * ```
 */
export function getToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

/**
 * Helper to get all tool names from an MCP server.
 *
 * @param server - MCP server
 * @returns Array of full qualified tool names
 *
 * @example
 * ```typescript
 * const server = createMCPServer({
 *   name: 'utilities',
 *   version: '1.0.0',
 *   tools: [
 *     tool('calculate', '...', {}, async () => ({ content: [] })),
 *     tool('translate', '...', {}, async () => ({ content: [] }))
 *   ]
 * });
 *
 * const toolNames = getServerToolNames(server);
 * // Returns: ['mcp__utilities__calculate', 'mcp__utilities__translate']
 * ```
 */
export function getServerToolNames(server: MCPServer): string[] {
  return server.tools.map(tool => getToolName(server.name, tool.name));
}
