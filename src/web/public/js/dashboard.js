/**
 * 대시보드 — 시스템 상태 확인
 */

async function checkSystemStatus() {
  await checkEndpoint('/api/health/comfyui', 'comfyui');
  await checkEndpoint('/api/health/python', 'python');
  await checkEndpoint('/api/health/oracle', 'oracle');
}

async function checkEndpoint(url, key) {
  var indicator = document.getElementById(key + '-indicator');
  var statusEl = document.getElementById(key + '-status');
  var detailEl = document.getElementById(key + '-detail');
  if (!indicator || !statusEl) return;

  try {
    var res = await fetch(url);
    var data = await res.json();

    if (res.ok && data.connected) {
      indicator.className = 'w-2 h-2 rounded-full bg-green-500';
      statusEl.textContent = '연결됨';
      if (detailEl) detailEl.textContent = data.detail || '정상';
    } else {
      indicator.className = 'w-2 h-2 rounded-full bg-red-500';
      statusEl.textContent = '오류';
      if (detailEl) detailEl.textContent = data.detail || '응답 이상';
    }
  } catch (_err) {
    indicator.className = 'w-2 h-2 rounded-full bg-red-500';
    statusEl.textContent = '연결 실패';
    if (detailEl) detailEl.textContent = '서버에 연결할 수 없습니다';
  }
}

checkSystemStatus();
setInterval(checkSystemStatus, 30000);
