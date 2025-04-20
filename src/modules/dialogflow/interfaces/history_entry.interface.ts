// src/modules/history/interfaces/history-entry.interface.ts
export interface ConversationHistory {
    entries: HistoryEntry[];
  }
  
  export interface HistoryEntry {
    user: string;
    bot: string;
    timestamp?: string;
  }