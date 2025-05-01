import { Injectable, NotFoundException } from '@nestjs/common';
import { ArticleHistoryEntity } from '../repositories/entities/article-history.entity';
import { ArticleHistoryRepository } from '../repositories/repository/article-history.repository';
import { ArticleEntity } from 'src/modules/article/repositories/entities/article.entity';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

@Injectable()
export class ArticleHistoryService {
  constructor(
    private readonly articleHistoryRepository: ArticleHistoryRepository,
    private readonly pdfService: PdfService,
    @InjectRepository(ArticleEntity)
    private readonly articleRepository: Repository<ArticleEntity>,
    private readonly dataSource: DataSource // Ajoutez cette ligne

  ) {}
  
  async getArticleVersion(articleId: number, version: number): Promise<ArticleHistoryEntity> {
    return this.articleHistoryRepository.findOne({
        where: { articleId, version }
    });
}
  /**
   * Crée une entrée dans l'historique des modifications d'un article
   */
  async createHistoryEntry(historyData: {
    version: number;
    changes: Record<string, { oldValue: any; newValue: any }>;
    articleId: number;
  }): Promise<ArticleHistoryEntity> {
    return this.articleHistoryRepository.createHistoryEntry(historyData);
  }

  /**
   * Récupère l'historique complet d'un article trié par version
   */
  async getArticleHistory(articleId: number): Promise<ArticleHistoryEntity[]> {
    const history = await this.articleHistoryRepository.find({
      where: { articleId },
      order: { version: 'ASC' },
    });

    if (!history || history.length === 0) {
      throw new NotFoundException(`Aucun historique trouvé pour l'article ${articleId}`);
    }

    return history;
  }

  /**
   * Récupère un article par son ID
   */
  private async findArticleById(articleId: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOne({ 
      where: { id: articleId },
      relations: ['history']
    });
    
    if (!article) {
      throw new NotFoundException(`Article ${articleId} non trouvé`);
    }
    return article;
  }

  /**
   * Télécharge le PDF d'une version spécifique
   */
  async downloadVersionPdf(articleId: number, version: number): Promise<Buffer> {
    return this.generateSingleVersionPdf(articleId, version);
  }

  /**
   * Génère le PDF pour une version spécifique
   */
  async generateSingleVersionPdf(articleId: number, version: number): Promise<Buffer> {
    const article = await this.findArticleById(articleId);

    if (version === article.version) {
      return this.generateCurrentVersionPdf(article);
    }

    const history = await this.getArticleHistory(articleId);
    const versionEntry = history.find(entry => entry.version === version);
    
    if (!versionEntry) {
      throw new NotFoundException(`Version ${version} non trouvée dans l'historique`);
    }

    const articleState = this.reconstructArticleState(history, version);
    
    return this.pdfService.generatePdf({
      version: version,
      date: versionEntry.date.toISOString(),
      article: articleState,
      changes: versionEntry.changes,
    }, 'template4');
  }

  /**
   * Génère le PDF pour la version actuelle
   */
  private async generateCurrentVersionPdf(article: ArticleEntity): Promise<Buffer> {
    return this.pdfService.generatePdf({
      version: article.version,
      date: new Date().toISOString(),
      article: this.extractArticleState(article),
      changes: {},
    }, 'template4');
  }

  private extractArticleState(article: ArticleEntity): Partial<ArticleEntity> {
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      reference: article.reference,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      notes: article.notes,
    };
  }

  private reconstructArticleState(
    history: ArticleHistoryEntity[],
    targetVersion: number,
  ): Partial<ArticleEntity> {
    let articleState: Partial<ArticleEntity> = {};

    for (const entry of history) {
      if (entry.version > targetVersion) break;
      for (const [field, change] of Object.entries(entry.changes)) {
        articleState[field] = change.newValue;
      }
    }

    return articleState;
  }

  /**
   * (Optionnel) Génère tous les PDFs pour archivage
   */
  async generateAllVersionPdfs(articleId: number): Promise<string[]> {
    const article = await this.findArticleById(articleId);
    const articleDir = path.join(__dirname, '..', '..', 'uploads', `article_${articleId}`);
    
    if (!fs.existsSync(articleDir)) {
      fs.mkdirSync(articleDir, { recursive: true });
    }

    const filePaths: string[] = [];
    const history = await this.getArticleHistory(articleId);

    // Générer les PDFs historiques
    for (const entry of history) {
      const pdfBuffer = await this.generateSingleVersionPdf(articleId, entry.version);
      const filePath = path.join(articleDir, `article_${articleId}_version_${entry.version}.pdf`);
      fs.writeFileSync(filePath, pdfBuffer);
      filePaths.push(filePath);
    }

    // Générer le PDF actuel
    const currentPdfBuffer = await this.generateCurrentVersionPdf(article);
    const currentFilePath = path.join(articleDir, `article_${articleId}_version_${article.version}.pdf`);
    fs.writeFileSync(currentFilePath, currentPdfBuffer);
    filePaths.push(currentFilePath);

    return filePaths;
  }

  ////////////
  // article-history.service.ts

async deleteVersion(articleId: number, versionToDelete: number): Promise<void> {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
      // 1. Vérifier que l'article existe
      const article = await queryRunner.manager.findOne(ArticleEntity, {
          where: { id: articleId }
      });
      if (!article) {
          throw new NotFoundException('Article non trouvé');
      }

      // 2. Vérifier que la version à supprimer existe
      const versionEntry = await queryRunner.manager.findOne(ArticleHistoryEntity, {
          where: { articleId, version: versionToDelete }
      });
      if (!versionEntry) {
          throw new NotFoundException(`Version ${versionToDelete} non trouvée`);
      }

      // 3. Supprimer la version
      await queryRunner.manager.delete(ArticleHistoryEntity, {
          articleId,
          version: versionToDelete
      });

      // 4. Décrémenter les versions supérieures
      await queryRunner.manager
          .createQueryBuilder()
          .update(ArticleHistoryEntity)
          .set({ version: () => "version - 1" })
          .where("articleId = :articleId AND version > :version", {
              articleId,
              version: versionToDelete
          })
          .execute();

      // 5. Mettre à jour la version de l'article si nécessaire
      if (article.version > versionToDelete) {
          await queryRunner.manager.update(ArticleEntity, articleId, {
              version: article.version - 1
          });
      }

      await queryRunner.commitTransaction();
  } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
  } finally {
      await queryRunner.release();
  }
}

async getStatusChangeCount(startDate: Date, endDate: Date): Promise<number> {
  const queryBuilder = this.articleHistoryRepository.createQueryBuilder('history');
  
  const result = await queryBuilder
    .select('COUNT(history.id)', 'count')
    .where('history.date BETWEEN :startDate AND :endDate', { 
      startDate, 
      endDate 
    })
    .andWhere('JSON_CONTAINS_PATH(history.changes, \'one\', \'$.status\') = 1')
    .getRawOne();

  return result?.count || 0;
}

}