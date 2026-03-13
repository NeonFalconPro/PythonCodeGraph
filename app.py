"""
CodeGraph - Python 代码知识图谱生成与可视化工具

主应用入口，提供 Web 界面和 API 接口
支持标准模式（vis-network）和蓝图模式（LiteGraph.js）
"""

import os
from pathlib import Path
from typing import List

from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from parser.graph_builder import GraphBuilder
from parser.models import GraphData

app = FastAPI(title="CodeGraph", description="Python 代码知识图谱可视化工具")

# 静态文件和模板
BASE_DIR = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))


class AnalyzeRequest(BaseModel):
    """分析请求"""
    path: str


class FilterRequest(BaseModel):
    """过滤请求"""
    path: str
    node_types: List[str] = []
    edge_types: List[str] = []
    show_methods: bool = True
    show_variables: bool = False


# ============ 共享解析逻辑 ============

def _build_graph(path: str) -> GraphData:
    """共享的图谱构建逻辑"""
    target_path = path.strip()
    if not target_path:
        raise HTTPException(status_code=400, detail="请提供文件夹路径")

    target = Path(target_path)
    if not target.exists():
        raise HTTPException(status_code=400, detail=f"路径不存在: {target_path}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"不是文件夹: {target_path}")

    try:
        builder = GraphBuilder(target_path)
        return builder.build()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析出错: {str(e)}")


def _apply_filters(graph_data: GraphData, req: FilterRequest) -> GraphData:
    """共享的过滤逻辑"""
    if req.node_types:
        graph_data.nodes = [n for n in graph_data.nodes if n.node_type.value in req.node_types]
    if not req.show_methods:
        graph_data.nodes = [n for n in graph_data.nodes if n.node_type.value != "method"]
    if not req.show_variables:
        graph_data.nodes = [n for n in graph_data.nodes if n.node_type.value != "constant"]

    valid_ids = {n.id for n in graph_data.nodes}
    graph_data.edges = [e for e in graph_data.edges if e.source in valid_ids and e.target in valid_ids]
    if req.edge_types:
        graph_data.edges = [e for e in graph_data.edges if e.edge_type.value in req.edge_types]
    return graph_data


# ============ 页面路由 ============

@app.get("/")
async def index(request: Request):
    """模式选择主页"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/standard")
async def standard_page(request: Request):
    """标准模式页面"""
    return templates.TemplateResponse("standard.html", {"request": request})


@app.get("/blueprint")
async def blueprint_page(request: Request):
    """蓝图模式页面"""
    return templates.TemplateResponse("blueprint.html", {"request": request})


# ============ 标准模式 API ============

@app.post("/api/standard/analyze")
async def standard_analyze(req: AnalyzeRequest):
    """标准模式解析，返回 vis-network 格式"""
    graph_data = _build_graph(req.path)
    vis_data = graph_data.to_vis_format()
    return JSONResponse(content={
        "success": True,
        "data": vis_data,
        "metadata": graph_data.metadata,
    })


@app.post("/api/standard/analyze/filtered")
async def standard_analyze_filtered(req: FilterRequest):
    """标准模式带过滤的解析"""
    graph_data = _build_graph(req.path)
    graph_data = _apply_filters(graph_data, req)
    vis_data = graph_data.to_vis_format()
    return JSONResponse(content={
        "success": True,
        "data": vis_data,
        "metadata": graph_data.metadata,
    })


# ============ 蓝图模式 API ============

@app.post("/api/blueprint/analyze")
async def blueprint_analyze(req: AnalyzeRequest):
    """蓝图模式解析，返回 LiteGraph 格式"""
    graph_data = _build_graph(req.path)
    bp_data = graph_data.to_blueprint_format()
    return JSONResponse(content={
        "success": True,
        "data": bp_data,
        "metadata": graph_data.metadata,
    })


@app.post("/api/blueprint/analyze/filtered")
async def blueprint_analyze_filtered(req: FilterRequest):
    """蓝图模式带过滤的解析"""
    graph_data = _build_graph(req.path)
    graph_data = _apply_filters(graph_data, req)
    bp_data = graph_data.to_blueprint_format()
    return JSONResponse(content={
        "success": True,
        "data": bp_data,
        "metadata": graph_data.metadata,
    })


# ============ 共享 API ============

@app.get("/api/browse")
async def browse_directory(path: str = ""):
    """浏览目录结构，帮助用户选择文件夹"""
    if not path:
        if os.name == 'nt':
            import string
            drives = []
            for letter in string.ascii_uppercase:
                drive = f"{letter}:\\"
                if os.path.exists(drive):
                    drives.append({"name": drive, "path": drive, "is_dir": True})
            return JSONResponse(content={"items": drives, "current": "", "parent": ""})
        else:
            path = "/"

    target = Path(path)
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=400, detail="路径无效")

    items = []
    try:
        for entry in sorted(target.iterdir()):
            if entry.name.startswith('.'):
                continue
            if entry.is_dir():
                items.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": True,
                })
    except PermissionError:
        pass

    return JSONResponse(content={
        "items": items,
        "current": str(target),
        "parent": str(target.parent) if target.parent != target else "",
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
