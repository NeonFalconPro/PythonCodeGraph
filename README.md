# 🔍 CodeGraph

**Python Code Knowledge Graph Generator & Visualizer** — Automatically parse relationships between modules, classes, and functions in a Python project and generate an interactive knowledge graph.

![Python](https://img.shields.io/badge/Python-3.8+-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![vis-network](https://img.shields.io/badge/vis--network-9.x-orange)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- 🧠 **Deep AST Analysis** — Statically analyzes Python source code using the built-in `ast` module, extracting modules, classes, functions, methods, and variables
- 🔗 **Multi-dimensional Relationship Detection** — Automatically identifies 6 types of code relationships: imports, inheritance, containment, calls, decorators, and instantiation
- 🌐 **Interactive Graph** — Renders force-directed or hierarchical layout graphs via vis-network with support for zoom, drag, and focus
- 🎯 **Smart Highlight** — Click any node to highlight all connected nodes and edges; unrelated elements fade out instantly
- 🔍 **Node Detail Panel** — Sidebar displays node type, file path, line number, docstring, parameters, base classes, and more
- 📂 **Visual Directory Browser** — Built-in folder picker — no need to type paths manually
- 🎛️ **Flexible Filtering** — Dynamically filter by node type (package / module / class / function / method / variable) and relationship type
- 📐 **Multiple Layouts** — Switch between force-directed, top-down, left-right, and bottom-up hierarchical layouts
- 💾 **Export Image** — Export the current graph as a PNG with one click

## 📸 Graph Preview

```
📦 Package ──contains──▶ 📄 Module ──imports──▶ 📄 Module
                              │                       │
                           defines                 defines
                              ▼                       ▼
                          🏷️ Class ──inherits──▶  🏷️ Class
                              │
                           defines
                              ▼
                          🔧 Method
```

## 🚀 Quick Start

### Requirements

- Python 3.8+
- A modern browser (Chrome / Edge / Firefox)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/CodeGraph.git
cd CodeGraph

# Create a virtual environment (optional but recommended)
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Linux / macOS

# Install dependencies
pip install -r requirements.txt
```

### Running

```bash
python app.py
```

Or with uvicorn directly:

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser and navigate to **http://127.0.0.1:8000**

### Usage

1. Enter the path to a Python project folder in the left input box (or click 📁 to browse)
2. Click **🚀 Start Analysis**
3. The graph is generated automatically. You can interact with it as follows:

| Action | Result |
|--------|--------|
| Single-click a node | Highlight all connected relationships + open detail panel |
| Double-click a node | Focus and zoom in on that node |
| Click a relation in the detail panel | Jump to and focus on the target node |
| Click empty canvas area | Clear highlight |
| Scroll / drag | Navigate the graph |
| Left-panel filters | Filter nodes and edges by type |

## 📁 Project Structure

```
CodeGraph/
├── app.py                  # FastAPI main application (server + API routes)
├── requirements.txt        # Python dependencies
├── parser/                 # Analysis module
│   ├── __init__.py
│   ├── models.py           # Data models (Node / Edge / Graph)
│   ├── ast_parser.py       # Python AST parser
│   └── graph_builder.py    # Knowledge graph builder
├── templates/
│   └── index.html          # Frontend HTML template
└── static/
    ├── css/
    │   └── style.css       # Stylesheet
    └── js/
        └── graph.js        # Frontend interaction logic (vis-network)
```

## 🔗 Relationship Types

| Relationship | Color | Description | Example |
|---|---|---|---|
| 🔴 imports | Red | Module import dependency | `import os` / `from x import y` |
| 🔵 inherits | Blue | Class inheritance | `class Dog(Animal)` |
| ⚪ contains | Gray dashed | Module defines class/function | Module → Class / Function |
| 🟢 calls | Green | Function or method call | `foo()` |
| 🟣 decorates | Purple dashed | Decorator relationship | `@staticmethod` |
| 🟡 instantiates | Orange | Class instantiation | `obj = MyClass()` |

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Backend Framework | [FastAPI](https://fastapi.tiangolo.com/) | Web server + RESTful API |
| Code Analysis | Python `ast` module | Syntax tree analysis, structure extraction |
| Data Validation | [Pydantic](https://docs.pydantic.dev/) | Request/response schema validation |
| Template Engine | [Jinja2](https://jinja.palletsprojects.com/) | HTML page rendering |
| Graph Visualization | [vis-network](https://visjs.github.io/vis-network/) | Interactive network graph rendering |
| ASGI Server | [Uvicorn](https://www.uvicorn.org/) | High-performance async HTTP server |

## 📄 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Main page |
| `POST` | `/api/analyze` | Analyze a project and return graph data |
| `POST` | `/api/analyze/filtered` | Analyze with node/edge type filters |
| `GET` | `/api/browse?path=xxx` | Browse directory structure |

### Example Request

```bash
curl -X POST http://127.0.0.1:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/your/python/project"}'
```

### Example Response

```json
{
  "success": true,
  "data": {
    "nodes": [
      { "id": "module:myapp.main", "label": "📄 main", "group": "module", ... }
    ],
    "edges": [
      { "from": "module:myapp.main", "to": "class:myapp.main.App", "label": "定义", ... }
    ]
  },
  "metadata": {
    "project_name": "myapp",
    "python_files": 12,
    "total_nodes": 47,
    "total_edges": 63
  }
}
```

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

## 📜 License

This project is licensed under the [MIT License](LICENSE).
