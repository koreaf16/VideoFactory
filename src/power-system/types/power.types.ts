/**
 * ============================================================
 *  Module: Power System Domain Types
 * ============================================================
 *
 *  Defines character power status, buff/debuff effects,
 *  and NPC popularity ranking structures.
 *
 *  ┌──────────────────────────────────────────────┐
 *  │              PowerStatus                     │
 *  │  charId, subscriberCount, powerLevel, mana   │
 *  │                                              │
 *  │  ┌────────────┐      ┌────────────┐         │
 *  │  │  buffs[]   │      │ debuffs[]  │         │
 *  │  │ BuffDebuff │      │ BuffDebuff │         │
 *  │  │  name      │      │  name      │         │
 *  │  │  source    │      │  source    │         │
 *  │  │  effect    │      │  effect    │         │
 *  │  │  expiresEp │      │  expiresEp │         │
 *  │  └────────────┘      └────────────┘         │
 *  └──────────────────────────────────────────────┘
 *
 *  ┌──────────────────────────────────────────────┐
 *  │           NPCPopularity                      │
 *  │  npcId, name, positiveVotes,                 │
 *  │  negativeVotes, rank                         │
 *  └──────────────────────────────────────────────┘
 *
 * ============================================================
 */

export interface BuffDebuff {
  readonly name: string;
  readonly source: string;
  readonly effect: string;
  readonly expiresEp?: number;
}

export interface PowerStatus {
  readonly charId: string;
  readonly subscriberCount: number;
  readonly powerLevel: number;
  readonly mana: number;
  readonly buffs: BuffDebuff[];
  readonly debuffs: BuffDebuff[];
}

export interface NPCPopularity {
  readonly npcId: string;
  readonly name: string;
  readonly positiveVotes: number;
  readonly negativeVotes: number;
  readonly rank: number;
}
