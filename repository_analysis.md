# Remove-AI-Watermarks 저장소 분석 보고서

이 보고서는 AI 이미지에 삽입된 **보이는 워터마크**, **메타데이터(C2PA, EXIF 등)**, 그리고 **보이지 않는 워터마크(SynthID 등)**를 탐지하고 제거하는 오픈소스 라이브러리인 `wiltodelta/remove-ai-watermarks`에 대한 기술 분석 및 파이썬 라이브러리 호출 가이드를 담고 있습니다.

---

## 📌 아키텍처 개요 및 설치 가이드

해당 저장소는 모듈식 설계로 구성되어 있으며, 무거운 딥러닝 종속성 없이 CPU만으로도 작동하는 **가벼운 엔진(보이는 워터마크 및 메타데이터 제거)**과 GPU 가속을 권장하는 **확산 모델 기반 엔진(보이지 않는 워터마크 제거)**으로 나뉩니다.

### 1. 설치 방법
사용 시나리오에 따라 필요한 패키지를 설치합니다.

*   **기본 기능 전용 (보이는 워터마크 + 메타데이터 제거)**
    ```bash
    pip install -e .
    ```
*   **전체 기능 적용 (보이지 않는 워터마크 제거 추가 - GPU 필요)**
    ```bash
    pip install -e ".[gpu]"
    ```
    *(최초 실행 시 약 2GB 크기의 디퓨전 모델 가중치가 자동 다운로드됩니다.)*

---

## 1️⃣ 보이는 워터마크 제거 (Gemini Sparkle 등)
Google Gemini(내부 코드명 Nano Banana) 등에서 생성된 이미지 우하단에 합성되는 반짝임(Sparkle) 형태의 로고를 무손실 수학적 역연산과 이미지 인페인팅을 활용하여 완벽하게 제거합니다.

### 🛠️ 작동 원리 및 알고리즘
1. **역 알파 블렌딩 (Reverse Alpha Blending)**
   보이는 워터마크는 원본 이미지 위에 알파 채널 합성을 통해 오버레이됩니다.
   $$\text{watermarked} = \alpha \times \text{logo} + (1 - \alpha) \times \text{original}$$
   이를 수학적으로 역산하여 완벽한 원본 픽셀을 복원합니다:
   $$\text{original} = \frac{\text{watermarked} - \alpha \times \text{logo}}{1 - \alpha}$$
   *   알파 맵($\alpha$)은 순수 검은색 배경에서 캡처한 Gemini의 반짝임 로고 에셋(`gemini_bg_48.png`, `gemini_bg_96.png`)을 분석하여 픽셀의 밝기 기준(`max(R, G, B) / 255.0`)으로 추출해 보유하고 있습니다.
   *   이미지 크기가 $1024 \times 1024$ 이하일 경우 48x48 픽셀 크기를, 이를 초과할 경우 96x96 픽셀 크기를 타겟으로 지정하여 픽셀 보간 처리를 유연하게 수행합니다.

2. **3단계 융합 NCC 탐지 엔진 (Snap Engine)**
   이미지가 크롭되거나 리사이즈된 경우에도 작동하도록 이미지 우하단 $256 \times 256$ 검색 영역 안에서 워터마크의 위치와 크기(스케일 범위 16~120)를 동적으로 스캔합니다.
   *   **1단계 (공간 NCC)**: `cv2.matchTemplate`을 이용해 템플릿 매칭을 수행하고 스케일별 가중치를 반영해 최적의 매칭 스코어를 획득합니다.
   *   **2단계 (그라디언트 NCC)**: Sobel 필터로 이미지와 알파 맵의 그라디언트 크기를 구해 엣지 방향과 형상의 일치 여부를 매칭합니다.
   *   **3단계 (분산 분석)**: 워터마크가 있을 법한 타겟 영역과 그 상단 기준 영역의 표준편차(StdDev) 분산을 비교하여 노이즈 대비 명도 분포의 이질성을 최종 검증합니다.
   *   **최종 판단**: 세 가지 스코어를 조합하여 최종 신뢰도 점수가 **0.35 이상**일 때만 연산을 수행합니다. (오탐 상태에서 억지로 제거를 시도할 경우 역블렌딩으로 인한 반전 역상 노이즈가 생기기 때문입니다.)

