"""
CodeGraph - Python 代码知识图谱生成与可视化工具

主应用入口，提供 Web 界面和 API 接口
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
    node_types: List[str] = []      # 要显示的节点类型
    edge_types: List[str] = []      # 要显示的边类型
    show_methods: bool = True       # 是否显示方法
    show_variables: bool = False    # 是否显示变量


@app.get("/")
async def index(request: Request):
    """主页"""
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    """解析指定文件夹，返回图谱数据"""
    target_path = req.path.strip()

    if not target_path:
        raise HTTPException(status_code=400, detail="请提供文件夹路径")

    target = Path(target_path)
    if not target.exists():
        raise HTTPException(status_code=400, detail=f"路径不存在: {target_path}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"不是文件夹: {target_path}")

    try:
        builder = GraphBuilder(target_path)
        graph_data = builder.build()
        vis_data = graph_data.to_vis_format()

        return JSONResponse(content={
            "success": True,
            "data": vis_data,
            "metadata": graph_data.metadata,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析出错: {str(e)}")


@app.post("/api/analyze/filtered")
async def analyze_filtered(req: FilterRequest):
    """带过滤条件的解析"""
    target_path = req.path.strip()

    if not target_path:
        raise HTTPException(status_code=400, detail="请提供文件夹路径")

    target = Path(target_path)
    if not target.exists():
        raise HTTPException(status_code=400, detail=f"路径不存在: {target_path}")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail=f"不是文件夹: {target_path}")

    try:
        builder = GraphBuilder(target_path)
        graph_data = builder.build()

        # 应用过滤
        if req.node_types:
            graph_data.nodes = [
                n for n in graph_data.nodes
                if n.node_type.value in req.node_types
            ]
        if not req.show_methods:
            graph_data.nodes = [
                n for n in graph_data.nodes
                if n.node_type.value != "method"
            ]
        if not req.show_variables:
            graph_data.nodes = [
                n for n in graph_data.nodes
                if n.node_type.value != "variable"
            ]

        # 过滤边
        valid_ids = {n.id for n in graph_data.nodes}
        graph_data.edges = [
            e for e in graph_data.edges
            if e.source in valid_ids and e.target in valid_ids
        ]
        if req.edge_types:
            graph_data.edges = [
                e for e in graph_data.edges
                if e.edge_type.value in req.edge_types
            ]

        vis_data = graph_data.to_vis_format()
        return JSONResponse(content={
            "success": True,
            "data": vis_data,
            "metadata": graph_data.metadata,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解析出错: {str(e)}")


@app.get("/api/browse")
async def browse_directory(path: str = ""):
    """浏览目录结构，帮助用户选择文件夹"""
    if not path:
        # 返回磁盘根目录（Windows）或根目录（Linux/Mac）
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
