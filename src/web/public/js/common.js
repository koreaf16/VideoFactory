/**
 * 공통 유틸리티 — API 호출, 토스트 알림, 날짜 포맷
 */

// ── API fetch 래퍼 ──────────────────────────────────────────

/**
 * JSON API 호출을 수행한다.
 * @param {string} url - API 경로 (예: '/api/characters')
 * @param {RequestInit} options - fetch 옵션
 * @returns {Promise<object>} 응답 JSON
 */
async function fetchApi(url, options) {
  var defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  var merged = Object.assign({}, defaults, options || {});

  try {
    var response = await fetch(url, merged);
    var data = await response.json();

    if (!response.ok) {
      showToast(data.message || 'API 오류가 발생했습니다.', 'error');
      throw new Error(data.message || 'API Error ' + response.status);
    }

    return data;
  } catch (err) {
    if (err.name !== 'Error') {
      showToast('네트워크 오류가 발생했습니다.', 'error');
    }
    throw err;
  }
}

// ── 토스트 알림 ─────────────────────────────────────────────

/**
 * 화면 우측 상단에 토스트 메시지를 표시한다.
 * @param {string} message - 표시할 메시지
 * @param {'info'|'success'|'error'} type - 토스트 유형
 */
function showToast(message, type) {
  var toastType = type || 'info';
  var container = document.querySelector('.toast-container');

  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'toast toast-' + toastType;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(function () {
      toast.remove();
    }, 300);
  }, 3000);
}

// ── 날짜 포맷 ───────────────────────────────────────────────

/**
 * 타임스탬프를 한국어 날짜 형식으로 변환한다.
 * @param {string|number} timestamp - ISO 문자열 또는 Unix 타임스탬프
 * @returns {string} 포맷된 날짜 문자열
 */
function formatDate(timestamp) {
  var date = new Date(timestamp);
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
