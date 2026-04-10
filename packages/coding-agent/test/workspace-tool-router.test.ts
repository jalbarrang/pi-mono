import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import { createWorkspaceAwareToolDefinition } from "../src/core/tools/workspace-router.js";
import { WorkspaceController } from "../src/core/workspaces.js";

describe("createWorkspaceAwareToolDefinition", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("errors when folder routing is requested without an active workspace", async () => {
		const createDefinition = (_cwd: string): ToolDefinition => ({
			name: "fake",
			label: "fake",
			description: "Fake built-in tool",
			parameters: Type.Object({ path: Type.String() }),
			execute: async (_toolCallId, params: { path: string }) => ({
				content: [{ type: "text", text: params.path }],
				details: undefined,
			}),
		});

		const wrapped = createWorkspaceAwareToolDefinition({
			definition: createDefinition(process.cwd()),
			createDefinitionForCwd: createDefinition,
			workspaceController: new WorkspaceController({ workspacesDir: join(tmpdir(), `pi-workspaces-${Date.now()}`) }),
		});

		await expect(
			wrapped.execute(
				"call-no-workspace",
				{ path: "src/sdk.ts", folder: "run-sdk" },
				undefined,
				undefined,
				{} as never,
			),
		).rejects.toThrowError("Tool folder routing requires an active workspace.");
	});

	it("routes execution to the requested workspace folder basename and defaults to the primary folder", async () => {
		const tempDir = join(tmpdir(), `pi-workspace-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		tempDirs.push(tempDir);
		const workspacesDir = join(tempDir, "workspaces");
		const primaryDir = join(tempDir, "repos", "run-platform");
		const attachedDir = join(tempDir, "repos", "run-sdk");
		mkdirSync(primaryDir, { recursive: true });
		mkdirSync(attachedDir, { recursive: true });
		const resolvedPrimaryDir = realpathSync(primaryDir);
		const resolvedAttachedDir = realpathSync(attachedDir);

		const controller = new WorkspaceController({ workspacesDir });
		controller.create("rundot", primaryDir);
		controller.addFolder(attachedDir);

		const calls: Array<{ cwd: string; path: string }> = [];
		const createDefinition = (cwd: string): ToolDefinition => ({
			name: "fake",
			label: "fake",
			description: "Fake built-in tool",
			parameters: Type.Object({
				path: Type.String(),
			}),
			execute: async (_toolCallId, params: { path: string }) => {
				calls.push({ cwd, path: params.path });
				return {
					content: [{ type: "text", text: `${cwd}:${params.path}` }],
					details: undefined,
				};
			},
		});

		const wrapped = createWorkspaceAwareToolDefinition({
			definition: createDefinition(primaryDir),
			createDefinitionForCwd: createDefinition,
			workspaceController: controller,
		});

		await wrapped.execute("call-primary", { path: "src/app.ts" }, undefined, undefined, {} as never);
		await wrapped.execute(
			"call-attached",
			{ path: "src/sdk.ts", folder: "run-sdk" },
			undefined,
			undefined,
			{} as never,
		);

		expect(calls).toEqual([
			{ cwd: resolvedPrimaryDir, path: "src/app.ts" },
			{ cwd: resolvedAttachedDir, path: "src/sdk.ts" },
		]);
	});
});
