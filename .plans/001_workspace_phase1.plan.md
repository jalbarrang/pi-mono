---
name: "Phase 1 workspace support for pi core"
overview: "Add named multi-folder workspaces to pi-coding-agent so one interactive session can operate across a primary project and attached folders, with explicit built-in tool routing, workspace-aware prompt context, and interactive workspace management commands. The implementation stays within packages/coding-agent and preserves primary-cwd session scoping."
todo:
  - id: "workspace-phase1-1"
    task: "Add workspace domain types, persistence, validation, and active-workspace resolution under packages/coding-agent/src/core, including ~/.pi/workspaces storage and basename-based folder lookup."
    status: done
  - id: "workspace-phase1-2"
    task: "Thread workspace state through runtime/service creation and make resource loading append workspace prompt guidance plus AGENTS/CLAUDE context from attached folders without changing primary-only resource discovery."
    status: done
  - id: "workspace-phase1-3"
    task: "Wrap built-in tool definitions so read/write/edit/bash/grep/find/ls accept an optional folder basename and route execution to the resolved workspace folder while defaulting to the primary folder."
    status: done
  - id: "workspace-phase1-4"
    task: "Add interactive /workspace commands, runtime switching when the active workspace primary differs from the current session cwd, and a footer/status indicator for the active workspace."
    status: done
  - id: "workspace-phase1-5"
    task: "Cover the new behavior with tests, then run the affected test files and npm run check until clean."
    status: done
---

# Goal

Implement Phase 1 workspace support in `packages/coding-agent` so pi can load a named workspace with one primary folder and optional attached folders, route built-in tool calls by folder basename, inject cross-folder context into the system prompt, and manage the workspace from interactive mode.

# Context

- Parent task: implement native workspace support in this fork of pi core using the previously agreed Phase 1 scope.
- Module root: `packages/coding-agent`
- Session constraint: sessions must remain scoped by the primary folder cwd, using the existing `SessionManager` behavior.
- Deferred from this slice: attached-folder extension/skill whitelists, multi-match picker UI for `/workspace load`, and LSP orchestration (there is no built-in LSP subsystem in `packages/coding-agent/src` today).

## What exists

### Runtime/session creation

- `src/main.ts` builds a `CreateAgentSessionRuntimeFactory` and passes it to `createAgentSessionRuntime(...)`.
- `src/core/agent-session-services.ts` creates cwd-bound services via `createAgentSessionServices(...)`, including `SettingsManager`, `ModelRegistry`, and `DefaultResourceLoader`.
- `src/core/agent-session-runtime.ts` owns the current `AgentSession` plus cwd-bound services and already knows how to tear down/recreate the runtime for `/new`, `/resume`, `/fork`, and import flows.
- `src/core/sdk.ts` creates `AgentSession` and the underlying `Agent`; it restores session state from `SessionManager`, but it does not currently know anything about multi-folder workspaces.

### Resource/context loading

- `src/core/resource-loader.ts` already loads:
  - extensions
  - skills
  - prompt templates
  - themes
  - `AGENTS.md` / `CLAUDE.md`
  - `SYSTEM.md` / `APPEND_SYSTEM.md`
- `DefaultResourceLoaderOptions` already exposes override hooks such as:
  - `agentsFilesOverride`
  - `systemPromptOverride`
  - `appendSystemPromptOverride`
- `AgentSession._rebuildSystemPrompt(...)` calls `buildSystemPrompt(...)` with loaded skills, context files, tool prompt snippets, and append-system content from `ResourceLoader`.
- `buildSystemPrompt(...)` in `src/core/system-prompt.ts` already appends project context files and skills to the default or custom system prompt.

### Built-in tools

- `src/core/tools/index.ts` exports cwd-bound factories such as:
  - `createAllToolDefinitions(cwd, options?)`
  - `createReadToolDefinition(...)`
  - `createBashToolDefinition(...)`
  - `createEditToolDefinition(...)`
  - `createWriteToolDefinition(...)`
  - `createGrepToolDefinition(...)`
  - `createFindToolDefinition(...)`
  - `createLsToolDefinition(...)`
- Each built-in tool is already implemented in terms of a cwd passed at definition-creation time.
- `AgentSession._buildRuntime(...)` currently creates built-in tool definitions with `createAllToolDefinitions(this._cwd, ...)`, stores them in `_baseToolDefinitions`, and later merges them into the runtime tool registry.
- There is already a thin adapter in `src/core/tools/tool-definition-wrapper.ts` for turning `ToolDefinition` into `AgentTool`, but there is no workspace-aware routing layer.

