/**
 * @fileoverview Shared type definitions for headless-coder-sdk adapters.
 */

/**
 * Provider discriminant used for selecting a headless-coder-sdk implementation.
 */
export type Provider = 'codex' | 'gemini' | 'claude' | (string & {});

/**
 * Adapter identifiers supplied by individual adapter packages.
 */
export type AdapterName = Provider;

/**
 * Alias exposed for developer ergonomics when referring to provider identifiers.
 */
export type CoderType = Provider;

/**
 * Chat-style message input accepted by every adapter.
 */
export interface PromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Provider-native content blocks. Codex currently accepts local image
 * attachments directly; text-only providers flatten these blocks to text.
 */
export type PromptContentPart =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

/**
 * Input accepted by coders when executing a run.
 */
export type PromptInput = string | PromptMessage[] | PromptContentPart[];

/**
 * Tool result content format following MCP protocol.
 */
export interface ToolResultContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: any;
}

/**
 * Tool result returned by custom tool handlers.
 */
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

/**
 * Handler function for custom tools.
 *
 * @param args - Arguments passed to the tool, validated against the input schema
 * @returns Tool result with content array
 */
export type ToolHandler<TArgs = any> = (args: TArgs) => Promise<ToolResult> | ToolResult;

/**
 * Input schema definition for tools.
 * Can be a simple type mapping (e.g., { latitude: number, longitude: number })
 * or a full JSON Schema object.
 */
export type ToolInputSchema = Record<string, any> | {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
  [key: string]: any;
};

/**
 * Definition of a custom tool.
 */
export interface ToolDefinition<TArgs = any> {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler<TArgs>;
}

/**
 * MCP Server containing custom tools.
 */
export interface MCPServer {
  name: string;
  version: string;
  tools: ToolDefinition[];
  [key: string]: any;
}

export type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';
export type WebSearchMode = 'disabled' | 'cached' | 'live';

/**
 * Provider-specific passthrough options. Adapters merge these into their native
 * SDK options after applying the normalized fields exposed below.
 */
export interface ProviderOptions {
  codex?: Record<string, any>;
  codexClient?: Record<string, any>;
  claude?: Record<string, any>;
  gemini?: Record<string, any>;
  [provider: string]: Record<string, any> | undefined;
}

/**
 * Options for starting or resuming a thread across providers.
 */
export interface StartOpts {
  model?: string;
  workingDirectory?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  skipGitRepoCheck?: boolean;
  codexExecutablePath?: string;
  codexBaseUrl?: string;
  codexApiKey?: string;
  codexConfig?: Record<string, any>;
  codexEnv?: Record<string, string>;
  codexClientOptions?: Record<string, any>;
  providerOptions?: ProviderOptions;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  webSearchEnabled?: boolean;
  approvalPolicy?: ApprovalPolicy;
  additionalDirectories?: string[];
  /**
   * Array of allowed tool names. Tool names follow the pattern:
   * - Built-in tools: tool name directly (e.g., "bash", "read")
   * - MCP tools: mcp__{server_name}__{tool_name} (e.g., "mcp__my-server__get_weather")
   */
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[] | { type: 'preset'; preset: string };
  toolAliases?: Record<string, string>;
  canUseTool?: unknown;
  /**
   * MCP servers providing custom tools.
   * Key is the server name, value is the server definition or provider-specific server object.
   */
  mcpServers?: Record<string, MCPServer | unknown>;
  agent?: string;
  agents?: Record<string, any>;
  continue?: boolean;
  resume?: string;
  resumeSessionAt?: string;
  forkSession?: boolean;
  geminiBinaryPath?: string;
  includeDirectories?: string[];
  yolo?: boolean;
  permissionMode?: string;
  permissionPromptToolName?: string;
  settingSources?: Array<'local' | 'project' | 'user'>;
  fallbackModel?: string;
  enableFileCheckpointing?: boolean;
  betas?: string[];
  hooks?: unknown;
  includeHookEvents?: boolean;
  forwardSubagentText?: boolean;
  thinking?: unknown;
  effort?: AgentEffort | number;
  maxThinkingTokens?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  taskBudget?: { total: number };
  pathToClaudeCodeExecutable?: string;
  planModeInstructions?: string;
  allowDangerouslySkipPermissions?: boolean;
  plugins?: unknown[];
  promptSuggestions?: boolean;
  agentProgressSummaries?: boolean;
  persistSession?: boolean;
  sandbox?: unknown;
  settings?: string | Record<string, any>;
  managedSettings?: Record<string, any>;
  skills?: string[] | 'all';
  debug?: boolean;
  debugFile?: string;
  stderr?: (data: string) => void;
  strictMcpConfig?: boolean;
  systemPrompt?:
    | string
    | string[]
    | { type: 'preset'; preset: string; append?: string; excludeDynamicSections?: boolean };
  title?: string;
  toolConfig?: unknown;
  env?: Record<string, string | undefined>;
  executable?: 'bun' | 'deno' | 'node';
  executableArgs?: string[];
  extraArgs?: Record<string, string | null>;
}

