/**
 * Draw-out canvas prototype: a small LSP client over the server's language
 * server bridge. It gives Monaco hover, go-to-definition and references for
 * files on the server's machine. One language server runs per project root.
 */
import type { EnvironmentId, LspStreamEvent } from "@t3tools/contracts";
import { executeAtomQuery, runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { canvasEnvironment } from "~/state/canvas";
import { projectEnvironment } from "~/state/projects";

import { modelFor, monaco } from "./monaco";

type LspMessage = {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
};

export type LspStatus = "starting" | "ready" | "unavailable";

/** Read a file of the environment's machine. */
export async function readServerFile(
  environmentId: EnvironmentId,
  path: string,
): Promise<string | null> {
  const slash = path.lastIndexOf("/");
  const result = await executeAtomQuery(
    appAtomRegistry,
    projectEnvironment.readFile({
      environmentId,
      input: { cwd: path.slice(0, slash) || "/", relativePath: path.slice(slash + 1) },
    }),
    { reportFailure: false, reportDefect: false },
  );
  return result._tag === "Success" ? result.value.contents : null;
}

/** The LSP language id: React files have their own, unlike Monaco's. */
function lspLanguageId(model: monaco.editor.ITextModel): string {
  const path = model.uri.path;
  if (path.endsWith(".tsx")) return "typescriptreact";
  if (path.endsWith(".jsx")) return "javascriptreact";
  return model.getLanguageId();
}

class LspClient {
  rootPath: string | null = null;
  status: LspStatus = "starting";
  /** The folder this client answers for: its root, or where it found none. */
  get scopePath(): string {
    return this.rootPath ?? this.firstPath.slice(0, this.firstPath.lastIndexOf("/"));
  }
  readonly ready: Promise<boolean>;
  private sessionId: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (message: LspMessage) => void>();
  private readonly opened = new Set<string>();
  private readonly statusListeners = new Set<() => void>();

  constructor(
    readonly environmentId: EnvironmentId,
    readonly languageId: string,
    readonly firstPath: string,
  ) {
    const atom = canvasEnvironment.lspConnect({
      environmentId,
      input: { path: firstPath, languageId },
    });
    let settle: (ok: boolean) => void = () => {};
    this.ready = new Promise((resolve) => {
      settle = resolve;
    });
    // Keeps the stream, and so the language server, alive for this page.
    appAtomRegistry.subscribe(
      atom,
      (result) => {
        if (!AsyncResult.isSuccess(result)) return;
        for (const event of result.value) void this.onEvent(event, settle);
      },
      { immediate: true },
    );
  }

  onStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: LspStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }

  private async onEvent(event: LspStreamEvent, settle: (ok: boolean) => void) {
    switch (event.type) {
      case "ready": {
        this.sessionId = event.sessionId;
        this.rootPath = event.rootPath;
        const initialized = await this.request("initialize", {
          processId: null,
          rootUri: monaco.Uri.file(event.rootPath).toString(),
          workspaceFolders: [
            {
              uri: monaco.Uri.file(event.rootPath).toString(),
              name: event.rootPath.split("/").pop(),
            },
          ],
          capabilities: {
            textDocument: {
              hover: { contentFormat: ["markdown", "plaintext"] },
              definition: { linkSupport: true },
              references: {},
              synchronization: { didSave: false },
            },
            workspace: { workspaceFolders: true, configuration: true },
          },
        });
        if (initialized.error) {
          this.setStatus("unavailable");
          settle(false);
          return;
        }
        this.notify("initialized", {});
        this.setStatus("ready");
        settle(true);
        return;
      }
      case "message":
        this.onMessage(event.message as LspMessage);
        return;
      case "unavailable":
      case "exited":
        this.setStatus("unavailable");
        settle(false);
        return;
    }
  }

  private onMessage(message: LspMessage) {
    if (message.id !== undefined && message.method === undefined) {
      const resolve = this.pending.get(Number(message.id));
      this.pending.delete(Number(message.id));
      resolve?.(message);
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      // A request from the server: answer what a plain editor answers.
      const result =
        message.method === "workspace/configuration"
          ? ((message.params as { items?: unknown[] })?.items ?? []).map(() => null)
          : null;
      this.send({ jsonrpc: "2.0", id: message.id, result });
    }
  }

  private send(message: unknown) {
    if (!this.sessionId) return;
    void runAtomCommand(
      appAtomRegistry,
      canvasEnvironment.lspSend,
      { environmentId: this.environmentId, input: { sessionId: this.sessionId, message } },
      { label: "lsp send", reportFailure: false, reportDefect: false },
    );
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown): Promise<LspMessage> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  openDocument(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (this.opened.has(uri)) return;
    this.opened.add(uri);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: lspLanguageId(model), version: 1, text: model.getValue() },
    });
  }
}

