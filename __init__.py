# __init__.py
# SK节点库 (SKNodes) - 个人学习自用节点
# 版本: 1.0.0-beta.1 (测试版)

import importlib
import os
import sys

# --- 版本信息 ---
__version__ = "1.0.0-beta.1"
__author__ = "SK"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# --- 模块清单 ---
sub_modules = [
    "PresetPrompt",
    "MergePrompt",
    "RecommendFrameSetter",
    "InfoDisplay",
    "TypeDetector",
    "SaveTagger",
    "SerialNumberMarks",
    "InteractiveAnnotationTool",
    "MemoryTools",
]

# 获取当前插件目录名
base_path = os.path.basename(os.path.dirname(__file__))

# --- 循环加载逻辑 ---
for module_name in sub_modules:
    try:
        module = importlib.import_module(f".nodes.{module_name}", package=__name__)
        if hasattr(module, "NODE_CLASS_MAPPINGS"):
            NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
        if hasattr(module, "NODE_DISPLAY_NAME_MAPPINGS"):
            NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)  
        print(f"✅ [sknodes] {module_name} 加载成功")
    except Exception as e:
        print(f"❌ [sknodes] {module_name} 加载失败: {type(e).__name__} | {e}")


WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS", 
    "NODE_DISPLAY_NAME_MAPPINGS", 
    "WEB_DIRECTORY",
    "__version__"
]

print(f"🚀 [sknodes] 初始化完成 | 版本: {__version__} | 注册节点数: {len(NODE_CLASS_MAPPINGS)}")