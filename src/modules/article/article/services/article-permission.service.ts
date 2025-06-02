import { Injectable } from '@nestjs/common';
import { ArticleStatus } from '../interfaces/article-data.interface';

export enum ArticleAction {
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  VIEW_HISTORY = 'VIEW_HISTORY',
  RESTORE_VERSION = 'RESTORE_VERSION',
  CHANGE_STATUS = 'CHANGE_STATUS',
  ACTIVATE = 'ACTIVATE',
  DEACTIVATE = 'DEACTIVATE',
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE',
  USE_IN_QUOTE = 'USE_IN_QUOTE',
  USE_IN_ORDER = 'USE_IN_ORDER',
  RESTOCK = 'RESTOCK',
  UPDATE_STOCK = 'UPDATE_STOCK'
}

@Injectable()
export class ArticlePermissionService {
  // Autorise toutes les actions pour tous les statuts
  isActionAllowed(_status: ArticleStatus, _action: ArticleAction): boolean {
    return true;
  }

  // Ne lève jamais d'exception
  validateAction(_status: ArticleStatus, _action: ArticleAction): void {
    // Toutes les actions sont autorisées
  }
}