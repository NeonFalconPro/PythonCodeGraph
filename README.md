# CodeGraph

Python code knowledge graph parser and visualizer.

English | [中文文档](README_CN.md)

## Overview

CodeGraph analyzes a target Python project with AST and visualizes relationships between modules, classes, functions, methods, constants, and external packages.

It provides two UI modes:

- Standard mode (`/standard`): force-directed and hierarchical graph based on vis-network
- Blueprint mode (`/blueprint`): module-level input/output blueprint graph based on LiteGraph.js

## Current Capabilities

- Project-wide Python file scanning with ignore rules for common cache/build/venv folders
- Multi-entity extraction:
  - package, module, class, function, method, constant, external
- Multi-relationship extraction:
  - imports, inherits, contains, calls, decorates, instantiates, uses
- External package hierarchy modeling (e.g. `external:fastapi`, `external:fastapi.staticfiles`)
- Real-time node/edge filtering in both UI modes
- Node detail panel with metadata (file, line, docstring, params, decorators, bases)
- Directory browser API for selecting analysis target

## Architecture

### Backend

- `app.py`
  - FastAPI app entry
  - Page routes: `/`, `/standard`, `/blueprint`
  - API routes:
    - `/api/standard/analyze`
    - `/api/standard/analyze/filtered`
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
  - Output adapters:
    - `to_vis_format()` for Standard mode
    - `to_blueprint_format()` for Blueprint mode

### Frontend

- `templates/index.html`: mode selector
- `templates/standard.html` + `static/js/graph.js`: Standard mode
- `templates/blueprint.html` + `static/js/blueprint.js`: Blueprint mode
- `static/css/style.css`: shared style
- `static/css/blueprint.css`: blueprint-specific style overrides

## Data Flow

1. User selects a folder path.
2. Frontend calls one of analyze APIs.
3. Backend validates path and invokes `GraphBuilder.build()`.
4. `PythonASTParser.parse_project()` generates node/edge sets.
5. `GraphData` is transformed to UI-specific format.
6. Frontend renders graph and enables filtering/search/detail interactions.

## API Reference

### Page routes

- `GET /` mode selector
- `GET /standard` standard visualization page
- `GET /blueprint` blueprint visualization page

### Analyze APIs

- `POST /api/standard/analyze`
  - Request:
    ```json
    { "path": "D:/your/python/project" }
    ```
  - Response: vis-network formatted graph + metadata

- `POST /api/standard/analyze/filtered`
- `POST /api/blueprint/analyze/filtered`
  - Request:
    ```json
    {
      "path": "D:/your/python/project",
      "node_types": ["module", "class", "function", "external"],
      "edge_types": ["imports", "calls", "uses"],
      "show_methods": true,
      "show_variables": false
    }
    ```

- `POST /api/blueprint/analyze`
  - Request same as standard analyze
  - Response: blueprint module/link structure + metadata

### Directory browser API

- `GET /api/browse?path=...`
  - Returns subdirectories only (hidden folders ignored)
  - On Windows and empty path, returns available drives

## Installation

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
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
CodeGraph/
  app.py
  requirements.txt
  parser/
    __init__.py
    ast_parser.py
    graph_builder.py
    models.py
  templates/
    index.html
    standard.html
    blueprint.html
  static/
    css/
      style.css
      blueprint.css
    js/
      graph.js
      blueprint.js
```

## Developer Guide

For detailed framework and extension guide, see:

- [FRAMEWORK_DEVELOPMENT_GUIDE_CN.md](FRAMEWORK_DEVELOPMENT_GUIDE_CN.md)

## License

MIT License. See [LICENSE](LICENSE).
