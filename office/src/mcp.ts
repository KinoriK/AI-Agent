// Tiny wrapper so every office MCP server registers tools the same way and turns errors into tool errors.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z } from 'zod';

export function createServer(name: string) {
  const server = new McpServer({ name, version: '1.0.0' });
  const tool = (tname: string, description: string, shape: z.ZodRawShape, fn: (a: any) => unknown) =>
    server.registerTool(tname, { description, inputSchema: shape }, async (args: any) => {
      try { return { content: [{ type: 'text' as const, text: JSON.stringify(await fn(args), null, 2) }] }; }
      catch (e: any) { return { isError: true, content: [{ type: 'text' as const, text: String(e?.message ?? e) }] }; }
    });
  return { tool, start: () => server.connect(new StdioServerTransport()) };
}
