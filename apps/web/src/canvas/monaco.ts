/**
 * Draw-out: Monaco for code cards and steps. The core editor, its editor
 * features and the syntax definitions load, so every language gets
 * highlighting; language smarts come from the server's language servers, and
 * no browser-side language service reports errors about imports it cannot see.
 */
import * as monaco from "monaco-editor/editor";
import "./monacoContribs";
import "monaco-editor/languages/register.all";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker };
  }
}

window.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export const CODE_LINE_HEIGHT = 20;

export const DARK_THEME = "draw-out-dark";
export const LIGHT_THEME = "draw-out-light";

monaco.editor.defineTheme(DARK_THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#00000000",
    "editorGutter.background": "#00000000",
    "editor.lineHighlightBackground": "#ffffff08",
    "editorLineNumber.foreground": "#ffffff38",
    "editorLineNumber.activeForeground": "#ffffff80",
    "scrollbarSlider.background": "#ffffff14",
    "editorStickyScroll.background": "#0d0d0e",
    "editorStickyScrollHover.background": "#18181b",
    "editorStickyScroll.shadow": "#00000080",
  },
});
monaco.editor.defineTheme(LIGHT_THEME, {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#00000000",
    "editorGutter.background": "#00000000",
    "editor.lineHighlightBackground": "#0000000a",
    "editorLineNumber.foreground": "#00000040",
    "scrollbarSlider.background": "#00000014",
    "editorStickyScroll.background": "#ffffff",
    "editorStickyScrollHover.background": "#f4f4f5",
  },
});

/** The Monaco language id for a file path, from its extension or file name. */
export function languageForPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((filename) => filename.toLowerCase() === name)) return language.id;
    if (extension && language.extensions?.includes(extension)) return language.id;
  }
  if (name === "gemfile" || name === "rakefile" || extension === ".rake" || extension === ".erb") {
    return "ruby";
  }
  return "plaintext";
}

/** One model per file, shared by every card that shows it. */
export function modelFor(path: string, contents: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path);
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getValue() !== contents) existing.setValue(contents);
    return existing;
  }
  return monaco.editor.createModel(contents, languageForPath(path), uri);
}

export { monaco };
