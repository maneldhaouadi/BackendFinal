import { Injectable, BadRequestException, NotFoundException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PageDto } from 'src/common/database/dtos/database.page.dto';
import { PageMetaDto } from 'src/common/database/dtos/database.page-meta.dto';
import { ArticleRepository } from '../repositories/repository/article.repository';
import { ArticleEntity } from '../repositories/entities/article.entity';
import { ResponseArticleDto } from '../dtos/article.response.dto';
import { CreateArticleDto } from '../dtos/article.create.dto';
import { UpdateArticleDto } from '../dtos/article.update.dto';
import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
import { DataSource, DeepPartial, FindManyOptions, FindOneOptions, ILike, In, LessThan, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { QueryBuilder } from 'src/common/database/utils/database-query-builder';
import { Readable } from 'stream';
import * as xlsx from 'xlsx';
import { ArticleHistoryService } from 'src/modules/article-history/services/article-history.service';
import { InjectRepository } from '@nestjs/typeorm';
import { ArticleHistoryEntity } from 'src/modules/article-history/repositories/entities/article-history.entity';
import * as fs from 'fs';
import { TextSimilarityService } from './TextSimilarityService';
import { PdfExtractionService } from 'src/modules/pdf-extraction/services/pdf-extraction.service';
import { PdfService } from 'src/common/pdf/services/pdf.service';
import { ArticleOcrService } from 'src/modules/ocr/services/articleOcrService';
import { ArticleStatus } from '../interfaces/article-data.interface';

@Injectable()
export class ArticleService {
  constructor(
    private readonly articleRepository: ArticleRepository,
    private readonly articleHistoryService: ArticleHistoryService,
    private readonly pdfService: PdfService,
    private readonly textSimilarityService: TextSimilarityService,
    private readonly articleOcrService: ArticleOcrService,
    private readonly pdfExtractionService: PdfExtractionService,
    private dataSource: DataSource // Injection du DataSource

  ) {}

  async updateStatus(id: number, newStatus: ArticleStatus): Promise<ArticleEntity> {
    const article = await this.findOneById(id);
    
    // Vérification des transitions autorisées
    if (!this.isStatusTransitionValid(article.status, newStatus)) {
      throw new BadRequestException(
        `Transition de statut invalide: ${article.status} -> ${newStatus}`
      );
    }
  
    // Vérifications spécifiques selon le nouveau statut
    if (newStatus === 'active') {
      if (!article.title || !article.reference) {
        throw new BadRequestException(
          'Un article actif doit avoir un titre et une référence'
        );
      }
    }
  
    // Inclure la référence existante dans la mise à jour
    return this.update(id, { 
      status: newStatus,
      reference: article.reference // Ajout de la référence existante
    });
  }
  
  
  async checkAndUpdateStockStatus(): Promise<void> {
    const articles = await this.articleRepository.find({
      where: { status: In(['active', 'out_of_stock']) }
    });
  
    const updates = articles.map(async article => {
      if (article.quantityInStock <= 0 && article.status !== 'out_of_stock') {
        await this.update(article.id, { 
          status: 'out_of_stock',
          reference: article.reference 
        });
      } else if (article.quantityInStock > 0 && article.status === 'out_of_stock') {
        await this.update(article.id, { 
          status: 'active',
          reference: article.reference 
        });
      }
    });
  
    await Promise.all(updates);
  }
  
  async suggestArchiving(): Promise<ArticleEntity[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
    const candidates = await this.articleRepository.find({
      where: [
        { 
          status: 'inactive',
          updatedAt: LessThan(sixMonthsAgo) 
        },
        { 
          status: 'out_of_stock',
          updatedAt: LessThan(sixMonthsAgo) 
        }
      ]
    });
  
    return candidates;
  }

  private handleSaveError(error: any, reference?: string): never {
    if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
      throw new ConflictException(
        reference 
          ? `La référence '${reference}' existe déjà`
          : 'Une ou plusieurs références existent déjà'
      );
    }
    throw error;
  }

  private async generateUniqueReference(): Promise<string> {
    let reference: string;
    let attempts = 0;
    const maxAttempts = 5;
  
    do {
      // Génération selon le format souhaité
      const randomNumber = Math.floor(100000000 + Math.random() * 900000000);
      reference = `REF-${randomNumber}`;
      attempts++;
  
      // Vérification de l'unicité
      const exists = await this.articleRepository.findOne({ 
        where: { reference } 
      });
      
      if (!exists) return reference;
  
      // Limite de tentatives pour éviter les boucles infinies
      if (attempts >= maxAttempts) {
        throw new Error('Impossible de générer une référence unique après plusieurs tentatives');
      }
      
      // Pause avant nouvelle tentative
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (true);
  }
  
  async save(
    createArticleDto: CreateArticleDto & { justificatifFile?: Express.Multer.File }
  ): Promise<ArticleEntity> {
    // Générer une référence unique si vide
    if (!createArticleDto.reference?.trim()) {
      createArticleDto.reference = await this.generateUniqueReference();
    }
  
    const articleData: DeepPartial<ArticleEntity> = {
      title: createArticleDto.title,
      description: createArticleDto.description,
      reference: createArticleDto.reference,
      quantityInStock: createArticleDto.quantityInStock,
      unitPrice: createArticleDto.unitPrice,
      status: (createArticleDto.status as ArticleStatus) || 'draft',
      notes: createArticleDto.notes,
    };
  
    // Gestion du fichier justificatif
    if (createArticleDto.justificatifFile) {
      articleData.justificatifFile = {
        buffer: createArticleDto.justificatifFile.buffer,
        originalname: createArticleDto.justificatifFile.originalname,
        mimetype: createArticleDto.justificatifFile.mimetype,
        size: createArticleDto.justificatifFile.size
      };
      articleData.justificatifFileName = createArticleDto.justificatifFile.originalname;
      articleData.justificatifMimeType = createArticleDto.justificatifFile.mimetype;
      articleData.justificatifFileSize = createArticleDto.justificatifFile.size;
    }
  
    try {
      const article = this.articleRepository.create(articleData);
      return await this.articleRepository.save(article);
    } catch (error) {
      this.handleSaveError(error, createArticleDto.reference);
    }
  }

  async saveMany(
    createArticleDtos: (CreateArticleDto & { justificatifFile?: Express.Multer.File })[]
  ): Promise<ArticleEntity[]> {
    try {
      return await Promise.all(
        createArticleDtos.map(async dto => {
          // Création de l'objet partiel pour l'entité
          const entityData: DeepPartial<ArticleEntity> = {
            title: dto.title,
            description: dto.description,
            reference: dto.reference,
            quantityInStock: dto.quantityInStock,
            unitPrice: dto.unitPrice,
            status: (dto.status as ArticleStatus) || 'draft',
            notes: dto.notes,
          };
  
          // Ajout des propriétés du fichier si présent
          if (dto.justificatifFile) {
            // Création d'un objet File compatible
            const file: Express.Multer.File = {
              ...dto.justificatifFile,
              buffer: dto.justificatifFile.buffer,
              originalname: dto.justificatifFile.originalname,
              mimetype: dto.justificatifFile.mimetype,
              size: dto.justificatifFile.size,
              // Propriétés optionnelles avec valeurs par défaut
              fieldname: dto.justificatifFile.fieldname || 'justificatifFile',
              encoding: dto.justificatifFile.encoding || '7bit',
              stream: null,
              destination: '',
              filename: dto.justificatifFile.originalname,
              path: ''
            };
  
            entityData.justificatifFile = file;
            entityData.justificatifFileName = file.originalname;
            entityData.justificatifMimeType = file.mimetype;
            entityData.justificatifFileSize = file.size;
          }
  
          const entity = this.articleRepository.create(entityData);
          return this.articleRepository.save(entity);
        })
      );
    } catch (error) {
      this.handleSaveError(error);
    }
  }

  async findAll(
    query: IQueryObject,
  ): Promise<{ total: number }> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const total = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });
    return { total };
  }

  async findAllPaginated(
    query: IQueryObject,
  ): Promise<PageDto<ResponseArticleDto>> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const count = await this.articleRepository.getTotalCount({
      where: queryOptions.where,
    });
  
    const entities = await this.articleRepository.findAll(
      queryOptions as FindManyOptions<ArticleEntity>,
    );
  
    const responseDtos: ResponseArticleDto[] = entities.map(entity => {
      const dto: ResponseArticleDto = {
        id: entity.id,
        title: entity.title ?? undefined,
        description: entity.description ?? undefined,
        reference: entity.reference,
        quantityInStock: entity.quantityInStock,
        unitPrice: entity.unitPrice,
        status: entity.status,
        version: entity.version,
        notes: entity.notes ?? undefined,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt ?? undefined,
        // Ajout des propriétés séparées pour le fichier
        justificatifFileName: entity.justificatifFileName ?? undefined,
        justificatifMimeType: entity.justificatifMimeType ?? undefined,
        justificatifFileSize: entity.justificatifFileSize ?? undefined
      };
  
      if (entity.justificatifFile) {
        // Construction d'un objet Express.Multer.File complet
        dto.justificatifFile = {
          fieldname: 'justificatifFile',
          originalname: entity.justificatifFileName,
          encoding: '7bit',
          mimetype: entity.justificatifMimeType,
          size: entity.justificatifFileSize,
          buffer: entity.justificatifFile.buffer,
          stream: null,
          destination: '',
          filename: entity.justificatifFileName,
          path: ''
        } as Express.Multer.File;
      }
  
      if (entity.history) {
        dto.history = entity.history.map(historyItem => ({
          version: historyItem.version,
          changes: historyItem.changes,
          date: historyItem.date
        }));
      }
  
      return dto;
    });
  
    const pageMetaDto = new PageMetaDto({
      pageOptionsDto: {
        page: parseInt(query.page),
        take: parseInt(query.limit),
      },
      itemCount: count,
    });
  
    return new PageDto(responseDtos, pageMetaDto);
  }

  async update(
    id: number,
    updateData: UpdateArticleDto & { 
      justificatifFile?: Express.Multer.File;
    }
  ): Promise<ArticleEntity> {
    // 1. Récupérer l'article existant
    const article = await this.findOneById(id);
    
    // 2. Vérifier si l'article est archivé
    if (article.status === 'archived') {
      throw new BadRequestException(
        'Les articles avec le statut "archived" ne peuvent pas être modifiés.'
      );
    }
  
    // 3. Préparer les données de mise à jour
    const updatePayload: Partial<ArticleEntity> = {
      ...updateData,
      version: article.version + 1
    };
  
    // 4. Gérer le fichier justificatif si présent
    if (updateData.justificatifFile) {
      updatePayload.justificatifFile = updateData.justificatifFile;
      updatePayload.justificatifFileName = updateData.justificatifFile.originalname;
      updatePayload.justificatifMimeType = updateData.justificatifFile.mimetype;
      updatePayload.justificatifFileSize = updateData.justificatifFile.size;
    }
  
    // 5. Enregistrer les changements dans l'historique
    const changes = this.getChanges(article, updatePayload);
    await this.articleHistoryService.createHistoryEntry({
      version: updatePayload.version,
      changes,
      articleId: id
    });
  
    // 6. Effectuer la mise à jour
    await this.articleRepository.update(id, updatePayload);
    
    // 7. Retourner l'article mis à jour
    return this.articleRepository.findOneById(id) as Promise<ArticleEntity>;
  }

  
  private checkUpdateRestrictions(
    currentStatus: ArticleStatus,
    updateData: Partial<UpdateArticleDto>
  ): void {
    // Liste des champs qui peuvent toujours être modifiés
    const alwaysUpdatableFields = ['status', 'notes', 'quantityInStock'];
    
    // Vérifier si on essaie de modifier autre chose que les champs toujours modifiables
    const restrictedFields = Object.keys(updateData).filter(
      field => !alwaysUpdatableFields.includes(field)
    );

    if (restrictedFields.length === 0) {
      return; // Aucune restriction nécessaire
    }

    // Restrictions basées sur le statut
    switch(currentStatus) {
      case 'inactive':
        // Pour les articles inactifs, on ne peut modifier que le statut (pour les réactiver)
        throw new BadRequestException(
          'Les articles inactifs ne peuvent pas être modifiés. Activez-les d\'abord.'
        );

      case 'out_of_stock':
        // Pour les articles en rupture de stock, restrictions similaires
        throw new BadRequestException(
          'Les articles en rupture de stock ne peuvent pas être modifiés. Réapprovisionnez-les d\'abord.'
        );

      case 'archived':
      case 'deleted':
        // Pas de modifications possibles pour ces statuts
        throw new BadRequestException(
          `Les articles avec le statut "${currentStatus}" ne peuvent pas être modifiés.`
        );

      case 'draft':
      case 'pending_review':
      case 'active':
        // Pas de restrictions pour ces statuts
        break;

      default:
        throw new BadRequestException(
          `Statut "${currentStatus}" non reconnu.`
        );
    }
  }
