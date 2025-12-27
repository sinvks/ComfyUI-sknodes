import torch
import numpy as np
import json
import base64
import io
import os
from PIL import Image, ImageDraw, ImageFont
import folder_paths

class InteractiveAnnotationTool:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))] if os.path.exists(input_dir) else []
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "points_data": ("STRING", {"default": "[]", "multiline": True}),
                "doodle_data": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "MASK", "IMAGE", "IMAGE")
    RETURN_NAMES = ("json_points", "image", "mask", "image_doodle", "image_points")
    FUNCTION = "process"
    CATEGORY = "🌟SK节点库/工具"

    def process(self, image, points_data, doodle_data):
        if not image:
            empty_img = torch.zeros((1, 512, 512, 3))
            empty_mask = torch.zeros((1, 512, 512))
            return ("[]", empty_img, empty_mask, empty_img, empty_img)

        image_path = folder_paths.get_annotated_filepath(image)
        base_pil = Image.open(image_path).convert("RGB")
        w, h = base_pil.size

        # 处理标注点数据
        try:
            raw_pts = json.loads(points_data)
            # 简化输出到 json_points 端口
            clean_pts_for_output = [{"x": p['x'], "y": p['y']} for p in raw_pts]
            output_json = json.dumps(clean_pts_for_output)
        except:
            raw_pts = []
            output_json = "[]"

        combined_img = base_pil.copy()
        img_with_doodle = base_pil.copy()
        img_with_points = base_pil.copy()
        mask_pil = Image.new("L", (w, h), 0)

        # 处理涂鸦数据
        if doodle_data and doodle_data.startswith("data:image"):
            try:
                header, encoded = doodle_data.split(",", 1)
                doodle_bytes = base64.b64decode(encoded)
                doodle_layer = Image.open(io.BytesIO(doodle_bytes)).convert("RGBA")
                if doodle_layer.size == (w, h):
                    combined_img.paste(doodle_layer, (0, 0), doodle_layer)
                    img_with_doodle.paste(doodle_layer, (0, 0), doodle_layer)
                    mask_pil = doodle_layer.split()[3]
            except Exception as e:
                print(f"Doodle error: {e}")

        # 绘图标注点函数
        r = max(int(min(w, h) * 0.015), 10)
        def draw_pts(canvas):
            d = ImageDraw.Draw(canvas)
            for idx, pt in enumerate(raw_pts):
                px, py = pt['x'], pt['y']
                if not (0 <= px <= w and 0 <= py <= h): continue
                c = pt.get('color', '#FF6600').lstrip('#')
                rgb = tuple(int(c[i:i+2], 16) for i in (0, 2, 4))
                # 绘制外边框和中心点
                d.ellipse([px-r-2, py-r-2, px+r+2, py+r+2], fill=(255, 255, 255))
                d.ellipse([px-r, py-r, px+r, py+r], fill=rgb)
                try:
                    font = ImageFont.truetype("arial.ttf", int(r * 1.2))
                    d.text((px, py), str(idx+1), fill=(0, 0, 0), font=font, anchor="mm")
                except: pass

        draw_pts(combined_img)
        draw_pts(img_with_points)

        # 转换为 ComfyUI Tensor
        def t(img): return torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None,]
        
        return (
            output_json, 
            t(combined_img), 
            torch.from_numpy(np.array(mask_pil).astype(np.float32) / 255.0)[None,], 
            t(img_with_doodle), 
            t(img_with_points)
        )

NODE_CLASS_MAPPINGS = {"InteractiveAnnotationTool": InteractiveAnnotationTool}
NODE_DISPLAY_NAME_MAPPINGS = {"InteractiveAnnotationTool": "🖌️交互式标注/涂鸦工具"}