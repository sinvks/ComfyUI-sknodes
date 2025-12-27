import torch

# --- 创建一个永远等于任何类型的代理类 ---
class AlwaysEqualProxy(str):
    def __eq__(self, _):
        return True
    def __ne__(self, _):
        return False

# 定义通配符类型
ANY = AlwaysEqualProxy("*")

class SK_TypeDetector:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # 使用 ANY 代理，让它可以连接任何类型的输出端口
                "any_input": (ANY, {"forceInput": True}), 
            },
        }

    # 修改返回类型：第一个是原始数据(ANY)，第二个是检测报告(STRING)
    RETURN_TYPES = (ANY, "STRING")
    RETURN_NAMES = ("output", "report")
    FUNCTION = "detect_logic"
    CATEGORY = "🌟SK节点库/工具"
    OUTPUT_NODE = True 

    def detect_logic(self, any_input):
        result_str = ""
        
        # 1. 检测列表 (List)
        if isinstance(any_input, list):
            count = len(any_input)
            if count > 0:
                first_item = any_input[0]
                first_item_type = type(first_item).__name__
                result_str = f"【检测结果】: 列表 (List)\n"
                result_str += f"● 列表长度: {count}\n"
                result_str += f"● 元素类型: {first_item_type}"
                
                if isinstance(first_item, torch.Tensor):
                    result_str += f"\n● 元素维度(Shape): {list(first_item.shape)}"
            else:
                result_str = "【检测结果】: 空列表 (Empty List)"

        # 2. 检测张量 (Tensor)
        elif isinstance(any_input, torch.Tensor):
            shape = list(any_input.shape)
            result_str = f"【检测结果】: 张量 (Tensor)\n"
            result_str += f"● 维度形状: {shape}\n"
            result_str += f"● 数据类型: {any_input.dtype}\n"
            
            if len(shape) == 4:
                result_str += f"● 解析: 批大小={shape[0]}, 高={shape[1]}, 宽={shape[2]}, 通道={shape[3]}"
            elif len(shape) == 3:
                result_str += f"● 解析: 序列长度={shape[0]}, 隐层维度={shape[2]}"

        # 3. 其他基础类型
        else:
            result_str = f"【检测结果】: {type(any_input).__name__}\n"
            result_str += f"● 内容摘要: {str(any_input)[:150]}"

        print(f"\n[SK数据检测器]\n{result_str}\n")

        # 同时返回：(原始数据, 字符串报告)
        return {"ui": {"text": [result_str]}, "result": (any_input, result_str)}

NODE_CLASS_MAPPINGS = {
    "SK_TypeDetector": SK_TypeDetector
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SK_TypeDetector": "🔍数据类型检测器"
}