//
  private isStatusTransitionValid(currentStatus: ArticleStatus, newStatus: ArticleStatus): boolean {
    const validTransitions: Record<ArticleStatus, ArticleStatus[]> = {
      draft: ['active', 'pending_review', 'deleted'],
      pending_review: ['draft', 'active', 'deleted'],
      active: ['inactive', 'out_of_stock', 'deleted'],
      inactive: ['active', 'archived', 'deleted'],
      out_of_stock: ['active', 'archived', 'deleted'],
      archived: [], // Aucune transition possible depuis archived
      deleted: [] // Aucune transition possible depuis deleted
    };
  
    return validTransitions[currentStatus].includes(newStatus);
  }

  private getChanges(
    existingArticle: ArticleEntity,
    newData: Partial<ArticleEntity>,
  ): Record<string, { oldValue: any; newValue: any }> {
    const changes: Record<string, { oldValue: any; newValue: any }> = {};
  
    for (const key in newData) {
      if (newData[key] !== undefined && 
          existingArticle[key] !== newData[key] &&
          key !== 'version') {
        changes[key] = {
          oldValue: existingArticle[key],
          newValue: newData[key]
        };
      }
    }
  
    return changes;
  }

  async findOneById(id: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOne({ 
      where: { id },
      relations: ['history'] 
    });
    
    if (!article) {
      throw new NotFoundException(`Article avec ID ${id} non trouvé`);
    }
    return article;
  }
  
  async softDelete(id: number): Promise<ArticleEntity> {
    const article = await this.findOneById(id);
    await this.articleRepository.softDelete(id);
    return article;
  }
  
  async getArticleDetails(id: number): Promise<ArticleEntity> {
    return this.findOneById(id);
  }
  
  async deleteAll(): Promise<void> {
    await this.articleRepository.deleteAll();
  }

  async findOneByCondition(
    query: IQueryObject,
  ): Promise<ResponseArticleDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    
    const article = await this.articleRepository.findOne({
      ...queryOptions,
      relations: ['history']
    } as FindOneOptions<ArticleEntity>);
  
    if (!article) {
      return null;
    }
  
    return this.mapToResponseDto(article);
  }
  private mapToResponseDto(entity: ArticleEntity): ResponseArticleDto {
    const dto: ResponseArticleDto = {
        id: entity.id,
        title: entity.title ?? undefined,
        description: entity.description ?? undefined,
        reference: entity.reference,
        quantityInStock: entity.quantityInStock,
        unitPrice: entity.unitPrice,
        status: entity.status,
        version: entity.version,
        notes: entity.notes ?? undefined,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt ?? undefined,
    };

    if (entity.justificatifFile) {
        // Construction d'un objet Express.Multer.File complet
        dto.justificatifFile = {
            fieldname: 'justificatifFile',
            originalname: entity.justificatifFileName,
            encoding: '7bit',
            mimetype: entity.justificatifMimeType,
            size: entity.justificatifFileSize,
            buffer: entity.justificatifFile.buffer,
            stream: null,
            destination: '',
            filename: entity.justificatifFileName,
            path: ''
        } as Express.Multer.File;
    }

    if (entity.history) {
        dto.history = entity.history.map(historyItem => ({
            version: historyItem.version,
            changes: historyItem.changes,
            date: historyItem.date
        }));
    }

    return dto;
}
  async restoreArticleVersion(articleId: number, targetVersion: number): Promise<ArticleEntity> {
    // Utilisation d'une transaction pour garantir l'intégrité des données
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // 1. Récupérer l'article actuel (sans l'historique pour économiser la mémoire)
        const currentArticle = await queryRunner.manager.findOne(ArticleEntity, {
            where: { id: articleId }
        });
        
        if (!currentArticle) {
            throw new NotFoundException('Article non trouvé');
        }

        // 2. Récupérer uniquement la version cible (optimisation)
        const targetVersionEntry = await queryRunner.manager.findOne(ArticleHistoryEntity, {
            where: {
                article: { id: articleId }, // Utilisez la relation au lieu de articleId directement
                version: targetVersion
            }
        });

        if (!targetVersionEntry) {
            throw new NotFoundException(`Version ${targetVersion} non trouvée`);
        }

        // 3. Préparer l'article restauré
        const restoredArticle = this.articleRepository.create({
            ...currentArticle,
            version: currentArticle.version + 1,
            updatedAt: new Date()
        });

        // 4. Appliquer les changements avec une vérification de type
        const changes = targetVersionEntry.changes as Record<string, { oldValue: any; newValue: any }>;
        for (const [field, change] of Object.entries(changes)) {
            if (field in restoredArticle && field !== 'id') {
                restoredArticle[field] = this.convertFieldValue(field, change.oldValue);
            }
        }

        // 5. Enregistrer les changements dans l'historique
        const newChanges = this.getChanges(currentArticle, restoredArticle);
        const newHistoryEntry = queryRunner.manager.create(ArticleHistoryEntity, {
            version: restoredArticle.version,
            changes: newChanges,
            article: { id: articleId } // Utilisez la relation
        });

        // 6. Sauvegarder tout dans la transaction
        await queryRunner.manager.save(restoredArticle);
        await queryRunner.manager.save(newHistoryEntry);

        await queryRunner.commitTransaction();

        // 7. Retourner l'article avec son historique
        return this.articleRepository.findOne({
            where: { id: articleId },
            relations: ['history']
        });
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
}


  private convertFieldValue(field: string, value: any): any {
    switch(field) {
      case 'quantityInStock':
        return parseInt(value, 10);
      case 'unitPrice':
        return parseFloat(value);
      case 'status':
        return String(value);
      default:
        return value;
    }
  }
  
  async getAvailableVersions(articleId: number): Promise<Array<{ version: number; date?: Date }>> {
    const article = await this.articleRepository.findOne({ 
      where: { id: articleId }
    });
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }
  
    const history = await this.articleHistoryService.getArticleHistory(articleId);
    const versions = history.map(entry => ({
      version: entry.version,
      date: entry.date
    }));
  
    if (!versions.some(v => v.version === article.version)) {
      versions.push({
        version: article.version,
        date: article.updatedAt || article.createdAt
      });
    }
  
    return versions.sort((a, b) => b.version - a.version);
  }

