import os
import sys
import uuid
import logging
import shutil
from pathlib import Path
import traceback
import cv2
import numpy as np

# remove-ai-watermarks 패키지 경로를 파이썬 경로 맨 앞에 추가
BASE_DIR = Path(__file__).parent.resolve()
SRC_PATH = BASE_DIR / "remove-ai-watermarks-src" / "src"
if SRC_PATH.exists() and str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("remove_watermark_web")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Watermark Remover")

# CORS 활성화
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 정적 디렉터리 구성
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
RESULT_DIR = BASE_DIR / "static" / "results"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)

# 정적 파일 및 템플릿 마운트
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

# 라이브러리 로드 확인
try:
    from remove_ai_watermarks.gemini_engine import GeminiEngine
    from remove_ai_watermarks.metadata import remove_ai_metadata, has_ai_metadata, get_ai_metadata
    from remove_ai_watermarks.invisible_engine import InvisibleEngine, is_available as is_invisible_available
    IMPORTS_OK = True
except ImportError as e:
    logger.error(f"라이브러리 임포트 실패: {e}")
    IMPORTS_OK = False


@app.get("/")
async def get_index():
    index_path = BASE_DIR / "templates" / "index.html"
    if index_path.exists():
        return HTMLResponse(content=index_path.read_text(encoding="utf-8"))
    return HTMLResponse("<h2>템플릿을 생성 중입니다. 잠시만 기다려 주세요...</h2>")


