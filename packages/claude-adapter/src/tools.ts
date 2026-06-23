/**
 * @fileoverview Claude-specific tool utilities that bridge headless-coder-sdk tools
 * with the Claude Agent SDK's tool and MCP server format.
 */

import {
  tool as claudeTool,
  createSdkMcpServer,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type {
  ToolDefinition,
  MCPServer,
  ToolInputSchema,
} from '@headless-coder-sdk/core';

/**
 * Converts a headless-coder-sdk ToolInputSchema to the Zod raw-shape format
 * required by Claude Agent SDK 0.3.x.
 *
 * @param schema - Generic tool input schema
 * @returns Schema in Claude Agent SDK format (typically Zod-like or plain object)
 */
function convertInputSchema(schema: ToolInputSchema): Record<string, any> {
  if (schema.type === 'object' && schema.properties) {
    return convertPropertiesToZodRawShape(schema.properties, schema.required);
  }

  const required = Object.entries(schema)
    .filter(([, value]) => !isOptionalSchemaProperty(value))
    .map(([key]) => key);
  return convertPropertiesToZodRawShape(schema, required);
}

function convertPropertiesToZodRawShape(
  properties: Record<string, any>,
  required?: string[],
): Record<string, any> {
  const shape: Record<string, any> = {};
  const requiredSet = new Set(required ?? []);
  const hasExplicitRequired = Array.isArray(required);

  for (const [key, value] of Object.entries(properties)) {
    const isRequired = hasExplicitRequired ? requiredSet.has(key) : !isOptionalSchemaProperty(value);
    const zodSchema = schemaPropertyToZod(value);
    shape[key] = isRequired ? zodSchema : zodSchema.optional();
  }

  return shape;
}

function schemaPropertyToZod(value: any): any {
  if (isZodSchema(value)) return value;

  if (typeof value === 'string') {
    return primitiveToZod(value);
  }

  if (typeof value === 'function') {
    return constructorToZod(value);
  }

  if (!value || typeof value !== 'object') {
    return z.unknown();
  }

  if (Array.isArray(value.enum) && value.enum.length > 0) {
    const literalSchemas = value.enum.map((entry: unknown) => z.literal(entry as never));
    return applyDescription(
      literalSchemas.length === 1 ? literalSchemas[0] : z.union(literalSchemas as [any, any, ...any[]]),
      value.description,
    );
  }

  const type = Array.isArray(value.type) ? value.type.find((entry: string) => entry !== 'null') : value.type;
  const base =
    type === 'object' && value.properties
      ? z.object(convertPropertiesToZodRawShape(value.properties, value.required)).passthrough()
      : type === 'array'
        ? z.array(schemaPropertyToZod(value.items ?? {}))
        : primitiveToZod(type);

  return applyDescription(base, value.description);
}

function primitiveToZod(type: string | undefined): any {
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'object':
      return z.record(z.string(), z.unknown());
    case 'array':
      return z.array(z.unknown());
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}

function constructorToZod(value: Function): any {
  switch (value) {
    case String:
      return z.string();
    case Number:
      return z.number();
    case Boolean:
      return z.boolean();
    case Array:
      return z.array(z.unknown());
    case Object:
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

function applyDescription(schema: any, description: unknown): any {
  return typeof description === 'string' ? schema.describe(description) : schema;
}

function isZodSchema(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as any).safeParse === 'function');
}

function isOptionalSchemaProperty(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as any).optional === true);
}

/**
 * Converts a generic headless-coder-sdk ToolDefinition to a Claude Agent SDK Tool.
 *
 * @param toolDef - Generic tool definition
 * @returns Claude-specific tool instance
 */
export function convertToolToClaudeTool(toolDef: ToolDefinition): any {
  const schema = convertInputSchema(toolDef.inputSchema);

  return (claudeTool as any)(
    toolDef.name,
    toolDef.description,
    schema,
    async (args: any): Promise<any> => {
      const result = await toolDef.handler(args);
      return result as any;
    }
  );
}

/**
 * Converts a generic headless-coder-sdk MCPServer to a Claude Agent SDK MCP server.
 *
 * @param server - Generic MCP server definition
 * @returns Claude-specific MCP server instance
 */
export function convertMCPServerToClaudeServer(server: MCPServer): any {
  const claudeTools = server.tools.map(convertToolToClaudeTool);

  return createSdkMcpServer({
    name: server.name,
    version: server.version,
    tools: claudeTools,
  });
}

/**
 * Helper to convert all MCP servers from StartOpts format to Claude format.
 *
 * @param mcpServers - MCP servers from StartOpts
 * @returns Claude-compatible MCP servers object
 */
export function convertMCPServers(
  mcpServers?: Record<string, MCPServer | unknown>
): Record<string, any> | undefined {
  if (!mcpServers) return undefined;

  const converted: Record<string, any> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    // If it's already a Claude server (has tools array with Claude Tool instances), use as-is
    if (isClaudeServer(server)) {
      converted[name] = server;
    }
    // If it's a generic MCPServer, convert it
    else if (isGenericMCPServer(server)) {
      converted[name] = convertMCPServerToClaudeServer(server);
    }
    // Otherwise, assume it's already in the right format
    else {
      converted[name] = server;
    }
  }

  return converted;
}

/**
 * Type guard to check if a server is a generic MCPServer.
 */
function isGenericMCPServer(server: any): server is MCPServer {
  return (
    server &&
    typeof server === 'object' &&
    typeof server.name === 'string' &&
    typeof server.version === 'string' &&
    Array.isArray(server.tools) &&
    server.tools.length > 0 &&
    server.tools[0].handler !== undefined
  );
}

/**
 * Type guard to check if a server is already a Claude MCP server.
 */
function isClaudeServer(server: any): boolean {
  return (
    server &&
    typeof server === 'object' &&
    typeof server.name === 'string' &&
    typeof server.version === 'string' &&
    Array.isArray(server.tools) &&
    // Claude tools don't have a 'handler' property at the top level
    (server.tools.length === 0 || server.tools[0].handler === undefined)
  );
}

/**
 * Re-export the Claude Agent SDK's tool and createSdkMcpServer functions
 * for users who want to use them directly.
 */
export { claudeTool as tool, createSdkMcpServer };
