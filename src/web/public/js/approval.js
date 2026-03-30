/**
 * @module ApprovalMode
 * @description 파생 이미지 다중 선택 승인 모듈.
 *
 * 사용법:
 *   ApprovalMode.init(gridEl, { charId: 'soyul', onApproved: fn });
 *   ApprovalMode.destroy();
 */
(function (global) {
  var _grid = null;
  var _options = null;
  var _selected = new Set();
  var _floatingBar = null;
  var _observer = null;

  // ── 카드 체크박스 추가 ──────────────────────────────────────

  function addCheckbox(card) {
    if (!card.dataset.refId || card.dataset.refId === '' || card.querySelector('.approval-cb-wrap')) return;

    var wrap = document.createElement('div');
    wrap.className = 'approval-cb-wrap';
    wrap.style.cssText = 'position:absolute;top:6px;left:6px;z-index:10;pointer-events:auto;';

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'width:18px;height:18px;cursor:pointer;accent-color:#7c3aed;';

    cb.addEventListener('change', function (e) {
      e.stopPropagation();
      toggleSelect(card, cb.checked);
    });

    wrap.appendChild(cb);
    card.style.position = 'relative';
    card.insertBefore(wrap, card.firstChild);
  }

  // ── 그리드 클릭 인터셉터 (capture phase) ────────────────────

  function onGridClick(e) {
    var card = e.target.closest('[data-ref-id]');
    if (!card) return;
    if (e.target.closest('.approval-cb-wrap')) return;

    e.stopImmediatePropagation();
    e.preventDefault();

    var cb = card.querySelector('.approval-cb-wrap input');
    if (cb) {
      cb.checked = !cb.checked;
      toggleSelect(card, cb.checked);
    }
  }

  // ── 선택 토글 ───────────────────────────────────────────────

  function toggleSelect(card, selected) {
    var refId = Number(card.dataset.refId);
    if (!refId) return;

    if (selected) {
      _selected.add(refId);
      card.style.outline = '2px solid #7c3aed';
      card.style.outlineOffset = '-2px';
    } else {
      _selected.delete(refId);
      card.style.outline = '';
    }
    updateFloatingBar();
  }

  // ── 플로팅 액션 바 ──────────────────────────────────────────

  function createFloatingBar() {
    var bar = document.createElement('div');
    bar.id = 'approval-floating-bar';
    bar.style.cssText =
      'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
      'background:#1b1b1d;border:1px solid #353437;border-radius:12px;' +
      'padding:12px 20px;display:none;align-items:center;gap:12px;' +
      'z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:nowrap;';

    var countEl = document.createElement('span');
    countEl.id = 'approval-bar-count';
    countEl.style.cssText = 'color:#ccc3d8;font-size:14px;';
    countEl.textContent = '0장 선택됨';

    function makeBtn(label, bg, fg) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText =
        'background:' + bg + ';color:' + fg + ';border:none;border-radius:8px;' +
        'padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;';
      return btn;
    }

    var approveBtn = makeBtn('승인', '#7c3aed', '#fff');
    var unapproveBtn = makeBtn('승인 취소', '#353437', '#e5e1e4');
    var clearBtn = makeBtn('선택 해제', 'transparent', '#ccc3d8');
    clearBtn.style.fontWeight = '400';

    approveBtn.addEventListener('click', function () { submitApproval(true); });
    unapproveBtn.addEventListener('click', function () { submitApproval(false); });
    clearBtn.addEventListener('click', clearSelection);

    bar.appendChild(countEl);
    bar.appendChild(approveBtn);
    bar.appendChild(unapproveBtn);
    bar.appendChild(clearBtn);
    return bar;
  }

  function updateFloatingBar() {
    if (!_floatingBar) return;
    var count = _selected.size;
    document.getElementById('approval-bar-count').textContent = count + '장 선택됨';
    _floatingBar.style.display = count > 0 ? 'flex' : 'none';
  }

  function clearSelection() {
    _selected.clear();
    if (_grid) {
      _grid.querySelectorAll('[data-ref-id]').forEach(function (card) {
        card.style.outline = '';
        var cb = card.querySelector('.approval-cb-wrap input');
        if (cb) cb.checked = false;
      });
    }
    updateFloatingBar();
  }

  // ── API 호출 ────────────────────────────────────────────────

  function submitApproval(approved) {
    var refIds = Array.from(_selected);
    if (refIds.length === 0) return;

    fetch('/api/characters/' + encodeURIComponent(_options.charId) + '/ref-images/approve-batch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refIds: refIds, approved: approved }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.success) {
          if (typeof showToast === 'function') {
            showToast((approved ? '승인' : '승인 취소') + ' 완료: ' + data.updated + '장', 'success');
          }
          if (_options.onApproved) _options.onApproved(Array.from(_selected), approved);
          clearSelection();
        } else {
          if (typeof showToast === 'function') showToast('승인 실패: ' + (data.error || '오류'), 'error');
        }
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('승인 실패: ' + err.message, 'error');
      });
  }

  function selectAll() {
    if (!_grid) return;
    _grid.querySelectorAll('[data-ref-id]').forEach(function (card) {
      var refId = Number(card.dataset.refId);
      if (refId) {
        _selected.add(refId);
        card.style.outline = '2px solid #7c3aed';
        card.style.outlineOffset = '-2px';
        var cb = card.querySelector('.approval-cb-wrap input');
        if (cb) cb.checked = true;
      }
    });
    updateFloatingBar();
  }

  // ── 공개 API ────────────────────────────────────────────────

  function init(gridEl, options) {
    if (_grid) destroy();

    _grid = gridEl;
    _options = options;
    _selected = new Set();

    _floatingBar = createFloatingBar();
    document.body.appendChild(_floatingBar);

    gridEl.querySelectorAll('[data-ref-id]').forEach(addCheckbox);

    _observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) {
            if (node.dataset && node.dataset.refId) addCheckbox(node);
            node.querySelectorAll && node.querySelectorAll('[data-ref-id]').forEach(addCheckbox);
          }
        });
      });
    });
    _observer.observe(gridEl, { childList: true, subtree: true });

    gridEl.addEventListener('click', onGridClick, true);
  }

  function destroy() {
    if (_grid) {
      _grid.removeEventListener('click', onGridClick, true);
      _grid.querySelectorAll('.approval-cb-wrap').forEach(function (el) { el.remove(); });
      _grid.querySelectorAll('[data-ref-id]').forEach(function (card) {
        card.style.outline = '';
      });
    }
    if (_observer) { _observer.disconnect(); _observer = null; }
    if (_floatingBar) { _floatingBar.remove(); _floatingBar = null; }
    _selected.clear();
    _grid = null;
    _options = null;
  }

  global.ApprovalMode = { init: init, destroy: destroy, selectAll: selectAll, clearSelection: clearSelection };
})(window);
