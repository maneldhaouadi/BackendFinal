import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { EntityHelper } from 'src/common/database/interfaces/database.entity.interface';
import { ArticleStatus } from '../../interfaces/article-data.interface';
import { ArticleHistoryEntity } from 'src/modules/article-history/article-history/repositories/entities/article-history.entity';

@Entity('article')
export class ArticleEntity extends EntityHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, nullable: true })
  title: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ length: 50, unique: true, nullable: false })
  reference: string;

  @Column({ default: 0 })
  quantityInStock: number;

  @Column({
    type: 'enum',
    enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'],
    default: 'draft'
  })
  status: ArticleStatus;

  @Column({ default: 1 })
  version: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'longblob', nullable: true })
  justificatifFile: Express.Multer.File;

  @Column({ length: 255, nullable: true })
  justificatifFileName: string;

  @Column({ length: 100, nullable: true })
  justificatifMimeType: string;

  @Column({ nullable: true })
  justificatifFileSize: number;
  
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.00 })
  unitPrice: number;

  @OneToMany(() => ArticleHistoryEntity, history => history.article)
  history: ArticleHistoryEntity[];
}