import os
import json
from aiohttp import web 
from server import PromptServer

# =========================================================================
# 路径配置：适配从 nodes/ 目录回退到根目录
# =========================================================================
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# 向上跳一级找到 config
PRESET_DIR = os.path.normpath(os.path.join(CURRENT_DIR, "..", "config", "prompts")) 

def get_names_handler():
    """保留原有的目录加载逻辑"""
    if not os.path.exists(PRESET_DIR):
        os.makedirs(PRESET_DIR, exist_ok=True)
    files = [f[:-4] for f in os.listdir(PRESET_DIR) if f.lower().endswith(".txt")]
    files.sort()
    return files if files else ["无可用预设"]

def get_prompt_content(name):
    """保留原有的读取文件逻辑"""
    file_path = os.path.join(PRESET_DIR, f"{name}.txt")
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except: return "读取预设失败"
    return ""

class PresetPrompt:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt_type": (get_names_handler(),),
                "caption": ("STRING", {"default": "", "multiline": True}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"}
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "preset"
    CATEGORY = "🌟SK节点库/提示词"

    def preset(self, prompt_type, caption, prompt=None, extra_pnginfo=None, unique_id=None):
        # --- 完全保留您原有的工作流实时同步逻辑 ---
        if unique_id is not None and extra_pnginfo is not None:
            try:
                workflow = extra_pnginfo.get("workflow", {})
                node = next((n for n in workflow.get("nodes", []) if str(n.get("id")) == str(unique_id)), None)
                if node:
                    node["widgets_values"] = [prompt_type, caption]
            except Exception as e:
                print(f"[PresetPrompt] 同步工作流失败: {e}")
        return (caption,)

NODE_CLASS_MAPPINGS = {"PresetPrompt": PresetPrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"PresetPrompt": "🏷️提示词预设"}

# =========================================================================
# 路由注册：保留原有 API 名称，确保 JS 访问不中断
# =========================================================================
@PromptServer.instance.routes.get("/sklibs/prompts")
async def _get_names(request):
    return web.json_response(get_names_handler())

@PromptServer.instance.routes.get("/sklibs/get_prompt_content")
async def _get_content(request):
    name = request.query.get("name")
    return web.json_response({"prompt": get_prompt_content(name)})

@PromptServer.instance.routes.post("/sklibs/reload_prompts")
async def _reload(request):
    return web.json_response({"status": "success", "names": get_names_handler()})