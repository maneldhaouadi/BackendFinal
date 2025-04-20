import { HistoryEntry } from "./history_entry.interface";

export interface HistoryRepository {
  saveSessionHistory(sessionId: string, entries: HistoryEntry[]): Promise<void>;
  getFullHistory(sessionId: string): Promise<HistoryEntry[]>;
  getRecentHistory(sessionId: string, limit?: number): Promise<HistoryEntry[]>;
}