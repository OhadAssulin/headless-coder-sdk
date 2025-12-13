/**
 * @fileoverview Example demonstrating custom tools usage with Claude adapter.
 *
 * This example shows how to:
 * 1. Create custom tools using the unified SDK helpers
 * 2. Register tools in an MCP server
 * 3. Use custom tools with the Claude adapter
 * 4. Control which tools Claude can use with allowedTools
 */

import { tool, createMCPServer, getToolName } from '@headless-coder-sdk/core';
import { createHeadlessClaude } from '@headless-coder-sdk/claude-adapter';

// Example 1: Simple weather tool
const weatherTool = tool(
  'get_weather',
  'Get current temperature for a location using coordinates',
  {
    latitude: { type: 'number', description: 'Latitude coordinate' },
    longitude: { type: 'number', description: 'Longitude coordinate' },
  },
  async (args: { latitude: number; longitude: number }) => {
    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m&temperature_unit=fahrenheit`
      );
      const data = await response.json();

      return {
        content: [
          {
            type: 'text' as const,
            text: `Temperature at coordinates (${args.latitude}, ${args.longitude}): ${data.current.temperature_2m}°F`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to fetch weather: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Example 2: Calculator tool
const calculatorTool = tool(
  'calculate',
  'Perform mathematical calculations',
  {
    expression: { type: 'string', description: 'Mathematical expression to evaluate' },
    precision: { type: 'number', description: 'Decimal precision', optional: true },
  },
  async (args: { expression: string; precision?: number }) => {
    try {
      // In production, use a safe math evaluation library
      const result = eval(args.expression);
      const precision = args.precision ?? 2;
      const formatted = Number(result).toFixed(precision);

      return {
        content: [
          {
            type: 'text' as const,
            text: `${args.expression} = ${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Invalid expression - ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Example 3: Data formatter tool
const formatterTool = tool(
  'format_data',
  'Format data into different output formats',
  {
    data: { type: 'object', description: 'Data to format' },
    format: { type: 'string', enum: ['json', 'yaml', 'table'], description: 'Output format' },
  },
  async (args: { data: any; format: string }) => {
    try {
      let formatted: string;

      switch (args.format) {
        case 'json':
          formatted = JSON.stringify(args.data, null, 2);
          break;
        case 'yaml':
          // Simple YAML formatting (use a library in production)
          formatted = Object.entries(args.data)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join('\n');
          break;
        case 'table':
          if (Array.isArray(args.data)) {
            const headers = Object.keys(args.data[0] || {});
            formatted = headers.join(' | ') + '\n' + args.data.map(row => headers.map(h => row[h]).join(' | ')).join('\n');
          } else {
            formatted = Object.entries(args.data)
              .map(([k, v]) => `${k} | ${v}`)
              .join('\n');
          }
          break;
        default:
          formatted = JSON.stringify(args.data);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: formatted,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error formatting data: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Create MCP servers with custom tools
const weatherServer = createMCPServer({
  name: 'weather-tools',
  version: '1.0.0',
  tools: [weatherTool],
});

const utilityServer = createMCPServer({
  name: 'utilities',
  version: '1.0.0',
  tools: [calculatorTool, formatterTool],
});

/**
 * Example 1: Basic custom tool usage
 */
async function basicCustomToolExample() {
  console.log('\n=== Basic Custom Tool Example ===\n');

  const claude = createHeadlessClaude({
    workingDirectory: process.cwd(),
    mcpServers: {
      'weather-tools': weatherServer,
    },
    allowedTools: [getToolName('weather-tools', 'get_weather')],
    permissionMode: 'bypassPermissions',
  });

  const thread = await claude.startThread();

  console.log('Asking Claude to use the weather tool...\n');

  try {
    const result = await thread.run(
      "What's the weather in San Francisco? Use coordinates 37.7749, -122.4194"
    );

    console.log('Result:', result.text);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 2: Multiple tools with selective allowlist
 */
async function multipleToolsExample() {
  console.log('\n=== Multiple Tools Example ===\n');

  const claude = createHeadlessClaude({
    workingDirectory: process.cwd(),
    mcpServers: {
      utilities: utilityServer,
    },
    // Only allow the calculator tool, not the formatter
    allowedTools: [getToolName('utilities', 'calculate')],
    permissionMode: 'bypassPermissions',
  });

  const thread = await claude.startThread();

  console.log('Asking Claude to calculate with precision...\n');

  try {
    const result = await thread.run('Calculate pi * 10 with 5 decimal places');

    console.log('Result:', result.text);
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 3: Streaming with custom tools
 */
async function streamingCustomToolsExample() {
  console.log('\n=== Streaming with Custom Tools Example ===\n');

  const claude = createHeadlessClaude({
    workingDirectory: process.cwd(),
    mcpServers: {
      utilities: utilityServer,
    },
    allowedTools: [
      getToolName('utilities', 'calculate'),
      getToolName('utilities', 'format_data'),
    ],
    permissionMode: 'bypassPermissions',
  });

  const thread = await claude.startThread();

  console.log('Streaming response with tool usage...\n');

  try {
    for await (const event of thread.runStreamed(
      'Calculate 123.456 * 789.012 and then format the result as JSON with metadata'
    )) {
      if (event.type === 'tool_use') {
        console.log(`[TOOL USE] ${event.name}`);
        if (event.args) {
          console.log('  Args:', JSON.stringify(event.args, null, 2));
        }
      } else if (event.type === 'tool_result') {
        console.log(`[TOOL RESULT] ${event.name}`);
        if (event.result) {
          console.log('  Result:', JSON.stringify(event.result, null, 2));
        }
      } else if (event.type === 'message' && event.role === 'assistant') {
        if (event.delta) {
          process.stdout.write(event.text ?? '');
        } else {
          console.log('\n[ASSISTANT]', event.text);
        }
      } else if (event.type === 'error') {
        console.error('[ERROR]', event.message);
      } else if (event.type === 'done') {
        console.log('\n[DONE]');
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 4: Using Claude Agent SDK tools directly
 */
async function claudeNativeToolsExample() {
  console.log('\n=== Claude Native Tools Example ===\n');

  // Import Claude's native tool helpers
  const { tool: claudeTool, createSdkMcpServer } = await import(
    '@headless-coder-sdk/claude-adapter'
  );

  // Create a tool using Claude's native format
  const nativeServer = createSdkMcpServer({
    name: 'native-tools',
    version: '1.0.0',
    tools: [
      claudeTool(
        'reverse_string',
        'Reverse a string',
        { text: { type: 'string' } } as any,
        async (args: any) => ({
          content: [{ type: 'text', text: args.text.split('').reverse().join('') }],
        })
      ),
    ],
  });

  const claude = createHeadlessClaude({
    workingDirectory: process.cwd(),
    mcpServers: {
      'native-tools': nativeServer,
    },
    allowedTools: [getToolName('native-tools', 'reverse_string')],
    permissionMode: 'bypassPermissions',
  });

  const thread = await claude.startThread();

  console.log('Using Claude native tool...\n');

  try {
    const result = await thread.run('Reverse the string "Hello World"');

    console.log('Result:', result.text);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run examples
async function main() {
  try {
    await basicCustomToolExample();
    await multipleToolsExample();
    await streamingCustomToolsExample();
    await claudeNativeToolsExample();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { basicCustomToolExample, multipleToolsExample, streamingCustomToolsExample, claudeNativeToolsExample };
