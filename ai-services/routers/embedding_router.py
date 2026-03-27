"""
@module 임베딩 라우터
@description 이미지/텍스트 임베딩 + 얼굴 유사도 비교 엔드포인트.

+-----------------+     +------------------+
| POST /face      | --> | face_recognition |
| POST /face/     |     | (dlib, 128d)     |
|   compare       |     |                  |
| POST /image     | --> | CLIP (미구현)    |
| POST /text      | --> | MiniLM (미구현)  |
+-----------------+     +------------------+

@dependencies fastapi, face_embedder
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from models.embedding_models import (
    FaceCompareRequest,
    FaceCompareResponse,
    ImageEmbeddingRequest,
    TextEmbeddingRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/face")
async def embed_face(request: ImageEmbeddingRequest) -> JSONResponse:
    """얼굴 임베딩 추출 (128d, dlib 기반)."""
    from services.embedding.face_embedder import extract_face_embedding

    embedding = extract_face_embedding(request.image_path)
    if embedding is None:
        return JSONResponse(
            status_code=404,
            content={"detail": "얼굴을 검출할 수 없습니다"},
        )

    return JSONResponse(content={
        "embedding": embedding,
        "dimension": len(embedding),
    })


@router.post("/face/compare")
async def compare_faces(request: FaceCompareRequest) -> FaceCompareResponse:
    """앵커 이미지 기준으로 여러 이미지의 얼굴 유사도를 비교한다."""
    from services.embedding.face_embedder import compare_faces as do_compare

    results = do_compare(
        anchor_path=request.anchor_path,
        image_paths=request.image_paths,
        threshold=request.threshold,
    )

    similar_count = sum(1 for r in results if r["similar"])

    return FaceCompareResponse(
        results=results,
        similar_count=similar_count,
        total_count=len(results),
    )


@router.post("/image", status_code=501)
async def embed_image(request: ImageEmbeddingRequest) -> JSONResponse:
    """이미지 임베딩 생성 (미구현)."""
    logger.info("Image embedding requested: %s", request.image_path)
    return JSONResponse(
        status_code=501,
        content={"detail": "Image embedding not implemented yet"},
    )


@router.post("/text", status_code=501)
async def embed_text(request: TextEmbeddingRequest) -> JSONResponse:
    """텍스트 임베딩 생성 (미구현)."""
    logger.info("Text embedding requested")
    return JSONResponse(
        status_code=501,
        content={"detail": "Text embedding not implemented yet"},
    )
