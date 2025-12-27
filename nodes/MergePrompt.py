class MergePrompt:
    @classmethod
    def INPUT_TYPES(s):
        optional_inputs = {f"提示词_{i}": ("STRING", {"forceInput": True}) for i in range(3, 21)}
        return {
            "required": {
                "提示词_1": ("STRING", {"forceInput": True}),
                "提示词_2": ("STRING", {"forceInput": True}),
            },
            "optional": {
                **optional_inputs,
                "提示词接入数量": ("INT", {"default": 2, "min": 2, "max": 20, "tooltip": "修改接入提示词的数量。使用时先修改数量，再点击底部的【修改提示词接入数量】。"}),
                
                # 预设分隔符下拉菜单
                "预设分隔符": (
                    ["逗号", "句号", "竖线", "换行"],
                    {"default": "竖线", "tooltip": "选择一个预设分隔符。若自定义分隔符不为空，则此选项被忽略。"},
                ),
                
                # 自定义分隔符输入框
                "自定义分隔符": ("STRING", {"default": "", "multiline": False, "tooltip": "输入自定义分隔符。若此项不为空，则使用此分隔符。"}),
                
                "移除换行符": ("BOOLEAN", {"default": False, "label_on": "是", "label_off": "否"}),
                "移除空行": ("BOOLEAN", {"default": False, "label_on": "是", "label_off": "否"}),
                
                # 选项名称：分隔符独立成段
                "分隔符独立成段": ("BOOLEAN", {"default": False, "label_on": "是", "label_off": "否", "tooltip": "如果勾选，合并后的每个【提示词输入框】片段将由换行符 + 分隔符 + 换行符连接。此时，输入框内部的分隔符将不会被用于拆分。如果分隔符本身是换行，则使用双换行符连接（\\n\\n）。"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("合并提示词",)
    FUNCTION = "merge"
    CATEGORY = "🌟SK节点库/提示词"

    def merge(
        self,
        提示词_1,
        提示词_2,
        提示词接入数量=2, 
        预设分隔符="竖线",
        自定义分隔符="", 
        移除换行符=False,
        移除空行=False,
        分隔符独立成段=False,
        **kwargs,
    ):
        # 1. 确定最终使用的分隔符 (sep)
        separator_map = {
            "逗号": ",",
            "句号": ".",
            "竖线": "|",
            "换行": "\n",
        }
        
        if 自定义分隔符:
            selected_sep = 自定义分隔符
        else:
            selected_sep = separator_map.get(预设分隔符, "|") 

        sep = selected_sep or "" 
        
        # 2. 预处理前两个提示词 (此处的预处理已过时，但保留以防万一)
        t1 = 提示词_1 or ""
        t2 = 提示词_2 or ""
        if 移除换行符:
            t1 = t1.replace("\r", "").replace("\n", " ")
            t2 = t2.replace("\r", "").replace("\n", " ")
        
        # 将 分隔符独立成段 标志传入 split_by，以控制是否进行内部拆分
        def split_by(value, is_independent_segment):
            items = value if isinstance(value, (list, tuple)) else [value]
            out = []
            for item in items:
                s = "" if item is None else str(item)
                
                # 统一换行符 (跨平台兼容性)
                s = s.replace("\r\n", "\n").replace("\r", "\n") 
                
                # 先移除空行（仅删除纯空白行，保留非空行）
                if 移除空行:
                    s = "\n".join([ln for ln in s.split("\n") if ln.strip()])
                
                # 再根据需求移除换行符 (转换为 ' ')
                if 移除换行符:
                    s = s.replace("\n", " ")

                # 核心修改逻辑：
                if is_independent_segment:
                    # 将整个输入视为一个 Token，但要对整个字符串进行首尾清理
                    s_stripped = s.strip() # <--- 关键修改：清理首尾空白
                    if s_stripped or not 移除空行:
                        out.append(s_stripped) # 追加清理后的字符串
                else:
                    # 默认逻辑：按分隔符进行拆分
                    parts = s.split(sep) if sep else s.split()
                    for p in parts:
                        p = p.strip() # 此处已进行每段的首尾清理
                        if p or not 移除空行:
                            out.append(p)
            return out

        # 3. 收集所有提示词片段，将 分隔符独立成段 标志传入
        tokens = []
        tokens.extend(split_by(t1, 分隔符独立成段))
        tokens.extend(split_by(t2, 分隔符独立成段))
        
        for i in range(3, 21):
            key = f"提示词_{i}"
            if key in kwargs:
                val = kwargs.get(key, "") or ""
                tokens.extend(split_by(val, 分隔符独立成段))

        if 移除空行:
            # 最终清理，移除任何空字符串
            tokens = [x for x in tokens if x.strip()]

        # 4. 执行合并 (根据 分隔符独立成段 调整连接符)
        if 分隔符独立成段: 
            if sep == "\n":
                 # 特殊情况：分隔符是换行，使用双换行符 (\n\n) 隔离段落
                 joiner = "\n\n"
            else:
                 # 否则，使用 换行 + 分隔符 + 换行 (\nsep\n)
                 joiner = "\n" + sep + "\n"
        else:
             # 默认行为：只使用分隔符本身
             joiner = sep or " " 
             
        result = joiner.join(tokens)
        
        return (result,)

NODE_CLASS_MAPPINGS = {"MergePrompt": MergePrompt}
NODE_DISPLAY_NAME_MAPPINGS = {"MergePrompt": "🖇️提示词合并"}