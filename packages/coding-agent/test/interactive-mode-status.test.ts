import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Container } from "@mariozechner/pi-tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { WorkspaceController } from "../src/core/workspaces.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.handleWorkspaceCommand", () => {
	const tempDirs: string[] = [];

	beforeAll(() => {
		initTheme("dark");
	});

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	function createWorkspaceThis(workspacesDir: string, cwd: string) {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
			workspaceController: new WorkspaceController({ workspacesDir }),
			footerDataProvider: {
				setExtensionStatus: vi.fn(),
			},
			session: {
				isStreaming: false,
				isCompacting: false,
				reload: vi.fn(),
			},
			sessionManager: {
				getCwd: () => cwd,
			},
			runtimeHost: {
				switchToCwdSession: vi.fn(async () => ({ cancelled: false })),
			},
			handleRuntimeSessionChange: vi.fn(async () => {}),
			renderCurrentSessionState: vi.fn(),
			setupAutocomplete: vi.fn(),
			fdPath: undefined,
			footer: { invalidate: vi.fn() },
		};
		// Wire showStatus and showWarning/showError through the real prototype
		fakeThis.showStatus = (msg: string) => (InteractiveMode as any).prototype.showStatus.call(fakeThis, msg);
		fakeThis.showWarning = (msg: string) => (InteractiveMode as any).prototype.showWarning.call(fakeThis, msg);
		fakeThis.showError = (msg: string) => (InteractiveMode as any).prototype.showError.call(fakeThis, msg);
		fakeThis.updateWorkspaceStatus = () => (InteractiveMode as any).prototype.updateWorkspaceStatus.call(fakeThis);
		fakeThis.applyWorkspaceChange = async (primaryPath: string) =>
			(InteractiveMode as any).prototype.applyWorkspaceChange.call(fakeThis, primaryPath);
		return fakeThis;
	}

	test("/workspace list with no workspaces shows informational message", async () => {
		const tempDir = join(tmpdir(), `pi-ws-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const cwd = join(tempDir, "project");
		mkdirSync(cwd, { recursive: true });

		const fakeThis = createWorkspaceThis(workspacesDir, cwd);
		await (InteractiveMode as any).prototype.handleWorkspaceCommand.call(fakeThis, "/workspace list");

		const output = renderAll(fakeThis.chatContainer);
		expect(output).toContain("No saved workspaces");
	});

	test("/workspace new creates workspace and updates footer status", async () => {
		const tempDir = join(tmpdir(), `pi-ws-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const cwd = join(tempDir, "project");
		mkdirSync(cwd, { recursive: true });

		const fakeThis = createWorkspaceThis(workspacesDir, cwd);
		await (InteractiveMode as any).prototype.handleWorkspaceCommand.call(fakeThis, "/workspace new myws");

		expect(fakeThis.workspaceController.getActive()?.name).toBe("myws");
		expect(fakeThis.footerDataProvider.setExtensionStatus).toHaveBeenCalledWith(
			"workspace",
			expect.stringContaining("ws:myws"),
		);
	});

	test("/workspace close clears active workspace and footer status", async () => {
		const tempDir = join(tmpdir(), `pi-ws-interactive-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const cwd = join(tempDir, "project");
		mkdirSync(cwd, { recursive: true });

		const fakeThis = createWorkspaceThis(workspacesDir, cwd);
		await (InteractiveMode as any).prototype.handleWorkspaceCommand.call(fakeThis, "/workspace new myws");
		await (InteractiveMode as any).prototype.handleWorkspaceCommand.call(fakeThis, "/workspace close");

		expect(fakeThis.workspaceController.getActive()).toBeUndefined();
		expect(fakeThis.footerDataProvider.setExtensionStatus).toHaveBeenCalledWith("workspace", undefined);
	});
});

describe("InteractiveMode.showLoadedResources", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowLoadedResourcesThis(options: {
		quietStartup: boolean;
		verbose?: boolean;
		skills?: Array<{ filePath: string }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
	}) {
		const fakeThis: any = {
			options: { verbose: options.verbose ?? false },
			chatContainer: new Container(),
			settingsManager: {
				getQuietStartup: () => options.quietStartup,
			},
			session: {
				promptTemplates: [],
				extensionRunner: undefined,
				resourceLoader: {
					getPathMetadata: () => new Map(),
					getAgentsFiles: () => ({ agentsFiles: [] }),
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getExtensions: () => ({ extensions: [], errors: [], runtime: {} }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
				},
			},
			formatDisplayPath: (p: string) => p,
			buildScopeGroups: () => [],
			formatScopeGroups: () => "resource-list",
			getShortPath: (p: string) => p,
			formatDiagnostics: () => "diagnostics",
			getBuiltInCommandConflictDiagnostics: () => [],
		};

		return fakeThis;
	}

	test("does not show verbose listing on quiet startup during reload", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			extensions: [{ path: "/tmp/ext/index.ts" }],
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		expect(fakeThis.chatContainer.children).toHaveLength(0);
	});

	test("still shows diagnostics on quiet startup when requested", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		const output = renderAll(fakeThis.chatContainer);
		expect(output).toContain("[Skill conflicts]");
		expect(output).not.toContain("[Skills]");
	});
});
