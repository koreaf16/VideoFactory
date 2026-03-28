/**
 * lora.js - LoRA 데이터셋 / 학습 페이지 공용 유틸리티
 *
 * lora-dataset.ejs, lora-training.ejs 에서 공유하는 헬퍼 함수 모음.
 */

// ── SSE Helper ───────────────────────────────────────────

/**
 * EventSource(SSE) 연결을 생성하고 메시지를 처리한다.
 * 완료/실패 시 자동으로 연결을 닫는다.
 *
 * @param {string} url - SSE 엔드포인트 URL
 * @param {function(object): void} onMessage - 메시지 수신 콜백
 * @param {function(object?): void} [onDone] - 연결 종료 시 콜백
 * @returns {EventSource} 생성된 EventSource 인스턴스
 */
function connectSSE(url, onMessage, onDone) {
  var source = new EventSource(url);

  source.onmessage = function (event) {
    try {
      var data = JSON.parse(event.data);
      onMessage(data);

      if (
        data.status === 'ready' ||
        data.status === 'completed' ||
        data.status === 'done' ||
        data.status === 'failed'
      ) {
        source.close();
        if (onDone) onDone(data);
      }
    } catch (e) {
      // JSON 파싱 실패 무시
    }
  };

  source.onerror = function () {
    source.close();
    if (onDone) onDone(null);
  };

  return source;
}

// ── API Helper ───────────────────────────────────────────

/**
 * JSON API 호출을 수행한다. (LoRA 전용 래퍼)
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method - HTTP 메서드
 * @param {string} path - API 경로
 * @param {object} [body] - 요청 본문 (POST/PUT 시)
 * @returns {Promise<object>} 응답 JSON
 */
async function loraApi(method, path, body) {
  var opts = {
    method: method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  var res = await fetch(path, opts);
  if (!res.ok) {
    var errData;
    try { errData = await res.json(); } catch (e) { errData = {}; }
    throw new Error(errData.error || errData.message || 'API Error ' + res.status);
  }
  return res.json();
}

// ── Caption Editing Helper ───────────────────────────────

/**
 * 캡션 텍스트를 서버에 저장한다.
 *
 * @param {string} charId - 캐릭터 ID
 * @param {string} datasetId - 데이터셋 ID
 * @param {string} imageId - 이미지 ID
 * @param {string} caption - 캡션 텍스트
 * @returns {Promise<object>} 응답 JSON
 */
async function saveCaption(charId, datasetId, imageId, caption) {
  return loraApi('PUT', '/api/characters/' + charId + '/lora/dataset/' + datasetId + '/caption', {
    imageId: imageId,
    caption: caption,
  });
}

// ── File Size Formatter ──────────────────────────────────

/**
 * 바이트 수를 사람이 읽기 쉬운 형식으로 변환한다.
 *
 * @param {number} bytes - 바이트 수
 * @returns {string} 포맷된 문자열 (예: "2.3 MB")
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = 0;
  var size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

// ── Duration Formatter ───────────────────────────────────

/**
 * 초 단위 시간을 mm:ss 또는 hh:mm:ss 형식으로 변환한다.
 *
 * @param {number} seconds - 초 단위 시간
 * @returns {string} 포맷된 시간 문자열
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '-';
  var s = Math.floor(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;

  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };

  if (h > 0) {
    return h + ':' + pad(m) + ':' + pad(sec);
  }
  return m + ':' + pad(sec);
}
