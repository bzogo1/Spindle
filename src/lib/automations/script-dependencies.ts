/**
 * Static dependency checking for automation scripts.
 *
 * The automation runtime ships a curated set of packages for each supported
 * snippet language, so imports can be validated without installing or
 * importing anything: extract the package/module names from the script's
 * import statements and compare them with the static runtime list.
 */

export type ScriptLanguage = "python" | "r" | "julia"

/** Python modules guaranteed by the automation runtime. */
export const AUTOMATION_PYTHON_RUNTIME_DEPENDENCIES = [
  // First-party project bridge.
  "spindle",

  // Python standard library (top-level modules automation scripts commonly use).
  "__future__",
  "argparse",
  "array",
  "ast",
  "asyncio",
  "base64",
  "collections",
  "concurrent",
  "contextlib",
  "copy",
  "csv",
  "ctypes",
  "dataclasses",
  "datetime",
  "decimal",
  "enum",
  "fnmatch",
  "fractions",
  "functools",
  "glob",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "keyword",
  "linecache",
  "locale",
  "logging",
  "math",
  "mimetypes",
  "multiprocessing",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "platform",
  "pprint",
  "queue",
  "random",
  "re",
  "secrets",
  "shlex",
  "shutil",
  "signal",
  "socket",
  "sqlite3",
  "ssl",
  "statistics",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tarfile",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "timeit",
  "traceback",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",

  // Curated scientific/data stack available to automation scripts.
  "PIL",
  "bs4",
  "dateutil",
  "geopandas",
  "httpx",
  "jinja2",
  "lxml",
  "matplotlib",
  "networkx",
  "numpy",
  "openpyxl",
  "pandas",
  "plotly",
  "polars",
  "pyarrow",
  "pytz",
  "regex",
  "requests",
  "scipy",
  "seaborn",
  "sklearn",
  "statsmodels",
  "toml",
  "tqdm",
  "tzdata",
  "xarray",
  "yaml",
] as const

/** R packages guaranteed by the automation runtime. */
export const AUTOMATION_R_RUNTIME_DEPENDENCIES = [
  "spindle",
  "data.table",
  "dplyr",
  "forcats",
  "ggplot2",
  "glue",
  "httr",
  "jsonlite",
  "lubridate",
  "magrittr",
  "purrr",
  "readr",
  "rlang",
  "stringr",
  "tibble",
  "tidyr",
  "tidyselect",
  "vctrs",
] as const

/** Julia packages/modules guaranteed by the automation runtime. */
export const AUTOMATION_JULIA_RUNTIME_DEPENDENCIES = [
  "Spindle",
  "CSV",
  "DataFrames",
  "Dates",
  "JSON",
  "Printf",
  "Random",
  "Statistics",
] as const

/** Static runtime package lists by snippet language. */
export const AUTOMATION_RUNTIME_DEPENDENCIES_BY_LANGUAGE: Record<
  ScriptLanguage,
  readonly string[]
> = {
  python: AUTOMATION_PYTHON_RUNTIME_DEPENDENCIES,
  r: AUTOMATION_R_RUNTIME_DEPENDENCIES,
  julia: AUTOMATION_JULIA_RUNTIME_DEPENDENCIES,
}

/** Backwards-compatible name for the Python runtime list. */
export const AUTOMATION_RUNTIME_DEPENDENCIES = AUTOMATION_PYTHON_RUNTIME_DEPENDENCIES

export interface ScriptDependencyCheck {
  /** Unique modules/packages imported by the script, in source order. */
  imports: string[]
  /** Imported modules/packages that are not present in the runtime list. */
  missing: string[]
  /** Imported modules/packages confirmed by the runtime list. */
  available: string[]
  /** True when every detected import is available. */
  ok: boolean
}

