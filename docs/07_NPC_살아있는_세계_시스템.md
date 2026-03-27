# 07. NPC 살아있는 세계 시스템 설계

> NPC는 자기 삶을 산다. 주인공이 없어도 세계는 돌아간다.
> 2026-03-27

---

## 핵심 원칙

```
"카메라가 비추지 않는 곳에서도 세계는 돌아간다."
```

- NPC는 에피소드 사이에도 **자기 일과를 수행**한다
- NPC끼리 **상호작용하고 관계가 변한다**
- **랜덤 이벤트**가 NPC의 삶을 바꾼다
- 주인공이 NPC를 다시 만나면 **변한 상태가 반영**된다
- 시청자는 "어? 이 캐릭터 뭔가 달라졌는데?" 느끼면서 세계의 깊이를 체감

---

## 1. 세계 시간 시스템

### 시간 흐름

```
에피소드 간 시간 = 현실 업로드 간격에 비례

EP01 업로드 → 3일 후 EP02 업로드
= 이세계에서도 3일이 흐름 (조정 가능)
```

Node.js가 YouTube 업로드 시간을 추적하고,
다음 에피소드 생성 시 "경과 일수"를 계산해서 Python에 넘긴다.

### 시간 진행 트리거

| 트리거 | 설명 |
|--------|------|
| 에피소드 생성 요청 시 | 자동: 이전 업로드 이후 경과 일수만큼 NPC 시뮬레이션 |
| 수동 실행 | 웹 UI에서 "시간 진행" 버튼 → 원하는 일수만큼 시뮬 |
| 테스트용 | 특정 NPC에 대해서만 이벤트 강제 발생 |

---

## 2. NPC 프로필 구조

### Oracle JSON Duality로 저장

```json
{
  "npc_id": "npc_blacksmith_01",
  "name": "대장간 민수",
  "role": "대장장이",
  "importance": "recurring",

  "location": {
    "current": "마을_대장간",
    "home": "마을_대장간_2층",
    "frequent": ["마을_대장간", "마을_시장", "마을_주점"]
  },

  "schedule": {
    "morning": { "location": "마을_대장간", "activity": "작업", "interruptible": false },
    "afternoon": { "location": "마을_대장간", "activity": "작업", "interruptible": true },
    "evening": { "location": "마을_주점", "activity": "휴식", "interruptible": true },
    "night": { "location": "마을_대장간_2층", "activity": "수면", "interruptible": false }
  },

  "personality": {
    "traits": ["우직함", "과묵함", "장인 정신"],
    "speech_style": "짧고 직설적",
    "quirks": ["칭찬에 약함", "무기 이야기만 하면 수다쟁이"]
  },

  "mood": {
    "happiness": 0.6,
    "stress": 0.3,
    "loneliness": 0.4
  },

  "goals": [
    { "goal": "전설의 검 제작", "progress": 0.3, "deadline": null },
    { "goal": "도제 구하기", "progress": 0.0, "deadline": "EP10" }
  ],

  "inventory": ["불의 망치", "미완성 검", "태양의 검 수리 도구"],

  "relationships": {
    "태양": { "type": "customer", "trust": 0.7, "history": "검 수리 3회" },
    "소율": { "type": "acquaintance", "trust": 0.3, "history": "EP02에서 처음 만남" },
    "나비": { "type": "wary", "trust": 0.1, "history": "물건 훔치려다 걸림" }
  },

  "appearance_changes": [],
  "last_simulated": "EP03+3d"
}
```

### NPC 중요도 등급

| 등급 | 설명 | 시뮬 깊이 | 예시 |
|------|------|----------|------|
| main | 메인 파티원 | 매우 상세 (감정, 목표, 관계 전부) | 태양, 린, 나비 |
| recurring | 반복 등장 | 상세 (일과, 이벤트, 관계) | 대장간 민수, 유나, 길드장 |
| background | 배경 NPC | 간략 (위치, 기본 상태만) | 마을 사람 #1~10 |
| mention | 언급만 | 이름+한줄 상태 | "동쪽 마을의 상인" |

---

## 3. NPC 생활 시뮬레이션 (Python)

### 시뮬레이션 엔진

에피소드 사이 시간 동안 NPC별로 "하루"를 반복 시뮬.

```python
# ai-services/services/npc/life_simulator.py

async def simulate_days(npc_id: str, days: int) -> list[NpcEvent]:
    """
    NPC의 n일간 생활을 시뮬레이션한다.
    
    1. Oracle에서 NPC 프로필 로드
    2. 일수만큼 반복:
       a. 일과 수행 (schedule 기반)
       b. 랜덤 이벤트 체크 (확률 기반)
       c. NPC 간 상호작용 (같은 장소에 있는 NPC끼리)
       d. 감정/목표/관계 업데이트
    3. 결과 이벤트 목록 + 최종 상태 반환
    4. Oracle 업데이트 (Graph + JSON)
    """
```

