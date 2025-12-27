class RecommendFrameSetter:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "总帧数": ("INT", {"min": 1, "default": 100, "tooltip": "Multi/InfiniteTalk Wav2vec2 Embeds -> num_frames"}),
            },
            "optional": {
                "窗口帧数_MIN": ("INT", {"default": 61, "min": 5, "max": 200, "step": 4, "tooltip": "WanVideo Long I2V Multi/InfiniteTalk -> frame_window_size(Min，4N+1)"}),
                "窗口帧数_MAX": ("INT", {"default": 81, "min": 5, "max": 401, "step": 4, "tooltip": "WanVideo Long I2V Multi/InfiniteTalk -> frame_window_size(Max，4N+1)"}),
                "窗口数量_MIN": ("INT", {"default": 2, "min": 1, "max": 100, "tooltip": ""}),
                "窗口数量_MAX": ("INT", {"default": 5, "min": 1, "max": 100, "tooltip": ""}),
                "重叠帧数": ("INT", {"default": 9, "min": 9, "max": 25, "tooltip": "WanVideo Long I2V Multi/InfiniteTalk -> motion_frame"}),
                
                "帧处理方式": (
                    ["减少", "增加"], 
                    {"default": "减少", "tooltip": "当总帧数无法被窗口配置完美整除时，选择是倾向于减少最终帧数还是允许增加一个窗口循环。"}
                ),
            },
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("窗口帧数", "窗口数", "重叠帧数", "修订总帧数", "调整信息")
    FUNCTION = "recommend"
    CATEGORY = "🌟SK节点库/视频"

    def recommend(
        self,
        总帧数,
        窗口帧数_MIN=61,
        窗口帧数_MAX=81,
        窗口数量_MIN=2,
        窗口数量_MAX=5,
        重叠帧数=9,
        帧处理方式="减少", 
    ):
        T = int(总帧数 or 0)
        min_w_input = int(窗口帧数_MIN)
        max_w_input = int(窗口帧数_MAX)
        min_n = int(窗口数量_MIN)
        max_n = int(窗口数量_MAX)
        o = int(重叠帧数)
        
        log_info = "⚠️【窗口帧数】对应【WanVideo Long I2V Multi/InfiniteTalk】节点的frame_window_size\n⚠️【重叠帧数】对应【WanVideo Long I2V Multi/InfiniteTalk】节点的motion_frame\n⚠️【修订总帧数】可用于【ImageFromBatch】节点截取有效图片\n⚠️建议先查看【调整信息】输出的信息以便调整\n\n"

        # =========================================================
        # 1. 强制 4N+1 校验逻辑
        # =========================================================
        def to_4n_plus_1(val, direction="round"):
            # 如果已经是 4n+1 则不处理
            if (val - 1) % 4 == 0:
                return val
            if direction == "up":
                return ((val - 1) // 4 + 1) * 4 + 1
            elif direction == "down":
                return ((val - 1) // 4) * 4 + 1
            else:
                return round((val - 1) / 4) * 4 + 1

        min_w = to_4n_plus_1(min_w_input, "up")
        max_w = to_4n_plus_1(max_w_input, "down")

        if min_w != min_w_input:
            log_info += f"⚙️ 窗口帧数_MIN 已从 {min_w_input} 自动修正为 {min_w} (需符合4N+1)。\n"
        if max_w != max_w_input:
            log_info += f"⚙️ 窗口帧数_MAX 已从 {max_w_input} 自动修正为 {max_w} (需符合4N+1)。\n"

        # 规范化范围
        if min_w > max_w:
            max_w = min_w
            log_info += f"⚠️ 警告: 修正后的 MIN 超过了 MAX，已强制设置 MAX={max_w}。\n"
        
        if min_n > max_n:
            min_n, max_n = max_n, min_n
            log_info += f"⚠️ 警告: 窗口数量_MIN > 窗口数量_MAX, 已互换。\n"
        
        if T <= 0:
            return (0, 0, o, 0, "❌ 错误: 总帧数必须大于 0。")

        if o >= max_w:
            o = max_w // 2 
            if o < 1: o = 1
            log_info += f"⚠️ 警告: 重叠帧数({重叠帧数})过大, 已调整为 {o}。\n"
        
        # =========================================================
        # 2. 迭代搜索最优解 (确保 W 始终为 4N+1)
        # =========================================================
        best_decrease = None  
        best_increase = None  
        
        best_diff_decrease = float('inf') 
        best_diff_increase = float('inf') 

        for n in range(min_n, max_n + 1):
            
            # --- R <= T 的计算 ---
            # 计算理论允许的最大窗口帧数
            w_allow_decrease = (T + o * (n - 1)) // n
            # 找到小于等于 w_allow_decrease 的最大 4n+1
            w_dec_candidate = to_4n_plus_1(w_allow_decrease, "down")
            
            if w_dec_candidate >= min_w:
                w_dec = min(w_dec_candidate, max_w)
                R_dec = w_dec * n - o * (n - 1)
                diff = T - R_dec
                if diff >= 0 and diff < best_diff_decrease:
                    best_diff_decrease = diff
                    best_decrease = (w_dec, n, o, R_dec)

            # --- R > T 的计算 ---
            # 找到大于 w_allow_decrease 的最小 4n+1
            w_inc_candidate = to_4n_plus_1(w_allow_decrease + 1, "up")
            w_inc = max(w_inc_candidate, min_w)
            
            if w_inc <= max_w:
                R_inc = w_inc * n - o * (n - 1)
                if R_inc > T:
                    diff = R_inc - T
                    if diff < best_diff_increase:
                        best_diff_increase = diff
                        best_increase = (w_inc, n, o, R_inc)

        # =========================================================
        # 3. 根据 "帧处理方式" 选择最终结果
        # =========================================================
        best = None
        
        if 帧处理方式 == "减少":
            best = best_decrease
            if best is None:
                # 强制使用 min_w (符合4n+1)
                best = (min_w, min_n, o, min_w * min_n - o * (min_n - 1))
                info = log_info + f"❌ 无法满足 R<=T。强制推荐: N={best[1]}, W={best[0]} (R={best[3]} > T={T})。"
            else:
                info = log_info + f"✅ 推荐参数(4N+1): 窗口数={best[1]}, 窗口帧数={best[0]}。\n✨ 修订总帧数={best[3]}，较目标减少 {T - best[3]} 帧。"
        
        else: # 增加
            best = best_increase
            if best is None:
                best = best_decrease
                if best is not None:
                    info = log_info + f"⚠️ 找不到 R>T 的解。已回退到 R<=T 的最优解 (相差 {T - best[3]} 帧)。"
                else:
                    best = (min_w, min_n, o, min_w * min_n - o * (min_n - 1))
                    info = log_info + f"❌ 无法找到任何有效解。强制推荐: N={best[1]}, W={best[0]}。"
            else:
                info = log_info + f"✅ 推荐参数(4N+1): 窗口数={best[1]}, 窗口帧数={best[0]}。\n✨ 原始计算 R={best[3]}，较目标增加 {best[3] - T} 帧。"
        
        # =========================================================
        # 4. 修订和返回
        # =========================================================
        W, N, O, R_calc = best
        final_R = R_calc
        
        if 帧处理方式 == "增加" and R_calc > T:
             final_R = T
             info += f"\n\n❗ **提示：** 模式为'增加'且计算值 {R_calc} > {T}，**修订总帧数**已锁定为输入值 {T}。"

        return (W, N, O, final_R, info)

NODE_CLASS_MAPPINGS = {"RecommendFrameSetter": RecommendFrameSetter}
NODE_DISPLAY_NAME_MAPPINGS = {"RecommendFrameSetter": "🧮Multi/InfiniteTalk帧数计算器"}