/**
 * Run-time modifiers that tweak how execution is performed.
 */
export interface RunOpts {
  outputSchema?: object;
  streamPartialMessages?: boolean;
  extraEnv?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Handle returned by provider-specific threads, exposing execution helpers.
 */
export interface ThreadHandle {
  provider: Provider;
  internal: unknown;
  id?: string;
  run(input: PromptInput, opts?: RunOpts): Promise<RunResult>;
  runStreamed(input: PromptInput, opts?: RunOpts): EventIterator;
  interrupt?(reason?: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Streaming events emitted by adapters during live runs.
 */
export type CoderStreamEvent =
  | { type: 'init'; provider: Provider; threadId?: string; model?: string; ts: number; originalItem?: any }
  | {
      type: 'message';
      provider: Provider;
      role: 'assistant' | 'user' | 'system';
      text?: string;
      delta?: boolean;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'tool_use';
      provider: Provider;
      name: string;
      callId?: string;
      args?: any;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'tool_result';
      provider: Provider;
      name: string;
      callId?: string;
      result?: any;
      exitCode?: number | null;
      error?: unknown;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'progress';
      provider: Provider;
      label?: string;
      detail?: string;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'permission';
      provider: Provider;
      request?: any;
      decision?: 'granted' | 'denied' | 'auto';
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'file_change';
      provider: Provider;
      path?: string;
      op?: 'create' | 'modify' | 'delete' | 'rename';
      patch?: string;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'plan_update';
      provider: Provider;
      text?: string;
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'usage';
      provider: Provider;
      stats?: { inputTokens?: number; outputTokens?: number; [k: string]: any };
      ts: number;
      originalItem?: any;
    }
  | {
      type: 'error';
      provider: Provider;
      code?: string;
      message: string;
      ts: number;
      originalItem?: any;
    }
  | { type: 'cancelled'; provider: Provider; ts: number; originalItem?: any }
  | { type: 'done'; provider: Provider; ts: number; originalItem?: any };

export type EventIterator = AsyncIterable<CoderStreamEvent>;

export const now = () => Date.now();

/**
 * Result returned after a run completes.
 */
export interface RunResult {
  threadId?: string;
  text?: string;
  json?: unknown;
  usage?: any;
  raw?: any;
}

/**
 * Interface implemented by all headless-coder-sdk adapters.
 */
export interface HeadlessCoder {
  startThread(opts?: StartOpts): Promise<ThreadHandle>;
  resumeThread(threadId: string, opts?: StartOpts): Promise<ThreadHandle>;
  getThreadId(thread: ThreadHandle): string | undefined;
  close?(thread: ThreadHandle): Promise<void>;
}

export type AdapterFactory = ((defaults?: StartOpts) => HeadlessCoder) & {
  coderName?: AdapterName;
};
