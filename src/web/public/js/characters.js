/**
 * characters.js - 캐릭터 페이지 공용 유틸리티
 *
 * manage.ejs, candidates.ejs, derivatives.ejs 에서 공유하는 헬퍼 함수 모음.
 */

/**
 * 절대 경로를 웹 URL로 변환한다. (한글/공백 포함 파일명 인코딩 처리)
 * C:\VideoFactory\exports\candidates\soyul\job123\file.png
 *   → /exports/candidates/soyul/job123/file.png
 *
 * @param {string} absPath - 서버의 절대 파일 경로
 * @returns {string} 웹에서 접근 가능한 상대 URL
 */
function pathToUrl(absPath) {
  if (!absPath) return '';
  var match = absPath.match(/exports[\\\/](.*)/);
  if (!match) return absPath;
  // 각 경로 세그먼트를 개별 인코딩 (슬래시는 유지)
  var segments = match[1].replace(/\\/g, '/').split('/');
  var encoded = segments.map(function(seg) { return encodeURIComponent(seg); }).join('/');
  return '/exports/' + encoded;
}

/**
 * 원본 이미지 경로에서 썸네일 URL을 생성한다.
 * /exports/candidates/soyul/job/file.png → /exports/candidates/soyul/job/thumb_file.png
 *
 * @param {string} absPath - 서버의 절대 파일 경로
 * @returns {string} 썸네일 웹 URL
 */
function thumbUrl(absPath) {
  if (!absPath) return '';
  var match = absPath.match(/exports[\\\/](.*)/);
  if (!match) return '';
  var rel = match[1].replace(/\\/g, '/');
  var lastSlash = rel.lastIndexOf('/');
  var dir = lastSlash >= 0 ? rel.substring(0, lastSlash + 1) : '';
  var file = lastSlash >= 0 ? rel.substring(lastSlash + 1) : rel;
  var segments = (dir + 'thumb_' + file).split('/');
  var encoded = segments.map(function(seg) { return encodeURIComponent(seg); }).join('/');
  return '/exports/' + encoded;
}
