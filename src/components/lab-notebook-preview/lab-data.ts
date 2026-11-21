/**
 * Content for the /lab-notebook-preview simulation.
 *
 * Everything here is static demo content for a fictional field study
 * ("coastal-resilience"). It exists so the simulated IDE, notebook, R session,
 * and SSH terminal have realistic things to show without any backend.
 */

export type IdeLanguage = "python" | "r" | "markdown" | "yaml" | "table"

export type IdeFile = {
  path: string
  name: string
  dir: string
  language: IdeLanguage
  status?: "M" | "U" | "A"
  code: string
}

/* -------------------------------------------------------------------------- */
/* Editor / explorer                                                          */
/* -------------------------------------------------------------------------- */

export const IDE_FILES: IdeFile[] = [
  {
    path: "scripts/clean_data.py",
    name: "clean_data.py",
    dir: "scripts",
    language: "python",
    status: "M",
    code: `"""Clean and validate the 2026 coastal survey.

Run: python scripts/clean_data.py --input data/survey.parquet
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "outputs"

KEEP = [
    "sample_id",
    "site",
    "sampled_at",
    "salinity",
    "turbidity",
    "tide_range",
    "rainfall_7d",
    "water_temp",
    "do_mg_l",
]


def load_survey(path: Path = DATA / "survey.parquet") -> pd.DataFrame:
    df = pd.read_parquet(path)
    print(f"loaded {len(df):,} rows x {df.shape[1]} columns")
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)
    df = df.drop_duplicates(subset="sample_id", keep="last")

    # Turbidity probes occasionally drop a reading at low tide.
    df["turbidity"] = df["turbidity"].fillna(df["turbidity"].median())
    df["salinity"] = df["salinity"].clip(lower=0, upper=42)
    df["sampled_at"] = pd.to_datetime(df["sampled_at"], utc=True)
    df["site"] = df["site"].astype("category")

    print(f"dropped {before - len(df)} duplicate samples")
    print(f"kept {len(df):,} rows · {df['site'].nunique()} sites")
    return df[KEEP]


def validate(df: pd.DataFrame) -> None:
    assert df["sample_id"].is_unique, "sample_id must be unique"
    assert df["salinity"].between(0, 42).all(), "salinity out of range"
    assert df["sampled_at"].notna().all(), "missing sample timestamps"
    print("validation passed")


if __name__ == "__main__":
    survey = clean(load_survey())
    validate(survey)
    survey.to_parquet(OUT / "clean.parquet", index=False)
    print(f"wrote {OUT / 'clean.parquet'}")
`,
  },
  {
    path: "scripts/fit_model.py",
    name: "fit_model.py",
    dir: "scripts",
    language: "python",
    code: `"""Fit the salinity -> turbidity model used in the 2026 report."""
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

DATA = Path(__file__).resolve().parents[1] / "outputs"

FEATURES = [
    "salinity",
    "water_temp",
    "tide_range",
    "rainfall_7d",
    "do_mg_l",
    "salinity_lag1",
]


def load() -> pd.DataFrame:
    df = pd.read_parquet(DATA / "clean.parquet")
    df = df.sort_values(["site", "sampled_at"])
    df["salinity_lag1"] = df.groupby("site", observed=True)["salinity"].shift(1)
    return df.dropna(subset=["turbidity", "salinity_lag1"])


def fit(df: pd.DataFrame) -> RandomForestRegressor:
    split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=7)
    train_idx, test_idx = next(split.split(df, groups=df["site"]))

    model = RandomForestRegressor(
        n_estimators=400,
        max_depth=12,
        min_samples_leaf=3,
        n_jobs=-1,
        random_state=7,
    )
    model.fit(df.iloc[train_idx][FEATURES], df.iloc[train_idx]["turbidity"])

    pred = model.predict(df.iloc[test_idx][FEATURES])
    actual = df.iloc[test_idx]["turbidity"]
    print(f"train R2  {model.score(df.iloc[train_idx][FEATURES], df.iloc[train_idx]['turbidity']):.3f}")
    print(f"val R2    {r2_score(actual, pred):.3f}")
    print(f"val MAE   {mean_absolute_error(actual, pred):.2f} NTU")
    return model


if __name__ == "__main__":
    fit(load())
`,
  },
  {
    path: "scripts/plot_trends.py",
    name: "plot_trends.py",
    dir: "scripts",
    language: "python",
    code: `"""Monthly salinity and turbidity trend, shared with the field team."""
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "outputs"

df = pd.read_parquet(OUT / "clean.parquet")
monthly = (
    df.set_index("sampled_at")
    .groupby("site", observed=True)
    .resample("MS")[["salinity", "turbidity"]]
    .mean()
    .reset_index()
)

plt.rcParams.update({"figure.dpi": 160, "font.size": 9})
fig, (ax1, ax2) = plt.subplots(2, 1, sharex=True, figsize=(6.4, 4.2))

for site, group in monthly.groupby("site", observed=True):
    ax1.plot(group["sampled_at"], group["salinity"], lw=1.1, alpha=0.8)
    ax2.plot(group["sampled_at"], group["turbidity"], lw=1.1, alpha=0.8)

ax1.set_ylabel("salinity (psu)")
ax2.set_ylabel("turbidity (NTU)")
ax2.set_xlabel("sample month")
fig.tight_layout()
fig.savefig(OUT / "trends-2026.png")
print("wrote outputs/trends-2026.png")
`,
  },
  {
    path: "notebooks/analysis.ipynb",
    name: "analysis.ipynb",
    dir: "notebooks",
    language: "python",
    status: "M",
    code: `{
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# Coastal resilience — salinity & turbidity\\n",
    "Field survey, May–July 2026 · 12 sites, 48,102 samples"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {},
   "source": [
    "import pandas as pd\\n",
    "df = pd.read_parquet('../outputs/clean.parquet')\\n",
    "df.shape"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "Python 3 (ipykernel)",
   "language": "python",
   "name": "python3"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}`,
  },
  {
    path: "data/survey.parquet",
    name: "survey.parquet",
    dir: "data",
    language: "table",
    code: "",
  },
  {
    path: "README.md",
    name: "README.md",
    dir: "",
    language: "markdown",
    code: `# coastal-resilience

Field survey data and analysis for the 2026 mangrove salinity study.

## Layout

- \`data/survey.parquet\` — raw samples, 14 columns (read-only mount)
- \`data/sites.geojson\` — 12 station polygons
- \`scripts/clean_data.py\` — dedupe, range-check, write \`outputs/clean.parquet\`
- \`scripts/fit_model.py\` — grouped train/validation split, random forest
- \`notebooks/analysis.ipynb\` — findings notebook
- \`reports/findings.qmd\` — quarterly write-up

## Environment

\`\`\`
conda env create -f environment.yml
conda activate coastal
\`\`\`

The Lab mounts this directory at \`~/projects/coastal-resilience\` in every
runtime (VS Code, Jupyter, RStudio, SSH). Do not move \`outputs/\` — the report
build reads it by path.

## Data notes

Turbidity values above 45 NTU are real storm events, not probe errors. Check
\`sampled_at\` before dropping them.
`,
  },
  {
    path: "environment.yml",
    name: "environment.yml",
    dir: "",
    language: "yaml",
    code: `name: coastal
channels:
  - conda-forge
dependencies:
  - python=3.12.4
  - pandas=2.2.3
  - pyarrow=17.0.0
  - scikit-learn=1.5.2
  - matplotlib=3.9.2
  - duckdb=1.1.3
  - pip
  - pip:
      - jupyterlab==4.2.5
`,
  },
]

