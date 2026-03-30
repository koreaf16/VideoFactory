"""
@module 이미지 품질 평가 서비스
@description 선명도, 얼굴 크기, 얼굴 유사도를 종합해 품질 점수를 산출한다.

+-----------+     +-------------+     +-------------+
| 이미지    | --> | 선명도 측정 | --> | quality_    |
| (파일)    |     | 얼굴 감지   |     | score 0~1   |
|           |     | 유사도 비교 |     |             |
+-----------+     +-------------+     +-------------+

@dependencies face_recognition, numpy, Pillow
@license MIT + Boost (상업적 자유)
"""

import logging
from pathlib import Path

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

_face_recognition = None


def _get_fr():
    global _face_recognition
    if _face_recognition is None:
        import face_recognition
        _face_recognition = face_recognition
        logger.info("face_recognition (dlib) 로드 완료")
    return _face_recognition


def _compute_sharpness(image_array: np.ndarray) -> float:
    """라플라시안 분산으로 선명도를 계산한다 (0.0~1.0).

    값이 높을수록 선명한 이미지. variance=500 기준으로 정규화.
    """
    gray = np.mean(image_array, axis=2).astype(np.float32)

    # 라플라시안 커널 수동 적용 (OpenCV 없이)
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    from numpy.lib.stride_tricks import sliding_window_view
    windows = sliding_window_view(gray, (3, 3))
    laplacian = (windows * kernel).sum(axis=(-2, -1))
    variance = float(laplacian.var())

    # variance 500 이상이면 충분히 선명
    return min(1.0, variance / 500.0)


def _compute_face_size_score(
    face_location: tuple,
    img_w: int,
    img_h: int,
) -> float:
    """얼굴 크기 비율로 구도 점수를 계산한다 (0.0~1.0).

    적정 범위(2%~30%)에서 최고점, 너무 작거나 너무 크면 감점.
    """
    top, right, bottom, left = face_location
    face_area = (right - left) * (bottom - top)
    img_area = img_w * img_h
    ratio = face_area / img_area

    if ratio < 0.02:
        return ratio / 0.02 * 0.3
    elif ratio > 0.5:
        return max(0.3, 1.0 - ratio)
    else:
        # 0.02~0.3 구간을 0.3~1.0으로 선형 매핑
        return 0.3 + (min(ratio, 0.3) / 0.3) * 0.7


def score_image(
    image_path: str,
    reference_embedding: list[float] | None = None,
) -> dict:
    """이미지 품질을 평가해 점수와 세부 항목을 반환한다.

    Args:
        image_path: 평가할 이미지 파일 경로
        reference_embedding: 참조 얼굴 임베딩 (128d). 없으면 유사도 미계산.

    Returns:
        {quality_score, face_detected, details}

    Raises:
        FileNotFoundError: 이미지 파일이 없을 때
    """
    fr = _get_fr()
    path = Path(image_path)

    if not path.exists():
        raise FileNotFoundError(f"이미지 파일 없음: {image_path}")

    pil_image = Image.open(path).convert("RGB")
    image_array = np.array(pil_image)
    img_h, img_w = image_array.shape[:2]

    sharpness = _compute_sharpness(image_array)

    face_locations = fr.face_locations(image_array)
    face_detected = len(face_locations) > 0

    face_size_score = 0.0
    similarity_score = None

    if face_detected:
        face_size_score = _compute_face_size_score(face_locations[0], img_w, img_h)

        if reference_embedding is not None:
            face_encodings = fr.face_encodings(image_array, [face_locations[0]])
            if face_encodings:
                ref_vec = np.array(reference_embedding)
                face_vec = face_encodings[0]
                distance = float(np.linalg.norm(ref_vec - face_vec))
                # 거리 0.6 → 유사도 0.0, 거리 0.0 → 유사도 1.0
                similarity_score = max(0.0, 1.0 - distance / 0.6)

    # 최종 점수: 가중 합산
    if not face_detected:
        quality_score = sharpness * 0.4
    elif similarity_score is not None:
        quality_score = sharpness * 0.4 + face_size_score * 0.3 + similarity_score * 0.3
    else:
        quality_score = sharpness * 0.5 + face_size_score * 0.5

    quality_score = round(min(1.0, max(0.0, quality_score)), 4)

    details: dict[str, float] = {
        "sharpness": round(sharpness, 4),
        "face_size": round(face_size_score, 4),
    }
    if similarity_score is not None:
        details["similarity"] = round(similarity_score, 4)

    logger.info(
        "품질 평가 완료: path=%s score=%.4f face=%s details=%s",
        image_path, quality_score, face_detected, details,
    )

    return {
        "quality_score": quality_score,
        "face_detected": face_detected,
        "details": details,
    }