### Interactive mode

- `src/core/slash-commands.ts` contains built-in command metadata for autocomplete.
- `src/modes/interactive/interactive-mode.ts` hardcodes slash-command handling inside `setupEditorSubmitHandler()`.
- The footer is rendered by `src/modes/interactive/components/footer.ts`, backed by `FooterDataProvider` from `src/core/footer-data-provider.ts`.
- The footer already supports additional single-line statuses via `FooterDataProvider.setExtensionStatus(...)`, which can be reused for a workspace indicator without changing the footer layout API.

### Session scoping

- `SessionManager.getDefaultSessionDir(cwd, agentDir?)` encodes cwd into the session directory name under `~/.pi/agent/sessions/...`.
- `SessionManager.create(cwd)`, `SessionManager.continueRecent(cwd)`, and `SessionManager.open(path, sessionDir?, cwdOverride?)` all operate on one cwd.
- Current session storage semantics therefore already match the desired “scope sessions by primary folder cwd” rule.

# API inventory

## Existing config/runtime APIs

### `src/config.ts`

```ts
export function getAgentDir(): string;
export function getSessionsDir(): string;
export const CONFIG_DIR_NAME: string;
```

### `src/core/resource-loader.ts`

```ts
export interface ResourceLoader {
  getExtensions(): LoadExtensionsResult;
  getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
  getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
  getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
  getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
  getSystemPrompt(): string | undefined;
  getAppendSystemPrompt(): string[];
  extendResources(paths: ResourceExtensionPaths): void;
  reload(): Promise<void>;
}

export interface DefaultResourceLoaderOptions {
  cwd?: string;
  agentDir?: string;
  settingsManager?: SettingsManager;
  additionalExtensionPaths?: string[];
  additionalSkillPaths?: string[];
  additionalPromptTemplatePaths?: string[];
  additionalThemePaths?: string[];
  noExtensions?: boolean;
  noSkills?: boolean;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
    agentsFiles: Array<{ path: string; content: string }>;
  };
  systemPromptOverride?: (base: string | undefined) => string | undefined;
  appendSystemPromptOverride?: (base: string[]) => string[];
}
```

### `src/core/agent-session-services.ts`

```ts
export interface AgentSessionServices {
  cwd: string;
  agentDir: string;
  authStorage: AuthStorage;
  settingsManager: SettingsManager;
  modelRegistry: ModelRegistry;
  resourceLoader: ResourceLoader;
  diagnostics: AgentSessionRuntimeDiagnostic[];
}

export interface CreateAgentSessionServicesOptions {
  cwd: string;
  agentDir?: string;
  authStorage?: AuthStorage;
  settingsManager?: SettingsManager;
  modelRegistry?: ModelRegistry;
  extensionFlagValues?: Map<string, boolean | string>;
  resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">;
}

export async function createAgentSessionServices(
  options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices>;
```

### `src/core/agent-session-runtime.ts`

```ts
export type CreateAgentSessionRuntimeFactory = (options: {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManager;
  sessionStartEvent?: SessionStartEvent;
}) => Promise<CreateAgentSessionRuntimeResult>;

export class AgentSessionRuntime {
  get services(): AgentSessionServices;
  get session(): AgentSession;
  get cwd(): string;
  get diagnostics(): readonly AgentSessionRuntimeDiagnostic[];
  get modelFallbackMessage(): string | undefined;
  async switchSession(sessionPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  async newSession(options?: { parentSession?: string; setup?: (sessionManager: SessionManager) => Promise<void> }): Promise<{ cancelled: boolean }>;
  async fork(entryId: string): Promise<{ cancelled: boolean; selectedText?: string }>;
  async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }>;
  async dispose(): Promise<void>;
}
```

### `src/core/session-manager.ts`

```ts
export function getDefaultSessionDir(cwd: string, agentDir?: string): string;

export class SessionManager {
  static create(cwd: string, sessionDir?: string): SessionManager;
  static open(path: string, sessionDir?: string, cwdOverride?: string): SessionManager;
  static continueRecent(cwd: string, sessionDir?: string): SessionManager;
  static inMemory(cwd?: string): SessionManager;
  getCwd(): string;
  getSessionDir(): string;
  getSessionFile(): string | undefined;
  getSessionId(): string;
  getSessionName(): string | undefined;
}
```