@app.post("/process")
async def process_image(
    file: UploadFile = File(...),
    remove_visible: bool = Form(False),
    remove_metadata: bool = Form(False),
    remove_invisible: bool = Form(False),
    visible_strength: float = Form(0.85),
    invisible_strength: float = Form(0.04),
    protect_faces: bool = Form(True),
    humanize: float = Form(0.0)
):
    if not IMPORTS_OK:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": "필수 파이썬 라이브러리를 임포트할 수 없습니다. 가상환경 종속성을 확인하세요."
            }
        )

    # 1. 파일 저장
    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix.lower() or ".png"
    if ext not in [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".avif"]:
        raise HTTPException(status_code=400, detail="지원되지 않는 이미지 포맷입니다.")

    input_path = UPLOAD_DIR / f"{file_id}_input{ext}"
    output_path = RESULT_DIR / f"{file_id}_output{ext}"
    
    try:
        content = await file.read()
        input_path.write_bytes(content)
    except Exception as e:
        logger.error(f"파일 저장 중 에러: {e}")
        raise HTTPException(status_code=500, detail="업로드 파일을 저장하는 데 실패했습니다.")

    logs = []
    logs.append(f"📥 이미지 업로드 완료: {file.filename} ({len(content) // 1024} KB)")

    # AI 메타데이터 사전 검사
    try:
        has_meta = has_ai_metadata(input_path)
        meta_dict = get_ai_metadata(input_path) if has_meta else {}
        if has_meta:
            logs.append(f"🔍 AI 메타데이터 검출됨: {list(meta_dict.keys())}")
        else:
            logs.append("🔍 특이한 AI 메타데이터가 발견되지 않았습니다.")
    except Exception as e:
        logger.warn(f"메타데이터 검사 오류: {e}")
        has_meta = False

    current_image_path = input_path

    # --- PHASE 1: 보이는 워터마크(Gemini Sparkle 등) 제거 ---
    if remove_visible:
        logs.append("✨ [단계 1] 보이는 워터마크(Gemini Sparkle 등) 제거 탐지 중...")
        try:
            # OpenCV 이미지 로드
            img = cv2.imread(str(current_image_path), cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("OpenCV로 이미지를 읽을 수 없습니다.")

            engine = GeminiEngine()
            detection = engine.detect_watermark(img)
            
            if detection.detected:
                logs.append(f"🎯 워터마크 감지 성공! (신뢰도: {detection.confidence:.2f}, 위치: {detection.region})")
                # 역 알파 블렌딩 적용
                cleaned_img = engine.remove_watermark(img)
                # 잔류 아티팩트 인페인팅 적용
                if visible_strength > 0:
                    logs.append(f"🩹 인페인팅 정화 적용 중 (강도: {visible_strength})...")
                    cleaned_img = engine.inpaint_residual(
                        cleaned_img, 
                        detection.region, 
                        strength=visible_strength,
                        method="ns"
                    )
                
                # 임시 파일로 저장하여 다음 단계로 전달
                temp_output = RESULT_DIR / f"{file_id}_step1{ext}"
                cv2.imwrite(str(temp_output), cleaned_img)
                current_image_path = temp_output
                logs.append("✅ 보이는 워터마크 제거가 완료되었습니다.")
            else:
                logs.append("ℹ️ 우측 하단에서 눈에 띄는 Gemini Sparkle 워터마크가 감지되지 않았습니다. (제거 스킵)")
        except Exception as e:
            logs.append(f"❌ 보이는 워터마크 제거 중 실패: {str(e)}")
            logger.error(traceback.format_exc())

    # --- PHASE 2: 보이지 않는 워터마크(SynthID 등) 제거 ---
    if remove_invisible:
        logs.append("🌀 [단계 2] 보이지 않는 워터마크(SynthID, StableSignature) 제거 시작...")
        if not is_invisible_available():
            logs.append("⚠️ 보이지 않는 워터마크 제거 라이브러리(diffusers, torch 등)가 현재 시스템에 설치되지 않았습니다. [CPU/GPU 가속 세팅 필요]")
            logs.append("ℹ️ SynthID 제거를 건너뜁니다. (종속성 부족)")
        else:
            try:
                logs.append("⏳ SDXL 확산 모델(Stability AI XL) 및 잠재 공간 노이즈 재구성을 시작합니다...")
                logs.append("💡 [안내] 딥러닝 제거는 시스템 환경(GPU 유무)에 따라 최대 수십 초 이상 소요될 수 있습니다.")
                
                engine = InvisibleEngine(device="auto")
                
                temp_output = RESULT_DIR / f"{file_id}_step2{ext}"
                engine.remove_watermark(
                    image_path=current_image_path,
                    output_path=temp_output,
                    strength=invisible_strength,
                    num_inference_steps=50,
                    protect_faces=protect_faces,
                    humanize=humanize
                )
                current_image_path = temp_output
                logs.append("✅ 보이지 않는 워터마크(SynthID 등) 재확산 소거가 성공적으로 수행되었습니다.")
                if protect_faces:
                    logs.append("👤 인물 보호(YOLOv8 + Soft Blending)를 통해 눈, 코, 입 등의 중요 이목구비 영역을 자연스럽게 복원했습니다.")
                if humanize > 0:
                    logs.append(f"🎞️ 아날로그 휴머니자이저(그레인 강도: {humanize})를 추가하여 미세한 질감을 합성했습니다.")
            except Exception as e:
                logs.append(f"❌ 보이지 않는 워터마크 제거 실패: {str(e)}")
                logger.error(traceback.format_exc())

    # --- PHASE 3: 메타데이터(C2PA, EXIF 등) 소거 ---
    if remove_metadata:
        logs.append("🏷️ [단계 3] AI 메타데이터(C2PA Provenance, IPTC AI-Markers) 소거 중...")
        try:
            temp_output = RESULT_DIR / f"{file_id}_step3{ext}"
            remove_ai_metadata(
                source_path=current_image_path,
                output_path=temp_output,
                keep_standard=True
            )
            current_image_path = temp_output
            logs.append("✅ EXIF AI 태그, PNG chunk 파라미터 및 C2PA 출처 선언 제거 완료.")
        except Exception as e:
            logs.append(f"❌ 메타데이터 소거 중 실패: {str(e)}")
            logger.error(traceback.format_exc())

    # 최종 결과물 이동 및 임시 파일 정리
    try:
        if current_image_path != output_path:
            if current_image_path.exists():
                shutil.move(str(current_image_path), str(output_path))
            else:
                shutil.copy(str(input_path), str(output_path))
        
        # 중간 파일 제거
        for step_file in RESULT_DIR.glob(f"{file_id}_step*"):
            try:
                step_file.unlink()
            except Exception:
                pass
    except Exception as e:
        logger.error(f"결과 파일 정리 중 실패: {e}")

    logs.append("🎉 모든 처리 절차가 완료되었습니다! 깨끗한 오리지널 이미지를 다운로드받으세요.")
    
    # 웹 접근용 상대 경로
    input_url = f"/static/uploads/{input_path.name}"
    output_url = f"/static/results/{output_path.name}"

    return {
        "success": True,
        "input_url": input_url,
        "output_url": output_url,
        "logs": logs
    }


if __name__ == "__main__":
    import uvicorn
    import shutil
    
    # 필요한 폴더 생성
    (BASE_DIR / "templates").mkdir(exist_ok=True)
    (BASE_DIR / "static" / "css").mkdir(exist_ok=True)
    (BASE_DIR / "static" / "js").mkdir(exist_ok=True)

    logger.info("Starting Dev Server on http://localhost:8000")
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