export const SURVEY_SCHEMA = [
  { column: "sample_id", type: "string", nulls: "0.0%", note: "uuid4" },
  { column: "site", type: "category", nulls: "0.0%", note: "12 stations" },
  { column: "sampled_at", type: "timestamp[ns, UTC]", nulls: "0.0%", note: "" },
  { column: "salinity", type: "float64", nulls: "0.1%", note: "psu" },
  { column: "turbidity", type: "float64", nulls: "0.4%", note: "NTU" },
  { column: "tide_range", type: "float64", nulls: "0.1%", note: "metres" },
  { column: "rainfall_7d", type: "float64", nulls: "0.2%", note: "mm" },
  { column: "water_temp", type: "float64", nulls: "0.0%", note: "°C" },
  { column: "do_mg_l", type: "float64", nulls: "1.2%", note: "mg/L" },
  { column: "sensor_id", type: "string", nulls: "0.0%", note: "HW rev 3" },
  { column: "lab_batch", type: "string", nulls: "0.0%", note: "" },
  { column: "analyst", type: "string", nulls: "0.0%", note: "" },
  { column: "qc_flag", type: "int8", nulls: "0.0%", note: "0/1/2" },
  { column: "notes", type: "string", nulls: "88.6%", note: "" },
]

/* -------------------------------------------------------------------------- */
/* Notebook                                                                   */
/* -------------------------------------------------------------------------- */

