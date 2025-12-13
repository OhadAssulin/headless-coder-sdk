/**
 * @fileoverview Claude-specific tool utilities that bridge headless-coder-sdk tools
 * with the Claude Agent SDK's tool and MCP server format.
 */

import {
  tool as claudeTool,
  createSdkMcpServer,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ToolDefinition,
  MCPServer,
  ToolInputSchema,
} from '@headless-coder-sdk/core';

/**
 * Converts a headless-coder-sdk ToolInputSchema to a Claude Agent SDK compatible schema.
 *
 * @param schema - Generic tool input schema
 * @returns Schema in Claude Agent SDK format (typically Zod-like or plain object)
 */
function convertInputSchema(schema: ToolInputSchema): Record<string, any> {
  // If it's already a JSON Schema object format, return as-is
  if (schema.type === 'object' && schema.properties) {
    return schema;
  }

  // Convert simple type mapping to object schema
  const properties: Record<string, any> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'string') {
      properties[key] = { type: value };
    } else if (typeof value === 'function') {
      // Handle constructor types like String, Number
      properties[key] = { type: value.name.toLowerCase() };
    } else {
      properties[key] = value;
    }
  }

  return {
    type: 'object',
    properties,
  };
}

/**
 * Converts a generic headless-coder-sdk ToolDefinition to a Claude Agent SDK Tool.
 *
 * @param toolDef - Generic tool definition
 * @returns Claude-specific tool instance
 */
export function convertToolToClaudeTool(toolDef: ToolDefinition): any {
  const schema = convertInputSchema(toolDef.inputSchema);

  return claudeTool(
    toolDef.name,
    toolDef.description,
    schema,
    async (args: any) => {
      const result = await toolDef.handler(args);
      return result;
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
