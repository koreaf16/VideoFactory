/**
 * ============================================================
 *  Module: NPC World Domain Types
 * ============================================================
 *
 *  Defines NPC entities, world events triggered by NPCs,
 *  and encounter probability structures.
 *
 *  ┌──────────────────────────────────────────┐
 *  │                 NPC                      │
 *  │  npcId, name, role                       │
 *  │  importance: main | sub | extra          │
 *  │  profile, mood, location                 │
 *  └──────────┬───────────────────────────────┘
 *             │  1:N
 *  ┌──────────▼───────────────────────────────┐
 *  │              NPCEvent                    │
 *  │  eventId, eventType, description,        │
 *  │  effects, worldTime                      │
 *  └──────────────────────────────────────────┘
 *
 *  ┌──────────────────────────────────────────┐
 *  │           EncounterInfo                  │
 *  │  npcId, probability, location, reason    │
 *  └──────────────────────────────────────────┘
 *
 * ============================================================
 */

export type NPCImportance = 'main' | 'sub' | 'extra';

export interface NPC {
  readonly npcId: string;
  readonly name: string;
  readonly nameEn?: string;
  readonly role: string;
  readonly importance: NPCImportance;
  readonly profile?: string;
  readonly mood?: string;
  readonly location?: string;
  readonly createdAt: Date;
}

export interface NPCEvent {
  readonly eventId: string;
  readonly npcId: string;
  readonly eventType: string;
  readonly description: string;
  readonly effects?: string;
  readonly worldTime: string;
  readonly createdAt: Date;
}

export interface EncounterInfo {
  readonly npcId: string;
  readonly probability: number;
  readonly location: string;
  readonly reason: string;
}