const MODULE_PATH = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/
const FROM_IMPORT = /^from\s+(\.*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\.+)\s+import\b/
const PLAIN_IMPORT = /^import\s+(.+)$/
const R_LIBRARY = /^\s*(?:library|require)\s*\(\s*["']?([A-Za-z0-9._]+)["']?/
const JULIA_IMPORT = /^\s*(?:using|import)\s+(.+)$/

function uniqueImports(imports: string[]): string[] {
  return [...new Set(imports)]
}

function checkImports(
  imports: string[],
  runtimeDependencies: readonly string[],
): ScriptDependencyCheck {
  const runtime = new Set(runtimeDependencies)
  const available = imports.filter((moduleName) => runtime.has(moduleName))
  const missing = imports.filter((moduleName) => !runtime.has(moduleName))

  return {
    imports,
    missing,
    available,
    ok: missing.length === 0,
  }
}

/**
 * Remove comments and string contents while preserving enough code shape to
 * find imports. This is deliberately lexical rather than a full Python parse:
 * it understands quotes and triple-quoted strings well enough for static
 * dependency checks without executing or evaluating user code.
 */
function pythonCodeOnlyLines(source: string): string[] {
  // Python's explicit line joining lets an import list continue after `\`.
  const logicalSource = source.replace(/\\\r?\n/g, " ")
  const lines: string[] = []
  let tripleQuote: '"""' | "'''" | null = null

  for (const rawLine of logicalSource.split(/\r?\n/)) {
    let cleaned = ""
    let index = 0

    while (index < rawLine.length) {
      if (tripleQuote) {
        const end = rawLine.indexOf(tripleQuote, index)
        if (end === -1) {
          index = rawLine.length
          break
        }
        index = end + tripleQuote.length
        tripleQuote = null
        continue
      }

      const marker = rawLine.slice(index, index + 3)
      if (marker === '"""' || marker === "'''") {
        tripleQuote = marker
        index += 3
        continue
      }

      const char = rawLine[index]
      if (char === '"' || char === "'") {
        const quote = char
        index += 1
        while (index < rawLine.length) {
          if (rawLine[index] === "\\") {
            index += 2
            continue
          }
          if (rawLine[index] === quote) {
            index += 1
            break
          }
          index += 1
        }
        continue
      }

      if (char === "#") break
      cleaned += char
      index += 1
    }

    lines.push(cleaned)
  }

  return lines
}

/** Reduce `package.submodule` to the runtime-level package `package`. */
function pythonModuleName(modulePath: string): string {
  if (modulePath.startsWith(".")) {
    // Relative imports refer to project files rather than installed packages,
    // but keep enough of the path for the checker/UI to name them.
    const match = /^(\.+)([A-Za-z_]\w*)?/.exec(modulePath)
    return match ? `${match[1]}${match[2] ?? ""}` : modulePath
  }
  return modulePath.split(".")[0] ?? modulePath
}

function addPythonImport(imports: string[], seen: Set<string>, modulePath: string) {
  const moduleName = pythonModuleName(modulePath)
  if (!moduleName || seen.has(moduleName)) return
  seen.add(moduleName)
  imports.push(moduleName)
}

/**
 * Extract unique top-level Python module names from import statements.
 * Handles plain imports, comma-separated imports, `as` aliases,
 * `from package.module import name`, semicolon-separated statements, and
 * indented imports inside blocks. Relative imports are preserved with their
 * leading dots so callers can report them as unavailable runtime modules.
 */
export function extractPythonImports(source: string): string[] {
  const imports: string[] = []
  const seen = new Set<string>()

  for (const line of pythonCodeOnlyLines(source)) {
    for (const statement of line.split(";")) {
      const trimmed = statement.trim()
      if (!trimmed) continue

      const fromMatch = FROM_IMPORT.exec(trimmed)
      if (fromMatch) {
        addPythonImport(imports, seen, fromMatch[1])
        continue
      }

      const importMatch = PLAIN_IMPORT.exec(trimmed)
      if (!importMatch) continue

      for (const part of importMatch[1].split(",")) {
        const modulePath =
          part
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? ""
        if (MODULE_PATH.test(modulePath)) addPythonImport(imports, seen, modulePath)
      }
    }
  }

  return imports
}

/** Extract unique R package names from `library()` / `require()` calls. */
export function extractRImports(source: string): string[] {
  const imports: string[] = []

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "")
    const match = R_LIBRARY.exec(line)
    if (match) imports.push(match[1])
  }

  return uniqueImports(imports)
}

function juliaModuleName(modulePath: string): string {
  if (modulePath.startsWith(".")) {
    const match = /^(\.+)([A-Za-z_]\w*)?/.exec(modulePath)
    return match ? `${match[1]}${match[2] ?? ""}` : modulePath
  }
  return modulePath.split(".")[0] ?? modulePath
}

/** Extract unique Julia package/module names from `using` / `import` statements. */
export function extractJuliaImports(source: string): string[] {
  const imports: string[] = []

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "")
    const match = JULIA_IMPORT.exec(line)
    if (!match) continue

    for (const part of match[1].split(",")) {
      const modulePath = part.trim().split(/\s+/)[0]?.replace(/:.*$/, "").trim()
      if (modulePath) imports.push(juliaModuleName(modulePath))
    }
  }

  return uniqueImports(imports)
}

/** Extract imports using the syntax for the selected snippet language. */
export function extractScriptImports(source: string, language: ScriptLanguage): string[] {
  if (language === "r") return extractRImports(source)
  if (language === "julia") return extractJuliaImports(source)
  return extractPythonImports(source)
}

/** Check Python script imports against a static runtime module list. */
export function checkScriptDependencies(
  source: string,
  runtimeDependencies: readonly string[] = AUTOMATION_RUNTIME_DEPENDENCIES,
): ScriptDependencyCheck {
  return checkImports(extractPythonImports(source), runtimeDependencies)
}

/** Check script imports for a specific snippet language. */
export function checkScriptDependenciesForLanguage(
  source: string,
  language: ScriptLanguage,
  runtimeDependencies: readonly string[] = AUTOMATION_RUNTIME_DEPENDENCIES_BY_LANGUAGE[language],
): ScriptDependencyCheck {
  return checkImports(extractScriptImports(source, language), runtimeDependencies)
}
