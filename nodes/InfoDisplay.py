# InfoDisplay.py - 纯日志终端节点

import sys
import datetime
import json
from comfy.comfy_types.node_typing import IO

class InfoDisplayNode:
    
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "输入数据": (IO.ANY, {"forceInput": True}),
                "日志标识": (
                    ["❤️❤️❤️❤️❤️❤️", "🧡🧡🧡🧡🧡🧡", "💛💛💛💛💛💛", "💚💚💚💚💚💚", "💙💙💙💙💙💙", "💜💜💜💜💜💜", "🖤🖤🖤🖤🖤🖤", "🤍🤍🤍🤍🤍🤍", "🤎🤎🤎🤎🤎🤎", "💔💔💔💔💔💔", "💕💕💕💕💕💕", "💖💖💖💖💖💖", "💗💗💗💗💗💗"],
                    {"default": "💖💖💖💖💖💖", "tooltip": "选择一个日志标识，以便于使用多个节点时做区分。"},
                ),
            },
        }

    # 1. 核心设置：移除所有输出端口
    RETURN_TYPES = () 
    RETURN_NAMES = ()
    
    FUNCTION = "display_info"
    CATEGORY = "🌟SK节点库/工具"
    # 2. 保持 OUTPUT_NODE = True，确保每次循环都强制执行并刷新日志
    OUTPUT_NODE = True 

    # 辅助方法：将单个输入项转换为文本 (简化版，仅用于日志)
    def _format_item_to_log_text(self, item):
        """将单个输入项转换为可显示的字符串。"""
        if item is None:
            return 'None'
        elif isinstance(item, (str, int, float, bool)):
            return str(item)
        elif hasattr(item, "shape"):
            # 适用于 PyTorch Tensor 或类似对象
            shape = getattr(item, "shape", "unknown")
            dtype = getattr(item, "dtype", "unknown")
            return f"Tensor(Shape={shape}, Dtype={dtype})"
        
        try:
            # 尝试用 JSON 格式化输出复杂结构 (如字典、列表)
            return json.dumps(item, ensure_ascii=False, indent=2) 
        except Exception:
            try:
                return str(item)
            except Exception:
                return f'数据存在，但无法序列化: {type(item)}'


    def display_info(self, 输入数据, 日志标识):
        
        timestamp = datetime.datetime.now().strftime("[%H:%M:%S.%f]")[:-3] 
        prefix = str(日志标识).strip() if 日志标识 else "--- 未指定日志标识 ---"
        
        # 1. 构造用于日志的格式化文本
        formatted_content = self._format_item_to_log_text(输入数据)
        
        # 2. 构造日志显示内容 (保留多行和原始类型信息)
        log_display_lines = [
            f">>原始类型: {type(输入数据)}",
            f">>格式化内容: {formatted_content}"
        ]
        log_content = "\n".join(log_display_lines)

        # 3. 打印到服务器日志 (使用 flush=True 强制刷新)
        # 【核心】：使用 flush=True 确保每次循环实时输出。
        print(f"\n⬇️ {prefix} [SK LIBS LOG] Start ({timestamp}) >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>", file=sys.stderr, flush=True)
        # print(f"[{timestamp}][SK LIBS LOG] 节点执行开始", file=sys.stderr, flush=True)
        print(f"{log_content}", file=sys.stderr, flush=True)
        # print(f"[{timestamp}][SK LIBS LOG] 节点执行结束", file=sys.stderr, flush=True)
        print(f"⬆️ {prefix} [SK LIBS LOG] End ({timestamp}) <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<", file=sys.stderr, flush=True)
        
        # 4. 【核心修复】：返回空字典或空元组。彻底移除 {"ui":...} 避免创建文本框。
        # 终端节点必须返回空字典 {} 或空元组 ()
        return {} 

    # 移除 IS_CHANGED 辅助方法，使用默认行为，除非有特殊强制执行需求

NODE_CLASS_MAPPINGS = {"信息展示": InfoDisplayNode}
NODE_DISPLAY_NAME_MAPPINGS = {"信息展示": "📓日志输出终端 (logs)"}