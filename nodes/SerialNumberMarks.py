import torch
import numpy as np
import json
import os
from PIL import Image, ImageDraw, ImageFont
import folder_paths

class SerialNumberMarks:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "points_data": ("STRING", {"default": "[]", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("json_points", "image")
    FUNCTION = "process"
    CATEGORY = "🌟SK节点库/工具"

    def process(self, image, points_data):
        try:
            pts = json.loads(points_data)
        except:
            pts = []
            
        if not image:
            return (json.dumps(pts), torch.zeros((1, 512, 512, 3)))
            
        image_path = folder_paths.get_annotated_filepath(image)
        img = Image.open(image_path).convert("RGB")
        w, h = img.size
        draw = ImageDraw.Draw(img)
        
        base_size = min(w, h)
        r = int(base_size * 0.035) 
        font_size = int(base_size * 0.05) 

        try:
            font = ImageFont.truetype("arialbd.ttf", font_size)
        except:
            font = ImageFont.load_default()

        for idx, pt in enumerate(pts):
            px, py = pt['x'], pt['y']
            # 绘制红底序号圆圈
            draw.ellipse([px-r, py-r, px+r, py+r], fill=(255, 0, 0), outline=(255, 255, 255), width=int(r*0.15))
            # 绘制序号
            draw.text((px, py), str(idx + 1), fill=(255, 255, 255), font=font, anchor="mm")

        out_tensor = np.array(img).astype(np.float32) / 255.0
        return (json.dumps(pts, indent=2), torch.from_numpy(out_tensor).unsqueeze(0))

NODE_CLASS_MAPPINGS = {"SerialNumberMarks": SerialNumberMarks}
NODE_DISPLAY_NAME_MAPPINGS = {"SerialNumberMarks": "🌟交互式序号标注工具"}