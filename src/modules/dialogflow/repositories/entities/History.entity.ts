import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('history')
export class HistoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'sessionId' })
  sessionId: string;

  @Column('text')
  history: string; // Stockage JSON

  @Column({ name: 'lastUpdated', default: () => 'CURRENT_TIMESTAMP' })
  lastUpdated: Date;

  @Column({ name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}