export type NotebookTableOutput = {
  kind: "table"
  caption: string
  columns: string[]
  rows: (string | number)[][]
}

export type NotebookTextOutput = {
  kind: "text"
  content: string
  tone?: "default" | "ok" | "warn" | "error" | "dim"
}

export type NotebookPlotOutput = {
  kind: "plot"
  caption: string
}

export type NotebookOutput = NotebookTableOutput | NotebookTextOutput | NotebookPlotOutput

export type NotebookCell = {
  id: string
  kind: "markdown" | "code"
  source: string
  outputs: NotebookOutput[]
  runSeconds: number
}

export const NOTEBOOK_CELLS: NotebookCell[] = [
  {
    id: "intro",
    kind: "markdown",
    source: `# Coastal resilience — salinity & turbidity

Field survey, May–July 2026. Twelve mangrove stations, three probes each,
sampled every 20 minutes. This notebook reproduces the figures in
\`reports/findings.qmd\`.

**Hypothesis:** wet-season turbidity is driven by 7-day rainfall more than by
tidal range once salinity is controlled for.`,
    outputs: [],
    runSeconds: 0,
  },
  {
    id: "load",
    kind: "code",
    source: `import pandas as pd
import numpy as np

pd.set_option("display.max_columns", 20)
df = pd.read_parquet("../outputs/clean.parquet")
print(f"{len(df):,} samples · {df.site.nunique()} sites · {df.sampled_at.min():%b %d}–{df.sampled_at.max():%b %d, %Y}")
df.head(3)`,
    outputs: [
      {
        kind: "text",
        content: "48,102 samples · 12 sites · May 03–Jul 28, 2026",
        tone: "default",
      },
      {
        kind: "table",
        caption: "3 rows × 9 columns",
        columns: [
          "sample_id",
          "site",
          "sampled_at",
          "salinity",
          "turbidity",
          "tide_range",
          "rainfall_7d",
        ],
        rows: [
          ["8f2a1c", "A-01", "2026-05-03 06:20", 27.4, 12.8, 1.92, 4.1],
          ["8f2a1d", "A-01", "2026-05-03 06:40", 27.6, 13.1, 1.86, 4.1],
          ["8f2a1e", "B-04", "2026-05-03 07:00", 31.2, 18.4, 2.14, 3.8],
        ],
      },
    ],
    runSeconds: 0.42,
  },
  {
    id: "clean",
    kind: "code",
    source: `# Range check: probe drift shows up as impossible salinity spikes.
clean = df.query("0 <= salinity <= 42").copy()
clean["month"] = clean.sampled_at.dt.strftime("%b")

dropped = len(df) - len(clean)
print(f"dropped {dropped} out-of-range readings ({dropped / len(df):.2%})")
clean.groupby("site", observed=True).agg(
    n=("sample_id", "size"),
    salinity=("salinity", "mean"),
    turbidity=("turbidity", "mean"),
).round(1).sort_values("salinity", ascending=False)`,
    outputs: [
      {
        kind: "text",
        content: "dropped 212 out-of-range readings (0.44%)",
        tone: "warn",
      },
      {
        kind: "table",
        caption: "12 rows × 3 columns · sorted by salinity",
        columns: ["site", "n", "salinity", "turbidity"],
        rows: [
          ["B-04", 4021, 31.2, 21.4],
          ["B-07", 3988, 30.8, 19.9],
          ["C-02", 4102, 29.7, 17.2],
          ["A-01", 4077, 28.4, 14.6],
          ["A-02", 3990, 27.9, 13.9],
        ],
      },
      {
        kind: "text",
        content: "… 7 more rows",
        tone: "dim",
      },
    ],
    runSeconds: 0.31,
  },
  {
    id: "plot",
    kind: "code",
    source: `import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(7.2, 3.1), dpi=150)
for site, group in clean.groupby("site", observed=True):
    monthly = group.set_index("sampled_at").turbidity.resample("MS").mean()
    ax.plot(monthly.index, monthly.values, lw=1.1, alpha=0.75, label=site)

ax.set_ylabel("turbidity (NTU)")
ax.set_xlabel("2026")
ax.legend(ncol=4, fontsize=6, frameon=False, loc="upper left")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
plt.show()`,
    outputs: [
      {
        kind: "plot",
        caption: "Figure 1 · monthly mean turbidity by station · 12 series",
      },
      {
        kind: "text",
        content:
          "A-01 and B-04 diverge in late June; the storm window (Jun 18–24) is visible in all series.",
        tone: "dim",
      },
    ],
    runSeconds: 1.18,
  },
  {
    id: "model",
    kind: "code",
    source: `from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import r2_score, mean_absolute_error

features = ["salinity", "water_temp", "tide_range", "rainfall_7d", "do_mg_l", "salinity_lag1"]
data = clean.sort_values(["site", "sampled_at"]).copy()
data["salinity_lag1"] = data.groupby("site", observed=True).salinity.shift(1)
data = data.dropna(subset=features + ["turbidity"])

split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=7)
train, test = next(split.split(data, groups=data["site"]))

model = RandomForestRegressor(n_estimators=400, max_depth=12, n_jobs=-1, random_state=7)
model.fit(data.iloc[train][features], data.iloc[train].turbidity)

pred = model.predict(data.iloc[test][features])
print(f"val R²   {r2_score(data.iloc[test].turbidity, pred):.3f}")
print(f"val MAE  {mean_absolute_error(data.iloc[test].turbidity, pred):.2f} NTU")

for name, importance in sorted(zip(features, model.feature_importances_), key=lambda x: -x[1]):
    print(f"  {name:<14} {importance:.3f}")`,
    outputs: [
      {
        kind: "text",
        content:
          "val R²   0.874\nval MAE  2.61 NTU\n  rainfall_7d    0.284\n  salinity_lag1  0.241\n  tide_range     0.168\n  salinity       0.142\n  water_temp     0.101\n  do_mg_l        0.064",
        tone: "ok",
      },
      {
        kind: "text",
        content: "Grouped split by station: no site appears in both train and validation.",
        tone: "dim",
      },
    ],
    runSeconds: 4.86,
  },
  {
    id: "findings",
    kind: "markdown",
    source: `## Findings

- 7-day rainfall is the strongest predictor of turbidity (importance **0.284**).
- Salinity is a useful lag feature but explains less than the storm window.
- Three stations (B-04, B-07, C-02) run consistently saltier; the report flags
  them for a sensor recalibration visit in September.
- Model is grouped by station, so the validation score is honest about new sites.`,
    outputs: [],
    runSeconds: 0,
  },
]

