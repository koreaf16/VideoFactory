/**
 * @module Kontext 워크플로우 통합 테스트
 * @description 앵커 이미지 1장 생성 → 파생 이미지 3장 생성 → 결과 검증.
 *              ComfyUI 서버가 실행 중이어야 한다.
 *
 * @usage npx tsx scripts/test-kontext-workflows.ts
 * @dependencies comfyui-client, kontext-workflows
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs/promises';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { comfyuiClient } from '../src/comfyui/client';
import {
  buildKontextAnchorWorkflow,
  buildKontextEditWorkflow,
} from '../src/comfyui/workflows/kontext-workflows';
import { DERIVATIVE_PRESETS } from '../src/characters/services/derivative-presets';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const COMFYUI_HOST = process.env.COMFYUI_HOST ?? '192.168.0.3';
const COMFYUI_PORT = process.env.COMFYUI_PORT ?? '8188';
const OUT_DIR = path.resolve('exports/test-kontext');

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadImage(filename: string, subfolder: string, outPath: string): Promise<void> {
  const url = `http://${COMFYUI_HOST}:${COMFYUI_PORT}/view?filename=${filename}&subfolder=${subfolder}&type=output`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buffer);
}

async function testAnchorGeneration(): Promise<string> {
  console.log(`\n${BOLD}${CYAN}[1/2] 앵커 이미지 생성 테스트${RESET}`);
  console.log('  프롬프트: 자연어 Flux 호환 프롬프트');
  console.log('  스텝: 24, cfg: 3.0, denoise: 1.0\n');

  const prompt =
    'Professional studio portrait photo of a young Korean woman with long dark brown straight hair and brown eyes. ' +
    'Fair skin, wearing a white school blouse with a navy blue tie. ' +
    'Head and shoulders, front view, looking directly at camera with a calm neutral expression. ' +
    'Flat even studio lighting on a plain light gray background. Highly detailed skin texture.';

  const seed = 42;
  const workflow = buildKontextAnchorWorkflow({
    prompt,
    seed,
    filenamePrefix: 'test_anchor',
  });

  console.log('  워크플로우 제출 중...');
  await comfyuiClient.connect();
  const promptId = await comfyuiClient.submitWorkflow(workflow);
  console.log(`  promptId: ${promptId}`);
  console.log('  결과 대기 중 (최대 2분)...');

  const { images } = await comfyuiClient.waitForResult(promptId, 120_000);
  if (images.length === 0) throw new Error('앵커 이미지 결과 없음');

  const outPath = path.join(OUT_DIR, `anchor_seed${seed}.png`);
  await downloadImage(images[0].filename, images[0].subfolder ?? '', outPath);
  console.log(`  ${GREEN}✅ 앵커 이미지 저장: ${outPath}${RESET}`);

  // 앵커를 ComfyUI input에 업로드 (파생 생성용)
  const uploadedName = await comfyuiClient.uploadImage(outPath);
  console.log(`  업로드 완료: ${uploadedName}`);
  return uploadedName;
}

async function testDerivativeGeneration(anchorName: string): Promise<void> {
  console.log(`\n${BOLD}${CYAN}[2/2] 파생 이미지 생성 테스트 (3개 프리셋)${RESET}`);
  console.log('  KontextSampler 사용, guidance: 2.5, denoise: 1.0\n');

  // 3개 프리셋만 테스트 (다양한 포즈: 정면 미소, 측면 프로필, 전신 정면)
  const testPresets = [
    DERIVATIVE_PRESETS[0],  // 정면 미소
    DERIVATIVE_PRESETS[4],  // 측면 프로필
    DERIVATIVE_PRESETS[11], // 전신 정면
  ];

  for (const preset of testPresets) {
    console.log(`  ${BOLD}프리셋: ${preset.label}${RESET}`);
    console.log(`    프롬프트: ${preset.promptSuffix.substring(0, 80)}...`);

    const seed = Math.floor(Math.random() * 999999999);
    const workflow = buildKontextEditWorkflow({
      anchorImageName: anchorName,
      editPrompt: preset.promptSuffix,
      seed,
      filenamePrefix: `test_${preset.label}`,
    });

    try {
      const promptId = await comfyuiClient.submitWorkflow(workflow);
      console.log(`    promptId: ${promptId}, 대기 중...`);
      const { images } = await comfyuiClient.waitForResult(promptId, 120_000);
      if (images.length === 0) {
        console.log(`    ${RED}❌ 결과 없음${RESET}`);
        continue;
      }

      const outPath = path.join(OUT_DIR, `deriv_${preset.label}_${seed}.png`);
      await downloadImage(images[0].filename, images[0].subfolder ?? '', outPath);
      console.log(`    ${GREEN}✅ 저장: ${outPath}${RESET}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    ${RED}❌ 실패: ${msg}${RESET}`);

      // KontextSampler 노드 에러면 안내 메시지
      if (msg.includes('KontextSampler') || msg.includes('node_errors')) {
        console.log(`\n    ${RED}⚠️  KontextSampler 노드를 찾을 수 없습니다.${RESET}`);
        console.log('    ComfyUI-KontextWrapper 커스텀 노드가 설치되어 있는지 확인하세요.');
        console.log('    설치: ComfyUI Manager → Install Custom Nodes → "KontextWrapper" 검색');
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}=== Kontext 워크플로우 통합 테스트 ===${RESET}`);
  console.log(`ComfyUI: ${COMFYUI_HOST}:${COMFYUI_PORT}`);
  console.log(`출력 디렉토리: ${OUT_DIR}\n`);

  await ensureDir(OUT_DIR);

  try {
    const anchorName = await testAnchorGeneration();
    await testDerivativeGeneration(anchorName);

    console.log(`\n${BOLD}${GREEN}=== 테스트 완료 ===${RESET}`);
    console.log(`결과 이미지: ${OUT_DIR}`);
    console.log('이미지를 확인하여 다음을 검증하세요:');
    console.log('  1. 앵커 이미지: 프롬프트와 일치하는 정면 인물 사진인가?');
    console.log('  2. 파생 이미지: 각각 다른 포즈/앵글인가? (정면 미소, 측면, 전신)');
    console.log('  3. 파생 이미지: 앵커와 동일 인물처럼 보이는가?');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n${RED}${BOLD}테스트 실패: ${msg}${RESET}`);
    process.exit(1);
  } finally {
    comfyuiClient.disconnect();
  }

  process.exit(0);
}

main();
