/**
 * @module TTS 음성 생성 API 엔드포인트
 * @description Python FastAPI의 TTS 엔드포인트를 호출한다.
 *              캐릭터별 대사와 감정을 전달하여 음성을 생성한다.
 *
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │ Node.js      │ ──→ │ pythonApi    │ ──→ │ Python       │
 * │ (TTS 요청)   │     │ .post()     │     │ /api/tts     │
 * └──────────────┘     └──────────────┘     └──────────────┘
 *
 * @dependencies api-client
 * @author AI Video Factory
 */

import { pythonApi } from '../api-client';
import type { PythonApiResponse } from '../types/api-response.types';

/** 개별 대사 항목 */
export interface TTSDialogue {
  character: string;
  line: string;
  emotion?: string;
}

/** TTS 생성 결과 */
interface TTSGenerateResult {
  audioFiles: string[];
}

/** 씬별 대사 목록으로 TTS 음성을 생성한다 */
export async function generateTTS(
  scenes: TTSDialogue[][]
): Promise<PythonApiResponse<TTSGenerateResult>> {
  return pythonApi.post<TTSGenerateResult>('/api/tts/generate', { scenes });
}
