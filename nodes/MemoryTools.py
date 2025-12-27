import torch
import gc
import psutil
import logging
from server import PromptServer
from aiohttp import web
import comfy.model_management as mm

logger = logging.getLogger("MemoryTools")

prompt_server = PromptServer.instance

def release_model_vram():
    """只释放模型显存（对应 Manager 的 Unload Models）"""
    pre_models = len(mm.current_loaded_models)

    # 直接设置 flag，让 ComfyUI 安全卸载（避开直接调用 unload_all_models 的 bug）
    if prompt_server and prompt_server.prompt_queue:
        pq = prompt_server.prompt_queue
        if not pq.currently_running:
            pq.set_flag("unload_models", True)  # 只卸载模型
            logger.info("[MemoryTools] Flag set: unload_models=True (safe unload)")
        else:
            logger.warning("[MemoryTools] Task running, unload_models flag will apply after current task")

    # 立即温和清理显存
    mm.soft_empty_cache()
    torch.cuda.empty_cache()

    post_models = len(mm.current_loaded_models)
    logger.info(f"[MemoryTools] Release Model VRAM requested: models {pre_models} → will unload safely")

def release_all_memory():
    """彻底释放（对应 Manager 的 Free model and node cache）"""
    pre_models = len(mm.current_loaded_models)
    vm = psutil.virtual_memory()
    pre_cpu = vm.used / (1024**3)

    if prompt_server and prompt_server.prompt_queue:
        pq = prompt_server.prompt_queue
        if not pq.currently_running:
            pq.set_flag("unload_models", True)
            pq.set_flag("free_memory", True)  # 清节点缓存
            logger.info("[MemoryTools] Flags set: unload_models=True, free_memory=True (full cleanup)")
        else:
            logger.warning("[MemoryTools] Task running, full cleanup flags will apply after current task")

    # 立即执行温和清理
    mm.soft_empty_cache()
    torch.cuda.empty_cache()
    gc.collect()

    post_models = len(mm.current_loaded_models)
    vm = psutil.virtual_memory()
    post_cpu = vm.used / (1024**3)
    logger.info(f"[MemoryTools] Full Cleanup requested: models {pre_models}→{post_models}, CPU {pre_cpu:.2f}→{post_cpu:.2f} GiB")

# API 路由
@PromptServer.instance.routes.post("/memory/release_model_vram")
async def api_release_model_vram(request):
    release_model_vram()
    return web.json_response({"message": "模型显存释放请求已提交（安全模式）"})

@PromptServer.instance.routes.post("/memory/release_all")
async def api_release_all(request):
    release_all_memory()
    return web.json_response({"message": "全部内存释放请求已提交（安全模式）"})