### 랜덤 이벤트 시스템

#### 이벤트 풀 (Oracle에 저장)

```json
{
  "event_id": "evt_weapon_break",
  "name": "무기 파손",
  "trigger_conditions": {
    "role": ["전사", "기사", "모험가"],
    "probability_per_day": 0.05
  },
  "effects": {
    "mood_delta": { "stress": 0.3, "happiness": -0.2 },
    "inventory_remove": ["주무기"],
    "goal_add": { "goal": "무기 수리", "urgency": "high" },
    "location_change": "대장간"
  },
  "narrative": "{name}의 무기가 훈련 중 부러졌다. 대장간을 찾아가야 한다."
}
```

#### 이벤트 카테고리

| 카테고리 | 확률/일 | 예시 |
|---------|--------|------|
| 일상 | 30% | 시장에서 물건 구매, 좋은 식사, 날씨에 따른 기분 변화 |
| 사회적 | 15% | NPC끼리 다툼, 화해, 새 친구, 소문 듣기 |
| 직업 | 10% | 승진, 실패, 새 주문, 재료 부족 |
| 사건 | 5% | 도둑, 몬스터 출현, 부상, 질병 |
| 성장 | 3% | 새 기술 습득, 깨달음, 목표 달성 |
| 대형 | 1% | 직업 변경, 이사, 연애, 큰 사고 |

#### 이벤트 체이닝

이벤트는 다른 이벤트를 유발할 수 있다:

```
태양의 검 파손 (이벤트)
  → 대장간 방문 (위치 변경)
  → 민수와 대화 (상호작용)
  → 민수가 무료로 수리해줌 (민수-태양 trust +0.3)
  → 태양이 감동 (mood: gratitude +0.5)
  → 다음 에피소드에서 태양이 민수를 언급 (대본에 반영)
```

이 체이닝을 Claude가 처리한다:

```python
# 이벤트 발생 후 Claude에게 체이닝 요청
response = await claude.generate(
    system="NPC 이벤트 체이닝 시뮬레이터",
    user=f"""
    NPC: {npc.name} ({npc.role})
    발생 이벤트: {event.narrative}
    현재 위치: {npc.location.current}
    같은 장소의 NPC: {nearby_npcs}
    
    이 이벤트로 인한 연쇄 반응을 JSON으로 생성해줘.
    """
)
```

---

## 4. NPC 간 상호작용

### 같은 장소 = 상호작용 기회

매일 같은 장소에 있는 NPC끼리 상호작용 발생.

```sql
-- 같은 장소에 있는 NPC 쌍 찾기
SELECT a.npc_id, b.npc_id, a.location
FROM npc_states a
JOIN npc_states b ON a.location_current = b.location_current
WHERE a.npc_id < b.npc_id  -- 중복 제거
  AND a.schedule_activity = 'interruptible'
  AND b.schedule_activity = 'interruptible'
```

### 상호작용 결과 (Claude 생성)

```python
interaction = await claude.generate(
    system="NPC 상호작용 시뮬레이터",
    user=f"""
    NPC A: {npc_a.name} (성격: {npc_a.personality}, 기분: {npc_a.mood})
    NPC B: {npc_b.name} (성격: {npc_b.personality}, 기분: {npc_b.mood})
    현재 관계: {relationship.type}, trust: {relationship.trust}
    장소: {location}
    
    이 두 NPC의 자연스러운 상호작용을 JSON으로:
    - 무슨 대화/행동을 했는지 (1~2문장)
    - trust 변화 (-0.2 ~ +0.2)
    - mood 변화
    - 특이사항 (있으면)
    """
)
```

---

## 5. 조우 시스템

### 주인공이 NPC를 만나는 규칙

```
조우 확률 = 
  (NPC가 해당 장소에 있을 확률) × 
  (시간대 일치) × 
  (NPC가 interruptible 상태) × 
  (스토리 관련성 보너스)
```

### 조우 시 반영되는 것

NPC를 다시 만나면, 그동안의 변화가 자연스럽게 드러난다:

| 변화 종류 | 표현 방식 |
|----------|----------|
| 기분 변화 | 대사 톤이 달라짐 (기쁘면 밝게, 우울하면 짧게) |
| 외모 변화 | 프롬프트에 반영 (부상 → 붕대, 승진 → 새 옷) |
| 관계 변화 | 주인공에 대한 태도가 달라짐 |
| 새 정보 | 오프스크린에서 알게 된 정보를 주인공에게 전달 |
| 위치 변화 | 예상치 못한 장소에서 만남 |
| 목표 변화 | 새로운 부탁/퀘스트 제안 |

### 대본 생성 시 Claude 컨텍스트에 포함

