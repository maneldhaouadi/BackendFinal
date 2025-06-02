import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('article_history')
export class ArticleHistoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  version: number;

  @Column('json')
  changes: Record<string, { oldValue: any; newValue: any }>;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;
  
  @Column({ default: false })
  isActive: boolean; // Nouveau champ pour gérer l'activation
  
  @ManyToOne(() => ArticleEntity, article => article.history, { 
    onDelete: 'CASCADE',
    nullable: false
  })
  article: ArticleEntity;

  @Column()
  articleId: number;
}