## Existing tool APIs

### `src/core/tools/index.ts`

```ts
export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef>;
```

### `src/core/extensions/types.ts`

```ts
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: TParams;
  prepareArguments?: (args: unknown) => Static<TParams>;
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  renderCall?: (args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>) => Component;
  renderResult?: (
    result: AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext<TState, Static<TParams>>,
  ) => Component;
}
```

## Existing interactive APIs

### `src/core/slash-commands.ts`

```ts
export interface BuiltinSlashCommand {
  name: string;
  description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand>;
```

### `src/modes/interactive/components/footer.ts`

```ts
export class FooterComponent implements Component {
  constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider);
  setSession(session: AgentSession): void;
  setAutoCompactEnabled(enabled: boolean): void;
  invalidate(): void;
  dispose(): void;
  render(width: number): string[];
}
```

### `src/core/footer-data-provider.ts`

```ts
export class FooterDataProvider {
  constructor(cwd?: string);
  getGitBranch(): string | null;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  onBranchChange(callback: () => void): () => void;
  setExtensionStatus(key: string, text: string | undefined): void;
  clearExtensionStatuses(): void;
  getAvailableProviderCount(): number;
  setAvailableProviderCount(count: number): void;
  setCwd(cwd: string): void;
  dispose(): void;
}
```

# Tasks

1. **Add workspace model, storage, and resolution helpers**
   - Create `packages/coding-agent/src/core/workspaces.ts`.
   - Define typed workspace file/config/state models for:
     - the on-disk workspace JSON (`name`, `folders`, `defaultPrimary`, `whitelistedExtensions`, `whitelistedSkills`)
     - the active workspace with resolved absolute folder paths, unique basenames, primary folder, and attached folders
   - Add helpers to:
     - list saved workspaces from `~/.pi/workspaces`
     - read/write a workspace JSON file
     - create a new workspace from the current cwd
     - add/remove folders with directory existence checks and basename uniqueness enforcement
     - auto-detect workspaces containing the current cwd
     - resolve the active primary folder from launch cwd or `defaultPrimary`
     - resolve a tool target folder basename to an absolute cwd
   - Add `getWorkspacesDir()` to `packages/coding-agent/src/config.ts` using the parent of `getAgentDir()` so the path is `~/.pi/workspaces` rather than `~/.pi/agent/workspaces`.

2. **Thread workspace state through runtime creation and resource loading**
   - Extend `AgentSessionServices` / `CreateAgentSessionServicesOptions` to carry a mutable workspace controller/state object.
   - In `main.ts`, create one workspace controller before building the runtime factory so it is shared across runtime recreations.
   - Build `DefaultResourceLoader` with overrides that inspect the current active workspace:
     - `appendSystemPromptOverride` should add a workspace preamble describing the workspace name, folders, which folder is primary, how `folder` routing works, and the primary-write preference.
     - `agentsFilesOverride` should keep the base primary-folder context files and append root-level `AGENTS.md` / `CLAUDE.md` files from attached workspace folders, labeling them with folder basename plus absolute path in the displayed `path` string.
   - Do not change skill/prompt/extension/theme discovery rules in this slice; they remain primary-only because `DefaultResourceLoader` still runs with the primary cwd.

