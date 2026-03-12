# 🔍 PythonCodeGraph

**Python 代码知识图谱生成与可视化工具** — 自动解析 Python 项目的模块、类、函数之间的关系，生成可交互的知识图谱。

![Python](https://img.shields.io/badge/Python-3.8+-blue?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![vis-network](https://img.shields.io/badge/vis--network-9.x-orange)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ 功能特性

- 🧠 **AST 深度解析** — 基于 Python `ast` 模块，静态分析源代码，提取模块、类、函数、方法、变量等实体
- 🔗 **多维关系识别** — 自动识别 6 种代码关系：导入、继承、包含、调用、装饰器、实例化
- 🌐 **交互式图谱** — 使用 vis-network 渲染力导向/层级布局图谱，支持缩放、拖拽、聚焦
- 🎯 **智能高亮** — 点击节点高亮所有关联节点和边，非关联元素自动淡化，关系一目了然
- 🔍 **节点详情** — 侧边面板展示节点类型、文件路径、行号、文档字符串、参数、基类等信息
- 📂 **可视化目录浏览** — 内置文件夹选择器，无需手动输入路径
- 🎛️ **灵活过滤** — 按节点类型（包/模块/类/函数/方法/变量）和关系类型动态过滤
- 📐 **多种布局** — 支持力导向布局、上下/左右/下上层级布局切换
- 💾 **导出图片** — 一键导出图谱为 PNG 图片

## 📸 图谱预览

```
📦 Package ──包含──▶ 📄 Module ──导入──▶ 📄 Module
                        │                     │
                       定义                   定义
                        ▼                     ▼
                    🏷️ Class ──继承──▶   🏷️ Class
                        │
                       定义
                        ▼
                    🔧 Method
```

## 🚀 快速开始

### 环境要求

- Python 3.8+
- 现代浏览器（Chrome / Edge / Firefox）

### 安装

```bash
# 克隆项目
git clone https://github.com/your-username/CodeGraph.git
cd CodeGraph

# 创建虚拟环境（可选）
python -m venv .venv
.venv\Scripts\activate  # Windows
# source .venv/bin/activate  # Linux/Mac

# 安装依赖
pip install -r requirements.txt
```

### 运行

```bash
python app.py
```

或使用 uvicorn：

```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

打开浏览器访问 **http://127.0.0.1:8000**

### 使用方法

1. 在左侧输入框输入 Python 项目的文件夹路径（或点击 📁 按钮浏览选择）
2. 点击 **🚀 开始解析**
3. 图谱自动生成，可进行以下交互：
   - **单击节点** → 高亮所有关联关系 + 显示详情面板
   - **双击节点** → 聚焦放大到该节点
   - **点击详情面板中的关联关系** → 跳转并聚焦到目标节点
   - **点击空白区域** → 取消高亮
   - **滚轮缩放 / 拖拽** → 浏览图谱
   - **左侧过滤器** → 按类型筛选显示内容

## 📁 项目结构

```
CodeGraph/
├── app.py                  # FastAPI 主应用（Web 服务 + API）
├── requirements.txt        # Python 依赖
├── parser/                 # 解析模块
│   ├── __init__.py
│   ├── models.py           # 数据模型（Node / Edge / Graph）
│   ├── ast_parser.py       # Python AST 解析器
│   └── graph_builder.py    # 知识图谱构建器
├── templates/
│   └── index.html          # 前端页面模板
└── static/
    ├── css/
    │   └── style.css       # 样式文件
    └── js/
        └── graph.js        # 前端交互逻辑（vis-network）
```

## 🔗 识别的关系类型

| 关系 | 颜色 | 说明 | 示例 |
|------|------|------|------|
| 🔴 导入 (imports) | 红色 | 模块间的导入依赖 | `import os` / `from x import y` |
| 🔵 继承 (inherits) | 蓝色 | 类的继承关系 | `class Dog(Animal)` |
| ⚪ 包含 (contains) | 灰色虚线 | 模块包含类/函数 | 模块 → 类/函数 |
| 🟢 调用 (calls) | 绿色 | 函数/方法调用 | `foo()` |
| 🟣 装饰 (decorates) | 紫色虚线 | 装饰器关系 | `@staticmethod` |
| 🟡 实例化 (instantiates) | 橙色 | 类的实例化 | `obj = MyClass()` |

## 🛠️ 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 后端框架 | [FastAPI](https://fastapi.tiangolo.com/) | Web 服务 + RESTful API |
| 代码解析 | Python `ast` 模块 | 语法树分析，提取代码结构 |
| 数据模型 | [Pydantic](https://docs.pydantic.dev/) | 请求/响应数据验证 |
| 模板引擎 | [Jinja2](https://jinja.palletsprojects.com/) | HTML 页面渲染 |
| 图谱可视化 | [vis-network](https://visjs.github.io/vis-network/) | 交互式网络图谱渲染 |
| ASGI 服务器 | [Uvicorn](https://www.uvicorn.org/) | 高性能异步 HTTP 服务器 |

## 📄 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 主页 |
| `POST` | `/api/analyze` | 解析项目，返回图谱数据 |
| `POST` | `/api/analyze/filtered` | 带过滤条件的解析 |
| `GET` | `/api/browse?path=xxx` | 浏览目录结构 |

## 📜 License

MIT License
