import os

class SK_TagFileSaver_Ultimate:
    def __init__(self):
        self.counter = 0

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "文本输入": ("STRING", {"forceInput": True}),
                "存放路径": ("STRING", {"default": "请输入图片所在的文件夹绝对路径", "tooltip": "文本文件需要保存在图片所在目录"}),
                "是否添加触发词": (["是", "否"], {"default": "否", "tooltip": "如果选择【是】，请在下方输入触发词，触发词将添加在文本之前"}),
                "触发词": ("STRING", {"multiline": False, "default": "", "tooltip": "【是否添加触发词】选择【是】，此处才生效"}),
                "追加标签": ("STRING", {"multiline": True, "default": "", "placeholder": "此处可输入额外追加的后缀标签"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("日志",)
    FUNCTION = "save_tags_adaptive"
    CATEGORY = "🌟SK节点库/工具"
    OUTPUT_NODE = True

    def save_tags_adaptive(self, 文本输入, 存放路径, 是否添加触发词, 触发词, 追加标签):
        full_path = os.path.abspath(存放路径)
        if not os.path.isdir(full_path):
            return (f"❌ 路径不存在: {full_path}",)

        # 重点：必须使用与 1 号节点完全一致的过滤和排序逻辑
        # 1. 只读取图片扩展名
        exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
        # 2. 强制使用字符排序 (sorted 默认即是)，确保 1 后面是 10
        img_files = sorted([f for f in os.listdir(full_path) if f.lower().endswith(exts)])
        
        if not img_files:
            return ("⚠️ 文件夹内无图片",)

        # 识别模式 (Llama 列表模式 或 循环字符串模式)
        if isinstance(文本输入, list):
            text_items = 文本输入
            is_loop_mode = False
        else:
            text_items = [文本输入]
            is_loop_mode = True

        results = []

        for i, raw_content in enumerate(text_items):
            actual_idx = self.counter if is_loop_mode else i
            
            # 索引保护：防止图片数量少于文本条数
            if actual_idx >= len(img_files):
                break

            content = str(raw_content).strip()
            if 是否添加触发词 == "是" and 触发词.strip():
                content = f"{触发词.strip()}, {content}"
            if 追加标签.strip():
                content = f"{content}, {追加标签.strip()}"

            # 关键：按排序后的索引取出对应的图片文件名，确保 1-1 对应
            target_img = img_files[actual_idx]
            file_name = os.path.splitext(target_img)[0] + ".txt"
            file_path = os.path.join(full_path, file_name)

            try:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(content)
                results.append(f"✅ {file_name}")
            except Exception as e:
                results.append(f"❌ {file_name}: {str(e)}")

            if is_loop_mode:
                self.counter += 1
                if self.counter >= len(img_files):
                    self.counter = 0

        if not is_loop_mode:
            self.counter = 0

        return ("\n".join(results),)

NODE_CLASS_MAPPINGS = { "SK_TagFileSaver_Ultimate": SK_TagFileSaver_Ultimate }
NODE_DISPLAY_NAME_MAPPINGS = { "SK_TagFileSaver_Ultimate": "🗃️打标文件保存(兼容小助手&llama)" }