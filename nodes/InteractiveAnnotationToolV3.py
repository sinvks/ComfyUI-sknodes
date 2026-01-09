import torch
import numpy as np
import json
import base64
import io
import os
import time
import cv2
from PIL import Image
import folder_paths
from server import PromptServer
from aiohttp import web

# 全局内存缓存：{ image_path: numpy_array_bgr }
SK_V3_IMAGE_CACHE = {}

class InteractiveAnnotationToolV3:
    @classmethod
    def INPUT_TYPES(s):
        input_dir = folder_paths.get_input_directory()
        files = []
        if os.path.exists(input_dir):
            for root, dirs, filenames in os.walk(input_dir):
                for f in filenames:
                    if os.path.isfile(os.path.join(root, f)):
                        rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                        rel_path = rel_path.replace("\\", "/")
                        files.append(rel_path)
        
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "points_data": ("STRING", {"default": "[]"}),
                "mask_data": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("images", "mask", "image_doodle", "image_points", "json_points")
    FUNCTION = "process"
    CATEGORY = "🌟SK节点库/工具"

    def process(self, image, points_data, mask_data):
        if not image:
            empty_img = torch.zeros((1, 512, 512, 3))
            empty_mask = torch.zeros((1, 512, 512))
            return (empty_img, empty_mask, empty_img, empty_img, "[]")

        image_path = folder_paths.get_annotated_filepath(image)
        
        # 1. 优先从缓存读取 OpenCV 格式 (BGR)
        if image_path in SK_V3_IMAGE_CACHE:
            base_bgr = SK_V3_IMAGE_CACHE[image_path]
        else:
            # OpenCV 读取速度快于 PIL
            try:
                base_bgr = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
                if base_bgr is None: raise Exception("OpenCV read failed")
                SK_V3_IMAGE_CACHE[image_path] = base_bgr
            except:
                # 降级到 PIL 读取
                pil_img = Image.open(image_path).convert("RGB")
                base_bgr = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
                SK_V3_IMAGE_CACHE[image_path] = base_bgr

        h, w = base_bgr.shape[:2]
        base_rgb = cv2.cvtColor(base_bgr, cv2.COLOR_BGR2RGB)

        # 2. 准备涂鸦层 (OpenCV RGBA)
        doodle_rgba = np.zeros((h, w, 4), dtype=np.uint8)
        
        if mask_data and "," in mask_data:
            try:
                encoded = mask_data.split(",")[1]
                m_bytes = base64.b64decode(encoded)
                # 使用 OpenCV 解码 PNG 数据
                m_arr = cv2.imdecode(np.frombuffer(m_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
                
                if m_arr is not None:
                    if m_arr.shape[:2] != (h, w):
                        m_arr = cv2.resize(m_arr, (w, h), interpolation=cv2.INTER_LINEAR)
                    
                    # 确保是 4 通道
                    if len(m_arr.shape) == 2: # 灰度转 RGBA
                        m_arr = cv2.cvtColor(m_arr, cv2.COLOR_GRAY2RGBA)
                    elif m_arr.shape[2] == 3: # RGB 转 RGBA
                        m_arr = cv2.cvtColor(m_arr, cv2.COLOR_RGB2RGBA)
                    
                    doodle_rgba = m_arr
            except Exception as e:
                print(f"SK-Nodes-V3 Error: Mask decode failure: {e}")

        # 3. OpenCV 高速绘制函数
        def draw_points_cv2(img_rgb, pts_list):
            if not pts_list: return img_rgb
            
            # 转换为 BGR 进行绘制，最后转回 RGB
            canvas = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
            
            r = max(int(min(w, h) * 0.015), 10)
            font_scale = r * 0.04
            thickness = max(int(r * 0.15), 1)
            
            for i, pt in enumerate(pts_list):
                try:
                    px, py = int(float(pt['x'])), int(float(pt['y']))
                    # 绘制底圆 (BGR: 蓝色通道在最后，红色在前 -> 这里我们要红色)
                    # 实际上 OpenCV 默认 BGR，所以红色是 (0, 0, 255)
                    cv2.circle(canvas, (px, py), r, (0, 0, 255), -1) 
                    cv2.circle(canvas, (px, py), r, (255, 255, 255), thickness)
                    
                    text = str(i+1)
                    (fw, fh), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
                    tx = int(px - fw / 2)
                    ty = int(py + fh / 2)
                    cv2.putText(canvas, text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
                except: pass
            
            return cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)

        try:
            pts = json.loads(points_data)
        except:
            pts = []

        # --- 合成输出 1: images (原图 + 涂鸦 + 标注点) ---
        # 优化 Alpha Blend 性能
        def overlay_rgba(bg_rgb, fg_rgba):
            # 分离通道并归一化 alpha
            alpha = (fg_rgba[:, :, 3] / 255.0)[:, :, np.newaxis]
            # 矢量化合成：(fg * alpha) + (bg * (1 - alpha))
            result = (fg_rgba[:, :, :3] * alpha + bg_rgb * (1 - alpha)).astype(np.uint8)
            return result

        img_doodle_rgb = overlay_rgba(base_rgb, doodle_rgba)
        img_all_rgb = draw_points_cv2(img_doodle_rgb, pts)

        # --- 输出 2: mask ---
        mask_arr = doodle_rgba[:, :, 3].astype(np.float32) / 255.0
        mask_tensor = torch.from_numpy(mask_arr)[None,]

        # --- 合成输出 4: image_points (仅原图 + 点) ---
        img_points_rgb = draw_points_cv2(base_rgb, pts)

        # --- 转换为 Tensor ---
        def np_to_tensor(np_img):
            return torch.from_numpy(np_img.astype(np.float32) / 255.0)[None,]

        return (
            np_to_tensor(img_all_rgb),
            mask_tensor,
            np_to_tensor(img_doodle_rgb),
            np_to_tensor(img_points_rgb),
            json.dumps(pts)
        )

    @classmethod
    def IS_CHANGED(s, image, points_data, mask_data):
        import hashlib
        m = hashlib.sha256()
        m.update(image.encode())
        m.update(points_data.encode())
        m.update(mask_data.encode())
        return m.hexdigest()

# API 路由注册
@PromptServer.instance.routes.post("/api/sk-marks/save_v3")
async def save_v3_marks(request):
    try:
        data = await request.json()
        image_name = data.get("image")
        points = data.get("points", [])
        mask_data = data.get("mask_data", "")
        
        image_path = folder_paths.get_annotated_filepath(image_name)
        if not os.path.exists(image_path):
            return web.Response(status=404, text="Image not found")
        
        # 1. 优先使用缓存 (BGR 格式)
        if image_path in SK_V3_IMAGE_CACHE:
            base_bgr = SK_V3_IMAGE_CACHE[image_path]
        else:
            base_bgr = cv2.imdecode(np.fromfile(image_path, dtype=np.uint8), cv2.IMREAD_COLOR)
            SK_V3_IMAGE_CACHE[image_path] = base_bgr
            
        h, w = base_bgr.shape[:2]
        
        # 2. 涂鸦合成 (Alpha Blend) - 保持在 BGR 空间处理以加快速度
        final_bgr = base_bgr.copy()
        
        if mask_data and "," in mask_data:
            encoded = mask_data.split(",")[1]
            m_bytes = base64.b64decode(encoded)
            m_arr = cv2.imdecode(np.frombuffer(m_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
            
            if m_arr is not None:
                if m_arr.shape[:2] != (h, w):
                    m_arr = cv2.resize(m_arr, (w, h))
                
                # 矢量化 Alpha 混合 (BGR 空间)
                alpha = (m_arr[:, :, 3] / 255.0)[:, :, np.newaxis]
                final_bgr = (m_arr[:, :, :3] * alpha + final_bgr * (1.0 - alpha)).astype(np.uint8)

        # 3. 绘制点位 (OpenCV 矢量化绘制)
        r = max(int(min(w, h) * 0.015), 10)
        font_scale = r * 0.04
        thickness = 2
        
        for i, pt in enumerate(points):
            try:
                px, py = int(float(pt['x'])), int(float(pt['y']))
                # BGR 颜色: 红 (0,0,255), 白 (255,255,255)
                cv2.circle(final_bgr, (px, py), r, (0, 0, 255), -1)
                cv2.circle(final_bgr, (px, py), r, (255, 255, 255), thickness)
                
                text = str(i+1)
                (fw, fh), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
                tx = int(px - fw / 2)
                ty = int(py + fh / 2)
                cv2.putText(final_bgr, text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
            except: pass

        # 4. 保存为 JPG (压缩质量 85)
        output_dir = folder_paths.get_temp_directory()
        # 使用 JPG 后缀
        filename = f"sk_v3_preview_{int(time.time())}.jpg"
        save_path = os.path.join(output_dir, filename)
        
        # cv2.imwrite 速度极快，且支持压缩参数
        cv2.imwrite(save_path, final_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        
        return web.json_response({
            "status": "success",
            "preview_name": filename
        })
    except Exception as e:
        print(f"SK-Nodes-V3 API Error: {e}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)

NODE_CLASS_MAPPINGS = {"InteractiveAnnotationToolV3": InteractiveAnnotationToolV3}
NODE_DISPLAY_NAME_MAPPINGS = {"InteractiveAnnotationToolV3": "🖌️交互式序号标注工具V3-alpha"}
