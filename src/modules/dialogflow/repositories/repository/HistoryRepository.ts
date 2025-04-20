import { Injectable } from '@nestjs/common';
import { DatabaseAbstractRepository } from 'src/common/database/utils/database.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { HistoryEntity } from '../entities/History.entity';
import { ConversationHistory, HistoryEntry } from '../../interfaces/history_entry.interface';

@Injectable()
export class HistoryRepository {
  constructor(
    @InjectRepository(HistoryEntity)
    private readonly historyRepo: Repository<HistoryEntity>
  ) {}

  async saveSessionHistory(sessionId: string, newEntry: HistoryEntry): Promise<void> {
    // 1. Récupérer l'historique existant
    const existingRecord = await this.historyRepo.findOne({ where: { sessionId } });
    
    let entries: HistoryEntry[] = [];
    
    // 2. Si un historique existe, le parser
    if (existingRecord) {
      try {
        const existingHistory = JSON.parse(existingRecord.history) as ConversationHistory;
        entries = existingHistory.entries || [];
      } catch (e) {
        console.error('Error parsing existing history:', e);
        entries = [];
      }
    }
    
    // 3. Ajouter le nouvel entry
    entries.push(newEntry);
    
    // 4. Limiter à 50 entrées maximum
    if (entries.length > 50) {
      entries = entries.slice(-50);
    }
    
    // 5. Sauvegarder
    await this.historyRepo.upsert(
      {
        sessionId,
        history: JSON.stringify({ entries }),
        lastUpdated: new Date()
      },
      ['sessionId'] // Clé de conflit pour le upsert
    );
  }

  async getFullHistory(sessionId: string): Promise<ConversationHistory> {
    const record = await this.historyRepo.findOne({ 
      where: { sessionId },
      order: { lastUpdated: 'DESC' } // Toujours prendre le plus récent
    });
    
    if (!record) return { entries: [] };
    
    try {
      return JSON.parse(record.history) as ConversationHistory;
    } catch (e) {
      console.error('Error parsing history:', e);
      return { entries: [] };
    }
  }
}