export const NOTEBOOK_VARIABLES = [
  { name: "df", type: "DataFrame", value: "48,102 × 14" },
  { name: "clean", type: "DataFrame", value: "47,890 × 10" },
  { name: "model", type: "RandomForest", value: "400 trees" },
  { name: "split", type: "GroupShuffleSplit", value: "random_state=7" },
  { name: "features", type: "list", value: "6 items" },
]

/* -------------------------------------------------------------------------- */
/* RStudio                                                                    */
/* -------------------------------------------------------------------------- */

export const R_SOURCE = `library(tidyverse)
library(arrow)
library(sf)

survey <- read_parquet("data/survey.parquet")
sites  <- st_read("data/sites.geojson", quiet = TRUE)

# Mean salinity by station, joined to the field polygons
by_site <- survey |>
  group_by(site) |>
  summarise(
    n          = n(),
    salinity   = mean(salinity, na.rm = TRUE),
    turbidity  = mean(turbidity, na.rm = TRUE),
    .groups    = "drop"
  ) |>
  arrange(desc(salinity))

by_site |>
  left_join(sites, by = c("site" = "station")) |>
  ggplot(aes(x = longitude, y = latitude, size = n, colour = salinity)) +
  geom_sf(data = sites, inherit.aes = FALSE, fill = "grey92") +
  geom_point(alpha = 0.85) +
  scale_colour_viridis_c(option = "mako", direction = -1) +
  labs(
    title = "Surface salinity by station",
    subtitle = "Coastal resilience survey · May–Jul 2026",
    size = "samples", colour = "psu",
    x = NULL, y = NULL
  ) +
  theme_minimal(base_size = 11) +
  theme(panel.grid.minor = element_blank())
`