3. **잔여 엣지 아티팩트 인페인팅 (Inpainting Cleanup)**
   역 알파 블렌딩만으로는 부동소수점 및 보간 오차로 인해 워터마크 엣지 경계면에 하얗게 픽셀이 튀는 잔상이 남을 수 있습니다. 엔진은 알파 맵의 그래디언트를 역추적해 **엣지 경계선 마스크**를 생성하고, OpenCV의 `cv2.inpaint`(Fast Marching 방식 또는 Navier-Stokes 기반 `cv2.INPAINT_NS`)를 통해 주변 픽셀과 부드럽게 채워(Inpaint) 완성도를 높입니다.

### 🐍 Python API 호출 방법
```python
import cv2
from remove_ai_watermarks.gemini_engine import GeminiEngine

# 1. 보이는 워터마크 엔진 초기화 (템플릿 알파 맵 로드)
engine = GeminiEngine(logo_value=255.0)

# 2. 이미지 읽기
image = cv2.imread("watermarked.png")

# 3. 3단계 NCC 기반 워터마크 위치 및 크기 정밀 탐지
detection = engine.detect_watermark(image)

if detection.detected:
    print(f"🎯 Gemini 보이는 워터마크 감지 성공!")
    print(f"   - 신뢰도 (Confidence): {detection.confidence:.2%}")
    print(f"   - 영역 (X, Y, W, H): {detection.region}")
    
    # 4. 역 알파 블렌딩으로 1차 복원
    cleaned = engine.remove_watermark(image)
    
    # 5. 경계선 잔여 아티팩트 인페인팅(telea 또는 ns 방식)으로 2차 보정
    final_image = engine.inpaint_residual(
        cleaned,
        region=detection.region,
        strength=0.85,    # 보정 강도 (0.0 ~ 1.0)
        method="ns",      # "ns" (Navier-Stokes) 또는 "telea"
        inpaint_radius=10
    )
    
    # 결과 저장
    cv2.imwrite("clean_visible.png", final_image)
    print("✨ 보이는 워터마크가 완벽히 제거되었습니다.")
else:
    print("ℹ️ 보이는 워터마크가 검출되지 않았습니다. 이미지를 그대로 보존합니다.")
```

---

<h2>2️⃣ 메타데이터 제거 (C2PA, EXIF 등)</h2>
소셜 플랫폼(인스타그램, 페이스북, X 등)에서 자동으로 "Made with AI" 라벨을 부여하는 핵심 트리거인 메타데이터(크립토그래픽 출처 인증 Manifest, 특정 EXIF 플래그 등)를 이미지 재인코딩(화질 저하) 없이 원본 픽셀 수준에서 도려냅니다.

### 🛠️ 작동 원리 및 알고리즘
1. **IPTC AI 마커 및 EXIF 식별**:
   *   인스타그램 등에서 주로 감지하는 `trainedAlgorithmicMedia`, `compositeSynthetic`, `algorithmicMedia`와 같은 IPTC `digitalSourceType` 메타데이터 값을 타겟팅합니다.
   *   Stable Diffusion 파라미터(`parameters`, `workflow`, `comfyui`), Midjourney 고유 프롬프트 정보, 소프트웨어 정보 및 XMP 블록 내의 AI 흔적을 탐색합니다.
2. **이진 스캔 (Binary Scan) 우회 감지**:
   *   Pillow 등 표준 이미지 라이브러리가 파싱하지 못하는 최신 포맷(AVIF, HEIF, JPEG-XL 등)을 지원하기 위해 파일 원시 데이터의 헤더 영역을 바이트 단위로 직접 훑어 C2PA UUID(`d8fec3d61b0e483c92975828877ec481`)나 IPTC 마커 바이너리를 빠르게 식별합니다.