const clients: LspClient[] = [];
const connecting = new Map<string, Promise<LspClient>>();

/** The language server client for a file, started on first use. */
export async function lspClientFor(
  environmentId: EnvironmentId,
  path: string,
  languageId: string,
): Promise<LspClient> {
  const covering = () =>
    clients.find(
      (client) =>
        client.environmentId === environmentId &&
        client.languageId === languageId &&
        path.startsWith(`${client.scopePath}/`),
    );
  const key = `${environmentId}:${languageId}`;
  await connecting.get(key);
  const existing = covering();
  if (existing) return existing;
  const started = (async () => {
    const client = new LspClient(environmentId, languageId, path);
    clients.push(client);
    await client.ready;
    return client;
  })();
  connecting.set(key, started);
  return started;
}

/** Which environment each Monaco model's file belongs to. */
const modelEnvironment = new Map<string, EnvironmentId>();

export function attachModel(environmentId: EnvironmentId, model: monaco.editor.ITextModel) {
  modelEnvironment.set(model.uri.toString(), environmentId);
  void lspClientFor(environmentId, model.uri.path, model.getLanguageId()).then((client) => {
    if (client.status === "ready") client.openDocument(model);
  });
}

async function clientForModel(model: monaco.editor.ITextModel): Promise<LspClient | null> {
  const environmentId = modelEnvironment.get(model.uri.toString());
  if (!environmentId) return null;
  const client = await lspClientFor(environmentId, model.uri.path, model.getLanguageId());
  if (client.status !== "ready") return null;
  client.openDocument(model);
  return client;
}

const position = (model: monaco.editor.ITextModel, at: monaco.Position) => ({
  textDocument: { uri: model.uri.toString() },
  position: { line: at.lineNumber - 1, character: at.column - 1 },
});

interface LspRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

const toRange = (range: LspRange) =>
  new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );

/** Creates models for the files a result points to, so Monaco can show them. */
async function locations(
  environmentId: EnvironmentId,
  raw: unknown,
): Promise<monaco.languages.Location[]> {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{
    uri?: string;
    range?: LspRange;
    targetUri?: string;
    targetSelectionRange?: LspRange;
  }>;
  const result: monaco.languages.Location[] = [];
  for (const item of list.slice(0, 30)) {
    const uri = item.targetUri ?? item.uri;
    const range = item.targetSelectionRange ?? item.range;
    if (!uri || !range) continue;
    const parsed = monaco.Uri.parse(uri);
    if (!monaco.editor.getModel(parsed)) {
      const contents = await readServerFile(environmentId, parsed.path);
      if (contents === null) continue;
      const model = modelFor(parsed.path, contents);
      modelEnvironment.set(model.uri.toString(), environmentId);
    }
    result.push({ uri: parsed, range: toRange(range) });
  }
  return result;
}

let providersRegistered = false;

/** Hover, definition and references for every language, through the language servers. */
export function registerLspProviders() {
  if (providersRegistered) return;
  providersRegistered = true;
  monaco.languages.registerHoverProvider("*", {
    provideHover: async (model, at) => {
      const client = await clientForModel(model);
      if (!client) return null;
      const response = await client.request("textDocument/hover", position(model, at));
      const hover = response.result as { contents?: unknown; range?: LspRange } | null | undefined;
      if (!hover?.contents) return null;
      const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
      return {
        contents: parts.map((part) =>
          typeof part === "string"
            ? { value: part }
            : "language" in (part as object)
              ? {
                  value: `\`\`\`${(part as { language: string }).language}\n${(part as { value: string }).value}\n\`\`\``,
                }
              : { value: (part as { value: string }).value },
        ),
        ...(hover.range ? { range: toRange(hover.range) } : {}),
      };
    },
  });
  monaco.languages.registerDefinitionProvider("*", {
    provideDefinition: async (model, at) => {
      const client = await clientForModel(model);
      if (!client) return null;
      const response = await client.request("textDocument/definition", position(model, at));
      return locations(client.environmentId, response.result);
    },
  });
  monaco.languages.registerReferenceProvider("*", {
    provideReferences: async (model, at) => {
      const client = await clientForModel(model);
      if (!client) return null;
      const response = await client.request("textDocument/references", {
        ...position(model, at),
        context: { includeDeclaration: false },
      });
      return locations(client.environmentId, response.result);
    },
  });
}
