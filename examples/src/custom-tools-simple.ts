/**
 * @fileoverview Simple example showing custom tools usage.
 */

import { tool, createMCPServer, getToolName } from '@headless-coder-sdk/core';
import { createHeadlessClaude } from '@headless-coder-sdk/claude-adapter';

// Define a simple weather tool
const weatherTool = tool(
  'get_weather',
  'Get current temperature for a location',
  {
    latitude: { type: 'number', description: 'Latitude' },
    longitude: { type: 'number', description: 'Longitude' },
  },
  async (args: { latitude: number; longitude: number }) => {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m&temperature_unit=fahrenheit`
    );
    const data = await response.json();

    return {
      content: [{
        type: 'text' as const,
        text: `Temperature: ${data.current.temperature_2m}°F`
      }]
    };
  }
);

// Create an MCP server with the tool
const weatherServer = createMCPServer({
  name: 'weather-tools',
  version: '1.0.0',
  tools: [weatherTool]
});

// Use the custom tool with Claude
async function main() {
  const claude = createHeadlessClaude({
    workingDirectory: process.cwd(),
    mcpServers: {
      'weather-tools': weatherServer
    },
    allowedTools: [getToolName('weather-tools', 'get_weather')],
    permissionMode: 'bypassPermissions'
  });

  const thread = await claude.startThread();
  const result = await thread.run(
    "What's the weather in San Francisco? (37.7749, -122.4194)"
  );

  console.log(result.text);
}

main().catch(console.error);