3. **Wrap built-in tools with workspace-aware folder routing**
   - Create `packages/coding-agent/src/core/tools/workspace-router.ts`.
   - Add a wrapper that accepts an existing `ToolDefinition`, appends an optional `folder` parameter to the TypeBox schema, and delegates execution to a per-folder cached tool definition created with that folder’s cwd.
   - Apply the wrapper in `AgentSession._buildRuntime(...)` when a workspace is active.
   - The wrapper must:
     - default to the primary folder when `folder` is omitted
     - error when `folder` is provided but no workspace is active
     - error on unknown folder basename
     - preserve `prepareArguments(...)`, rendering, and prompt metadata from the wrapped definition
     - strip `folder` before calling the underlying tool implementation
   - Wrap the built-in tool set created by `createAllToolDefinitions(...)`: `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

4. **Add interactive workspace commands and runtime switching**
   - Add `/workspace` to `BUILTIN_SLASH_COMMANDS` for autocomplete.
   - In `InteractiveMode.setupEditorSubmitHandler()`, route `/workspace ...` to a dedicated handler rather than inlining more logic in the submit method.
   - Add a handler in `InteractiveMode` that supports:
     - `/workspace new <name>`
     - `/workspace load [name]`
     - `/workspace list`
     - `/workspace add-folder <path>`
     - `/workspace remove-folder <basename>`
     - `/workspace close`
   - For `/workspace load` with no name:
     - scan saved workspaces for those containing the current cwd
     - load when exactly one match exists
     - show an error listing matches when multiple exist (picker is deferred)
   - When loading a workspace whose primary folder differs from `sessionManager.getCwd()`, add a small runtime helper to `AgentSessionRuntime` that recreates the runtime against `SessionManager.continueRecent(primaryCwd)`.
   - After any workspace state change, call `session.reload()` or perform a runtime switch, then refresh interactive state with the existing `handleRuntimeSessionChange()` flow.

5. **Show active workspace in the footer and cover the behavior with tests**
   - Reuse `FooterDataProvider.setExtensionStatus(...)` for a workspace status line such as `ws:rundot [run-platform*, run-sdk]` so no footer API redesign is needed.
   - Update the workspace status whenever interactive mode initializes, reloads, loads/closes a workspace, or changes folders in the active workspace.
   - Add tests for:
     - workspace storage/resolution/validation
     - tool routing by folder basename
     - resource loader overrides for prompt/context injection
     - runtime switching to a different primary cwd
     - interactive footer/status rendering for an active workspace

# Files to create

- `packages/coding-agent/src/core/workspaces.ts`
- `packages/coding-agent/src/core/tools/workspace-router.ts`
- `packages/coding-agent/test/workspaces.test.ts`
- `packages/coding-agent/test/workspace-tool-router.test.ts`

# Files to modify

- `packages/coding-agent/src/config.ts` — add workspace directory helper
- `packages/coding-agent/src/core/agent-session-services.ts` — thread workspace state through services
- `packages/coding-agent/src/core/agent-session-runtime.ts` — add a runtime switch helper for primary-cwd changes
- `packages/coding-agent/src/core/agent-session.ts` — apply workspace-aware built-in tool wrapping during runtime rebuilds
- `packages/coding-agent/src/core/slash-commands.ts` — add `/workspace`
- `packages/coding-agent/src/main.ts` — create shared workspace state and pass it into runtime/service creation
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` — implement `/workspace` handling and update workspace status
- `packages/coding-agent/test/resource-loader.test.ts` — add coverage for workspace prompt/context overrides
- `packages/coding-agent/test/interactive-mode-status.test.ts` — add coverage for workspace footer/status output
- `packages/coding-agent/test/suite/agent-session-runtime.test.ts` — add coverage for runtime recreation against a new primary cwd

# Testing notes

- Follow existing unit-style patterns in:
  - `packages/coding-agent/test/resource-loader.test.ts`
  - `packages/coding-agent/test/interactive-mode-status.test.ts`
  - `packages/coding-agent/test/suite/agent-session-runtime.test.ts`
  - `packages/coding-agent/test/agent-session-dynamic-tools.test.ts`
- Prefer behavior-level tests over implementation-detail tests:
  - assert resolved primary folder, basename routing, and prompt/context outputs
  - assert runtime cwd/session switching through `AgentSessionRuntime` public APIs
  - assert interactive workspace status via rendered footer/status output or container contents
- Run each changed/new test file explicitly from `packages/coding-agent/`.
- After all tests pass, run `npm run check` from the repo root.

# Patterns to follow

- `packages/coding-agent/src/core/resource-loader.ts:318-465` — loader override hooks and reload flow
- `packages/coding-agent/src/core/agent-session.ts:2290-2348` — built-in tool definition creation and runtime rebuild path
- `packages/coding-agent/src/core/agent-session.ts:881-912` — system prompt rebuild using resource-loader outputs
- `packages/coding-agent/src/core/agent-session-runtime.ts:107-154` — runtime replacement flow for session switching
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2116-2256` — interactive slash command dispatch pattern
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1196-1303` — runtime change handling in interactive mode
- `packages/coding-agent/test/agent-session-dynamic-tools.test.ts` — verifying prompt/tool registry behavior through public APIs
- `packages/coding-agent/test/resource-loader.test.ts` — temp-dir based loader tests with real files on disk
- `packages/coding-agent/test/interactive-mode-status.test.ts` — container-render based UI assertions
