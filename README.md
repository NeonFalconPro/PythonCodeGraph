# PythonCodeGraph

Python code knowledge graph parser and visualizer (blueprint-focused edition).

English | [中文文档](README_CN.md)

## Overview

PythonCodeGraph statically analyzes a target Python project via AST and visualizes entities and relationships through a blueprint canvas.

Default entry is blueprint mode: `/` (and `/blueprint`).

![example](documents/blueprint.png)

## Current Capabilities

- Project-wide Python file scanning with ignore rules for common cache/build/venv folders
- Multi-entity extraction:
  - package, module, class, function, method, constant, external
- Multi-relationship extraction:
  - imports, inherits, contains, calls, decorates, instantiates, uses
- External package hierarchy modeling (e.g. `external:fastapi.staticfiles`)
- Real-time node/edge filtering in blueprint mode
- Node detail panel with metadata (file, line, docstring, params, decorators, bases)
- Pin-level link rendering, relation highlight, subgraph focus, back-to-full
- Directory browser API for selecting analysis target
- Built-in i18n switch (English/Chinese) with persisted language preference

## Demo GIF

![Blueprint mode demo](documents/blueprint.gif)

## Architecture

### Backend

- `app.py`
  - FastAPI app entry
  - Page routes: `/`, `/blueprint`
  - API routes:
    - `/api/blueprint/analyze`
    - `/api/blueprint/analyze/filtered`
    - `/api/browse`
  - Shared helpers:
    - `_build_graph(path)`
    - `_apply_filters(graph_data, req)`

- `parser/ast_parser.py`
  - Scans and parses Python files
  - Builds nodes/edges and deduplicates edges
  - Resolves internal and external references

- `parser/graph_builder.py`
  - Calls parser and performs graph-level filtering
  - Generates project metadata

- `parser/models.py`
  - Data models (`NodeData`, `EdgeData`, `GraphData`)
  - Output adapter: `to_blueprint_format()`

### Frontend

- `templates/blueprint.html` + `static/js/blueprint.js`: blueprint UI
- `static/js/i18n.js`: language pack and UI text switching
- `static/css/style.css`: shared style
- `static/css/blueprint.css`: blueprint-specific style overrides

## API Reference

### Page Routes

- `GET /`: blueprint page
- `GET /blueprint`: blueprint page

### Analyze APIs

- `POST /api/blueprint/analyze`
  - Request:
    ```json
    { "path": "D:/your/python/project" }
    ```
  - Response: blueprint module/link structure + metadata

- `POST /api/blueprint/analyze/filtered`
  - Request:
    ```json
    {
      "path": "D:/your/python/project",
      "node_types": ["package", "module", "class", "function", "external"],
      "edge_types": ["contains", "imports", "calls", "uses"],
      "show_methods": true,
      "show_variables": false
    }
    ```

### Directory Browser API

- `GET /api/browse?path=...`
  - Returns subdirectories only (hidden folders ignored)
  - On Windows and empty path, returns available drives

## Installation

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

or

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Open: `http://127.0.0.1:8000`

## Practical Notes and Limits

- This is static analysis based on AST, not runtime tracing.
- Files larger than 1 MB are skipped by parser.
- File decoding attempts UTF-8 first, then GBK fallback.
- Constant extraction currently focuses on uppercase or dunder names.
- Call edges are currently anchored at module level (not per-function caller node).

## Project Structure

```text
PythonCodeGraph/
  app.py
  requirements.txt
  documents/
    blueprint.gif
  parser/
    ast_parser.py
    graph_builder.py
    models.py
  templates/
    blueprint.html
  static/
    css/
      style.css
      blueprint.css
    js/
      blueprint.js
      i18n.js
      litegraph.min.js
```

## Developer Guide

See [documents/FRAMEWORK_DEVELOPMENT_GUIDE_CN.md](documents/FRAMEWORK_DEVELOPMENT_GUIDE_CN.md).

## License

MIT License. See [LICENSE](LICENSE).