3. **무손실 컨테이너 단의 C2PA 박스 제거 (ISOBMFF 무손실 편집)**:
   *   **AVIF, HEIF, HEIC, JPEG-XL** 등 컨테이너 기반 포맷은 이미지를 다시 읽어 재인코딩(Decompress & Compress)할 경우 압축률 하락 및 화질 손실이 일어납니다.
   *   본 라이브러리는 컨테이너의 바이트 스트림을 해석하여 최상위 수준의 `uuid` 박스 및 JUMBF(`jumb`) 데이터 박스 레이어만 정확히 분해해서 통째로 도려내고 연결하는 `strip_c2pa_boxes` 함수를 구현하여, **단 1픽셀의 화질 변화도 없는 무손실 메타데이터 완전 소거**를 보장합니다.
   *   **PNG, JPEG**는 Pillow와 `piexif`를 사용해 표준 메타데이터(Author, Copyright, Title, DPI 정보 등)는 그대로 보존하고, AI 생성 파라미터가 담긴 청크만 걸러내어 저장합니다.

### 🐍 Python API 호출 방법
```python
from pathlib import Path
from remove_ai_watermarks.metadata import has_ai_metadata, get_ai_metadata, remove_ai_metadata

source_img = Path("ai_generated.png")
clean_img = Path("clean_metadata.png")

# 1. AI 메타데이터 존재 여부 신속 스캔 (바이너리 + 파일 정보 결합)
if has_ai_metadata(source_img):
    print("⚠️ AI 관련 흔적/메타데이터가 검출되었습니다.")
    
    # 2. 포함된 AI 메타데이터 정보 요약 분석 (프롬프트, C2PA Manifest 바이트 크기 등)
    ai_details = get_ai_metadata(source_img)
    for key, val in ai_details.items():
        print(f"   [감지] {key}: {val}")
        
    # 3. AI 메타데이터 제거 실행
    # keep_standard=True 옵션으로 원본의 기본 창작자, 저작권, 해상도(DPI) 정보는 무사히 보존합니다.
    remove_ai_metadata(
        source_path=source_img,
        output_path=clean_img,
        keep_standard=True
    )
    print("✅ C2PA 출처 인증 및 'Made with AI' 메타데이터 제거 완료.")
else:
    print("💚 깨끗한 이미지입니다. AI 메타데이터가 발견되지 않았습니다.")
```

---

<h2>3️⃣ 보이지 않는 워터마크 제거 (SynthID 등)</h2>
디지털 픽셀이나 특정 주파수 도메인에 숨겨진 보이지 않는 워터마크(Google SynthID v1/v2, Meta StableSignature, TreeRing 등)를 인간의 눈에 띄지 않는 아주 미세한 수준의 확산 공정으로 안전하게 파괴합니다.

### 🛠️ 작동 원리 및 알고리즘
1. **디퓨전 모델 기반 재생성 공격 (Diffusion-based Regeneration)**
   *   ICLR 2025 학계 최신 논문인 *"Image Watermarks Are Removable Using Controllable Regeneration from Clean Noise"* 기법을 실무 수준으로 구현했습니다.
   *   **작동 방식**: 이미지를 잠재 공간(Latent Space)으로 인코딩한 뒤, 워터마크 신호가 교란될 정도의 매우 약한 순방향 노이즈(`strength=0.04 ~ 0.05` 수준)를 주입합니다. 그 후 디퓨전 모델의 역방향 디노이즈 프로세스(Reverse Diffusion, 기본 50 steps)를 거치며 노이즈를 걷어냄으로써, 이미지 고유의 형태는 완벽히 유지하면서 주파수 신호 영역에 몰래 숨겨져 있던 워터마크 패턴만 산산조각 내어 제거합니다.
   *   **SDXL Base 1.0 기본 채택**: 기존에 널리 쓰이던 SD-1.5 파이프라인(768px 해상도)은 구글의 최신 **SynthID v2** 패턴을 완벽히 지우지 못하고 잔상이 살아남는 한계가 발견되었습니다. 이에 따라 본 라이브러리는 네이티브 1024px 학습 모델인 `stabilityai/stable-diffusion-xl-base-1.0`을 디폴트 파이프라인으로 구축하여 SynthID v2를 깔끔하게 해제하는 압도적인 Robustness를 입증했습니다. (추가로 `yepengliu/ctrlregen` 옵션도 지원합니다.)

