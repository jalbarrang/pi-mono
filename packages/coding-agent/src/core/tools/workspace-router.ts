import { type TSchema, Type } from "typebox";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../extensions/types.js";
import type { WorkspaceController } from "../workspaces.js";

const folderSchema = Type.Optional(
	Type.String({ description: "Optional folder basename to target within the active workspace" }),
);

type WorkspaceAwareToolArgs = Record<string, unknown> & {
	folder?: string;
};

export interface CreateWorkspaceAwareToolDefinitionOptions {
	definition: ToolDefinition<any, any, any>;
	createDefinitionForCwd: (cwd: string) => ToolDefinition<any, any, any>;
	workspaceController: WorkspaceController;
}

function withFolderParameter(parameters: TSchema): TSchema {
	const schema = parameters as TSchema & {
		type?: string;
		properties?: Record<string, TSchema>;
		additionalProperties?: boolean;
	};
	if (schema.type === "object" && schema.properties) {
		return Type.Object(
			{
				...schema.properties,
				folder: folderSchema,
			},
			{ additionalProperties: schema.additionalProperties },
		);
	}
	return Type.Intersect([parameters, Type.Object({ folder: folderSchema })]);
}

function stripFolderParam(args: WorkspaceAwareToolArgs): Record<string, unknown> {
	const { folder: _folder, ...rest } = args;
	return rest;
}

export function createWorkspaceAwareToolDefinition(
	options: CreateWorkspaceAwareToolDefinitionOptions,
): ToolDefinition<any, any, any> {
	const { definition, createDefinitionForCwd, workspaceController } = options;
	const definitionsByCwd = new Map<string, ToolDefinition<any, any, any>>();

	const getDefinitionForCwd = (cwd: string): ToolDefinition<any, any, any> => {
		const cached = definitionsByCwd.get(cwd);
		if (cached) {
			return cached;
		}
		const next = createDefinitionForCwd(cwd);
		definitionsByCwd.set(cwd, next);
		return next;
	};

	return {
		...definition,
		description: `${definition.description} When a workspace is active, pass an optional folder basename to route this tool call to a non-primary folder.`,
		parameters: withFolderParameter(definition.parameters),
		prepareArguments: definition.prepareArguments
			? (args: unknown) => {
					const input = (args ?? {}) as WorkspaceAwareToolArgs;
					const prepared = definition.prepareArguments?.(stripFolderParam(input));
					if (!input.folder) {
						return prepared;
					}
					if (typeof prepared !== "object" || prepared === null) {
						return { folder: input.folder };
					}
					return { ...(prepared as Record<string, unknown>), folder: input.folder };
				}
			: undefined,
		execute: async (toolCallId, params, signal, onUpdate, ctx) => {
			const input = (params ?? {}) as WorkspaceAwareToolArgs;
			const active = workspaceController.getActive();
			if (!active) {
				if (input.folder) {
					throw new Error("Tool folder routing requires an active workspace.");
				}
				return definition.execute(toolCallId, stripFolderParam(input), signal, onUpdate, ctx);
			}
			const folder = workspaceController.resolveFolder(input.folder);
			return getDefinitionForCwd(folder.path).execute(toolCallId, stripFolderParam(input), signal, onUpdate, ctx);
		},
		renderCall: definition.renderCall
			? (args, theme, context) =>
					definition.renderCall?.(
						stripFolderParam((args ?? {}) as WorkspaceAwareToolArgs) as never,
						theme,
						context as ToolRenderContext,
					) as never
			: undefined,
		renderResult: definition.renderResult
			? (result, renderOptions, theme, context) =>
					definition.renderResult?.(
						result,
						renderOptions as ToolRenderResultOptions,
						theme,
						context as ToolRenderContext,
					) as never
			: undefined,
	};
}
