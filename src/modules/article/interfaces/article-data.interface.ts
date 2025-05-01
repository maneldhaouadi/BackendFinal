import { ArticleHistoryEntity } from "src/modules/article-history/repositories/entities/article-history.entity";

export interface ArticleData {
    id?: number;
    title?: string | null;
    description?: string | null;
    reference: string;
    quantityInStock: number;
    unitPrice: number; // Ajouté pour correspondre à l'entité
    status: ArticleStatus;
    version?: number;
    notes?: string | null;
    justificatifFile?: Buffer | null; // Changé pour correspondre au type de l'entité
    justificatifFileName?: string | null; // Ajouté
    justificatifMimeType?: string | null; // Ajouté
    justificatifFileSize?: number | null; // Ajouté
    createdAt?: Date;
    updatedAt?: Date;
    deletedAt?: Date | null;
    history?: ArticleHistoryEntity[];
}

export type ArticleStatus = 
  | 'draft'
  | 'active'
  | 'inactive'
  | 'archived'
  | 'out_of_stock'
  | 'pending_review'
  | 'deleted';