2. **YOLO 기반 얼굴 변형 보호막 (Smart Face Protection)**
   확산 공정(Diffusion)을 아주 얕게 수행하더라도 인물 사진의 경우 눈동자 방향이 돌아가거나 얼굴 이목구비가 미세하게 일그러지는 치명적인 왜곡이 발생할 수 있습니다.
   *   이를 위해 이미지 전처리 시 **YOLOv8** 모델을 돌려 인물 영역(Person)을 정확하게 탐지하여 해당 안면 좌표의 원본 픽셀 컷을 미리 보존해 둡니다.
   *   디퓨전 작업이 완전히 완료된 직후, 미리 보존해 둔 얼굴 원본에 **부드러운 타원형 경계선 마스크(GaussianBlur 처리)**를 입혀 외곽선이 티 나지 않게 자연스럽고 seamless하게 덮어써 복구시킴으로써 인물 퀄리티를 유지합니다.

3. **아날로그 휴머니자이저 (Analog Humanizer)**
   디지털 이미지 완벽성(AI 특유의 인위적인 매끄러움)을 식별해 내는 최첨단 AI 이미지 분류기(DeepFake Detector 등)를 무력화하는 보정 필터 모듈입니다.
   *   **색수차(Chromatic Aberration) 주입**: 렌즈 엣지에서 파장이 엇갈려 빨간색과 파란색이 미세하게 번지는 효과를 구현하기 위해 R 채널을 왼쪽으로, B 채널을 오른쪽으로 강제로 shift(롤링)시킵니다.
   *   **필름 그레인(Film Grain)**: 입자 노이즈(Gaussian Noise)를 미세하게 입혀 최신 고해상도 카메라로 촬영한 실물 이미지와 구분이 불가능하게 변조합니다.

### 🐍 Python API 호출 방법
```python
from pathlib import Path
from remove_ai_watermarks.invisible_engine import InvisibleEngine

# 1. 보이지 않는 워터마크 전용 확산 엔진 초기화
# 자동으로 가속 칩셋(NVIDIA CUDA > Apple MPS > CPU)을 자동 탐지하여 배치합니다.
# private 가중치 획득에 토큰이 필요한 경우 hf_token을 명시합니다.
engine = InvisibleEngine(
    pipeline="default",  # SDXL base 모델 파이프라인
    device="cuda",       # 가속 칩셋 강제 지정 (또는 None 시 자동 할당)
    hf_token=None
)

# 2. 엔진 내 가중치 사전 로드 (모델 메모리 선점 및 다운로드 진행률 가시화)
engine.preload()

# 3. 재생성 제거 실행
# - strength: 노이즈 크기 (0.04 ~ 0.05 가 이미지 왜곡 없이 SynthID v2를 파괴하는 최적 임계치)
# - protect_faces: YOLO를 사용해 사람의 얼굴 일그러짐을 막고 원래 얼굴 보존
# - humanize: 아날로그 질감 가우시안 그레인 주입 강도 (0.0 시 해제)
clean_result_path = engine.remove_watermark(
    image_path=Path("synthid_watermarked.png"),
    output_path=Path("fully_cleaned.png"),
    strength=0.05,
    num_inference_steps=50,
    protect_faces=True,
    humanize=4.0
)

print(f"🎉 SynthID가 소거된 깨끗한 이미지가 최종 생성되었습니다: {clean_result_path}")
```

---

## 🚀 세 가지 기술의 통합 파이썬 사용 가이드

모든 기능을 한 번에 프로그램 안에서 실행하여 보이는 워터마크 검출/제거 $\rightarrow$ 디퓨전 기반 보이지 않는 워터마크 파괴 $\rightarrow$ 무손실 메타데이터 청소까지 연결하는 최종 통합 워크플로우 코드입니다.

