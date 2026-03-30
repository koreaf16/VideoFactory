# ComfyUI ControlNet + IP-Adapter 설치 가이드

## 개요

장소 하이브리드 파이프라인에서 사용하는 ControlNet + IP-Adapter 환경을 ComfyUI 서버에 설치한다.

## 1. 커스텀 노드 설치

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Fannovel16/comfyui_controlnet_aux
git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus
pip install -r comfyui_controlnet_aux/requirements.txt
pip install -r ComfyUI_IPAdapter_plus/requirements.txt
```

## 2. 모델 다운로드

### ControlNet Union (FLUX용)

```bash
# models/controlnet/
# InstantX FLUX.1-dev ControlNet Union
# 파일명: instantx-flux-controlnet-union.safetensors
```

다운로드 위치: `ComfyUI/models/controlnet/`

### IP-Adapter (FLUX용)

```bash
# models/ipadapter/
# InstantX FLUX.1-dev IP-Adapter
# 파일명: ip-adapter_flux.safetensors
```

다운로드 위치: `ComfyUI/models/ipadapter/`

### CLIP Vision

```bash
# models/clip_vision/
# OpenAI CLIP ViT-L/14
# 파일명: clip-vit-large-patch14.safetensors
```

다운로드 위치: `ComfyUI/models/clip_vision/`

## 3. 검증

ComfyUI 재시작 후 로그에서 확인:
- `ControlNetLoader` 노드 사용 가능
- `IPAdapterAdvanced` 노드 사용 가능
- `CLIPVisionLoader` 노드 사용 가능

## 4. 리스크 대응

FLUX + ControlNet Union + IP-Adapter 3중 조합이 불안정한 경우:

| 우선순위 | 전략 | 설명 |
|---------|------|------|
| 1순위 | FLUX + ControlNet + IP-Adapter | 스펙 그대로 |
| 2순위 | FLUX + ControlNet만 | IP-Adapter 제외, 동일 시드로 스타일 통일 |
| 3순위 | SDXL 전환 | 성숙한 ControlNet 생태계, 기존 FLUX와 불일치 |

워크플로우 빌더가 분리되어 있으므로 전환 비용 낮음.
