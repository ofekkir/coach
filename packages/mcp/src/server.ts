// Why: stdio transport uses stdout for the JSON-RPC channel — never write logs
// to stdout, only stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createSession, type Session } from './session.ts';
import { createTools, type Tool } from './tools.ts';

const JSON_INDENT = 2;

function textResult(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, JSON_INDENT) }], isError };
}

async function callTool(tool: Tool, args: Record<string, unknown>): Promise<CallToolResult> {
  try {
    return textResult(await tool.handle(args));
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

function registerTool(server: McpServer, tool: Tool): void {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputShape },
    (args) => callTool(tool, args as Record<string, unknown>),
  );
}

/** Builds an MCP server exposing the analyst tools over a session. */
export function createMcpServer(session: Session): McpServer {
  const server = new McpServer({ name: 'coach-mcp', version: '0.0.0' });
  for (const tool of createTools(session)) registerTool(server, tool);
  return server;
}

/** Serves the analyst tools over stdio. `initialDir`, when given, is preloaded so
 *  the dataset is queryable immediately; otherwise the agent calls `load_dataset`. */
export async function serveStdio(initialDir?: string): Promise<void> {
  const session = createSession();
  if (initialDir != null && initialDir.length > 0) await session.load(initialDir);
  await createMcpServer(session).connect(new StdioServerTransport());
}