```python
import cv2
from pathlib import Path
from remove_ai_watermarks.gemini_engine import GeminiEngine
from remove_ai_watermarks.invisible_engine import InvisibleEngine
from remove_ai_watermarks.metadata import has_ai_metadata, remove_ai_metadata

def remove_all_watermarks_pipeline(input_path: str, output_path: str):
    input_p = Path(input_path)
    output_p = Path(output_path)
    
    # [Step 1] 보이는 워터마크 (Gemini Sparkle 등) 1차 제거
    print("Step 1. 보이는 워터마크 역 알파 블렌딩 제거 시작...")
    src_cv = cv2.imread(str(input_p))
    visible_engine = GeminiEngine()
    
    detection = visible_engine.detect_watermark(src_cv)
    if detection.detected:
        print(f" -> 보이는 워터마크 발견 (신뢰도: {detection.confidence:.1%})")
        src_cv = visible_engine.remove_watermark(src_cv)
        src_cv = visible_engine.inpaint_residual(src_cv, region=detection.region, strength=0.85)
    else:
        print(" -> 보이는 워터마크 발견 안 됨. 패스합니다.")
    
    # 1차 복원 임시 저장
    temp_path = output_p.with_name(f"temp_stage1_{output_p.name}")
    cv2.imwrite(str(temp_path), src_cv)

    # [Step 2] 보이지 않는 워터마크 (SynthID 등) 2차 제거
    print("\nStep 2. 보이지 않는 워터마크 확산공정 파괴 시작 (GPU 가속 권장)...")
    try:
        invisible_engine = InvisibleEngine(pipeline="default")
        invisible_engine.preload()
        
        invisible_engine.remove_watermark(
            image_path=temp_path,
            output_path=output_p,
            strength=0.05,
            num_inference_steps=50,
            protect_faces=True,
            humanize=3.0
        )
    except Exception as e:
        print(f" -> [!] 보이지 않는 워터마크 처리 중 에러 발생: {e}")
        print(" -> 확산 모델 제거 단계를 우회하고 1단계 결과를 최종본으로 전달합니다.")
        if temp_path.exists():
            temp_path.rename(output_p)
            
    # 임시 파일 삭제
    if temp_path.exists():
        temp_path.unlink()

    # [Step 3] 남아있는 C2PA, EXIF 등 AI 메타데이터 3차 영구 박멸
    print("\nStep 3. AI 관련 메타데이터 최종 소거 시작...")
    if has_ai_metadata(output_p):
        remove_ai_metadata(output_p, output_p, keep_standard=True)
        print(" -> 메타데이터 세척 완수.")
    else:
        print(" -> 깨끗한 상태의 파일 메타데이터 확인.")
        
    print(f"\n✨ 종합 필터링 완료! 저장 경로: {output_p.absolute()}")

# 실행 테스트 코드
if __name__ == "__main__":
    remove_all_watermarks_pipeline("test_watermarked.png", "perfect_cleaned.png")
```

---

## ⚖️ 법적 및 기술적 한계 요약 (Threat Model)

*   **서버측 영구 기록 보존성**: 
    Google SynthID-Image v2는 고유한 136비트 페이로드를 임베딩합니다. 이미지 사본에서 본 라이브러리를 통해 워터마크 픽셀 신호를 파괴하더라도, 해당 이미지를 맨 처음 Gemini 웹 앱이나 API를 통해 생성했던 당시 계정의 생성 기록 및 구글 측 서버 로그(Server-side Record)까지 지워지는 것은 아닙니다.
*   **법규 준수**:
    EU 인공지능법(AI Act), 미국 COPIED Act 등 인공지능 기원 증명을 지우는 행위에 대한 사법적 규제가 본격화되고 있습니다. 따라서 악의적인 기만(Deception) 목적이 아닌, 순수 개인정보 보호, 보안 강건성 분석 연구, 오탐 라벨 오버레이 방지 목적 등 적법한 범위 내에서만 사용해야 합니다.