// ==============================================
  // PARTIE STATISTIQUES SIMPLIFIÉES
  // ==============================================

  async getSimpleStats() {
    // 1. Récupérer tous les articles en une seule requête
    const allArticles = await this.articleRepository.find();
    
    // 2. Calculer les statistiques de base
    const stats = {
      totalArticles: allArticles.length,
      statusCounts: {},
      statusPercentages: {},
      outOfStockCount: 0,
      totalStockValue: 0,
      averageStock: 0,
      lowStockCount: 0,
      topStockValueArticles: [],
      toArchiveSuggestions: []
    };

    // 3. Calcul des valeurs
    allArticles.forEach(article => {
      // Comptage par statut
      stats.statusCounts[article.status] = (stats.statusCounts[article.status] || 0) + 1;
      
      // Stock
      stats.totalStockValue += article.quantityInStock * article.unitPrice;
      
      // Rupture de stock
      if (article.quantityInStock === 0) {
        stats.outOfStockCount++;
      }
      
      // Stock faible (entre 1 et 5)
      if (article.quantityInStock > 0 && article.quantityInStock <= 5) {
        stats.lowStockCount++;
      }
    });

    // 4. Calcul des pourcentages
    for (const status in stats.statusCounts) {
      stats.statusPercentages[status] = 
        ((stats.statusCounts[status] / stats.totalArticles) * 100).toFixed(2) + '%';
    }

    // 5. Stock moyen
    stats.averageStock = stats.totalStockValue / stats.totalArticles;

    // 6. Top 5 des articles par valeur de stock
    stats.topStockValueArticles = allArticles
      .map(a => ({
        reference: a.reference,
        title: a.title,
        value: a.quantityInStock * a.unitPrice
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // 7. Articles à archiver (inactifs depuis +6 mois)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    stats.toArchiveSuggestions = allArticles
      .filter(a => a.status === 'inactive' && a.updatedAt < sixMonthsAgo)
      .map(a => a.reference);

    return stats;
  }

  async getStockAlerts() {
    const allArticles = await this.articleRepository.find();
    
    return {
      outOfStock: allArticles
        .filter(a => a.quantityInStock === 0)
        .map(a => ({
          reference: a.reference,
          title: a.title,
          daysOutOfStock: Math.floor((new Date().getTime() - a.updatedAt.getTime()) / (1000 * 3600 * 24))
        })),
      
      lowStock: allArticles
        .filter(a => a.quantityInStock > 0 && a.quantityInStock <= 5)
        .map(a => ({
          reference: a.reference,
          title: a.title,
          remainingStock: a.quantityInStock
        }))
    };
  }

  async getStatusOverview() {
    const allArticles = await this.articleRepository.find();
    const overview = {
      counts: {},
      examples: {}
    };

    allArticles.forEach(article => {
      // Comptage par statut
      overview.counts[article.status] = (overview.counts[article.status] || 0) + 1;
      
      // Garder 2 exemples par statut
      if (!overview.examples[article.status]) {
        overview.examples[article.status] = [];
      }
      if (overview.examples[article.status].length < 2) {
        overview.examples[article.status].push({
          reference: article.reference,
          title: article.title
        });
      }
    });

    return overview;
  }



  //////////////////////// prédiction 
  // Dans ArticleService

async getArticleQualityScores(): Promise<{
  scores: Array<{
    id: number;
    reference: string;
    title?: string;
    score: number;
    missingFields: string[];
  }>;
  incompleteArticles: Array<{
    id: number;
    reference: string;
    title?: string;
    score: number;
  }>;
}> {
  const allArticles = await this.articleRepository.find();
  
  const results = allArticles.map(article => {
    const missingFields = [];
    let score = 0;

    // Critères de qualité
    if (article.description) score += 25; else missingFields.push('description');
    if (article.justificatifFile) score += 25; else missingFields.push('justificatif');
    if (article.notes) score += 25; else missingFields.push('notes');
    if (article.quantityInStock > 0) score += 25; else missingFields.push('stock');

    return {
      id: article.id,
      reference: article.reference,
      title: article.title,
      score,
      missingFields
    };
  });

  return {
    scores: results,
    incompleteArticles: results
      .filter(item => item.score < 100)
      .sort((a, b) => a.score - b.score)
  };
}

// Dans ArticleService

async detectSuspiciousArticles(): Promise<{
  zeroPrice: Array<{ id: number; reference: string; title?: string }>;
  highStock: Array<{ id: number; reference: string; title?: string; quantity: number }>;
  invalidReference: Array<{ id: number; reference: string; title?: string }>;
}> {
  const allArticles = await this.articleRepository.find();
  const referenceRegex = /^[A-Z0-9]{3,}-[0-9]{3,}$/; // Exemple: ABC-123

  return {
    zeroPrice: allArticles
      .filter(a => a.unitPrice === 0)
      .map(a => ({ id: a.id, reference: a.reference, title: a.title })),

    highStock: allArticles
      .filter(a => a.quantityInStock > 10000)
      .map(a => ({ 
        id: a.id, 
        reference: a.reference, 
        title: a.title, 
        quantity: a.quantityInStock 
      })),

    invalidReference: allArticles
      .filter(a => !referenceRegex.test(a.reference))
      .map(a => ({ id: a.id, reference: a.reference, title: a.title }))
  };
}

// Dans ArticleService

async comparePriceTrends(): Promise<{
  oldArticles: {
    count: number;
    averagePrice: number;
  };
  newArticles: {
    count: number;
    averagePrice: number;
  };
  priceEvolution: {
    amount: number;
    percentage: number;
    trend: 'up' | 'down' | 'stable';
  };
}> {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const allArticles = await this.articleRepository.find();
  
  const oldArticles = allArticles.filter(a => a.createdAt < oneYearAgo);
  const newArticles = allArticles.filter(a => a.createdAt >= oneYearAgo);

  const avgOld = oldArticles.reduce((sum, a) => sum + a.unitPrice, 0) / (oldArticles.length || 1);
  const avgNew = newArticles.reduce((sum, a) => sum + a.unitPrice, 0) / (newArticles.length || 1);

  const amountDiff = avgNew - avgOld;
  const percentDiff = (amountDiff / avgOld) * 100;

  return {
    oldArticles: {
      count: oldArticles.length,
      averagePrice: parseFloat(avgOld.toFixed(2))
    },
    newArticles: {
      count: newArticles.length,
      averagePrice: parseFloat(avgNew.toFixed(2))
    },
    priceEvolution: {
      amount: parseFloat(amountDiff.toFixed(2)),
      percentage: parseFloat(percentDiff.toFixed(2)),
      trend: amountDiff > 0 ? 'up' : amountDiff < 0 ? 'down' : 'stable'
    }
  };
}



// Dans ArticleService

async getStockHealth(): Promise<{
  activePercentage: number;
  status: 'poor' | 'medium' | 'good';
  details: Record<string, number>;
}> {
  const allArticles = await this.articleRepository.find();
  const statusCounts = {};

  allArticles.forEach(a => {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  });

  const activePercentage = (statusCounts['active'] || 0) / allArticles.length * 100;

  return {
    activePercentage: parseFloat(activePercentage.toFixed(2)),
    status: activePercentage < 30 ? 'poor' : 
            activePercentage < 70 ? 'medium' : 'good',
    details: statusCounts
  };
}

  


/*
 
  /////////////////////////////////////////////////////








  // PDF Related Methods
 /* async createFromPdfData(pdfData: ArticleData): Promise<ArticleEntity> {
    if (!pdfData.title || !pdfData.reference) {
      throw new BadRequestException('Le titre et la référence sont obligatoires');
    }

    const createArticleDto: CreateArticleDto = {
      title: pdfData.title,
      description: pdfData.description || '',
      reference: pdfData.reference,
      quantityInStock: pdfData.quantityInStock || 0,
      status: pdfData.status || 'draft'
    };

    const existingArticle = await this.articleRepository.findOne({
      where: { reference: createArticleDto.reference }
    });

    if (existingArticle) {
      throw new BadRequestException('Un article avec cette référence existe déjà');
    }

    return this.save(createArticleDto);
  }

  async comparePdfWithArticle(
    articleId: number,
    pdfPath: string
  ): Promise<{
    matches: Record<string, boolean>;
    differences: Record<string, { articleValue: any; pdfValue: any }>;
    similarityScore: number;
  }> {
    const article = await this.findOneById(articleId);
    const pdfData = await this.pdfExtractionService.extractArticleDataFromPdf(pdfPath);
    
    const fieldsToCompare = [
      'title', 'description', 'reference', 'quantityInStock', 'status'
    ];
    
    const matches: Record<string, boolean> = {};
    const differences: Record<string, { articleValue: any; pdfValue: any }> = {};
    let matchingFields = 0;

    fieldsToCompare.forEach(field => {
      const articleValue = article[field];
      const pdfValue = pdfData[field];

      if (field === 'quantityInStock') {
        const numPdfValue = Number(pdfValue);
        matches[field] = articleValue === numPdfValue;
      } else {
        const normalizedArticle = String(articleValue || '').trim().toLowerCase();
        const normalizedPdf = String(pdfValue || '').trim().toLowerCase();
        matches[field] = normalizedArticle === normalizedPdf;
      }

      if (!matches[field]) {
        differences[field] = {
          articleValue: article[field],
          pdfValue: pdfData[field]
        };
      } else {
        matchingFields++;
      }
    });

    const similarityScore = (matchingFields / fieldsToCompare.length) * 100;
    return {
      matches,
      differences,
      similarityScore: Math.round(similarityScore * 100) / 100
    };
  }

  // OCR Related Methods
  async createFromOcrData(ocrData: ArticleData): Promise<ArticleEntity> {
    if (!ocrData.title || !ocrData.reference) {
      throw new BadRequestException('Le titre et la référence sont obligatoires');
    }

    const createArticleDto: CreateArticleDto = {
      title: ocrData.title,
      description: ocrData.description || '',
      reference: ocrData.reference,
      quantityInStock: ocrData.quantityInStock || 0,
      status: ocrData.status || 'draft'
    };

    const existingArticle = await this.articleRepository.findOne({
      where: { reference: createArticleDto.reference }
    });

    if (existingArticle) {
      throw new BadRequestException('Un article avec cette référence existe déjà');
    }

    return this.save(createArticleDto);
  }

  async searchByOcrData(ocrData: ArticleData): Promise<ArticleEntity[]> {
    const whereClauses = [];
    
    if (ocrData.title) {
      whereClauses.push({ title: ILike(`%${ocrData.title}%`) });
    }
    
    if (ocrData.reference) {
      whereClauses.push({ reference: ILike(`%${ocrData.reference}%`) });
    }
    
    if (ocrData.description) {
      whereClauses.push({ description: ILike(`%${ocrData.description}%`) });
    }

    if (whereClauses.length === 0) {
      return [];
    }

    return await this.articleRepository.find({
      where: whereClauses,
      take: 20,
      order: { createdAt: 'DESC' }
    });
  }

  async compareWithImage(
    existingArticle: ArticleEntity,
    imageFile: Express.Multer.File
  ): Promise<{
    differences: Record<string, { oldValue: any; newValue: any }>,
    ocrData: any,
    hasDifferences: boolean
  }> {
    let imagePath: string | undefined;
    
    try {
      imagePath = `./uploads/compare_${Date.now()}_${imageFile.originalname}`;
      await fs.promises.writeFile(imagePath, imageFile.buffer);

      const imageText = await this.articleOcrService.extractTextFromImage(imagePath);
      const ocrData = await this.articleOcrService.extractArticleData(imageText);
      const differences = this.findDifferences(existingArticle, ocrData);
      
      return {
        differences,
        ocrData,
        hasDifferences: Object.keys(differences).length > 0
      };
    } finally {
      if (imagePath && fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
  }

  private findDifferences(
    existingArticle: ArticleEntity, 
    ocrData: any
  ): Record<string, { oldValue: any; newValue: any }> {
    const differences: Record<string, { oldValue: any; newValue: any }> = {};
    
    const fieldsToCompare = [
      'title', 'description', 'reference', 'quantityInStock', 'status'
    ];

    fieldsToCompare.forEach(field => {
      const existingValue = existingArticle[field];
      const newValue = ocrData[field];

      if (existingValue == null && newValue == null) return;

      if (typeof existingValue === 'number') {
        const numValue = typeof newValue === 'string' ? 
          parseFloat(newValue.replace(/[^\d.-]/g, '')) : 
          Number(newValue);
        
        if (isNaN(numValue)) {
          differences[field] = { oldValue: existingValue, newValue };
          return;
        }

        if (Math.abs(existingValue - numValue) > 0.001) {
          differences[field] = { 
            oldValue: existingValue, 
            newValue: numValue 
          };
        }
        return;
      }

      const strExisting = String(existingValue ?? '').trim().toLowerCase();
      const strNew = String(newValue ?? '').trim().toLowerCase();
      
      if (strExisting !== strNew) {
        differences[field] = { 
          oldValue: existingValue, 
          newValue 
        };
      }
    });

    return differences;
  }

  // Text Similarity Methods
  async findSimilarCategories(input: string): Promise<string[]> {
    const allCategories = await this.getAllCategories();
    return allCategories.filter(category => {
      return this.textSimilarityService.normalizeText(category).includes(
        this.textSimilarityService.normalizeText(input)) ||
        this.textSimilarityService.isSimilar(input, category);
    });
  }

  async findSimilarSubCategories(input: string): Promise<string[]> {
    const allSubCategories = await this.getAllSubCategories();
    return allSubCategories.filter(subCategory => {
      const normalizedInput = this.textSimilarityService.normalizeText(input);
      const normalizedSubCat = this.textSimilarityService.normalizeText(subCategory);
      return normalizedSubCat.includes(normalizedInput) || 
             this.textSimilarityService.isSimilar(input, subCategory);
    });
  }

  async validateCategoryUniqueness(category: string): Promise<{valid: boolean; matches?: string[]}> {
    const similarCategories = await this.findSimilarCategories(category);
    return {
      valid: similarCategories.length === 0,
      matches: similarCategories
    };
  }

  async validateSubCategoryUniqueness(subCategory: string): Promise<{valid: boolean; matches?: string[]}> {
    const similarSubCategories = await this.findSimilarSubCategories(subCategory);
    return {
      valid: similarSubCategories.length === 0,
      matches: similarSubCategories
    };
  }*/

  // Basic CRUD Methods
  /*
*/
 /* async findOneByCondition(
    query: IQueryObject,
  ): Promise<ResponseArticleDto | null> {
    const queryBuilder = new QueryBuilder();
    const queryOptions = queryBuilder.build(query);
    const article = await this.articleRepository.findOne(
      queryOptions as FindOneOptions<ArticleEntity>,
    );
    if (!article) return null;
    return article;
  }

 */

  
  private generateCustomReference(): string {
    // Format: REF-520333753 (REF- + 9 chiffres aléatoires)
    const randomNumber = Math.floor(100000000 + Math.random() * 900000000); // Génère un nombre à 9 chiffres
    return `REF-${randomNumber}`;
  }

  async getTotal(): Promise<number> {
    return this.articleRepository.getTotalCount();
  }
/*
  async saveWithFilterTitle(
    createArticleDto: CreateArticleDto,
  ): Promise<ArticleEntity | null> {
    const existingArticle = await this.articleRepository.findOne({
      where: { title: createArticleDto.title },
    });

    if (existingArticle) {
      return null;
    }

    const newArticle = this.articleRepository.create({
      ...createArticleDto,
      status: createArticleDto.status || 'draft',
    });

    return await this.articleRepository.save(newArticle);
  }
*/
  
 /* */
/*
  async importExcel(file: Express.Multer.File): Promise<ArticleEntity[]> {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    const articles: CreateArticleDto[] = data.map((row: any) => ({
      title: row.title,
      description: row.description,
      reference: row.reference,
      quantityInStock: parseInt(row.quantityInStock, 10),
      status: row.status || 'draft',
    }));

    return this.saveMany(articles);
  }

  async getArticleHistory(articleId: number) {
    return this.articleHistoryService.getArticleHistory(articleId);
  }

 
 

  async getSalesPerformance(articleId: number): Promise<{ totalSales: number, totalRevenue: number }> {
    const article = await this.articleRepository.findOneById(articleId);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }

    const totalSales = article.quantityInStock || 0;
    const totalRevenue = totalSales * (article.salePrice || 0);

    return { totalSales, totalRevenue };
  }

  async adjustPrice(articleId: number, newPrice: number): Promise<ArticleEntity> {
    const article = await this.articleRepository.findOneById(articleId);
    if (!article) {
      throw new NotFoundException('Article non trouvé');
    }

    article.salePrice = newPrice;
    return this.articleRepository.save(article);
  }

 */
   /*

    const historyEntries = await this.articleHistoryService.getArticleHistory(id);
    return {
      id: article.id,
      title: article.title,
      description: article.description,
      reference: article.reference,
      quantityInStock: article.quantityInStock,
      status: article.status,
      version: article.version,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      deletedAt: article.deletedAt,
      history: historyEntries.map((entry) => ({
        version: entry.version,
        changes: entry.changes,
        date: entry.date,
      })),
    };
  }

  async getAllCategories(): Promise<string[]> {
    const articles = await this.articleRepository.findAll({
      select: ['category'],
      where: { deletedAt: null }
    });
    const categories = [...new Set(articles.map(article => article.category))];
    return categories.filter(category => category);
  }

  async getAllSubCategories(): Promise<string[]> {
    const articles = await this.articleRepository.findAll({
      select: ['subCategory'],
      where: { deletedAt: null }
    });
    const subCategories = [...new Set(articles.map(article => article.subCategory))];
    return subCategories.filter(subCat => subCat);
  }

*/
}