export const R_SESSION_BANNER = [
  'R version 4.4.2 (2026-10-31) -- "Tidy Tuk Tuk"',
  "Platform: x86_64-pc-linux-gnu (64-bit) · Spindle remote session",
  "",
  "Type 'help()' for help, 'q()' to quit, and Ctrl+Shift+Enter to run a script.",
]

export const R_HISTORY = [
  {
    command: "library(tidyverse)",
    output: [
      "── Attaching core tidyverse packages ──────────────────── tidyverse 2.0.0 ──",
      "✔ dplyr     1.1.4     ✔ readr     2.1.5",
      "✔ forcats   1.0.0     ✔ stringr   1.5.1",
      "✔ ggplot2   3.5.1     ✔ tibble    3.2.1",
      "✔ lubridate 1.9.3     ✔ tidyr     1.3.1",
      "✔ purrr     1.0.2",
      "── Conflicts ───────────────────────────── tidyverse_conflicts() ──",
      "✖ dplyr::filter() masks stats::filter()",
      "✖ dplyr::lag()    masks stats::lag()",
    ],
  },
  {
    command: 'survey <- read_parquet("data/survey.parquet")',
    output: [],
  },
  {
    command: "survey",
    output: [
      "# A tibble: 48,102 × 14",
      "   sample_id site  sampled_at          salinity turbidity tide_range rainfall_7d",
      "   <chr>     <fct> <dttm>                 <dbl>     <dbl>      <dbl>       <dbl>",
      " 1 8f2a1c    A-01  2026-05-03 06:20:00     27.4      12.8       1.92         4.1",
      " 2 8f2a1d    A-01  2026-05-03 06:40:00     27.6      13.1       1.86         4.1",
      " 3 8f2a1e    B-04  2026-05-03 07:00:00     31.2      18.4       2.14         3.8",
      "# ℹ 48,099 more rows",
      "# ℹ Use `print(n = ...)` to see more rows",
    ],
  },
  {
    command:
      "by_site <- survey |> group_by(site) |> summarise(salinity = mean(salinity, na.rm = TRUE))",
    output: [],
  },
  {
    command: "arrange(by_site, desc(salinity))",
    output: [
      "# A tibble: 12 × 2",
      "   site  salinity",
      "   <fct>    <dbl>",
      " 1 B-04      31.2",
      " 2 B-07      30.8",
      " 3 C-02      29.7",
      " 4 A-01      28.4",
      " 5 A-02      27.9",
      " 6 C-05      27.1",
      " 7 D-01      26.8",
      " 8 B-02      26.4",
      " 9 D-03      25.9",
      "10 A-05      25.2",
      "11 C-01      24.7",
      "12 D-02      24.1",
    ],
  },
]

export const R_ENVIRONMENT = [
  { name: "survey", type: "tibble", detail: "48,102 obs. of 14 variables" },
  { name: "sites", type: "sf", detail: "12 features, 6 fields" },
  { name: "by_site", type: "tibble", detail: "12 obs. of 4 variables" },
  { name: "sal_mean", type: "numeric", detail: "28.6" },
  { name: "tidal", type: "ts", detail: "2,190 × 2" },
  { name: "fit", type: "lm", detail: "turbidity ~ rainfall_7d" },
]

export const R_PACKAGES = [
  { name: "tidyverse", version: "2.0.0", source: "CRAN" },
  { name: "arrow", version: "17.0.0", source: "CRAN" },
  { name: "sf", version: "1.0-17", source: "CRAN" },
  { name: "ggplot2", version: "3.5.1", source: "CRAN" },
  { name: "duckdb", version: "1.1.3", source: "CRAN" },
  { name: "renv", version: "1.0.11", source: "CRAN" },
]
