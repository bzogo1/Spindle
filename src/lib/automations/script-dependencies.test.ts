import { describe, expect, it } from "vitest"

import {
  AUTOMATION_RUNTIME_DEPENDENCIES,
  AUTOMATION_RUNTIME_DEPENDENCIES_BY_LANGUAGE,
  checkScriptDependencies,
  checkScriptDependenciesForLanguage,
  extractJuliaImports,
  extractPythonImports,
  extractRImports,
} from "./script-dependencies"

describe("extractPythonImports", () => {
  it("extracts plain, aliased, and from-imports as top-level modules", () => {
    const source = [
      "import pandas as pd",
      "import numpy, scipy.stats",
      "from spindle import project as sp",
      "from matplotlib.figure import Figure",
    ].join("\n")

    expect(extractPythonImports(source)).toEqual([
      "pandas",
      "numpy",
      "scipy",
      "spindle",
      "matplotlib",
    ])
  })

  it("deduplicates imports and handles semicolons and indentation", () => {
    const source = [
      "import json; import pandas",
      "try:",
      "    import pandas as pd",
      "except ImportError:",
      "    import ujson as json",
    ].join("\n")

    expect(extractPythonImports(source)).toEqual(["json", "pandas", "ujson"])
  })

  it("ignores imports inside comments and strings", () => {
    const source = [
      "# import fake_package",
      'message = "import another_fake"',
      "'''",
      "import triple_fake",
      "'''",
      "import real_package",
    ].join("\n")

    expect(extractPythonImports(source)).toEqual(["real_package"])
  })

  it("preserves relative imports for reporting", () => {
    expect(extractPythonImports("from .utils import helper\nfrom ..pkg.mod import thing")).toEqual([
      ".utils",
      "..pkg",
    ])
  })
})

describe("checkScriptDependencies", () => {
  it("passes the automation demo script", () => {
    const source = "from spindle import project as sp\nimport pandas as pd\n"
    const result = checkScriptDependencies(source)

    expect(result).toEqual({
      imports: ["spindle", "pandas"],
      missing: [],
      available: ["spindle", "pandas"],
      ok: true,
    })
  })

  it("reports modules missing from the runtime", () => {
    const result = checkScriptDependencies("import pandas\nimport tensorflow\nimport os")

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(["tensorflow"])
    expect(result.available).toEqual(["pandas", "os"])
  })

  it("supports custom runtime lists", () => {
    const result = checkScriptDependencies("import pandas\nimport numpy", ["pandas"])

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(["numpy"])
  })

  it("passes scripts with no imports", () => {
    expect(checkScriptDependencies("print('hello')")).toEqual({
      imports: [],
      missing: [],
      available: [],
      ok: true,
    })
  })

  it("keeps the runtime list unique", () => {
    expect(new Set(AUTOMATION_RUNTIME_DEPENDENCIES).size).toBe(
      AUTOMATION_RUNTIME_DEPENDENCIES.length,
    )
  })
})

describe("R and Julia imports", () => {
  it("extracts R library and require calls", () => {
    const source = [
      "# library(ignored)",
      "library(spindle)",
      'library("readr")',
      "require(dplyr)",
      "library(ggplot2, quietly = TRUE)",
    ].join("\n")

    expect(extractRImports(source)).toEqual(["spindle", "readr", "dplyr", "ggplot2"])
  })

  it("extracts Julia using and import statements", () => {
    const source = [
      "# using Ignored",
      "using Spindle",
      "using DataFrames, CSV",
      "import JSON",
      "using .LocalHelpers",
    ].join("\n")

    expect(extractJuliaImports(source)).toEqual([
      "Spindle",
      "DataFrames",
      "CSV",
      "JSON",
      ".LocalHelpers",
    ])
  })

  it("checks each language against its own runtime list", () => {
    expect(checkScriptDependenciesForLanguage("library(spindle)\nlibrary(readr)", "r").ok).toBe(
      true,
    )
    expect(checkScriptDependenciesForLanguage("using Spindle\nusing DataFrames", "julia").ok).toBe(
      true,
    )
    expect(checkScriptDependenciesForLanguage("library(reticulate)", "r").missing).toEqual([
      "reticulate",
    ])
    expect(
      checkScriptDependenciesForLanguage("using Spindle\nusing Gadfly", "julia").missing,
    ).toEqual(["Gadfly"])
  })

  it("keeps every runtime list unique", () => {
    for (const dependencies of Object.values(AUTOMATION_RUNTIME_DEPENDENCIES_BY_LANGUAGE)) {
      expect(new Set(dependencies).size).toBe(dependencies.length)
    }
  })
})
