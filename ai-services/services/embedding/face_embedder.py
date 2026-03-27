"""
@module 얼굴 임베딩 서비스
@description face_recognition(dlib) 기반 얼굴 벡터 추출 및 유사도 비교.

+-----------+     +----------------+     +-----------+
| 이미지    | --> | face_recognition| --> | 128d 벡터 |
| (파일)    |     | (dlib)         |     | (numpy)   |
+-----------+     +----------------+     +-----------+

@dependencies face_recognition, numpy
@license MIT + Boost (상업적 자유)
"""

import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# 지연 로딩 — 첫 호출 시 import
_face_recognition = None


def _get_fr():
    global _face_recognition
    if _face_recognition is None:
        import face_recognition
        _face_recognition = face_recognition
        logger.info("face_recognition (dlib) 로드 완료")
    return _face_recognition


def extract_face_embedding(image_path: str) -> list[float] | None:
    """이미지에서 얼굴 임베딩(128d)을 추출한다.

    Args:
        image_path: 이미지 파일 경로

    Returns:
        128차원 float 리스트, 얼굴 미검출 시 None
    """
    fr = _get_fr()
    path = Path(image_path)

    if not path.exists():
        logger.warning("이미지 파일 없음: %s", image_path)
        return None

    image = fr.load_image_file(str(path))
    encodings = fr.face_encodings(image)

    if not encodings:
        logger.warning("얼굴 미검출: %s", image_path)
        return None

    # 첫 번째 얼굴 사용
    return encodings[0].tolist()


def compare_faces(
    anchor_path: str,
    image_paths: list[str],
    threshold: float = 0.4,
) -> list[dict]:
    """앵커 이미지와 여러 이미지의 얼굴 유사도를 비교한다.

    Args:
        anchor_path: 앵커(기준) 이미지 경로
        image_paths: 비교 대상 이미지 경로 리스트
        threshold: 유사 판정 거리 기준 (작을수록 엄격, 기본 0.4)

    Returns:
        [{path, distance, similar, has_face}] 리스트 (distance 오름차순 정렬)
    """
    fr = _get_fr()

    # 앵커 얼굴 임베딩 추출
    anchor_embedding = extract_face_embedding(anchor_path)
    if anchor_embedding is None:
        logger.error("앵커 이미지에서 얼굴 미검출: %s", anchor_path)
        return []

    anchor_vec = np.array(anchor_embedding)
    results = []

    for img_path in image_paths:
        embedding = extract_face_embedding(img_path)

        if embedding is None:
            results.append({
                "path": img_path,
                "distance": 999.0,
                "similar": False,
                "has_face": False,
            })
            continue

        img_vec = np.array(embedding)
        distance = float(np.linalg.norm(anchor_vec - img_vec))

        results.append({
            "path": img_path,
            "distance": round(distance, 4),
            "similar": distance <= threshold,
            "has_face": True,
        })

    # 거리 오름차순 정렬
    results.sort(key=lambda x: x["distance"])

    similar_count = sum(1 for r in results if r["similar"])
    logger.info(
        "얼굴 비교 완료: %d장 중 %d장 유사 (threshold=%.2f)",
        len(image_paths), similar_count, threshold,
    )

    return results