```json
{
  "npc_encounters_available": [
    {
      "npc": "린",
      "location": "마법학교",
      "probability": 0.9,
      "current_state": "시험 탈락 후 분노+좌절",
      "changes_since_last_seen": [
        "마법학교 시험 탈락 → 분노 급상승",
        "혼자 숲에서 마법 연습 → 새 마법 부분 습득"
      ],
      "suggested_interaction": "평소보다 날카롭게 반응. 스마트폰 분해 시도가 분노 해소 방향으로."
    },
    {
      "npc": "대장간 민수",
      "location": "대장간",
      "probability": 0.7,
      "current_state": "태양 검 수리 완료, 기분 좋음",
      "changes_since_last_seen": ["태양과 친해짐 (trust +0.3)"],
      "suggested_interaction": "태양을 칭찬하며 소율에게 태양 이야기를 해줌"
    }
  ]
}
```

---

## 6. Oracle 저장 구조

### 테이블

```sql
-- NPC 기본 정보 + JSON 프로필
CREATE TABLE npcs (
    npc_id          VARCHAR2(50) PRIMARY KEY,
    name            VARCHAR2(100) NOT NULL,
    role            VARCHAR2(100),
    importance      VARCHAR2(20) CHECK (importance IN ('main','recurring','background','mention')),
    profile         JSON,          -- 성격, 일과, 목표, 인벤토리
    mood            JSON,          -- 현재 감정 상태
    location_current VARCHAR2(100),
    last_simulated  VARCHAR2(20),  -- EP03+3d 형식
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- NPC 이벤트 로그
CREATE TABLE npc_events (
    event_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    npc_id          VARCHAR2(50) REFERENCES npcs(npc_id),
    event_type      VARCHAR2(50),   -- daily/social/career/incident/growth/major
    description     VARCHAR2(1000),
    effects         JSON,           -- mood_delta, trust_delta, inventory 등
    world_time      VARCHAR2(20),   -- EP03+1d
    reflected_in_ep NUMBER,         -- 반영된 에피소드 (NULL이면 미반영)
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- NPC 간 관계 (Graph)
-- char_relationships 테이블 확장 — NPC끼리도 관계 추적

-- NPC 위치 히스토리
CREATE TABLE npc_location_log (
    log_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    npc_id          VARCHAR2(50) REFERENCES npcs(npc_id),
    location        VARCHAR2(100),
    activity        VARCHAR2(100),
    world_time      VARCHAR2(20),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- 이벤트 풀 (랜덤 이벤트 템플릿)
CREATE TABLE npc_event_pool (
    template_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR2(100),
    category        VARCHAR2(50),
    trigger_conditions JSON,        -- role, mood 조건 등
    probability     NUMBER(3,2),    -- 일별 발생 확률
    effects_template JSON,          -- 효과 템플릿
    narrative_template VARCHAR2(500) -- "{name}의 {item}이 부러졌다"
);
```

### Graph 확장

```sql
-- NPC 생애 이벤트를 Graph로 추적
-- 노드: NPC, 이벤트, 장소, 시간
-- 엣지: experienced, caused_by, at_location, at_time

-- 예: 태양의 검 파손 → 대장간 방문 → 민수와 교류
-- 이 체인이 Graph에서 경로로 추적 가능
```

---

## 7. API 엔드포인트

### Python FastAPI (NPC 시뮬레이션)

```
POST   /api/npc/simulate           지정 일수만큼 전체 NPC 시뮬레이션
POST   /api/npc/:id/simulate       특정 NPC만 시뮬레이션
GET    /api/npc/:id/state           NPC 현재 상태 조회
GET    /api/npc/encounters          주인공 현재 위치 기반 조우 가능 NPC
POST   /api/npc/interact            NPC 간 상호작용 생성 (Claude)
GET    /api/npc/events/unresolved   미반영 이벤트 목록
```

### Node.js (웹 UI)

```
GET    /api/npcs                    NPC 목록 (위치, 상태 요약)
GET    /api/npcs/:id                NPC 상세 (프로필, 이벤트 로그)
GET    /api/npcs/map                위치별 NPC 현황
GET    /api/npcs/events             오프스크린 이벤트 로그
POST   /api/npcs/:id/force-event    이벤트 강제 발생 (테스트용)
PUT    /api/npcs/:id/profile        NPC 프로필 수동 수정
```

---

## 8. 구현 우선순위

| 순서 | 기능 | Phase |
|------|------|-------|
| 1 | NPC 프로필 JSON 구조 + Oracle 테이블 | Phase 1 |
| 2 | 기본 일과 시스템 (위치 + 시간대) | Phase 1 |
| 3 | 랜덤 이벤트 풀 + 발생 로직 | Phase 2 |
| 4 | NPC 간 상호작용 (Claude) | Phase 2 |
| 5 | 이벤트 체이닝 (Claude) | Phase 2 |
| 6 | 조우 시스템 (대본 컨텍스트 주입) | Phase 2 |
| 7 | 웹 UI (NPC 맵, 이벤트 로그) | Phase 2 |
| 8 | 외모 변화 반영 (프롬프트 자동 수정) | Phase 3 |
